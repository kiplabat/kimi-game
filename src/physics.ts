// Kinematic physics: circles and boxes on the play plane, a spatial hash for speed,
// solid push-out with bounce, ground detection for platformers, and raycasts.
// In 3D the plane is x,z and a height check keeps things at different heights apart.

import type { Entity } from "./entity";

export interface Contact { nx: number; ny: number; depth: number }

function shapeOf(e: Entity) {
  const [x, y] = e.p;
  if (e.box) {
    const w = e.box[0] * e.scale, h = (e.is3d ? e.box[2] ?? e.box[0] : e.box[1]) * e.scale;
    return { box: true, x, y, hw: w / 2, hh: h / 2, r: 0 };
  }
  return { box: false, x, y, hw: 0, hh: 0, r: e.radius * e.scale };
}

/** Overlap test with the push-out normal (from b toward a) and depth, or null. */
export function overlap(a: Entity, b: Entity): Contact | null {
  if (a.is3d) {
    const ha = a.box ? a.box[1] / 2 : a.radius, hb = b.box ? b.box[1] / 2 : b.radius;
    if (Math.abs(a.y - b.y) > (ha + hb) * Math.max(a.scale, b.scale)) return null;
  }
  const A = shapeOf(a), B = shapeOf(b);
  if (!A.box && !B.box) {
    const dx = A.x - B.x, dy = A.y - B.y;
    const r = A.r + B.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2) || 1e-6;
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  if (A.box && B.box) {
    const ox = A.hw + B.hw - Math.abs(A.x - B.x);
    const oy = A.hh + B.hh - Math.abs(A.y - B.y);
    if (ox <= 0 || oy <= 0) return null;
    if (ox < oy) return { nx: Math.sign(A.x - B.x) || 1, ny: 0, depth: ox };
    return { nx: 0, ny: Math.sign(A.y - B.y) || 1, depth: oy };
  }
  // circle vs box
  const circle = A.box ? B : A, box = A.box ? A : B;
  const cx = Math.max(box.x - box.hw, Math.min(circle.x, box.x + box.hw));
  const cy = Math.max(box.y - box.hh, Math.min(circle.y, box.y + box.hh));
  let dx = circle.x - cx, dy = circle.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= circle.r * circle.r) return null;
  let nx: number, ny: number, depth: number;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d; depth = circle.r - d;
  } else {
    // centre inside the box: push out along the shallowest side
    const px = box.hw - Math.abs(circle.x - box.x), py = box.hh - Math.abs(circle.y - box.y);
    if (px < py) { nx = Math.sign(circle.x - box.x) || 1; ny = 0; depth = px + circle.r; }
    else { nx = 0; ny = Math.sign(circle.y - box.y) || 1; depth = py + circle.r; }
  }
  // normal must point from b toward a
  if (A.box) { nx = -nx; ny = -ny; }
  return { nx, ny, depth };
}

export class SpatialHash {
  private cells = new Map<number, Entity[]>();
  constructor(public cell: number) {}
  clear() { this.cells.clear(); }
  private key(ix: number, iy: number) { return (ix + 32768) * 65536 + (iy + 32768); }
  insert(e: Entity) {
    const [x, y] = e.p;
    const r = e.box ? Math.max(e.box[0], e.is3d ? e.box[2] ?? e.box[0] : e.box[1]) * 0.5 * e.scale : e.radius * e.scale;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(e); else this.cells.set(k, [e]);
      }
  }
  /** Entities whose cells touch a circle; may contain duplicates' removal already. */
  query(x: number, y: number, r: number, out: Entity[] = []): Entity[] {
    const c = this.cell;
    const seen = new Set<number>();
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const e of list) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
      }
    return out;
  }
}

/** Separate two solids along the contact normal; static or heavier ones move less. */
export function resolve(a: Entity, b: Entity, c: Contact) {
  const ma = a.opts.static ? Infinity : a.opts.mass ?? 1;
  const mb = b.opts.static ? Infinity : b.opts.mass ?? 1;
  if (ma === Infinity && mb === Infinity) return;
  const wa = ma === Infinity ? 0 : mb === Infinity ? 1 : mb / (ma + mb);
  const wb = 1 - wa;
  const [ax, ay] = a.p, [bx, by] = b.p;
  a.p = [ax + c.nx * c.depth * wa, ay + c.ny * c.depth * wa];
  b.p = [bx - c.nx * c.depth * wb, by - c.ny * c.depth * wb];
  // remove approaching velocity, with bounce
  const [avx, avy] = a.v, [bvx, bvy] = b.v;
  const rel = (avx - bvx) * c.nx + (avy - bvy) * c.ny;
  if (rel < 0) {
    const e = Math.max(a.opts.bounce ?? 0, b.opts.bounce ?? 0);
    const j = -(1 + e) * rel;
    if (wa > 0) a.v = [avx + c.nx * j * wa, avy + c.ny * j * wa];
    if (wb > 0) b.v = [bvx - c.nx * j * wb, bvy - c.ny * j * wb];
  }
  // standing on something (2D, y down: normal pointing up)
  if (!a.is3d) {
    if (c.ny < -0.6) a.onGround = true;
    if (c.ny > 0.6) b.onGround = true;
  }
}

export interface RayHit { entity: Entity; dist: number; point: [number, number] }

/** Cast a ray on the plane; returns the nearest entity with one of the tags. */
export function raycast(list: Entity[], from: [number, number], dir: [number, number], max: number, tags?: string[], ignore?: Entity): RayHit | null {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const dx = dir[0] / l, dy = dir[1] / l;
  let best: RayHit | null = null;
  for (const e of list) {
    if (!e.alive || e === ignore) continue;
    if (tags && !tags.some((t) => e.tags.has(t))) continue;
    const s = shapeOf(e);
    let t: number | null = null;
    if (!s.box) {
      const ox = from[0] - s.x, oy = from[1] - s.y;
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - s.r * s.r;
      const disc = b * b - c;
      if (disc >= 0) {
        const t0 = -b - Math.sqrt(disc);
        t = t0 >= 0 ? t0 : c < 0 ? 0 : null;
      }
    } else {
      const inv = (v: number) => (Math.abs(v) < 1e-12 ? 1e12 : 1 / v);
      const tx1 = (s.x - s.hw - from[0]) * inv(dx), tx2 = (s.x + s.hw - from[0]) * inv(dx);
      const ty1 = (s.y - s.hh - from[1]) * inv(dy), ty2 = (s.y + s.hh - from[1]) * inv(dy);
      const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2));
      const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));
      if (tmax >= Math.max(0, tmin)) t = Math.max(0, tmin);
    }
    if (t !== null && t <= max && (!best || t < best.dist)) {
      best = { entity: e, dist: t, point: [from[0] + dx * t, from[1] + dy * t] };
    }
  }
  return best;
}
