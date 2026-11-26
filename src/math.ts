// Small math helpers shared by every part of the engine.

export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Shortest signed difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const angleLerp = (a: number, b: number, t: number) => a + angleDiff(a, b) * t;

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Normalise a 2-vector; returns [0,0] for a zero vector. */
export function norm(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
}

/** Limit a 2-vector to a maximum length. */
export function limit(x: number, y: number, max: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  if (l > max && l > 0) return [(x / l) * max, (y / l) * max];
  return [x, y];
}

/** Move value `v` toward `target` by at most `step`. */
export function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

/** Exponential smoothing factor that is frame-rate independent. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Mulberry32: small, fast, seedable random numbers. */
export function rng(seed = Date.now() >>> 0) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** rand() → [0,1); rand(b) → [0,b); rand(a,b) → [a,b) */
    rand(a?: number, b?: number) {
      if (a === undefined) return next();
      if (b === undefined) return next() * a;
      return a + next() * (b - a);
    },
    int(a: number, b: number) {
      return Math.floor(a + next() * (b - a + 1));
    },
    pick<T>(arr: T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p: number) {
      return next() < p;
    },
    get seed() {
      return s;
    },
  };
}
export type Rng = ReturnType<typeof rng>;
