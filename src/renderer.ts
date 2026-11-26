// Shared renderer types and the 2D canvas renderer with its built-in shapes.

import type { Entity } from "./entity";
import type { Game } from "./game";
import { lerp, angleLerp, rng } from "./math";

export interface BurstOpts {
  count?: number;
  color?: string | string[];
  /** Start speed (units/s). 2D pixels, 3D world units. */
  speed?: number;
  life?: number;
  size?: number;
  gravity?: number;
  /** Direction [x,y] on the plane and spread (radians); default all around. */
  dir?: [number, number];
  spread?: number;
  fade?: boolean;
  /** 3D only: also spray upward. */
  up?: number;
}
export interface BeamOpts { color?: string; width?: number; life?: number }
export interface RingOpts { color?: string; radius?: number; life?: number; width?: number }
export interface Rect { kind: "rect"; x0: number; y0: number; x1: number; y1: number }
export interface Circle { kind: "circle"; cx: number; cy: number; r: number }
export type Bounds = Rect | Circle;

export interface CameraCtl {
  /** 3D: yaw of the camera (movement is camera-relative). 2D: 0. */
  yaw: number;
  shake(amount: number): void;
  /** 2D: follow an entity. 3D: same as topdown(). */
  follow(e: Entity, o?: { lerp?: number; lead?: number }): void;
  /** 3D cameras. */
  topdown(e: Entity | null, o?: { height?: number; distance?: number; tilt?: number; lerp?: number; lead?: number }): void;
  chase(e: Entity, o?: { distance?: number; height?: number; lerp?: number }): void;
  orbit(at: [number, number] | Entity, o?: { radius?: number; height?: number; speed?: number }): void;
  firstPerson(e: Entity, o?: { height?: number }): void;
  fixed(pos: number[], lookAt: number[]): void;
  /** 2D: centre on a point. */
  center(x: number, y: number): void;
  zoom: number;
}

export interface Renderer {
  readonly is3d: boolean;
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraCtl;
  attach(e: Entity): void;
  detach(e: Entity): void;
  render(alpha: number, dt: number): void;
  burst(at: number[], o: BurstOpts): void;
  beam(a: number[], b: number[], o: BeamOpts): void;
  ring(at: number[], o: RingOpts): void;
  /** World → CSS pixels inside the game root (or null when behind the camera). */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Fills input.pointer.world from the pointer position. */
  updatePointer(): void;
  /** The visible world rectangle (2D). */
  view(): Rect | null;
  clear(): void;
  resize(): void;
  describe(): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 2D
// ---------------------------------------------------------------------------

type Shape2D = (c: CanvasRenderingContext2D, e: Entity, r: number, col: string, col2: string) => void;

const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
};
const polyCache = new Map<number, number[]>();

export const SHAPES_2D: Record<string, Shape2D> = {
  ship(c, _e, r, col, col2) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(r * 1.25, 0);
    c.lineTo(-r * 0.9, r * 0.85);
    c.lineTo(-r * 0.45, 0);
    c.lineTo(-r * 0.9, -r * 0.85);
    c.closePath();
    c.fill();
    c.fillStyle = col2;
    c.beginPath();
    c.ellipse(r * 0.2, 0, r * 0.32, r * 0.18, 0, 0, Math.PI * 2);
    c.fill();
  },
  rock(c, e, r, col, col2) {
    let pts = polyCache.get(e.id);
    if (!pts) {
      const g = rng(e.id * 7919);
      pts = [];
      for (let i = 0; i < 9; i++) pts.push(0.75 + g.next() * 0.35);
      polyCache.set(e.id, pts);
      if (polyCache.size > 2000) polyCache.delete(polyCache.keys().next().value!);
    }
    c.fillStyle = col;
    c.strokeStyle = col2;
    c.lineWidth = Math.max(1, r * 0.12);
    c.beginPath();
    pts.forEach((k, i) => {
      const a = (i / pts!.length) * Math.PI * 2;
      const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.closePath();
    c.fill();
    c.stroke();
  },
  ball(c, _e, r, col) {
    c.fillStyle = col;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255,255,255,.45)";
    c.beginPath();
    c.arc(-r * 0.3, -r * 0.35, r * 0.32, 0, Math.PI * 2);
    c.fill();
  },
  paddle(c, e, r, col) {
    const [w, h] = e.box ?? [r * 0.5, r * 2];
    c.fillStyle = col;
    rr(c, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
    c.fill();
  },
  block(c, e, r, col, col2) {
    const [w, h] = e.box ?? [r * 2, r * 2];
    c.fillStyle = col;
    rr(c, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.12);
    c.fill();
    c.fillStyle = col2;
    c.globalAlpha *= 0.35;
    c.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, Math.max(2, h * 0.18));
    c.globalAlpha /= 0.35;
  },
  coin(c, e, r, col, col2) {
    const sx = Math.abs(Math.cos(e.age * 4)) * 0.8 + 0.2;
    c.scale(sx, 1);
    c.fillStyle = col;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = col2;
    c.lineWidth = r * 0.18;
    c.beginPath();
    c.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    c.stroke();
  },
  bullet(c, _e, r, col) {
    c.fillStyle = col;
    rr(c, -r * 1.8, -r * 0.6, r * 3.6, r * 1.2, r * 0.6);
    c.fill();
  },
  character(c, e, r, col, col2) {
    const f = e.data.faceX ?? 1;
    c.scale(f, 1);
    c.rotate(-e.rot);
    c.fillStyle = col;
    rr(c, -r * 0.75, -r * 0.55, r * 1.5, r * 1.55, r * 0.4);
    c.fill();
    c.beginPath();
    c.arc(0, -r * 0.85, r * 0.55, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col2;
    c.beginPath();
    c.arc(r * 0.22, -r * 0.9, r * 0.13, 0, Math.PI * 2);
    c.fill();
  },
  drone(c, e, r, col, col2) {
    c.rotate(e.age * 3);
    c.strokeStyle = col;
    c.lineWidth = r * 0.22;
    for (let i = 0; i < 4; i++) {
      c.rotate(Math.PI / 2);
      c.beginPath();
      c.moveTo(r * 0.3, 0);
      c.lineTo(r * 1.1, 0);
      c.stroke();
    }
    c.fillStyle = col2;
    c.beginPath();
    c.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    c.fill();
  },
  orb(c, _e, r, col) {
    const gr = c.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, "#fff");
    gr.addColorStop(0.35, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = gr;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
  },
  crystal(c, _e, r, col, col2) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(r, 0); c.lineTo(0, r * 0.6); c.lineTo(-r, 0); c.lineTo(0, -r * 0.6);
    c.closePath();
    c.fill();
    c.fillStyle = col2;
    c.globalAlpha *= 0.5;
    c.beginPath();
    c.moveTo(r, 0); c.lineTo(0, -r * 0.6); c.lineTo(0, 0);
    c.fill();
    c.globalAlpha /= 0.5;
  },
  tank(c, e, r, col, col2) {
    c.fillStyle = col;
    rr(c, -r, -r * 0.75, r * 2, r * 1.5, r * 0.2);
    c.fill();
    c.save();
    c.rotate(Math.atan2(e.aim[1], e.aim[0]) - e.rot);
    c.fillStyle = col2;
    c.fillRect(0, -r * 0.14, r * 1.4, r * 0.28);
    c.beginPath();
    c.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  car(c, _e, r, col, col2) {
    c.fillStyle = col;
    rr(c, -r * 1.1, -r * 0.6, r * 2.2, r * 1.2, r * 0.35);
    c.fill();
    c.fillStyle = col2;
    rr(c, -r * 0.2, -r * 0.45, r * 0.75, r * 0.9, r * 0.2);
    c.fill();
  },
  tree(c, _e, r, col, col2) {
    c.fillStyle = col2;
    c.fillRect(-r * 0.15, 0, r * 0.3, r);
    c.fillStyle = col;
    c.beginPath();
    c.arc(0, -r * 0.1, r * 0.85, 0, Math.PI * 2);
    c.fill();
  },
  building(c, e, r, col, col2) {
    const [w, h] = e.box ?? [r * 2, r * 2];
    c.fillStyle = col;
    c.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = col2;
    for (let y = -h / 2 + 6; y < h / 2 - 8; y += 12)
      for (let x = -w / 2 + 6; x < w / 2 - 6; x += 12) c.fillRect(x, y, 5, 6);
  },
  boss(c, e, r, col, col2) {
    c.rotate(e.age * 0.6);
    c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const k = i % 2 ? 0.78 : 1.08;
      i ? c.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k) : c.moveTo(Math.cos(a) * r * k, 0);
    }
    c.closePath();
    c.fill();
    c.fillStyle = col2;
    c.beginPath();
    c.arc(0, 0, r * 0.38, 0, Math.PI * 2);
    c.fill();
  },
  star(c, e, r, col) {
    c.rotate(e.age * 2);
    c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const k = i % 2 ? 0.45 : 1;
      i ? c.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k) : c.moveTo(Math.cos(a) * r * k, Math.sin(a) * r * k);
    }
    c.closePath();
    c.fill();
  },
  circle(c, _e, r, col) {
    c.fillStyle = col;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
  },
};
SHAPES_2D.wall = SHAPES_2D.block;
SHAPES_2D.pillar = SHAPES_2D.block;
SHAPES_2D.platform = SHAPES_2D.block;
SHAPES_2D.enemy = SHAPES_2D.drone;
SHAPES_2D.player = SHAPES_2D.ship;
SHAPES_2D.snake = SHAPES_2D.block;
SHAPES_2D.food = SHAPES_2D.coin;

interface P2 { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; g: number; fade: boolean }

export class Render2D implements Renderer {
  readonly is3d = false;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private W: number; private H: number;
  private scale = 1; private dpr = 1; private offX = 0; private offY = 0;
  private parts: P2[] = [];
  private beams: { a: number[]; b: number[]; color: string; width: number; life: number; max: number }[] = [];
  private rings: { at: number[]; color: string; r: number; life: number; max: number; width: number }[] = [];
  private stars: { x: number; y: number; z: number }[] = [];
  private cam = { x: 0, y: 0, tx: 0, ty: 0, trauma: 0, target: null as Entity | null, lerp: 6, lead: 0, sx: 0, sy: 0 };
  camera: CameraCtl;

  constructor(private g: Game) {
    this.W = g.size[0];
    this.H = g.size[1];
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    g.root.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.cam.x = this.cam.tx = this.W / 2;
    this.cam.y = this.cam.ty = this.H / 2;
    const r = rng(7);
    for (let i = 0; i < 160; i++) this.stars.push({ x: r.next(), y: r.next(), z: 0.2 + r.next() * 0.8 });
    const self = this;
    this.camera = {
      yaw: 0,
      zoom: 1,
      shake(a) { self.cam.trauma = Math.min(1, self.cam.trauma + a); },
      follow(e, o = {}) { self.cam.target = e; self.cam.lerp = o.lerp ?? 6; self.cam.lead = o.lead ?? 0; },
      topdown(e, o) { if (e) this.follow(e, o); },
      chase(e, o) { this.follow(e, o); },
      orbit() {}, firstPerson() {}, fixed() {},
      center(x, y) { self.cam.target = null; self.cam.tx = x; self.cam.ty = y; },
    };
    this.resize();
  }

  resize() {
    const rw = this.g.root.clientWidth || this.W, rh = this.g.root.clientHeight || this.H;
    this.scale = Math.min(rw / this.W, rh / this.H);
    this.dpr = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round(this.W * this.scale), ch = Math.round(this.H * this.scale);
    this.canvas.style.width = cw + "px";
    this.canvas.style.height = ch + "px";
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.offX = (rw - cw) / 2;
    this.offY = (rh - ch) / 2;
  }

  attach() {}
  detach(e: Entity) { polyCache.delete(e.id); }
  clear() {
    this.parts.length = 0;
    this.beams.length = 0;
    this.rings.length = 0;
    this.cam.target = null;
    this.cam.trauma = 0;
    this.cam.x = this.cam.tx = this.W / 2;
    this.cam.y = this.cam.ty = this.H / 2;
  }

  view(): Rect {
    const z = this.camera.zoom;
    return { kind: "rect", x0: this.cam.x - this.W / 2 / z, y0: this.cam.y - this.H / 2 / z, x1: this.cam.x + this.W / 2 / z, y1: this.cam.y + this.H / 2 / z };
  }
  project(x: number, y: number) {
    const z = this.camera.zoom;
    return {
      x: this.offX + ((x - this.cam.x) * z + this.W / 2) * this.scale,
      y: this.offY + ((y - this.cam.y) * z + this.H / 2) * this.scale,
    };
  }
  updatePointer() {
    const p = this.g.input.pointer;
    const z = this.camera.zoom;
    p.world.x = ((p.x - this.offX) / this.scale - this.W / 2) / z + this.cam.x;
    p.world.y = ((p.y - this.offY) / this.scale - this.H / 2) / z + this.cam.y;
  }

  burst(at: number[], o: BurstOpts) {
    const n = o.count ?? 16;
    const r = this.g.rand;
    for (let i = 0; i < n && this.parts.length < 3000; i++) {
      let ang = r(0, Math.PI * 2);
      if (o.dir) ang = Math.atan2(o.dir[1], o.dir[0]) + r(-(o.spread ?? 0.5), o.spread ?? 0.5);
      const sp = (o.speed ?? 180) * r(0.3, 1);
      const col = Array.isArray(o.color) ? o.color[i % o.color.length] : o.color ?? "#fff";
      const life = (o.life ?? 0.6) * r(0.6, 1);
      this.parts.push({ x: at[0], y: at[1], vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size: (o.size ?? 3) * r(0.6, 1.3), color: col, g: o.gravity ?? 0, fade: o.fade ?? true });
    }
  }
  beam(a: number[], b: number[], o: BeamOpts) {
    this.beams.push({ a, b, color: o.color ?? "#fff", width: o.width ?? 3, life: o.life ?? 0.25, max: o.life ?? 0.25 });
  }
  ring(at: number[], o: RingOpts) {
    this.rings.push({ at, color: o.color ?? "#fff", r: o.radius ?? 60, life: o.life ?? 0.4, max: o.life ?? 0.4, width: o.width ?? 3 });
  }

  render(alpha: number, dt: number) {
    const c = this.ctx, g = this.g, cam = this.cam;
    const s = g.current;
    // camera
    if (cam.target && cam.target.alive) {
      const t = cam.target;
      cam.tx = lerp(t.ox, t.x, alpha) + t.vx * cam.lead;
      cam.ty = lerp(t.oy, t.y, alpha) + t.vy * cam.lead;
    }
    const k = 1 - Math.exp(-cam.lerp * dt);
    cam.x += (cam.tx - cam.x) * (cam.target ? k : 1);
    cam.y += (cam.ty - cam.y) * (cam.target ? k : 1);
    const b = g.bounds;
    if (b.kind === "rect") {
      const hw = this.W / 2 / this.camera.zoom, hh = this.H / 2 / this.camera.zoom;
      cam.x = b.x1 - b.x0 > hw * 2 ? Math.max(b.x0 + hw, Math.min(b.x1 - hw, cam.x)) : (b.x0 + b.x1) / 2;
      cam.y = b.y1 - b.y0 > hh * 2 ? Math.max(b.y0 + hh, Math.min(b.y1 - hh, cam.y)) : (b.y0 + b.y1) / 2;
    }
    cam.trauma = Math.max(0, cam.trauma - dt * 1.6);
    const sh = cam.trauma * cam.trauma * 18;
    cam.sx = (Math.random() * 2 - 1) * sh;
    cam.sy = (Math.random() * 2 - 1) * sh;

    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    c.fillStyle = g.opts.background ?? "#0b1020";
    c.fillRect(0, 0, this.W, this.H);
    if (g.opts.backdrop === "stars") {
      for (const st of this.stars) {
        const x = ((st.x * this.W - cam.x * st.z * 0.3) % this.W + this.W) % this.W;
        const y = ((st.y * this.H - cam.y * st.z * 0.3 + g.time * 20 * st.z) % this.H + this.H) % this.H;
        c.fillStyle = `rgba(200,220,255,${0.25 + st.z * 0.6})`;
        c.fillRect(x, y, st.z * 2, st.z * 2);
      }
    }
    const z = this.camera.zoom;
    c.translate(this.W / 2 + cam.sx, this.H / 2 + cam.sy);
    c.scale(z, z);
    c.translate(-cam.x, -cam.y);
    if (g.opts.backdrop === "grid") {
      c.strokeStyle = "rgba(120,160,255,.08)";
      c.lineWidth = 1;
      const v = this.view();
      const step = 40;
      c.beginPath();
      for (let x = Math.floor(v.x0 / step) * step; x < v.x1; x += step) { c.moveTo(x, v.y0); c.lineTo(x, v.y1); }
      for (let y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) { c.moveTo(v.x0, y); c.lineTo(v.x1, y); }
      c.stroke();
    }
    if (!s) return;
    // entities
    let list = s.entities;
    if (list.some((e) => e.opts.layer)) list = [...list].sort((a, b) => (a.opts.layer ?? 0) - (b.opts.layer ?? 0));
    for (const e of list) {
      if (!e.alive || !e.visible) continue;
      const x = lerp(e.ox, e.x, alpha), y = lerp(e.oy, e.y, alpha);
      const rot = angleLerp(e.orot, e.rot, alpha);
      const o = e.opts;
      c.save();
      c.translate(x, y);
      if (o.shape !== "character") c.rotate(rot);
      c.scale(e.scale, e.scale);
      if (e.invuln > 0 && Math.floor(e.invuln * 20) % 2) c.globalAlpha = 0.35;
      if (o.glow) { c.shadowColor = o.color ?? "#fff"; c.shadowBlur = 8 * o.glow; }
      const flash = e.flashT > 0;
      const col = flash ? "#ffffff" : o.color ?? "#e8eefc";
      const col2 = flash ? "#ffffff" : o.color2 ?? "rgba(255,255,255,.85)";
      try {
        if (o.draw) o.draw(c, e);
        else (SHAPES_2D[o.shape ?? (e.box ? "block" : "circle")] ?? SHAPES_2D.circle)(c, e, e.radius * (o.size ?? 1), col, col2);
      } catch (err) { g._error(err); }
      c.restore();
    }
    for (const f of s._drawFns) { c.save(); try { f(c, s); } catch (err) { g._error(err); } c.restore(); }
    // fx
    c.globalCompositeOperation = "lighter";
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      p.vy += p.g * dt;
      p.vx *= 1 - dt * 1.5; p.vy *= 1 - dt * 1.5;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const t = p.life / p.max;
      c.globalAlpha = p.fade ? t : 1;
      c.fillStyle = p.color;
      const sz = p.size * (0.4 + t * 0.6);
      c.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i];
      bm.life -= dt;
      if (bm.life <= 0) { this.beams.splice(i, 1); continue; }
      c.globalAlpha = bm.life / bm.max;
      c.strokeStyle = bm.color;
      c.lineWidth = bm.width;
      c.beginPath(); c.moveTo(bm.a[0], bm.a[1]); c.lineTo(bm.b[0], bm.b[1]); c.stroke();
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.life -= dt;
      if (rg.life <= 0) { this.rings.splice(i, 1); continue; }
      const t = 1 - rg.life / rg.max;
      c.globalAlpha = 1 - t;
      c.strokeStyle = rg.color;
      c.lineWidth = rg.width;
      c.beginPath(); c.arc(rg.at[0], rg.at[1], rg.r * t, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }

  describe() {
    return { renderer: "canvas2d", size: [this.W, this.H], particles: this.parts.length, scale: +this.scale.toFixed(2) };
  }
}
