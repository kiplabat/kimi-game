// A scene holds entities, timers and tick handlers, and runs one fixed step at a time.

import { Entity, type EntityOpts } from "./entity";
import { SpatialHash, overlap, resolve, raycast, raycast3, type RayHit, type Ray3Hit } from "./physics";
import { steerToward, arrive } from "./ai";
import type { Game } from "./game";
import type { UI } from "./ui";
import type { Input } from "./input";
import type { BurstOpts, BeamOpts, RingOpts, CameraCtl } from "./renderer";

type V2 = [number, number];
interface Timer { id: number; t: number; every?: number; fn: () => void; dead: boolean; times?: number }

let TIMER_ID = 1;

// Sensible sizes and colours per shape so a model can write sprite.rock({ at }) and get a rock.
const DEF: Record<string, [number, number, string]> = {
  // shape: [2D radius px, 3D radius units, colour]
  ship: [16, 0.9, "#3fd0e0"], rock: [22, 1.2, "#8a7f74"], ball: [10, 0.5, "#ffffff"], coin: [10, 0.5, "#ffd166"],
  bullet: [4, 0.22, "#fff27a"], character: [14, 0.7, "#ff9f43"], drone: [14, 0.7, "#ff4d8d"], orb: [10, 0.45, "#7cf6ff"],
  crystal: [14, 0.8, "#b48bff"], tank: [18, 1.1, "#7fb069"], car: [18, 1.1, "#ff5d5d"], tree: [18, 1, "#3fa34d"],
  boss: [48, 3.2, "#ff3366"], star: [12, 0.6, "#ffe066"], pillar: [20, 1.4, "#39425f"], circle: [12, 0.6, "#e8eefc"],
  enemy: [14, 0.7, "#ff4d8d"], player: [16, 0.9, "#3fd0e0"], food: [10, 0.5, "#7bed9f"],
};
function withDefaults(o: EntityOpts, mode: "2d" | "3d"): EntityOpts {
  const d = DEF[o.shape ?? ""];
  if (!d) return o;
  return { ...o, radius: o.radius ?? (o.box ? undefined : mode === "2d" ? d[0] : d[1]), color: o.color ?? d[2] };
}

export class Scene {
  readonly entities: Entity[] = [];
  time = 0;
  readonly hash: SpatialHash;
  /** Static things (walls, props) live in their own hash, rebuilt only when one is added or removed. */
  readonly staticHash: SpatialHash;
  private staticDirty = true;
  private timers: Timer[] = [];
  private tickFns: ((dt: number, s: Scene) => void)[] = [];
  _drawFns: ((ctx: CanvasRenderingContext2D, s: Scene) => void)[] = [];
  private endFns: (() => void)[] = [];
  collisions = 0;
  ended = false;

  constructor(public readonly g: Game, public readonly name: string, public readonly params: any) {
    this.hash = new SpatialHash(g.mode === "3d" ? 6 : 96);
    this.staticHash = new SpatialHash(g.mode === "3d" ? 6 : 96);
  }

  get ui(): UI { return this.g.ui; }
  get input(): Input { return this.g.input; }
  get camera(): CameraCtl { return this.g.renderer.camera; }

  /** Add an entity from options (or a made Entity). Returns it. */
  add(o: EntityOpts | Entity): Entity {
    const e = o instanceof Entity ? o : new Entity(withDefaults(o, this.g.mode));
    e.scene = this;
    e._place(this.g.mode);
    if (e.opts.static) this.staticDirty = true;
    if (e.opts.controls === "twin") this.g.input.wantsAimStick = true;
    this.entities.push(e);
    this.g.renderer.attach(e);
    return e;
  }
  /** Add several at once. */
  addAll(list: EntityOpts[]) { return list.map((o) => this.add(o)); }

  /** Run fn every `sec` seconds of game time (optionally a number of times). */
  every(sec: number, fn: () => void, times?: number) {
    const t: Timer = { id: TIMER_ID++, t: sec, every: sec, fn, dead: false, times };
    this.timers.push(t);
    return { cancel: () => (t.dead = true), set every(v: number) { t.every = v; } };
  }
  /** Run fn once after `sec` seconds of game time. */
  after(sec: number, fn: () => void) {
    const t: Timer = { id: TIMER_ID++, t: sec, fn, dead: false };
    this.timers.push(t);
    return { cancel: () => (t.dead = true) };
  }

  /** s.on("tick", fn(dt)) every step; s.on("draw", fn(ctx)) in 2D after entities; s.on("end", fn). */
  on(ev: "tick", fn: (dt: number, s: Scene) => void): this;
  on(ev: "draw", fn: (ctx: CanvasRenderingContext2D, s: Scene) => void): this;
  on(ev: "end", fn: () => void): this;
  on(ev: string, fn: any) {
    if (ev === "tick") this.tickFns.push(fn);
    else if (ev === "draw") this._drawFns.push(fn);
    else if (ev === "end") this.endFns.push(fn);
    return this;
  }

  // ---------- queries ----------
  find(tag?: string): Entity[] {
    return this.entities.filter((e) => e.alive && (!tag || e.tags.has(tag)));
  }
  count(tag?: string) {
    let n = 0;
    for (const e of this.entities) if (e.alive && (!tag || e.tags.has(tag))) n++;
    return n;
  }
  first(tag: string) {
    return this.entities.find((e) => e.alive && e.tags.has(tag)) ?? null;
  }
  /** Nearest living entity with the tag to a point or entity (optionally within max). */
  nearest(tag: string, from: Entity | V2, max = Infinity): Entity | null {
    const p = from instanceof Entity ? from.p : from;
    let best: Entity | null = null, bd = max;
    for (const e of this.entities) {
      if (!e.alive || !e.tags.has(tag) || e === from) continue;
      const [x, y] = e.p;
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  /** Living entities with the tag within r of a point. */
  within(tag: string, at: V2, r: number): Entity[] {
    const out: Entity[] = [];
    for (const e of this.query(at[0], at[1], r)) {
      if (!e.alive || !e.tags.has(tag)) continue;
      const [x, y] = e.p;
      if (Math.hypot(x - at[0], y - at[1]) <= r + e.radius) out.push(e);
    }
    return out;
  }
  /** Nearest entity with one of the tags along a ray on the plane. */
  ray(from: V2, dir: V2, max = 1e4, tags?: string[], ignore?: Entity): RayHit | null {
    return raycast(this.entities, from, dir, max, tags, ignore);
  }

  /** 3D ray (boxes, capsules with head shots, spheres): s.ray3([x,y,z], [dx,dy,dz], 200, ["wall","npc"], me). */
  ray3(from: [number, number, number], dir: [number, number, number], max = 1e4, tags?: string[], ignore?: Entity | Entity[]): Ray3Hit | null {
    // broadphase: walk the hash cells along the ray instead of testing every entity
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const dx = dir[0] / l, dz = dir[2] / l;
    const plane = Math.hypot(dx, dz);
    const c = this.hash.cell;
    const seen = new Set<number>();
    const cand: Entity[] = [];
    const buf: Entity[] = [];
    const take = (x: number, z: number, r: number) => {
      buf.length = 0;
      for (const e of this.query(x, z, r, buf)) if (!seen.has(e.id)) { seen.add(e.id); cand.push(e); }
    };
    if (this.g.mode !== "3d" || plane < 1e-3) take(from[0], from[2], c);
    else {
      const step = (c * 0.5) / plane;
      for (let t = 0; t <= max + step; t += step) take(from[0] + dx * t, from[2] + dz * t, c * 0.75);
    }
    return raycast3(cand, from, dir, max, tags, ignore);
  }

  // ---------- effects ----------
  private at3(at: Entity | number[]): number[] {
    if (at instanceof Entity) return [at.x, at.y, at.z];
    if (this.g.mode === "3d" && at.length === 2) return [at[0], 0.6, at[1]];
    return at;
  }
  /** Particles: s.burst(e, { count: 30, color: "#ff0", speed: 8 }). */
  burst(at: Entity | number[], o: BurstOpts = {}) { this.g.renderer.burst(this.at3(at), o); }
  /** A line that fades: lasers, lightning, aim guides. */
  beam(a: Entity | number[], b: Entity | number[], o: BeamOpts = {}) { this.g.renderer.beam(this.at3(a), this.at3(b), o); }
  /** An expanding ring: shockwaves, pickups. */
  ring(at: Entity | number[], o: RingOpts = {}) { this.g.renderer.ring(this.at3(at), o); }
  /** Camera shake, 0..1. */
  shake(amount = 0.3) { this.g.renderer.camera.shake(amount); }
  /** Floating text at a world position. */
  popup(at: Entity | number[], text: string, color?: string) {
    const p = this.at3(at);
    const s = this.g.renderer.project(p[0], p[1], p[2] ?? 0);
    if (s) this.g.ui.popup(s.x, s.y, text, color);
  }

  // ---------- the step ----------
  step(dt: number, dtReal: number) {
    const g = this.g;
    this.time += dt;
    // after game over the world keeps moving (in slow motion) but the game's own logic stops
    const live = g.state !== "over";
    for (const t of live ? this.timers : []) {
      if (t.dead) continue;
      t.t -= dt;
      if (t.t <= 0) {
        try { t.fn(); } catch (err) { g._error(err); }
        if (t.every !== undefined && (t.times === undefined || --t.times > 0)) t.t += t.every;
        else t.dead = true;
      }
    }
    this.timers = this.timers.filter((t) => !t.dead);
    if (live) for (const f of this.tickFns) { try { f(dt, this); } catch (err) { g._error(err); } }
    this.ui.tick(dt);

    // rebuild the spatial hash at the start so queries during AI are fresh
    this.reindex();

    const n = this.entities.length;
    const is3d = g.mode === "3d";
    for (let i = 0; i < n; i++) {
      const e = this.entities[i];
      if (!e.alive) continue;
      if (e.opts.static && !e._tick.length && !e._ai.length) continue;
      const d = e.opts.unscaled ? dtReal : dt;
      e.ox = e.x; e.oy = e.y; e.oz = e.z; e.orot = e.rot;
      e.age += d;
      if (e.flashT > 0) e.flashT -= dtReal;
      if (e.invuln > 0) e.invuln -= d;
      try {
        if (e.opts.controls && e.opts.controls !== "none") this.control(e, d);
        for (const f of e._ai) f(e, d, this);
        for (const f of e._tick) f(d, e);
      } catch (err) { g._error(err); }
      if (!e.alive) continue;
      this.integrate(e, d, is3d);
      if (typeof e.opts.dies === "number" && e.age >= e.opts.dies) e.die("expired");
    }

    // collisions
    this.reindex();
    const buf: Entity[] = [];
    for (let pass = 0; pass < 2; pass++) {
      for (const a of this.entities) {
        if (!a.alive || !a.opts.solid || a.opts.static) continue;
        const [x, y] = a.p;
        buf.length = 0;
        for (const b of this.query(x, y, this.bound(a), buf)) {
          if (b === a || !b.alive || !b.opts.solid) continue;
          if (!b.opts.static && b.id < a.id && !Array.isArray(b.opts.solid)) continue;
          const sa = a.opts.solid, sb = b.opts.solid;
          if (Array.isArray(sa) && !sa.some((t) => b.tags.has(t))) continue;
          if (Array.isArray(sb) && !sb.some((t) => a.tags.has(t))) continue;
          const c = overlap(a, b);
          if (c) { resolve(a, b, c); if (pass === 0) this.collisions++; }
        }
      }
    }
    for (const a of this.entities) {
      if (!a.alive || (a._hit.size === 0 && a._overlap.size === 0)) continue;
      const [x, y] = a.p;
      buf.length = 0;
      const near = this.query(x, y, this.bound(a), buf);
      const now = new Set<number>();
      for (const b of near) {
        if (b === a || !b.alive) continue;
        let wants = false;
        for (const t of a._hit.keys()) if (b.tags.has(t)) wants = true;
        for (const t of a._overlap.keys()) if (b.tags.has(t)) wants = true;
        if (!wants) continue;
        if (!overlap(a, b)) continue;
        now.add(b.id);
        try {
          if (!a.contacts.has(b.id)) {
            this.collisions++;
            a.data._everHit = true;
            b.data._everHit = true;
            for (const [t, fns] of a._hit) if (b.tags.has(t)) for (const f of fns) { if (a.alive && b.alive) f(b, a); }
          }
          for (const [t, fns] of a._overlap) if (b.tags.has(t)) for (const f of fns) { if (a.alive && b.alive) f(b, a); }
        } catch (err) { g._error(err); }
        if (!a.alive) break;
      }
      a.contacts = now;
    }

    // remove the dead
    const eps = is3d ? 0.05 : 1.5;
    let w = 0;
    for (const e of this.entities) {
      if (e.alive) { if (!e.opts.static) e._checkMoved(eps); this.entities[w++] = e; }
      else { g.renderer.detach(e); if (e.opts.static) this.staticDirty = true; }
    }
    this.entities.length = w;
  }

  /** Moving things are re-hashed every step; static ones only when they change. */
  private reindex() {
    if (this.staticDirty) {
      this.staticHash.clear();
      for (const e of this.entities) if (e.alive && e.opts.static) this.staticHash.insert(e);
      this.staticDirty = false;
    }
    this.hash.clear();
    for (const e of this.entities) if (e.alive && !e.opts.static) this.hash.insert(e);
  }
  /** Everything whose cells touch a circle on the plane (moving and static). */
  query(x: number, y: number, r: number, out: Entity[] = []): Entity[] {
    this.hash.query(x, y, r, out);
    return this.staticHash.query(x, y, r, out);
  }

  private bound(e: Entity) {
    if (e.box) return Math.max(e.box[0], e.is3d ? e.box[2] ?? e.box[0] : e.box[1]) * 0.5 * e.scale;
    return e.radius * e.scale;
  }

  /** Player controls by scheme. */
  private control(e: Entity, dt: number) {
    const g = this.g, inp = g.input;
    const scheme = e.opts.controls!;
    const pl = e.opts.player ?? 0;
    const sp = e.speed || (g.mode === "3d" ? 10 : 300);
    let mv = inp.move(scheme === "arrows" || scheme === "wasd" ? scheme : "keys", pl);
    if (g.mode === "3d") {
      const yaw = g.renderer.camera.yaw;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      mv = { x: mv.x * c - mv.y * s, y: mv.x * s + mv.y * c };
    }
    const axis = e.opts.axis;
    if (scheme === "platformer") {
      const [vx] = e.v;
      const target = mv.x * sp;
      const acc = (e.opts.accel ?? sp * 8) * dt * (e.onGround ? 1 : 0.6);
      e.vx = vx + Math.max(-acc, Math.min(acc, target - vx));
      if ((inp.pressed("jump") || (inp.pressed("up") && !inp.used.has("jump"))) && e.onGround) {
        e.vy = -(e.opts.jump ?? 520);
        e.onGround = false;
        e.data.jumped = true;
      }
      if (inp.released("jump") && e.vy < 0) e.vy *= 0.5; // short hop
      if (Math.abs(mv.x) > 0.1) e.data.faceX = Math.sign(mv.x);
      return;
    }
    if (scheme === "mouse" && inp.pointer.moved && inp.using !== "pad" && Math.hypot(mv.x, mv.y) < 0.1) {
      const w = inp.pointer.world;
      let to: V2 = [w.x, w.y];
      if (axis === "x") to = [w.x, e.p[1]];
      if (axis === "y") to = [e.p[0], w.y];
      steerToward(e, arrive(e, to, sp, g.mode === "3d" ? 2 : 60), dt, e.opts.accel ?? sp * 12);
    } else {
      let x = mv.x, y = mv.y;
      if (axis === "x") y = 0;
      if (axis === "y") x = 0;
      steerToward(e, [x * sp, y * sp], dt, e.opts.accel ?? sp * 8);
    }
    if (scheme === "twin") {
      const rs = inp.rightStick(pl);
      if (rs) {
        const l = Math.hypot(rs.x, rs.y);
        let ax = rs.x / l, ay = rs.y / l;
        if (g.mode === "3d") {
          const yaw = g.renderer.camera.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
          [ax, ay] = [ax * c - ay * s, ax * s + ay * c];
        }
        e.aim = [ax, ay];
      } else if (inp.using === "keys" && inp.pointer.inside) {
        const w = inp.pointer.world;
        const [px, py] = e.p;
        const dx = w.x - px, dy = w.y - py;
        const l = Math.hypot(dx, dy);
        if (l > 0.01) e.aim = [dx / l, dy / l];
      } else if (Math.hypot(mv.x, mv.y) > 0.2) {
        const l = Math.hypot(mv.x, mv.y);
        e.aim = [mv.x / l, mv.y / l];
      }
    }
  }

  private integrate(e: Entity, d: number, is3d: boolean) {
    const o = e.opts;
    if (o.static) return;
    e.onGround = false;
    if (o.gravity) {
      if (is3d) e.vy -= o.gravity * d;
      else e.vy += o.gravity * d;
    }
    if (o.drag) {
      const k = Math.exp(-o.drag * d);
      e.vx *= k; e.vz *= k;
      if (!is3d && !o.gravity) e.vy *= k;
      if (!is3d && o.gravity) { /* keep vertical speed for platformers */ }
    }
    if (o.maxSpeed) {
      const [a, b] = e.v;
      const l = Math.hypot(a, b);
      if (l > o.maxSpeed) e.v = [(a / l) * o.maxSpeed, (b / l) * o.maxSpeed];
    }
    e.x += e.vx * d;
    e.y += e.vy * d;
    e.z += e.vz * d;
    if (is3d) {
      const ground = o.height ?? (e.box ? e.box[1] / 2 : e.radius);
      if (o.gravity && e.y <= ground) { e.y = ground; if (e.vy < 0) e.vy = 0; e.onGround = true; }
    }
    if (o.spin) e.rot += o.spin * d;
    const face = o.face ?? (o.controls === "twin" ? "aim" : o.spin || e.box ? "none" : "move");
    if (face === "aim") e.rot = Math.atan2(e.aim[1], e.aim[0]);
    else if (face === "move") {
      const [a, b] = e.v;
      if (a * a + b * b > (is3d ? 0.05 : 25)) {
        const want = Math.atan2(b, a);
        let diff = want - e.rot;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        e.rot += diff * Math.min(1, d * 14);
      }
    }
    // trail
    if (o.trail) {
      const tr = typeof o.trail === "object" ? o.trail : {};
      e._trailT -= d;
      if (e._trailT <= 0) {
        e._trailT = tr.every ?? 0.03;
        this.g.renderer.burst([e.x, e.y, e.z], {
          count: 1, color: tr.color ?? o.color ?? "#fff", speed: 0, life: 0.35,
          size: tr.size ?? (is3d ? e.radius * 0.9 : e.radius * 0.8), fade: true,
        });
      }
    }
    this.applyBounds(e);
  }

  private applyBounds(e: Entity) {
    const b = this.g.bounds;
    const mode = e.opts.bounds ?? (e.opts.controls && e.opts.controls !== "none" ? "clamp" : "none");
    const dies = e.opts.dies === "offscreen" || e.opts.dies === "bounds";
    if (mode === "none" && !dies) return;
    const r = e.radius * e.scale;
    const [x, y] = e.p;
    if (b.kind === "circle") {
      const dx = x - b.cx, dy = y - b.cy;
      const d = Math.hypot(dx, dy);
      if (dies && d > b.r + r * 2) { e.die("offscreen"); return; }
      const lim = b.r - r;
      if (d > lim && d > 0) {
        const nx = dx / d, ny = dy / d;
        e.data.edge = "edge";
        if (mode === "clamp" || mode === "bounce") {
          e.p = [b.cx + nx * lim, b.cy + ny * lim];
          const [vx, vy] = e.v;
          const vn = vx * nx + vy * ny;
          if (vn > 0) {
            const k = mode === "bounce" ? 1 + (e.opts.bounce ?? 1) : 1;
            e.v = [vx - nx * vn * k, vy - ny * vn * k];
          }
        } else if (mode === "die") e.die("bounds");
        else if (mode === "wrap") e.p = [b.cx - nx * lim, b.cy - ny * lim];
      }
      return;
    }
    let view = b;
    if (dies && e.opts.dies === "offscreen" && this.g.mode === "2d") view = this.g.renderer.view() ?? b;
    if (dies && (x < view.x0 - r * 2 || x > view.x1 + r * 2 || y < view.y0 - r * 2 || y > view.y1 + r * 2)) { e.die("offscreen"); return; }
    if (mode === "none") return;
    let nx = x, ny = y;
    let [vx, vy] = e.v;
    const bounce = e.opts.bounce ?? 1;
    if (mode === "wrap") {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (x < b.x0 - r) nx += w + 2 * r; else if (x > b.x1 + r) nx -= w + 2 * r;
      if (y < b.y0 - r) ny += h + 2 * r; else if (y > b.y1 + r) ny -= h + 2 * r;
    } else if (mode === "die") {
      if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) e.die("bounds");
      return;
    } else {
      const hw = e.box ? e.box[0] / 2 : r;
      const hh = e.box ? (this.g.mode === "3d" ? e.box[2] ?? e.box[0] : e.box[1]) / 2 : r;
      if (nx < b.x0 + hw) { nx = b.x0 + hw; if (vx < 0) vx = mode === "bounce" ? -vx * bounce : 0; e.data.edge = "left"; }
      if (nx > b.x1 - hw) { nx = b.x1 - hw; if (vx > 0) vx = mode === "bounce" ? -vx * bounce : 0; e.data.edge = "right"; }
      if (ny < b.y0 + hh) { ny = b.y0 + hh; if (vy < 0) vy = mode === "bounce" ? -vy * bounce : 0; e.data.edge = "top"; }
      if (ny > b.y1 - hh) {
        ny = b.y1 - hh;
        if (vy > 0) vy = mode === "bounce" ? -vy * bounce : 0;
        e.data.edge = "bottom";
        if (!this.g.renderer.is3d) e.onGround = true;
      }
    }
    e.p = [nx, ny];
    e.v = [vx, vy];
  }

  _end() {
    if (this.ended) return;
    this.ended = true;
    for (const f of this.endFns) try { f(); } catch {}
  }
}
