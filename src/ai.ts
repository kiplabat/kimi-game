// The computer as a player: steering, behaviours, state machines, A* and minimax.
// Behaviours are functions (e, dt, scene) passed as `ai:` when adding an entity.

import type { Entity, AiFn } from "./entity";
import type { Scene } from "./scene";
import { angleDiff } from "./math";

type V2 = [number, number];
export type Target = Entity | string | (() => Entity | null | undefined) | null | undefined;

function resolveTarget(t: Target, e: Entity, s: Scene): Entity | null {
  if (!t) return null;
  if (typeof t === "string") return s.nearest(t, e);
  if (typeof t === "function") return (t() as Entity) ?? null;
  return t.alive ? t : null;
}
const unit = (x: number, y: number): V2 => {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
};

// ---------- steering primitives (return a desired plane velocity) ----------
export function seek(e: Entity, to: V2, speed = e.speed): V2 {
  const [x, y] = e.p;
  const [ux, uy] = unit(to[0] - x, to[1] - y);
  return [ux * speed, uy * speed];
}
export function flee(e: Entity, from: V2, speed = e.speed): V2 {
  const [a, b] = seek(e, from, speed);
  return [-a, -b];
}
/** Seek, slowing inside `slow` units. */
export function arrive(e: Entity, to: V2, speed = e.speed, slow = 4): V2 {
  const [x, y] = e.p;
  const d = Math.hypot(to[0] - x, to[1] - y);
  const k = Math.min(1, d / slow);
  return seek(e, to, speed * k);
}
/** Where a target will be when we could reach it (for chasing and leading shots). */
export function predict(from: V2, target: Entity, projectileSpeed: number): V2 {
  const [tx, ty] = target.p;
  const [vx, vy] = target.v;
  // solve |T + V t - F| = s t
  const dx = tx - from[0], dy = ty - from[1];
  const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;
  let t: number;
  if (Math.abs(a) < 1e-6) t = c / Math.max(1e-6, -b);
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) t = Math.sqrt(c) / projectileSpeed;
    else {
      const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
      t = Math.min(...[r1, r2].filter((r) => r > 0), 3) || Math.sqrt(c) / projectileSpeed;
    }
  }
  t = Math.max(0, Math.min(3, t));
  return [tx + vx * t, ty + vy * t];
}
export function pursue(e: Entity, target: Entity, speed = e.speed): V2 {
  return seek(e, predict(e.p, target, Math.max(speed, 1)), speed);
}
export function evade(e: Entity, target: Entity, speed = e.speed): V2 {
  return flee(e, predict(e.p, target, Math.max(speed, 1)), speed);
}
export function wander(e: Entity, speed = e.speed, turn = 2.5, dt = 1 / 60): V2 {
  const r = e.scene.g.rand;
  e.data._wa = (e.data._wa ?? r(0, Math.PI * 2)) + r(-turn, turn) * dt * 3;
  return [Math.cos(e.data._wa) * speed, Math.sin(e.data._wa) * speed];
}
/** Push away from neighbours with a tag closer than `radius`. */
export function separate(e: Entity, s: Scene, tag: string, radius: number, strength = 1): V2 {
  let ax = 0, ay = 0;
  const [x, y] = e.p;
  for (const o of s.within(tag, e.p, radius)) {
    if (o === e) continue;
    const [ox, oy] = o.p;
    const dx = x - ox, dy = y - oy;
    const d = Math.hypot(dx, dy) || 0.001;
    const k = (radius - d) / radius;
    ax += (dx / d) * k;
    ay += (dy / d) * k;
  }
  return [ax * e.speed * strength, ay * e.speed * strength];
}
/** Circle a target at `radius`, clockwise when dir = 1. */
export function orbit(e: Entity, target: V2, radius: number, speed = e.speed, dir = 1): V2 {
  const [x, y] = e.p;
  const dx = x - target[0], dy = y - target[1];
  const d = Math.hypot(dx, dy) || 0.001;
  const tx = (-dy / d) * dir, ty = (dx / d) * dir;
  const radial = (radius - d) / Math.max(radius, 1);
  return [(tx + (dx / d) * radial * 2) * speed, (ty + (dy / d) * radial * 2) * speed];
}

/** Turn the entity's velocity toward a desired one, limited by accel (units/s²). */
export function steerToward(e: Entity, desired: V2, dt: number, accel = (e.opts.accel ?? e.speed * 4)) {
  const [vx, vy] = e.v;
  let dx = desired[0] - vx, dy = desired[1] - vy;
  const l = Math.hypot(dx, dy);
  const max = accel * dt;
  if (l > max) { dx = (dx / l) * max; dy = (dy / l) * max; }
  e.v = [vx + dx, vy + dy];
}

// ---------- behaviours (use as `ai:`) ----------
export interface SteerOpts {
  speed?: number;
  /** Chase this (entity, tag for nearest, or function). */
  seek?: Target;
  /** Lead the target (pursuit) instead of seeking where it is. */
  lead?: boolean;
  flee?: Target;
  /** Only flee inside this distance. */
  fleeRadius?: number;
  orbit?: Target;
  orbitRadius?: number;
  orbitDir?: number;
  /** Keep between [min, max] from this target (kiting). */
  keep?: Target;
  keepRange?: [number, number];
  wander?: number;
  /** Tag to keep apart from (flocking) and how far. */
  separate?: string;
  separateRadius?: number;
  /** Weights for each part. */
  w?: Partial<Record<"seek" | "flee" | "orbit" | "keep" | "wander" | "separate", number>>;
  accel?: number;
}

/** Blend steering behaviours: ai.steer({ seek: player, separate: "enemy", wander: 0.3 }). */
export function steer(o: SteerOpts): AiFn {
  return (e, dt, s) => {
    const sp = o.speed ?? e.speed;
    let x = 0, y = 0;
    const add = (v: V2, w = 1) => { x += v[0] * w; y += v[1] * w; };
    const W = o.w ?? {};
    const t = resolveTarget(o.seek, e, s);
    if (t) add(o.lead ? pursue(e, t, sp) : seek(e, t.p, sp), W.seek ?? 1);
    const f = resolveTarget(o.flee, e, s);
    if (f && e.dist(f) < (o.fleeRadius ?? Infinity)) add(evade(e, f, sp), W.flee ?? 1);
    const ob = resolveTarget(o.orbit, e, s);
    if (ob) add(orbit(e, ob.p, o.orbitRadius ?? 6, sp, o.orbitDir ?? (e.id % 2 ? 1 : -1)), W.orbit ?? 1);
    const k = resolveTarget(o.keep, e, s);
    if (k) {
      const [mn, mx] = o.keepRange ?? [6, 10];
      const d = e.dist(k);
      if (d < mn) add(flee(e, k.p, sp), W.keep ?? 1);
      else if (d > mx) add(seek(e, k.p, sp), W.keep ?? 1);
      else add(orbit(e, k.p, d, sp * 0.6, e.id % 2 ? 1 : -1), (W.keep ?? 1) * 0.7);
    }
    if (o.wander) add(wander(e, sp, 2.5, dt), o.wander * (W.wander ?? 1));
    if (o.separate) add(separate(e, s, o.separate, o.separateRadius ?? e.radius * 3), W.separate ?? 1.5);
    const l = Math.hypot(x, y);
    if (l > sp) { x = (x / l) * sp; y = (y / l) * sp; }
    steerToward(e, [x, y], dt, o.accel ?? e.opts.accel ?? sp * 4);
  };
}

/** Chase the target (leading it), keeping apart from others with the same tag. */
export const chase = (o: { target: Target; speed?: number; lead?: boolean; separate?: string; wander?: number }) =>
  steer({ seek: o.target, lead: o.lead ?? true, speed: o.speed, separate: o.separate, wander: o.wander });
export const fleeFrom = (o: { from: Target; speed?: number; radius?: number }) =>
  steer({ flee: o.from, fleeRadius: o.radius, speed: o.speed, wander: 0.4 });
export const wanderAround = (o: { speed?: number } = {}) => steer({ wander: 1, speed: o.speed });
export const circle = (o: { target: Target; radius?: number; speed?: number; dir?: number }) =>
  steer({ orbit: o.target, orbitRadius: o.radius, orbitDir: o.dir, speed: o.speed });
export const kite = (o: { target: Target; min?: number; max?: number; speed?: number; separate?: string }) =>
  steer({ keep: o.target, keepRange: [o.min ?? 6, o.max ?? 10], speed: o.speed, separate: o.separate });

/** Follow points in order (loops by default). */
export function patrol(o: { path: V2[]; speed?: number; loop?: boolean; reach?: number }): AiFn {
  return (e, dt) => {
    let i = e.data._pi ?? 0;
    if (i >= o.path.length) { if (o.loop === false) { steerToward(e, [0, 0], dt); return; } i = 0; }
    const p = o.path[i];
    if (e.dist(p) < (o.reach ?? Math.max(e.radius, 0.5))) e.data._pi = i + 1;
    steerToward(e, arrive(e, p, o.speed ?? e.speed, 2), dt);
  };
}

/** Face a target smoothly (turn rate in radians/s). Sets rot and aim. */
export function faceToward(e: Entity, to: V2, rate: number, dt: number) {
  const [x, y] = e.p;
  const want = Math.atan2(to[1] - y, to[0] - x);
  const d = angleDiff(e.rot, want);
  e.rot += Math.max(-rate * dt, Math.min(rate * dt, d));
  e.aim = [Math.cos(e.rot), Math.sin(e.rot)];
}

/**
 * Shoot at a target every `every` seconds when in range and in sight:
 * ai.shooter({ target: player, every: 1.2, range: 20, fire: (e, dir) => spawnBullet(e, dir) })
 */
export function shooter(o: {
  target: Target;
  every: number;
  range?: number;
  lead?: number;
  spread?: number;
  /** Tags that block line of sight. */
  blockers?: string[];
  fire: (e: Entity, dir: V2, target: Entity) => void;
}): AiFn {
  return (e, dt, s) => {
    const t = resolveTarget(o.target, e, s);
    e.data._st = (e.data._st ?? s.g.rand(0, o.every)) - dt;
    if (!t || e.data._st > 0) return;
    if (o.range && e.dist(t) > o.range) return;
    if (o.blockers) {
      const d = e.dist(t);
      const hit = s.ray(e.p, e.dirTo(t), d, o.blockers, e);
      if (hit) { e.data._st = 0.25; return; }
    }
    e.data._st = o.every;
    const aimAt = o.lead ? predict(e.p, t, o.lead) : t.p;
    const [x, y] = e.p;
    let ang = Math.atan2(aimAt[1] - y, aimAt[0] - x);
    if (o.spread) ang += s.g.rand(-o.spread, o.spread);
    o.fire(e, [Math.cos(ang), Math.sin(ang)], t);
  };
}

export interface StateDef {
  enter?: (e: Entity, s: Scene) => void;
  /** Return a state name to switch. `t` is seconds in this state. */
  tick?: (e: Entity, dt: number, s: Scene, t: number) => string | void;
  exit?: (e: Entity, s: Scene) => void;
}
/** A state machine: ai.machine({ initial: "idle", states: { idle: {...}, attack: {...} } }). */
export function machine(o: { initial: string; states: Record<string, StateDef> }): AiFn {
  return (e, dt, s) => {
    if (e.data.state === undefined) {
      e.data.state = o.initial;
      e.data.stateT = 0;
      o.states[o.initial]?.enter?.(e, s);
    }
    e.data.stateT += dt;
    const st = o.states[e.data.state];
    const next = st?.tick?.(e, dt, s, e.data.stateT);
    if (next && next !== e.data.state && o.states[next]) {
      st?.exit?.(e, s);
      e.data.state = next;
      e.data.stateT = 0;
      o.states[next].enter?.(e, s);
    }
  };
}

// ---------- search ----------
/**
 * A* on a grid. grid: rows of text ("#" or any char in `walls` blocks) or numbers (non-zero blocks).
 * Returns [[col,row], …] from start to goal, or [] if none.
 */
export function astar(grid: (string | number[])[], start: V2, goal: V2, o: { diagonal?: boolean; walls?: string } = {}): V2[] {
  const H = grid.length, Wd = typeof grid[0] === "string" ? (grid[0] as string).length : (grid[0] as number[]).length;
  const walls = o.walls ?? "#";
  const blocked = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= Wd || r >= H) return true;
    const row = grid[r];
    return typeof row === "string" ? walls.includes(row[c]) : !!row[c];
  };
  const key = (c: number, r: number) => r * Wd + c;
  const dirs = o.diagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const h = (c: number, r: number) => (o.diagonal ? Math.max(Math.abs(c - goal[0]), Math.abs(r - goal[1])) : Math.abs(c - goal[0]) + Math.abs(r - goal[1]));
  const g = new Map<number, number>([[key(start[0], start[1]), 0]]);
  const from = new Map<number, number>();
  const open: [number, number, number][] = [[h(start[0], start[1]), start[0], start[1]]];
  const closed = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, c, r] = open.splice(bi, 1)[0];
    const k = key(c, r);
    if (c === goal[0] && r === goal[1]) {
      const path: V2[] = [[c, r]];
      let cur = k;
      while (from.has(cur)) { cur = from.get(cur)!; path.unshift([cur % Wd, Math.floor(cur / Wd)]); }
      return path;
    }
    if (closed.has(k)) continue;
    closed.add(k);
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (blocked(nc, nr)) continue;
      if (dc && dr && (blocked(c + dc, r) || blocked(c, r + dr))) continue;
      const nk = key(nc, nr);
      const ng = g.get(k)! + (dc && dr ? 1.414 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        from.set(nk, k);
        open.push([ng + h(nc, nr), nc, nr]);
      }
    }
  }
  return [];
}

/**
 * Minimax with alpha-beta (negamax form) for turn-based games.
 * score(state, player) is from `player`'s point of view; player is 1 or -1.
 */
export function minimax<S, M>(o: {
  state: S;
  player: 1 | -1;
  depth: number;
  moves: (s: S, player: 1 | -1) => M[];
  apply: (s: S, m: M, player: 1 | -1) => S;
  score: (s: S, player: 1 | -1) => number;
  /** Game over? Then score is final. */
  done?: (s: S) => boolean;
}): { move: M | null; score: number } {
  const search = (s: S, d: number, a: number, b: number, p: 1 | -1): [number, M | null] => {
    const ms = o.moves(s, p);
    if (d === 0 || ms.length === 0 || o.done?.(s)) return [o.score(s, p), null];
    let best = -Infinity, bestM: M | null = null;
    for (const m of ms) {
      const [v] = search(o.apply(s, m, p), d - 1, -b, -a, (-p) as 1 | -1);
      const sc = -v;
      if (sc > best) { best = sc; bestM = m; }
      if (sc > a) a = sc;
      if (a >= b) break;
    }
    return [best, bestM];
  };
  const [score, move] = search(o.state, o.depth, -Infinity, Infinity, o.player);
  return { move, score };
}

/**
 * Ask the person's model (KimiLM's kimi.ai.ask) for a slow decision, with a code fallback
 * when there is no model, it is slow, or the answer is unusable.
 */
export async function ask<T>(question: string, o: { fallback: () => T; timeout?: number; schema?: object; parse?: (answer: any) => T | undefined }): Promise<T> {
  const k = (globalThis as any).kimi;
  if (!k?.ai?.ask) return o.fallback();
  try {
    const ans = await Promise.race([
      Promise.resolve(k.ai.ask(question, o.schema ? { schema: o.schema } : undefined)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), o.timeout ?? 8000)),
    ]);
    const v = o.parse ? o.parse(ans) : (ans as T);
    return v === undefined || v === null ? o.fallback() : v;
  } catch {
    return o.fallback();
  }
}

export const ai = {
  seek, flee, arrive, pursue, evade, wander, separate, orbit, predict, steerToward, faceToward,
  steer, chase, fleeFrom, wanderAround, circle, kite, patrol, shooter, machine,
  astar, minimax, ask,
};
