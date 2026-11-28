/* kimi/game 0.3.0 — Apache-2.0 — https://github.com/kiplabat/kimi-game. Built on three.js (MIT). */

// src/entity.ts
var NEXT_ID = 1;
var Entity = class _Entity {
  id = NEXT_ID++;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Previous step's position and rotation, for smooth drawing between steps. */
  ox = 0;
  oy = 0;
  oz = 0;
  orot = 0;
  rot = 0;
  radius;
  box;
  tags;
  name;
  hp;
  maxHp;
  alive = true;
  age = 0;
  /** Seconds left of the white hit flash. */
  flashT = 0;
  /** Seconds of invulnerability left. */
  invuln = 0;
  scale = 1;
  visible = true;
  onGround = false;
  /** Aim direction on the plane (unit vector), set by twin controls or by you. */
  aim = [1, 0];
  data;
  opts;
  /** Renderer-owned visual (three.js object in 3D). */
  visual = null;
  scene;
  moved = false;
  contacts = /* @__PURE__ */ new Set();
  sx = 0;
  sy = 0;
  sz = 0;
  _tick = [];
  _hit = /* @__PURE__ */ new Map();
  _overlap = /* @__PURE__ */ new Map();
  _die = [];
  _damage = [];
  _ai;
  _trailT = 0;
  diedBecause = "";
  constructor(o) {
    this.opts = o;
    this.radius = o.radius ?? (o.box ? Math.max(o.box[0], o.box[o.box.length - 1]) / 2 : 1);
    this.box = o.box;
    this.tags = new Set(o.tags ?? []);
    this.name = o.name;
    this.hp = this.maxHp = o.hp ?? 1;
    this.rot = this.orot = o.rot ?? 0;
    this.data = { ...o.data ?? {} };
    this._ai = o.ai ? Array.isArray(o.ai) ? o.ai : [o.ai] : [];
  }
  /** Called by the scene when added. */
  _place(mode) {
    const a = this.opts.at ?? [0, 0];
    const v = this.opts.vel ?? [0, 0];
    if (mode === "2d") {
      this.x = a[0];
      this.y = a[1] ?? 0;
      this.vx = v[0] ?? 0;
      this.vy = v[1] ?? 0;
    } else {
      const ground = this.opts.height ?? (this.box ? this.box[1] / 2 : this.radius);
      if (a.length >= 3) {
        this.x = a[0];
        this.y = a[1];
        this.z = a[2];
      } else {
        this.x = a[0];
        this.y = ground;
        this.z = a[1] ?? 0;
      }
      if (v.length >= 3) {
        this.vx = v[0];
        this.vy = v[1];
        this.vz = v[2];
      } else {
        this.vx = v[0] ?? 0;
        this.vz = v[1] ?? 0;
      }
    }
    this.ox = this.x;
    this.oy = this.y;
    this.oz = this.z;
    this.sx = this.x;
    this.sy = this.y;
    this.sz = this.z;
  }
  _checkMoved(eps) {
    if (this.moved) return;
    const d = Math.abs(this.x - this.sx) + Math.abs(this.y - this.sy) + Math.abs(this.z - this.sz);
    if (d > eps) this.moved = true;
  }
  get is3d() {
    return this.scene?.g.mode === "3d";
  }
  /** Position on the play plane: [x,y] in 2D, [x,z] in 3D. */
  get p() {
    return this.is3d ? [this.x, this.z] : [this.x, this.y];
  }
  set p(v) {
    this.x = v[0];
    if (this.is3d) this.z = v[1];
    else this.y = v[1];
  }
  /** Velocity on the play plane. */
  get v() {
    return this.is3d ? [this.vx, this.vz] : [this.vx, this.vy];
  }
  set v(v) {
    this.vx = v[0];
    if (this.is3d) this.vz = v[1];
    else this.vy = v[1];
  }
  get speedNow() {
    const [a, b] = this.v;
    return Math.hypot(a, b);
  }
  get speed() {
    return this.opts.speed ?? 0;
  }
  set speed(s) {
    this.opts.speed = s;
  }
  has(tag) {
    return this.tags.has(tag);
  }
  tag(...t) {
    t.forEach((x) => this.tags.add(x));
    return this;
  }
  untag(...t) {
    t.forEach((x) => this.tags.delete(x));
    return this;
  }
  on(ev, a, b) {
    if (ev === "hit" || ev === "overlap") {
      const map = ev === "hit" ? this._hit : this._overlap;
      const list = map.get(a) ?? [];
      list.push(b);
      map.set(a, list);
    } else if (ev === "tick") this._tick.push(a);
    else if (ev === "die") this._die.push(a);
    else if (ev === "damage") this._damage.push(a);
    return this;
  }
  /** Lose hp; flashes white; dies at 0. Ignored while invulnerable. Returns hp left. */
  damage(n = 1, from) {
    if (!this.alive || this.invuln > 0) return this.hp;
    this.hp -= n;
    this.flashT = 0.08;
    for (const f of this._damage) f(n, from, this);
    if (this.hp <= 0) this.die("killed");
    return this.hp;
  }
  heal(n = 1) {
    this.hp = Math.min(this.maxHp, this.hp + n);
    return this.hp;
  }
  die(why = "removed") {
    if (!this.alive) return;
    this.alive = false;
    this.diedBecause = why;
    for (const f of this._die) f(this, why);
  }
  /** Plane distance to another entity or point. */
  dist(o) {
    const [a, b] = this.p;
    const [c, d] = o instanceof _Entity ? o.p : o;
    return Math.hypot(c - a, d - b);
  }
  /** Unit direction on the plane toward another entity or point. */
  dirTo(o) {
    const [a, b] = this.p;
    const [c, d] = o instanceof _Entity ? o.p : o;
    const l = Math.hypot(c - a, d - b) || 1;
    return [(c - a) / l, (d - b) / l];
  }
  angleTo(o) {
    const [a, b] = this.dirTo(o);
    return Math.atan2(b, a);
  }
  /** Set plane velocity toward a direction at a speed (default: own speed). */
  go(dir, speed = this.speed) {
    this.v = [dir[0] * speed, dir[1] * speed];
    return this;
  }
  /** Add an impulse to the plane velocity. */
  push(a, b) {
    const [x, y] = this.v;
    this.v = [x + a, y + b];
    return this;
  }
  /** Point in front of the entity (plane), d units away along its facing or aim. */
  ahead(d = 1, useAim = false) {
    const [a, b] = this.p;
    const [ux, uy] = useAim ? this.aim : [Math.cos(this.rot), Math.sin(this.rot)];
    return [a + ux * d, b + uy * d];
  }
};

// src/physics.ts
function shapeOf(e) {
  const [x, y] = e.p;
  if (e.box) {
    const w = e.box[0] * e.scale, h = (e.is3d ? e.box[2] ?? e.box[0] : e.box[1]) * e.scale;
    return { box: true, x, y, hw: w / 2, hh: h / 2, r: 0 };
  }
  return { box: false, x, y, hw: 0, hh: 0, r: e.radius * e.scale };
}
function overlap(a, b) {
  if (a.is3d) {
    const half = (e) => e.box ? e.box[1] / 2 : e.opts.capsule ? e.opts.capsule[1] / 2 : e.radius;
    const ha = half(a), hb = half(b);
    if (Math.abs(a.y - b.y) > (ha + hb) * Math.max(a.scale, b.scale)) return null;
  }
  const A = shapeOf(a), B = shapeOf(b);
  if (!A.box && !B.box) {
    const dx2 = A.x - B.x, dy2 = A.y - B.y;
    const r = A.r + B.r;
    const d22 = dx2 * dx2 + dy2 * dy2;
    if (d22 >= r * r) return null;
    const d = Math.sqrt(d22) || 1e-6;
    return { nx: dx2 / d, ny: dy2 / d, depth: r - d };
  }
  if (A.box && B.box) {
    const ox = A.hw + B.hw - Math.abs(A.x - B.x);
    const oy = A.hh + B.hh - Math.abs(A.y - B.y);
    if (ox <= 0 || oy <= 0) return null;
    if (ox < oy) return { nx: Math.sign(A.x - B.x) || 1, ny: 0, depth: ox };
    return { nx: 0, ny: Math.sign(A.y - B.y) || 1, depth: oy };
  }
  const circle2 = A.box ? B : A, box = A.box ? A : B;
  const cx = Math.max(box.x - box.hw, Math.min(circle2.x, box.x + box.hw));
  const cy = Math.max(box.y - box.hh, Math.min(circle2.y, box.y + box.hh));
  let dx = circle2.x - cx, dy = circle2.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= circle2.r * circle2.r) return null;
  let nx, ny, depth;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
    depth = circle2.r - d;
  } else {
    const px = box.hw - Math.abs(circle2.x - box.x), py = box.hh - Math.abs(circle2.y - box.y);
    if (px < py) {
      nx = Math.sign(circle2.x - box.x) || 1;
      ny = 0;
      depth = px + circle2.r;
    } else {
      nx = 0;
      ny = Math.sign(circle2.y - box.y) || 1;
      depth = py + circle2.r;
    }
  }
  if (A.box) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny, depth };
}
var SpatialHash = class {
  constructor(cell) {
    this.cell = cell;
  }
  cell;
  cells = /* @__PURE__ */ new Map();
  clear() {
    this.cells.clear();
  }
  key(ix, iy) {
    return (ix + 32768) * 65536 + (iy + 32768);
  }
  insert(e) {
    const [x, y] = e.p;
    const r = e.box ? Math.max(e.box[0], e.is3d ? e.box[2] ?? e.box[0] : e.box[1]) * 0.5 * e.scale : e.radius * e.scale;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(e);
        else this.cells.set(k, [e]);
      }
  }
  /** Entities whose cells touch a circle; may contain duplicates' removal already. */
  query(x, y, r, out = []) {
    const c = this.cell;
    const seen = /* @__PURE__ */ new Set();
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const e of list) if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    return out;
  }
};
function resolve(a, b, c) {
  const ma = a.opts.static ? Infinity : a.opts.mass ?? 1;
  const mb = b.opts.static ? Infinity : b.opts.mass ?? 1;
  if (ma === Infinity && mb === Infinity) return;
  const wa = ma === Infinity ? 0 : mb === Infinity ? 1 : mb / (ma + mb);
  const wb = 1 - wa;
  const [ax, ay] = a.p, [bx, by] = b.p;
  a.p = [ax + c.nx * c.depth * wa, ay + c.ny * c.depth * wa];
  b.p = [bx - c.nx * c.depth * wb, by - c.ny * c.depth * wb];
  const [avx, avy] = a.v, [bvx, bvy] = b.v;
  const rel = (avx - bvx) * c.nx + (avy - bvy) * c.ny;
  if (rel < 0) {
    const e = Math.max(a.opts.bounce ?? 0, b.opts.bounce ?? 0);
    const j = -(1 + e) * rel;
    if (wa > 0) a.v = [avx + c.nx * j * wa, avy + c.ny * j * wa];
    if (wb > 0) b.v = [bvx - c.nx * j * wb, bvy - c.ny * j * wb];
  }
  if (!a.is3d) {
    if (c.ny < -0.6) a.onGround = true;
    if (c.ny > 0.6) b.onGround = true;
  }
}
function raycast(list, from, dir, max, tags, ignore) {
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const dx = dir[0] / l, dy = dir[1] / l;
  let best = null;
  for (const e of list) {
    if (!e.alive || e === ignore) continue;
    if (tags && !tags.some((t2) => e.tags.has(t2))) continue;
    const s = shapeOf(e);
    let t = null;
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
      const inv = (v) => Math.abs(v) < 1e-12 ? 1e12 : 1 / v;
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
function raycast3(list, from, dir, max, tags, ignore) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / l, dy = dir[1] / l, dz = dir[2] / l;
  const ig = Array.isArray(ignore) ? ignore : ignore ? [ignore] : [];
  let best = null;
  let bestT = max;
  for (const e of list) {
    if (!e.alive || ig.includes(e)) continue;
    if (tags && !tags.some((t2) => e.tags.has(t2))) continue;
    const br = e.box ? Math.hypot(e.box[0], e.box[1], e.box[2] ?? e.box[0]) / 2 : e.opts.capsule ? e.opts.capsule[1] / 2 + 0.1 : e.radius;
    const ox = e.x - from[0], oy = e.y - from[1], oz = e.z - from[2];
    const proj = ox * dx + oy * dy + oz * dz;
    if (proj < -br || proj - br > bestT) continue;
    const d2 = ox * ox + oy * oy + oz * oz - proj * proj;
    if (d2 > br * br) continue;
    let t = -1, nx = 0, ny = 0, nz = 0;
    let part = "sphere";
    if (e.box) {
      const hw = e.box[0] * e.scale / 2, hh = e.box[1] * e.scale / 2, hd = (e.box[2] ?? e.box[0]) * e.scale / 2;
      const inv = (v) => Math.abs(v) < 1e-12 ? 1e12 : 1 / v;
      const ix = inv(dx), iy = inv(dy), iz = inv(dz);
      const t1 = (e.x - hw - from[0]) * ix, t2 = (e.x + hw - from[0]) * ix;
      const t3 = (e.y - hh - from[1]) * iy, t4 = (e.y + hh - from[1]) * iy;
      const t5 = (e.z - hd - from[2]) * iz, t6 = (e.z + hd - from[2]) * iz;
      const tx = Math.min(t1, t2), ty = Math.min(t3, t4), tz = Math.min(t5, t6);
      const tmin = Math.max(tx, ty, tz);
      const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
      if (tmax >= Math.max(0, tmin)) {
        t = Math.max(0, tmin);
        if (tmin === tx) nx = dx > 0 ? -1 : 1;
        else if (tmin === ty) ny = dy > 0 ? -1 : 1;
        else nz = dz > 0 ? -1 : 1;
        part = "box";
      }
    } else if (e.opts.capsule) {
      const [r, h] = e.opts.capsule;
      const ya = e.y - h / 2 + r, yb = e.y + h / 2 - r;
      const bax = 0, bay = yb - ya, baz = 0;
      const oax = from[0] - e.x, oay = from[1] - ya, oaz = from[2] - e.z;
      const baba = bay * bay, bard = bay * dy, baoa = bay * oay;
      const rdoa = dx * oax + dy * oay + dz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
      const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
      let h2 = b * b - a * c;
      if (h2 >= 0 && a > 1e-9) {
        const tt = (-b - Math.sqrt(h2)) / a;
        const y = baoa + tt * bard;
        if (y > 0 && y < baba && tt >= 0) t = tt;
        else {
          const ocy = y <= 0 ? oay : oay - bay;
          const bb = dx * oax + dy * ocy + dz * oaz, cc = oax * oax + ocy * ocy + oaz * oaz - r * r;
          h2 = bb * bb - cc;
          if (h2 > 0) {
            const t2 = -bb - Math.sqrt(h2);
            if (t2 >= 0) t = t2;
          }
        }
      }
      void bax;
      void baz;
      if (t >= 0) {
        const py = from[1] + dy * t;
        part = py > e.y + h / 2 - r * 1.7 ? "head" : "body";
        const cy = Math.max(ya, Math.min(yb, py));
        const px = from[0] + dx * t - e.x, pz = from[2] + dz * t - e.z;
        const nl = Math.hypot(px, py - cy, pz) || 1;
        nx = px / nl;
        ny = (py - cy) / nl;
        nz = pz / nl;
      }
    } else {
      const r = e.radius * e.scale;
      const disc = proj * proj - (ox * ox + oy * oy + oz * oz - r * r);
      if (disc >= 0) {
        const t0 = proj - Math.sqrt(disc);
        t = t0 >= 0 ? t0 : 0;
        const px = from[0] + dx * t - e.x, py = from[1] + dy * t - e.y, pz = from[2] + dz * t - e.z;
        const nl = Math.hypot(px, py, pz) || 1;
        nx = px / nl;
        ny = py / nl;
        nz = pz / nl;
      }
    }
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = { entity: e, dist: t, point: [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t], normal: [nx, ny, nz], part };
    }
  }
  return best;
}

// src/math.ts
var TAU = Math.PI * 2;
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
var lerp = (a, b, t) => a + (b - a) * t;
function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
var angleLerp = (a, b, t) => a + angleDiff(a, b) * t;
function len(x, y) {
  return Math.sqrt(x * x + y * y);
}
function rng(seed = Date.now() >>> 0) {
  let s = seed >>> 0;
  const next = () => {
    s = s + 1831565813 >>> 0;
    let t = s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return {
    next,
    /** rand() → [0,1); rand(b) → [0,b); rand(a,b) → [a,b) */
    rand(a, b) {
      if (a === void 0) return next();
      if (b === void 0) return next() * a;
      return a + next() * (b - a);
    },
    int(a, b) {
      return Math.floor(a + next() * (b - a + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p) {
      return next() < p;
    },
    get seed() {
      return s;
    }
  };
}

// src/ai.ts
function resolveTarget(t, e, s) {
  if (!t) return null;
  if (typeof t === "string") return s.nearest(t, e);
  if (typeof t === "function") return t() ?? null;
  return t.alive ? t : null;
}
var unit = (x, y) => {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
};
function seek(e, to, speed = e.speed) {
  const [x, y] = e.p;
  const [ux, uy] = unit(to[0] - x, to[1] - y);
  return [ux * speed, uy * speed];
}
function flee(e, from, speed = e.speed) {
  const [a, b] = seek(e, from, speed);
  return [-a, -b];
}
function arrive(e, to, speed = e.speed, slow = 4) {
  const [x, y] = e.p;
  const d = Math.hypot(to[0] - x, to[1] - y);
  const k = Math.min(1, d / slow);
  return seek(e, to, speed * k);
}
function predict(from, target, projectileSpeed) {
  const [tx, ty] = target.p;
  const [vx, vy] = target.v;
  const dx = tx - from[0], dy = ty - from[1];
  const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;
  let t;
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
function pursue(e, target, speed = e.speed) {
  return seek(e, predict(e.p, target, Math.max(speed, 1)), speed);
}
function evade(e, target, speed = e.speed) {
  return flee(e, predict(e.p, target, Math.max(speed, 1)), speed);
}
function wander(e, speed = e.speed, turn = 2.5, dt = 1 / 60) {
  const r = e.scene.g.rand;
  e.data._wa = (e.data._wa ?? r(0, Math.PI * 2)) + r(-turn, turn) * dt * 3;
  return [Math.cos(e.data._wa) * speed, Math.sin(e.data._wa) * speed];
}
function separate(e, s, tag, radius, strength = 1) {
  let ax = 0, ay = 0;
  const [x, y] = e.p;
  for (const o of s.within(tag, e.p, radius)) {
    if (o === e) continue;
    const [ox, oy] = o.p;
    const dx = x - ox, dy = y - oy;
    const d = Math.hypot(dx, dy) || 1e-3;
    const k = (radius - d) / radius;
    ax += dx / d * k;
    ay += dy / d * k;
  }
  return [ax * e.speed * strength, ay * e.speed * strength];
}
function orbit(e, target, radius, speed = e.speed, dir = 1) {
  const [x, y] = e.p;
  const dx = x - target[0], dy = y - target[1];
  const d = Math.hypot(dx, dy) || 1e-3;
  const tx = -dy / d * dir, ty = dx / d * dir;
  const radial = (radius - d) / Math.max(radius, 1);
  return [(tx + dx / d * radial * 2) * speed, (ty + dy / d * radial * 2) * speed];
}
function steerToward(e, desired, dt, accel = e.opts.accel ?? e.speed * 4) {
  const [vx, vy] = e.v;
  let dx = desired[0] - vx, dy = desired[1] - vy;
  const l = Math.hypot(dx, dy);
  const max = accel * dt;
  if (l > max) {
    dx = dx / l * max;
    dy = dy / l * max;
  }
  e.v = [vx + dx, vy + dy];
}
function steer(o) {
  return (e, dt, s) => {
    const sp = o.speed ?? e.speed;
    let x = 0, y = 0;
    const add = (v, w = 1) => {
      x += v[0] * w;
      y += v[1] * w;
    };
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
    if (l > sp) {
      x = x / l * sp;
      y = y / l * sp;
    }
    steerToward(e, [x, y], dt, o.accel ?? e.opts.accel ?? sp * 4);
  };
}
var chase = (o) => steer({ seek: o.target, lead: o.lead ?? true, speed: o.speed, separate: o.separate, wander: o.wander });
var fleeFrom = (o) => steer({ flee: o.from, fleeRadius: o.radius, speed: o.speed, wander: 0.4 });
var wanderAround = (o = {}) => steer({ wander: 1, speed: o.speed });
var circle = (o) => steer({ orbit: o.target, orbitRadius: o.radius, orbitDir: o.dir, speed: o.speed });
var kite = (o) => steer({ keep: o.target, keepRange: [o.min ?? 6, o.max ?? 10], speed: o.speed, separate: o.separate });
function patrol(o) {
  return (e, dt) => {
    let i = e.data._pi ?? 0;
    if (i >= o.path.length) {
      if (o.loop === false) {
        steerToward(e, [0, 0], dt);
        return;
      }
      i = 0;
    }
    const p = o.path[i];
    if (e.dist(p) < (o.reach ?? Math.max(e.radius, 0.5))) e.data._pi = i + 1;
    steerToward(e, arrive(e, p, o.speed ?? e.speed, 2), dt);
  };
}
function faceToward(e, to, rate, dt) {
  const [x, y] = e.p;
  const want = Math.atan2(to[1] - y, to[0] - x);
  const d = angleDiff(e.rot, want);
  e.rot += Math.max(-rate * dt, Math.min(rate * dt, d));
  e.aim = [Math.cos(e.rot), Math.sin(e.rot)];
}
function shooter(o) {
  return (e, dt, s) => {
    const t = resolveTarget(o.target, e, s);
    e.data._st = (e.data._st ?? s.g.rand(0, o.every)) - dt;
    if (!t || e.data._st > 0) return;
    if (o.range && e.dist(t) > o.range) return;
    if (o.blockers) {
      const d = e.dist(t);
      const hit = s.ray(e.p, e.dirTo(t), d, o.blockers, e);
      if (hit) {
        e.data._st = 0.25;
        return;
      }
    }
    e.data._st = o.every;
    const aimAt = o.lead ? predict(e.p, t, o.lead) : t.p;
    const [x, y] = e.p;
    let ang = Math.atan2(aimAt[1] - y, aimAt[0] - x);
    if (o.spread) ang += s.g.rand(-o.spread, o.spread);
    o.fire(e, [Math.cos(ang), Math.sin(ang)], t);
  };
}
function machine(o) {
  return (e, dt, s) => {
    if (e.data.state === void 0) {
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
function astar(grid, start, goal, o = {}) {
  const H = grid.length, Wd = typeof grid[0] === "string" ? grid[0].length : grid[0].length;
  const walls = o.walls ?? "#";
  const blocked = (c, r) => {
    if (c < 0 || r < 0 || c >= Wd || r >= H) return true;
    const row = grid[r];
    return typeof row === "string" ? walls.includes(row[c]) : !!row[c];
  };
  const key = (c, r) => r * Wd + c;
  const dirs = o.diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const h = (c, r) => o.diagonal ? Math.max(Math.abs(c - goal[0]), Math.abs(r - goal[1])) : Math.abs(c - goal[0]) + Math.abs(r - goal[1]);
  const g = /* @__PURE__ */ new Map([[key(start[0], start[1]), 0]]);
  const from = /* @__PURE__ */ new Map();
  const open = [[h(start[0], start[1]), start[0], start[1]]];
  const closed = /* @__PURE__ */ new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, c, r] = open.splice(bi, 1)[0];
    const k = key(c, r);
    if (c === goal[0] && r === goal[1]) {
      const path = [[c, r]];
      let cur = k;
      while (from.has(cur)) {
        cur = from.get(cur);
        path.unshift([cur % Wd, Math.floor(cur / Wd)]);
      }
      return path;
    }
    if (closed.has(k)) continue;
    closed.add(k);
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (blocked(nc, nr)) continue;
      if (dc && dr && (blocked(c + dc, r) || blocked(c, r + dr))) continue;
      const nk = key(nc, nr);
      const ng = g.get(k) + (dc && dr ? 1.414 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        from.set(nk, k);
        open.push([ng + h(nc, nr), nc, nr]);
      }
    }
  }
  return [];
}
function minimax(o) {
  const search = (s, d, a, b, p) => {
    const ms = o.moves(s, p);
    if (d === 0 || ms.length === 0 || o.done?.(s)) return [o.score(s, p), null];
    let best = -Infinity, bestM = null;
    for (const m of ms) {
      const [v] = search(o.apply(s, m, p), d - 1, -b, -a, -p);
      const sc = -v;
      if (sc > best) {
        best = sc;
        bestM = m;
      }
      if (sc > a) a = sc;
      if (a >= b) break;
    }
    return [best, bestM];
  };
  const [score, move] = search(o.state, o.depth, -Infinity, Infinity, o.player);
  return { move, score };
}
async function ask(question, o) {
  const k = globalThis.kimi;
  if (!k?.ai?.ask) return o.fallback();
  try {
    const ans = await Promise.race([
      Promise.resolve(k.ai.ask(question, o.schema ? { schema: o.schema } : void 0)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), o.timeout ?? 8e3))
    ]);
    const v = o.parse ? o.parse(ans) : ans;
    return v === void 0 || v === null ? o.fallback() : v;
  } catch {
    return o.fallback();
  }
}
var ai = {
  seek,
  flee,
  arrive,
  pursue,
  evade,
  wander,
  separate,
  orbit,
  predict,
  steerToward,
  faceToward,
  steer,
  chase,
  fleeFrom,
  wanderAround,
  circle,
  kite,
  patrol,
  shooter,
  machine,
  astar,
  minimax,
  ask
};

// src/scene.ts
var TIMER_ID = 1;
var DEF = {
  // shape: [2D radius px, 3D radius units, colour]
  ship: [16, 0.9, "#3fd0e0"],
  rock: [22, 1.2, "#8a7f74"],
  ball: [10, 0.5, "#ffffff"],
  coin: [10, 0.5, "#ffd166"],
  bullet: [4, 0.22, "#fff27a"],
  character: [14, 0.7, "#ff9f43"],
  drone: [14, 0.7, "#ff4d8d"],
  orb: [10, 0.45, "#7cf6ff"],
  crystal: [14, 0.8, "#b48bff"],
  tank: [18, 1.1, "#7fb069"],
  car: [18, 1.1, "#ff5d5d"],
  tree: [18, 1, "#3fa34d"],
  boss: [48, 3.2, "#ff3366"],
  star: [12, 0.6, "#ffe066"],
  pillar: [20, 1.4, "#39425f"],
  circle: [12, 0.6, "#e8eefc"],
  enemy: [14, 0.7, "#ff4d8d"],
  player: [16, 0.9, "#3fd0e0"],
  food: [10, 0.5, "#7bed9f"]
};
function withDefaults(o, mode) {
  const d = DEF[o.shape ?? ""];
  if (!d) return o;
  return { ...o, radius: o.radius ?? (o.box ? void 0 : mode === "2d" ? d[0] : d[1]), color: o.color ?? d[2] };
}
var Scene = class {
  constructor(g, name, params) {
    this.g = g;
    this.name = name;
    this.params = params;
    this.hash = new SpatialHash(g.mode === "3d" ? 6 : 96);
    this.staticHash = new SpatialHash(g.mode === "3d" ? 6 : 96);
  }
  g;
  name;
  params;
  entities = [];
  time = 0;
  hash;
  /** Static things (walls, props) live in their own hash, rebuilt only when one is added or removed. */
  staticHash;
  staticDirty = true;
  timers = [];
  tickFns = [];
  _drawFns = [];
  endFns = [];
  collisions = 0;
  ended = false;
  get ui() {
    return this.g.ui;
  }
  get input() {
    return this.g.input;
  }
  get camera() {
    return this.g.renderer.camera;
  }
  /** Add an entity from options (or a made Entity). Returns it. */
  add(o) {
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
  addAll(list) {
    return list.map((o) => this.add(o));
  }
  /** Run fn every `sec` seconds of game time (optionally a number of times). */
  every(sec, fn, times) {
    const t = { id: TIMER_ID++, t: sec, every: sec, fn, dead: false, times };
    this.timers.push(t);
    return { cancel: () => t.dead = true, set every(v) {
      t.every = v;
    } };
  }
  /** Run fn once after `sec` seconds of game time. */
  after(sec, fn) {
    const t = { id: TIMER_ID++, t: sec, fn, dead: false };
    this.timers.push(t);
    return { cancel: () => t.dead = true };
  }
  on(ev, fn) {
    if (ev === "tick") this.tickFns.push(fn);
    else if (ev === "draw") this._drawFns.push(fn);
    else if (ev === "end") this.endFns.push(fn);
    return this;
  }
  // ---------- queries ----------
  find(tag) {
    return this.entities.filter((e) => e.alive && (!tag || e.tags.has(tag)));
  }
  count(tag) {
    let n = 0;
    for (const e of this.entities) if (e.alive && (!tag || e.tags.has(tag))) n++;
    return n;
  }
  first(tag) {
    return this.entities.find((e) => e.alive && e.tags.has(tag)) ?? null;
  }
  /** Nearest living entity with the tag to a point or entity (optionally within max). */
  nearest(tag, from, max = Infinity) {
    const p = from instanceof Entity ? from.p : from;
    let best = null, bd = max;
    for (const e of this.entities) {
      if (!e.alive || !e.tags.has(tag) || e === from) continue;
      const [x, y] = e.p;
      const d = Math.hypot(x - p[0], y - p[1]);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  /** Living entities with the tag within r of a point. */
  within(tag, at, r) {
    const out = [];
    for (const e of this.query(at[0], at[1], r)) {
      if (!e.alive || !e.tags.has(tag)) continue;
      const [x, y] = e.p;
      if (Math.hypot(x - at[0], y - at[1]) <= r + e.radius) out.push(e);
    }
    return out;
  }
  /** Nearest entity with one of the tags along a ray on the plane. */
  ray(from, dir, max = 1e4, tags, ignore) {
    return raycast(this.entities, from, dir, max, tags, ignore);
  }
  /** 3D ray (boxes, capsules with head shots, spheres): s.ray3([x,y,z], [dx,dy,dz], 200, ["wall","npc"], me). */
  ray3(from, dir, max = 1e4, tags, ignore) {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const dx = dir[0] / l, dz = dir[2] / l;
    const plane = Math.hypot(dx, dz);
    const c = this.hash.cell;
    const seen = /* @__PURE__ */ new Set();
    const cand = [];
    const buf = [];
    const take = (x, z, r) => {
      buf.length = 0;
      for (const e of this.query(x, z, r, buf)) if (!seen.has(e.id)) {
        seen.add(e.id);
        cand.push(e);
      }
    };
    if (this.g.mode !== "3d" || plane < 1e-3) take(from[0], from[2], c);
    else {
      const step = c * 0.5 / plane;
      for (let t = 0; t <= max + step; t += step) take(from[0] + dx * t, from[2] + dz * t, c * 0.75);
    }
    return raycast3(cand, from, dir, max, tags, ignore);
  }
  // ---------- effects ----------
  at3(at) {
    if (at instanceof Entity) return [at.x, at.y, at.z];
    if (this.g.mode === "3d" && at.length === 2) return [at[0], 0.6, at[1]];
    return at;
  }
  /** Particles: s.burst(e, { count: 30, color: "#ff0", speed: 8 }). */
  burst(at, o = {}) {
    this.g.renderer.burst(this.at3(at), o);
  }
  /** A line that fades: lasers, lightning, aim guides. */
  beam(a, b, o = {}) {
    this.g.renderer.beam(this.at3(a), this.at3(b), o);
  }
  /** An expanding ring: shockwaves, pickups. */
  ring(at, o = {}) {
    this.g.renderer.ring(this.at3(at), o);
  }
  /** Camera shake, 0..1. */
  shake(amount = 0.3) {
    this.g.renderer.camera.shake(amount);
  }
  /** Floating text at a world position. */
  popup(at, text, color) {
    const p = this.at3(at);
    const s = this.g.renderer.project(p[0], p[1], p[2] ?? 0);
    if (s) this.g.ui.popup(s.x, s.y, text, color);
  }
  // ---------- the step ----------
  step(dt, dtReal) {
    const g = this.g;
    this.time += dt;
    const live = g.state !== "over";
    for (const t of live ? this.timers : []) {
      if (t.dead) continue;
      t.t -= dt;
      if (t.t <= 0) {
        try {
          t.fn();
        } catch (err) {
          g._error(err);
        }
        if (t.every !== void 0 && (t.times === void 0 || --t.times > 0)) t.t += t.every;
        else t.dead = true;
      }
    }
    this.timers = this.timers.filter((t) => !t.dead);
    if (live) for (const f of this.tickFns) {
      try {
        f(dt, this);
      } catch (err) {
        g._error(err);
      }
    }
    this.ui.tick(dt);
    this.reindex();
    const n = this.entities.length;
    const is3d = g.mode === "3d";
    for (let i = 0; i < n; i++) {
      const e = this.entities[i];
      if (!e.alive) continue;
      if (e.opts.static && !e._tick.length && !e._ai.length) continue;
      const d = e.opts.unscaled ? dtReal : dt;
      e.ox = e.x;
      e.oy = e.y;
      e.oz = e.z;
      e.orot = e.rot;
      e.age += d;
      if (e.flashT > 0) e.flashT -= dtReal;
      if (e.invuln > 0) e.invuln -= d;
      try {
        if (e.opts.controls && e.opts.controls !== "none") this.control(e, d);
        for (const f of e._ai) f(e, d, this);
        for (const f of e._tick) f(d, e);
      } catch (err) {
        g._error(err);
      }
      if (!e.alive) continue;
      this.integrate(e, d, is3d);
      if (typeof e.opts.dies === "number" && e.age >= e.opts.dies) e.die("expired");
    }
    this.reindex();
    const buf = [];
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
          if (c) {
            resolve(a, b, c);
            if (pass === 0) this.collisions++;
          }
        }
      }
    }
    for (const a of this.entities) {
      if (!a.alive || a._hit.size === 0 && a._overlap.size === 0) continue;
      const [x, y] = a.p;
      buf.length = 0;
      const near = this.query(x, y, this.bound(a), buf);
      const now = /* @__PURE__ */ new Set();
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
            for (const [t, fns] of a._hit) if (b.tags.has(t)) for (const f of fns) {
              if (a.alive && b.alive) f(b, a);
            }
          }
          for (const [t, fns] of a._overlap) if (b.tags.has(t)) for (const f of fns) {
            if (a.alive && b.alive) f(b, a);
          }
        } catch (err) {
          g._error(err);
        }
        if (!a.alive) break;
      }
      a.contacts = now;
    }
    const eps = is3d ? 0.05 : 1.5;
    let w = 0;
    for (const e of this.entities) {
      if (e.alive) {
        if (!e.opts.static) e._checkMoved(eps);
        this.entities[w++] = e;
      } else {
        g.renderer.detach(e);
        if (e.opts.static) this.staticDirty = true;
      }
    }
    this.entities.length = w;
  }
  /** Moving things are re-hashed every step; static ones only when they change. */
  reindex() {
    if (this.staticDirty) {
      this.staticHash.clear();
      for (const e of this.entities) if (e.alive && e.opts.static) this.staticHash.insert(e);
      this.staticDirty = false;
    }
    this.hash.clear();
    for (const e of this.entities) if (e.alive && !e.opts.static) this.hash.insert(e);
  }
  /** Everything whose cells touch a circle on the plane (moving and static). */
  query(x, y, r, out = []) {
    this.hash.query(x, y, r, out);
    return this.staticHash.query(x, y, r, out);
  }
  bound(e) {
    if (e.box) return Math.max(e.box[0], e.is3d ? e.box[2] ?? e.box[0] : e.box[1]) * 0.5 * e.scale;
    return e.radius * e.scale;
  }
  /** Player controls by scheme. */
  control(e, dt) {
    const g = this.g, inp = g.input;
    const scheme = e.opts.controls;
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
      if ((inp.pressed("jump") || inp.pressed("up") && !inp.used.has("jump")) && e.onGround) {
        e.vy = -(e.opts.jump ?? 520);
        e.onGround = false;
        e.data.jumped = true;
      }
      if (inp.released("jump") && e.vy < 0) e.vy *= 0.5;
      if (Math.abs(mv.x) > 0.1) e.data.faceX = Math.sign(mv.x);
      return;
    }
    if (scheme === "mouse" && inp.pointer.moved && inp.using !== "pad" && Math.hypot(mv.x, mv.y) < 0.1) {
      const w = inp.pointer.world;
      let to = [w.x, w.y];
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
  integrate(e, d, is3d) {
    const o = e.opts;
    if (o.static) return;
    e.onGround = false;
    if (o.gravity) {
      if (is3d) e.vy -= o.gravity * d;
      else e.vy += o.gravity * d;
    }
    if (o.drag) {
      const k = Math.exp(-o.drag * d);
      e.vx *= k;
      e.vz *= k;
      if (!is3d && !o.gravity) e.vy *= k;
      if (!is3d && o.gravity) {
      }
    }
    if (o.maxSpeed) {
      const [a, b] = e.v;
      const l = Math.hypot(a, b);
      if (l > o.maxSpeed) e.v = [a / l * o.maxSpeed, b / l * o.maxSpeed];
    }
    e.x += e.vx * d;
    e.y += e.vy * d;
    e.z += e.vz * d;
    if (is3d) {
      const ground = o.height ?? (e.box ? e.box[1] / 2 : e.radius);
      if (o.gravity && e.y <= ground) {
        e.y = ground;
        if (e.vy < 0) e.vy = 0;
        e.onGround = true;
      }
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
    if (o.trail) {
      const tr = typeof o.trail === "object" ? o.trail : {};
      e._trailT -= d;
      if (e._trailT <= 0) {
        e._trailT = tr.every ?? 0.03;
        this.g.renderer.burst([e.x, e.y, e.z], {
          count: 1,
          color: tr.color ?? o.color ?? "#fff",
          speed: 0,
          life: 0.35,
          size: tr.size ?? (is3d ? e.radius * 0.9 : e.radius * 0.8),
          fade: true
        });
      }
    }
    this.applyBounds(e);
  }
  applyBounds(e) {
    const b = this.g.bounds;
    const mode = e.opts.bounds ?? (e.opts.controls && e.opts.controls !== "none" ? "clamp" : "none");
    const dies = e.opts.dies === "offscreen" || e.opts.dies === "bounds";
    if (mode === "none" && !dies) return;
    const r = e.radius * e.scale;
    const [x, y] = e.p;
    if (b.kind === "circle") {
      const dx = x - b.cx, dy = y - b.cy;
      const d = Math.hypot(dx, dy);
      if (dies && d > b.r + r * 2) {
        e.die("offscreen");
        return;
      }
      const lim = b.r - r;
      if (d > lim && d > 0) {
        const nx2 = dx / d, ny2 = dy / d;
        e.data.edge = "edge";
        if (mode === "clamp" || mode === "bounce") {
          e.p = [b.cx + nx2 * lim, b.cy + ny2 * lim];
          const [vx2, vy2] = e.v;
          const vn = vx2 * nx2 + vy2 * ny2;
          if (vn > 0) {
            const k = mode === "bounce" ? 1 + (e.opts.bounce ?? 1) : 1;
            e.v = [vx2 - nx2 * vn * k, vy2 - ny2 * vn * k];
          }
        } else if (mode === "die") e.die("bounds");
        else if (mode === "wrap") e.p = [b.cx - nx2 * lim, b.cy - ny2 * lim];
      }
      return;
    }
    let view = b;
    if (dies && e.opts.dies === "offscreen" && this.g.mode === "2d") view = this.g.renderer.view() ?? b;
    if (dies && (x < view.x0 - r * 2 || x > view.x1 + r * 2 || y < view.y0 - r * 2 || y > view.y1 + r * 2)) {
      e.die("offscreen");
      return;
    }
    if (mode === "none") return;
    let nx = x, ny = y;
    let [vx, vy] = e.v;
    const bounce = e.opts.bounce ?? 1;
    if (mode === "wrap") {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (x < b.x0 - r) nx += w + 2 * r;
      else if (x > b.x1 + r) nx -= w + 2 * r;
      if (y < b.y0 - r) ny += h + 2 * r;
      else if (y > b.y1 + r) ny -= h + 2 * r;
    } else if (mode === "die") {
      if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) e.die("bounds");
      return;
    } else {
      const hw = e.box ? e.box[0] / 2 : r;
      const hh = e.box ? (this.g.mode === "3d" ? e.box[2] ?? e.box[0] : e.box[1]) / 2 : r;
      if (nx < b.x0 + hw) {
        nx = b.x0 + hw;
        if (vx < 0) vx = mode === "bounce" ? -vx * bounce : 0;
        e.data.edge = "left";
      }
      if (nx > b.x1 - hw) {
        nx = b.x1 - hw;
        if (vx > 0) vx = mode === "bounce" ? -vx * bounce : 0;
        e.data.edge = "right";
      }
      if (ny < b.y0 + hh) {
        ny = b.y0 + hh;
        if (vy < 0) vy = mode === "bounce" ? -vy * bounce : 0;
        e.data.edge = "top";
      }
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
    for (const f of this.endFns) try {
      f();
    } catch {
    }
  }
};

// src/input.ts
var DEFAULT_BINDINGS = {
  up: ["ArrowUp", "KeyW", "pad:12"],
  down: ["ArrowDown", "KeyS", "pad:13"],
  left: ["ArrowLeft", "KeyA", "pad:14"],
  right: ["ArrowRight", "KeyD", "pad:15"],
  fire: ["KeyJ", "KeyZ", "mouse:0", "pad:7", "pad:2", "touch:fire"],
  jump: ["Space", "KeyK", "KeyX", "pad:0", "touch:jump"],
  alt: ["ShiftLeft", "ShiftRight", "KeyL", "KeyC", "KeyE", "mouse:2", "pad:1", "pad:4", "pad:5", "touch:alt"],
  pause: ["KeyP", "Escape", "pad:9"]
};
var ALIASES = {
  dash: "jump",
  action: "jump",
  boost: "jump",
  special: "alt",
  bomb: "alt",
  slow: "alt",
  shield: "alt",
  shoot: "fire",
  attack: "fire",
  start: "pause",
  menu: "pause"
};
var DEAD = 0.22;
var Input = class {
  constructor(root) {
    this.root = root;
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.edgeDown.add(e.code);
      this.using = "keys";
      this.fireAny();
    });
    addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      this.edgeUp.add(e.code);
    });
    addEventListener("blur", () => this.keys.clear());
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    root.addEventListener("wheel", (e) => {
      this.wheelAcc += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement || this.freeLook) {
        this.lookAcc.x += e.movementX;
        this.lookAcc.y += e.movementY;
      }
    });
    root.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = root.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.inside = true;
      this.pointer.moved = true;
      if (this.using === "touch") this.using = "keys";
    });
    root.addEventListener("mousedown", (e) => {
      if (e.sourceCapabilities?.firesTouchEvents) return;
      const code = "mouse:" + e.button;
      this.keys.add(code);
      this.edgeDown.add(code);
      this.pointer.down = true;
      this.using = "keys";
      this.fireAny();
    });
    addEventListener("mouseup", (e) => {
      const code = "mouse:" + e.button;
      this.keys.delete(code);
      this.edgeUp.add(code);
      if (e.buttons === 0) this.pointer.down = false;
    });
    root.addEventListener("touchstart", (e) => this.onTouch(e, "start"), { passive: false });
    root.addEventListener("touchmove", (e) => this.onTouch(e, "move"), { passive: false });
    root.addEventListener("touchend", (e) => this.onTouch(e, "end"), { passive: false });
    root.addEventListener("touchcancel", (e) => this.onTouch(e, "end"), { passive: false });
  }
  root;
  bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  /** Actions the game has asked about; touch buttons are shown only for these. */
  used = /* @__PURE__ */ new Set();
  /** The last kind of device used: "keys", "pad" or "touch". */
  using = "keys";
  /** Pointer in canvas CSS pixels, plus world position (filled by the renderer). */
  pointer = { x: 0, y: 0, down: false, inside: false, moved: false, world: { x: 0, y: 0 } };
  lookAcc = { x: 0, y: 0 };
  wheelAcc = 0;
  keys = /* @__PURE__ */ new Set();
  edgeDown = /* @__PURE__ */ new Set();
  edgeUp = /* @__PURE__ */ new Set();
  pads = [];
  padPrev = [];
  touch = {
    on: false,
    move: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
    aim: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
    buttons: /* @__PURE__ */ new Set()
  };
  touchEl;
  anyHandlers = [];
  wantsAimStick = false;
  /** Mouse look without pointer lock (when a page or frame refuses the lock). */
  freeLook = false;
  /** Called once for any key, click, tap or pad button (used for "press to start"). */
  onAny(fn) {
    this.anyHandlers.push(fn);
    return () => this.anyHandlers = this.anyHandlers.filter((f) => f !== fn);
  }
  fireAny() {
    for (const f of [...this.anyHandlers]) f();
  }
  /** Bind extra keys to an action: input.bind("bomb", ["KeyB", "pad:3"]). With { replace: true } the old keys go. */
  bind(action, codes, o = {}) {
    const a = ALIASES[action] ?? action;
    this.bindings[a] = o.replace ? [...codes] : [...this.bindings[a] ?? [], ...codes];
  }
  /** Lock the mouse to the game (needs a click or key press first). */
  lockPointer() {
    if (document.pointerLockElement || this.touch.on) return;
    try {
      const r = (this.root.querySelector("canvas") ?? this.root).requestPointerLock?.();
      r?.catch?.(() => {
      });
    } catch {
    }
  }
  get locked() {
    return !!document.pointerLockElement;
  }
  /** Mouse movement since the last call (pixels), plus the right stick and the touch aim stick scaled to match. */
  look(dt = 1 / 60) {
    let x = this.lookAcc.x, y = this.lookAcc.y;
    this.lookAcc.x = this.lookAcc.y = 0;
    const p = this.pads[0];
    if (p) {
      const ax = p.axes[2] ?? 0, ay = p.axes[3] ?? 0;
      if (len(ax, ay) > DEAD) {
        x += ax * Math.abs(ax) * 900 * dt;
        y += ay * Math.abs(ay) * 650 * dt;
      }
    }
    if (this.touch.aim.id >= 0) {
      x += (this.touch.aim.x - this.touch.aim.ox) / 50 * 700 * dt;
      y += (this.touch.aim.y - this.touch.aim.oy) / 50 * 500 * dt;
    }
    return { x, y };
  }
  /** Mouse wheel steps since the last call (+1 down, -1 up). */
  wheel() {
    const w = this.wheelAcc;
    this.wheelAcc = 0;
    return w;
  }
  resolve(action) {
    const a = ALIASES[action] ?? action;
    this.used.add(a);
    let codes = this.bindings[a] ?? [];
    if (a === "fire" && !this.used.has("jump")) codes = [...codes, "Space"];
    return { a, codes };
  }
  codeDown(code) {
    if (code.startsWith("pad:")) {
      const b = +code.slice(4);
      return this.pads.some((p) => !!p && !!p.buttons[b]?.pressed);
    }
    if (code.startsWith("touch:")) return this.touch.buttons.has(code.slice(6));
    return this.keys.has(code);
  }
  codeEdge(code, which) {
    if (code.startsWith("pad:")) {
      const b = +code.slice(4);
      return this.pads.some((p, i) => {
        if (!p) return false;
        const now = !!p.buttons[b]?.pressed;
        const was = !!this.padPrev[i]?.[b];
        return which === "down" ? now && !was : !now && was;
      });
    }
    const set = which === "down" ? this.edgeDown : this.edgeUp;
    return set.has(code);
  }
  /** Is the action held? Twin-stick aim past halfway also counts as "fire". */
  down(action) {
    const { a, codes } = this.resolve(action);
    if (codes.some((c) => this.codeDown(c))) return true;
    if (a === "fire" && this.wantsAimStick) {
      const s = this.rightStick();
      if (s && len(s.x, s.y) > 0.5) return true;
    }
    return false;
  }
  /** Did the action start this step? */
  pressed(action) {
    const { codes } = this.resolve(action);
    return codes.some((c) => this.codeEdge(c, "down"));
  }
  released(action) {
    const { codes } = this.resolve(action);
    return codes.some((c) => this.codeEdge(c, "up"));
  }
  /** Movement vector (length ≤ 1) from keys, pad left stick, or touch stick. */
  move(scheme = "keys", player = 0) {
    let x = 0, y = 0;
    const k = (c) => this.keys.has(c) ? 1 : 0;
    const useArrows = scheme !== "wasd";
    const useWasd = scheme !== "arrows";
    if (useArrows) {
      x += k("ArrowRight") - k("ArrowLeft");
      y += k("ArrowDown") - k("ArrowUp");
    }
    if (useWasd) {
      x += k("KeyD") - k("KeyA");
      y += k("KeyS") - k("KeyW");
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    const p = this.pads[player];
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (len(ax, ay) > DEAD) {
        x = ax;
        y = ay;
      }
      if (p.buttons[12]?.pressed) y = -1;
      if (p.buttons[13]?.pressed) y = 1;
      if (p.buttons[14]?.pressed) x = -1;
      if (p.buttons[15]?.pressed) x = 1;
    }
    if (player === 0 && this.touch.move.id >= 0) {
      const t = this.touch.move;
      const dx = (t.x - t.ox) / 50, dy = (t.y - t.oy) / 50;
      const l2 = len(dx, dy);
      if (l2 > 0.15) {
        x = dx / Math.max(1, l2);
        y = dy / Math.max(1, l2);
      }
    }
    const l = len(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }
  /** Right stick (pad or touch), or null when centred. */
  rightStick(player = 0) {
    const p = this.pads[player];
    if (p) {
      const ax = p.axes[2] ?? 0, ay = p.axes[3] ?? 0;
      if (len(ax, ay) > DEAD) return { x: ax, y: ay };
    }
    if (player === 0 && this.touch.aim.id >= 0) {
      const t = this.touch.aim;
      const dx = (t.x - t.ox) / 50, dy = (t.y - t.oy) / 50;
      const l = len(dx, dy);
      if (l > 0.2) return { x: dx / Math.max(1, l), y: dy / Math.max(1, l) };
    }
    return null;
  }
  get isTouch() {
    return this.touch.on;
  }
  padCount() {
    return this.pads.filter(Boolean).length;
  }
  /** Gamepad rumble when the browser supports it. */
  vibrate(ms = 120, strength = 0.6) {
    for (const p of this.pads) {
      const act = p?.vibrationActuator;
      try {
        act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
      } catch {
      }
    }
    if (this.touch.on) try {
      navigator.vibrate?.(Math.min(ms, 60));
    } catch {
    }
  }
  /** Called by the loop before each fixed step. */
  beginStep() {
    const list = navigator.getGamepads?.() ?? [];
    this.pads = Array.from(list).filter((p) => p && p.connected).slice(0, 4);
    for (const p of this.pads) {
      if (!p) continue;
      if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5)) {
        if (this.using !== "pad") this.using = "pad";
        if (p.buttons.some((b, i) => b.pressed && !this.padPrev[this.pads.indexOf(p)]?.[i])) this.fireAny();
      }
    }
  }
  /** Called by the loop after each fixed step: clears edges. */
  endStep() {
    this.edgeDown.clear();
    this.edgeUp.clear();
    this.padPrev = this.pads.map((p) => p ? p.buttons.map((b) => b.pressed) : []);
  }
  /** What is bound, for the report. */
  describe() {
    return {
      using: this.using,
      pads: this.padCount(),
      touch: this.touch.on,
      used: [...this.used],
      bound: Object.fromEntries([...this.used].map((a) => [a, this.bindings[a] ?? []]))
    };
  }
  // ---------- touch ----------
  onTouch(e, kind) {
    e.preventDefault();
    if (!this.touch.on) {
      this.touch.on = true;
      this.buildTouchUi();
    }
    this.using = "touch";
    const r = this.root.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      const target = t.target?.closest?.("[data-kg-btn]");
      if (kind === "start") {
        this.fireAny();
        if (target) {
          const name = target.dataset.kgBtn;
          this.touch.buttons.add(name);
          this.edgeDown.add("touch:" + name);
          target.dataset.id = String(t.identifier);
          target.classList.add("on");
          continue;
        }
        const left = x < r.width / 2;
        const stick = left ? this.touch.move : this.wantsAimStick ? this.touch.aim : null;
        if (stick && stick.id < 0) Object.assign(stick, { id: t.identifier, ox: x, oy: y, x, y });
        if (!stick && !left) {
          this.pointer.x = x;
          this.pointer.y = y;
        }
      } else if (kind === "move") {
        for (const s of [this.touch.move, this.touch.aim]) if (s.id === t.identifier) {
          s.x = x;
          s.y = y;
        }
      } else {
        for (const s of [this.touch.move, this.touch.aim]) if (s.id === t.identifier) s.id = -1;
        this.root.querySelectorAll("[data-kg-btn]").forEach((b) => {
          if (b.dataset.id === String(t.identifier)) {
            this.touch.buttons.delete(b.dataset.kgBtn);
            this.edgeUp.add("touch:" + b.dataset.kgBtn);
            b.classList.remove("on");
            b.dataset.id = "";
          }
        });
      }
    }
    this.drawSticks();
  }
  buildTouchUi() {
    const el = document.createElement("div");
    el.className = "kg-touch";
    this.root.appendChild(el);
    this.touchEl = el;
    this.refreshTouchButtons();
  }
  /** Show buttons only for actions the game uses. */
  refreshTouchButtons() {
    if (!this.touchEl) return;
    const want = ["fire", "jump", "alt"].filter((a) => this.used.has(a) && !(a === "fire" && this.wantsAimStick));
    const label = { fire: "\u25CF", jump: "\u25B2", alt: "\u25C6" };
    const html = `<div class="kg-stick l"><i></i></div><div class="kg-stick r"><i></i></div><div class="kg-btns">${want.map((a) => `<button data-kg-btn="${a}">${label[a]}<small>${a}</small></button>`).join("")}</div><button class="kg-tpause" data-kg-btn="pause">II</button>`;
    if (this.touchEl.dataset.k !== want.join()) {
      this.touchEl.innerHTML = html;
      this.touchEl.dataset.k = want.join();
    }
  }
  drawSticks() {
    if (!this.touchEl) return;
    const sticks = [["l", this.touch.move], ["r", this.touch.aim]];
    for (const [c, s] of sticks) {
      const el = this.touchEl.querySelector(".kg-stick." + c);
      if (!el) continue;
      el.style.display = s.id >= 0 ? "block" : "none";
      el.style.left = s.ox - 50 + "px";
      el.style.top = s.oy - 50 + "px";
      const dx = Math.max(-40, Math.min(40, s.x - s.ox)), dy = Math.max(-40, Math.min(40, s.y - s.oy));
      el.firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
    }
  }
};

// src/ui.ts
var CSS = `
.kg-root{position:relative;overflow:hidden;background:#000;user-select:none;-webkit-user-select:none;touch-action:none;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef3ff;--kg-accent:#3fd0e0;--kg-u:clamp(11px,1.6vmin,18px)}
.kg-root canvas{display:block;position:absolute;inset:0;margin:auto;outline:none}
.kg-hud{position:absolute;inset:0;pointer-events:none;font-size:var(--kg-u)}
.kg-slot{position:absolute;display:flex;flex-direction:column;gap:.5em;padding:1.1em 1.3em}
.kg-slot[data-at=top-left]{left:0;top:0;align-items:flex-start}
.kg-slot[data-at=top]{left:50%;top:0;transform:translateX(-50%);align-items:center}
.kg-slot[data-at=top-right]{right:0;top:0;align-items:flex-end}
.kg-slot[data-at=bottom-left]{left:0;bottom:0;align-items:flex-start}
.kg-slot[data-at=bottom]{left:50%;bottom:0;transform:translateX(-50%);align-items:center}
.kg-slot[data-at=bottom-right]{right:0;bottom:0;align-items:flex-end}
.kg-slot[data-at=center]{left:50%;top:50%;transform:translate(-50%,-50%);align-items:center}
.kg-item{font-variant-numeric:tabular-nums;text-shadow:0 1px 8px rgba(0,0,0,.6);line-height:1.1}
.kg-lbl{font-size:.72em;letter-spacing:.18em;text-transform:uppercase;opacity:.65;display:block;margin-bottom:.2em}
.kg-score b{font-size:2.1em;font-weight:800;letter-spacing:.02em;display:inline-block;transition:transform .12s}
.kg-score b.bump{transform:scale(1.18)}
.kg-text{font-size:1.1em;font-weight:600}
.kg-bar{width:var(--w,14em)}
.kg-bar .t{height:.62em;border-radius:1em;background:rgba(255,255,255,.12);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.kg-bar .f{height:100%;width:100%;border-radius:1em;background:var(--c,var(--kg-accent));transform-origin:left;transition:transform .15s;box-shadow:0 0 12px var(--c,var(--kg-accent))}
.kg-lives{font-size:1.3em;letter-spacing:.15em;color:var(--c,#ff5d7a)}
.kg-banner{position:absolute;left:0;right:0;top:34%;text-align:center;pointer-events:none;animation:kg-in .5s cubic-bezier(.2,1.4,.4,1) both}
.kg-banner h2{margin:0;font-size:calc(var(--kg-u)*3.4);font-weight:900;letter-spacing:.12em;color:var(--c,#fff);text-shadow:0 0 28px var(--c,var(--kg-accent))}
.kg-banner p{margin:.4em 0 0;font-size:calc(var(--kg-u)*1.1);letter-spacing:.3em;text-transform:uppercase;opacity:.8}
.kg-banner.out{animation:kg-out .4s ease-in both}
@keyframes kg-in{from{opacity:0;transform:scale(1.6)}to{opacity:1;transform:none}}
@keyframes kg-out{to{opacity:0;transform:translateY(-20px)}}
.kg-pop{position:absolute;font-weight:800;font-size:calc(var(--kg-u)*1.05);pointer-events:none;white-space:nowrap;transform:translate(-50%,-50%);text-shadow:0 0 10px currentColor;animation:kg-pop .9s ease-out forwards}
@keyframes kg-pop{0%{opacity:0;margin-top:0;scale:.6}15%{opacity:1;scale:1.15}100%{opacity:0;margin-top:-48px;scale:1}}
.kg-flash{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s}
.kg-vignette{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 18vmin rgba(255,0,60,.0);transition:box-shadow .3s}
.kg-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:radial-gradient(ellipse at center,rgba(5,8,20,.55),rgba(5,8,20,.88));backdrop-filter:blur(3px);font-size:var(--kg-u);animation:kg-fade .35s both}
.kg-card.clear{background:linear-gradient(180deg,rgba(4,6,16,.0) 30%,rgba(4,6,16,.78));backdrop-filter:none}
@keyframes kg-fade{from{opacity:0}}
.kg-card .in{text-align:center;max-width:min(92vw,40em);padding:2em}
.kg-card h1{margin:0;font-size:calc(var(--kg-u)*4.2);font-weight:900;letter-spacing:.08em;line-height:1;background:linear-gradient(90deg,#fff,var(--kg-accent),#fff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 24px color-mix(in srgb,var(--kg-accent) 60%,transparent))}
.kg-card h3{margin:.5em 0 1.4em;font-weight:500;letter-spacing:.35em;text-transform:uppercase;opacity:.7;font-size:.95em}
.kg-card ul{list-style:none;padding:0;margin:0 0 1.6em;display:grid;gap:.45em;font-size:.98em;opacity:.9}
.kg-card li kbd{display:inline-block;min-width:1.6em;padding:.1em .45em;margin:0 .15em;border-radius:.35em;background:rgba(255,255,255,.12);box-shadow:inset 0 -2px 0 rgba(0,0,0,.35);font:600 .85em ui-monospace,monospace}
.kg-go{display:inline-block;padding:.75em 1.8em;border-radius:3em;border:1px solid color-mix(in srgb,var(--kg-accent) 70%,transparent);color:#fff;letter-spacing:.3em;font-weight:700;text-transform:uppercase;font-size:.95em;animation:kg-pulse 1.6s ease-in-out infinite;background:color-mix(in srgb,var(--kg-accent) 18%,transparent)}
@keyframes kg-pulse{50%{box-shadow:0 0 26px var(--kg-accent);transform:scale(1.04)}}
.kg-hs{margin:0 auto 1.4em;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:16em}
.kg-hs td{padding:.28em .8em;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}
.kg-hs td:last-child{text-align:right;opacity:.55}
.kg-hs tr.me td{color:var(--kg-accent);font-weight:800}
.kg-big{font-size:calc(var(--kg-u)*3);font-weight:900;margin:.1em 0 .3em}
.kg-new{color:#ffd166;letter-spacing:.3em;font-weight:800;animation:kg-pulse 1s infinite}
.kg-small{opacity:.55;font-size:.82em;margin-top:1.2em;letter-spacing:.05em}
.kg-report{position:absolute;right:.6em;top:4.5em;width:19em;max-height:70%;overflow:auto;background:rgba(4,8,18,.82);border:1px solid rgba(120,200,255,.25);border-radius:.6em;padding:.7em .8em;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#bfe9ff;pointer-events:none;white-space:pre}
.kg-touch{position:absolute;inset:0;pointer-events:none}
.kg-stick{position:absolute;width:100px;height:100px;border-radius:50%;border:2px solid rgba(255,255,255,.25);background:rgba(255,255,255,.05);display:none}
.kg-stick i{position:absolute;left:30px;top:30px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.35)}
.kg-btns{position:absolute;right:4vmin;bottom:5vmin;display:flex;gap:3vmin;pointer-events:auto}
.kg-btns button,.kg-tpause{pointer-events:auto;width:16vmin;height:16vmin;max-width:84px;max-height:84px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:#fff;font-size:22px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.kg-btns button small{font-size:9px;letter-spacing:.15em;text-transform:uppercase;opacity:.7}
.kg-btns button.on{background:rgba(255,255,255,.3)}
.kg-tpause{position:absolute;top:2vmin;left:50%;transform:translateX(-50%);width:40px;height:40px;font-size:13px}
`;
var cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.appendChild(s);
}
var UI = class {
  constructor(root) {
    this.root = root;
    injectCss();
    this.layer = document.createElement("div");
    this.layer.className = "kg-hud";
    this.hud = document.createElement("div");
    this.hud.className = "kg-hud";
    this.flashEl = document.createElement("div");
    this.flashEl.className = "kg-flash";
    this.vignetteEl = document.createElement("div");
    this.vignetteEl.className = "kg-vignette";
    root.append(this.flashEl, this.vignetteEl, this.layer, this.hud);
  }
  root;
  hud;
  layer;
  slots = {};
  items = [];
  timers = [];
  flashEl;
  vignetteEl;
  card;
  reportEl;
  slot(at) {
    if (!this.slots[at]) {
      const s = document.createElement("div");
      s.className = "kg-slot";
      s.dataset.at = at;
      this.hud.appendChild(s);
      this.slots[at] = s;
    }
    return this.slots[at];
  }
  item(at, cls, html) {
    const el = document.createElement("div");
    el.className = "kg-item " + cls;
    el.innerHTML = html;
    this.slot(at).appendChild(el);
    return el;
  }
  /** Remove everything the current scene made. */
  clear() {
    this.hud.innerHTML = "";
    this.layer.innerHTML = "";
    this.slots = {};
    this.items = [];
    this.timers = [];
    this.vignette(0);
  }
  score(o = {}) {
    const el = this.item(o.at ?? "top-left", "kg-score", `<span class="kg-lbl">${o.label ?? "Score"}</span><b>0</b>`);
    const b = el.querySelector("b");
    let shown = -1;
    const h = {
      value: o.value ?? 0,
      el,
      add(n) {
        h.set(h.value + n);
      },
      set(n) {
        h.value = n;
        const r = Math.round(n);
        if (r !== shown) {
          shown = r;
          b.textContent = r.toLocaleString("en-US");
          b.classList.add("bump");
          setTimeout(() => b.classList.remove("bump"), 90);
        }
      }
    };
    h.set(h.value);
    this.items.push({ kind: "score", label: o.label ?? "Score", get: () => h.value, el });
    return h;
  }
  text(o = {}) {
    const opt = typeof o === "string" ? { text: o } : o;
    const el = this.item(opt.at ?? "top", "kg-text", (opt.label ? `<span class="kg-lbl">${opt.label}</span>` : "") + `<span></span>`);
    const span = el.lastElementChild;
    if (opt.color) el.style.color = opt.color;
    const h = { el, set(t) {
      span.textContent = t;
    } };
    h.set(opt.text ?? "");
    this.items.push({ kind: "text", label: opt.label, get: () => span.textContent, el });
    return h;
  }
  bar(o = {}) {
    const el = this.item(o.at ?? "top-left", "kg-bar", `<span class="kg-lbl">${o.label ?? ""}</span><div class="t"><div class="f"></div></div>`);
    if (o.color) el.style.setProperty("--c", o.color);
    if (o.width) el.style.setProperty("--w", o.width);
    if (!o.label) el.firstElementChild.style.display = "none";
    const f = el.querySelector(".f");
    const h = {
      value: o.value ?? o.max ?? 1,
      max: o.max ?? 1,
      el,
      set(v, max) {
        if (max !== void 0) h.max = max;
        h.value = Math.max(0, Math.min(h.max, v));
        f.style.transform = `scaleX(${h.max ? h.value / h.max : 0})`;
      },
      show(v) {
        el.style.display = v ? "" : "none";
      }
    };
    h.set(h.value);
    this.items.push({ kind: "bar", label: o.label, get: () => `${Math.round(h.value)}/${h.max}`, el });
    return h;
  }
  lives(n = 3, o = {}) {
    const el = this.item(o.at ?? "top-right", "kg-lives", "");
    if (o.color) el.style.setProperty("--c", o.color);
    const icon = o.icon ?? "\u2665";
    const h = {
      value: n,
      el,
      set(v) {
        h.value = Math.max(0, v);
        el.innerHTML = (o.label ? `<span class="kg-lbl">${o.label}</span>` : "") + icon.repeat(h.value) + `<span style="opacity:.2">${icon.repeat(Math.max(0, n - h.value))}</span>`;
      },
      lose(k = 1) {
        h.set(h.value - k);
        return h.value;
      }
    };
    h.set(n);
    this.items.push({ kind: "lives", get: () => h.value, el });
    return h;
  }
  /** A countdown (from > 0) or a stopwatch (from = 0). Calls onEnd at zero. */
  timer(o = {}) {
    const el = this.item(o.at ?? "top", "kg-score", `<span class="kg-lbl">${o.label ?? "Time"}</span><b></b>`);
    const b = el.querySelector("b");
    const fmt = (s) => {
      const t = Math.max(0, s);
      const m = Math.floor(t / 60), sec = Math.floor(t % 60);
      return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : t < 10 && (o.from ?? 0) > 0 ? t.toFixed(1) : String(sec);
    };
    const h = { value: o.from ?? 0, running: true, el, set(s) {
      h.value = s;
      b.textContent = fmt(s);
    } };
    h.set(h.value);
    this.timers.push({ h, dir: (o.from ?? 0) > 0 ? -1 : 1, onEnd: o.onEnd, fmt, b });
    this.items.push({ kind: "timer", label: o.label, get: () => +h.value.toFixed(1), el });
    return h;
  }
  tick(dt) {
    for (const t of this.timers) {
      if (!t.h.running) continue;
      const before = t.h.value;
      t.h.set(t.h.value + t.dir * dt);
      if (t.dir < 0 && before > 0 && t.h.value <= 0) {
        t.h.set(0);
        t.h.running = false;
        t.onEnd?.();
      }
    }
  }
  /** Big centred words for a moment: ui.banner("WAVE 3", { sub: "incoming" }). */
  banner(title, o = {}) {
    const el = document.createElement("div");
    el.className = "kg-banner";
    el.innerHTML = `<h2>${title}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}`;
    if (o.color) el.style.setProperty("--c", o.color);
    this.layer.appendChild(el);
    const t = (o.time ?? 1.6) * 1e3;
    setTimeout(() => el.classList.add("out"), t);
    setTimeout(() => el.remove(), t + 450);
  }
  /** Floating text at a screen position (CSS px). */
  popup(x, y, text, color = "#fff") {
    if (this.layer.childElementCount > 60) return;
    const el = document.createElement("div");
    el.className = "kg-pop";
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.color = color;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  flash(color = "#fff", strength = 0.5) {
    const f = this.flashEl;
    f.style.transition = "none";
    f.style.background = color;
    f.style.opacity = String(strength);
    requestAnimationFrame(() => {
      f.style.transition = "opacity .35s";
      f.style.opacity = "0";
    });
  }
  /** Red edges when hurt: 0..1. */
  vignette(v, color = "255,0,60") {
    this.vignetteEl.style.boxShadow = `inset 0 0 ${10 + v * 18}vmin rgba(${color},${(v * 0.55).toFixed(2)})`;
  }
  /** Centre card for title, pause and game over. */
  showCard(html, clear = false) {
    this.hideCard();
    const c = document.createElement("div");
    c.className = "kg-card" + (clear ? " clear" : "");
    c.innerHTML = `<div class="in">${html}</div>`;
    this.root.appendChild(c);
    this.card = c;
    return c;
  }
  hideCard() {
    this.card?.remove();
    this.card = void 0;
  }
  get cardOpen() {
    return !!this.card;
  }
  report(text) {
    if (text === null) {
      this.reportEl?.remove();
      this.reportEl = void 0;
      return;
    }
    if (!this.reportEl) {
      this.reportEl = document.createElement("div");
      this.reportEl.className = "kg-report";
      this.root.appendChild(this.reportEl);
    }
    this.reportEl.textContent = text;
  }
  describe() {
    return this.items.map((i) => ({ kind: i.kind, label: i.label, value: i.get() }));
  }
};

// src/sound.ts
var ctx = null;
var master;
var sfxBus;
var musicBus;
var musicFilter;
var noiseBuf = null;
var muted = false;
var volume = 0.7;
var lastPlayed = {};
function ac() {
  if (ctx) return ctx;
  const C = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass";
  musicFilter.frequency.value = 18e3;
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.45;
  sfxBus.connect(master);
  musicBus.connect(musicFilter).connect(master);
  master.connect(comp).connect(ctx.destination);
  const n = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, n, n);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}
function throttle(name, ms) {
  const now = performance.now();
  if (now - (lastPlayed[name] ?? 0) < ms) return false;
  lastPlayed[name] = now;
  return true;
}
var vary = (f, amt = 0.06) => f * (1 + (Math.random() * 2 - 1) * amt);
function tone(f0, f1, dur, type = "square", vol = 0.2, when = 0, bus) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 8e-3);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  o.connect(g).connect(bus ?? sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur, f0, f1, vol = 0.3, type = "lowpass", when = 0, bus) {
  const c = ac();
  if (!c || !noiseBuf) return;
  const t = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.7 + Math.random() * 0.6;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  s.connect(f).connect(g).connect(bus ?? sfxBus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}
var mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
var PROGRESSIONS = {
  // chords as midi roots + minor/major triads
  drive: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  // Am F C G
  calm: [[50, 53, 57], [55, 58, 62], [52, 55, 59], [57, 61, 64]],
  // Dm Gm Em A
  tense: [[52, 55, 59], [52, 55, 58], [48, 52, 55], [47, 50, 54]]
  // Em Edim C Bdim
};
var current = null;
function startMusic(opts = {}) {
  current?.stop();
  let style = opts.style ?? "drive";
  let bpm = opts.bpm ?? 118;
  let inten = opts.intensity ?? 0.4;
  let step = 0;
  let nextTime = 0;
  let playing = true;
  const id = Math.random();
  const timer = setInterval(() => {
    const c = ac();
    if (!c || !playing || c.state !== "running") return;
    if (nextTime < c.currentTime) nextTime = c.currentTime + 0.05;
    const sixteenth = 60 / bpm / 4;
    while (nextTime < c.currentTime + 0.15) {
      schedule(step, nextTime - c.currentTime, sixteenth);
      step++;
      nextTime += sixteenth;
    }
  }, 25);
  function schedule(s, when, len16) {
    const prog = PROGRESSIONS[style];
    const bar = Math.floor(s / 16) % prog.length;
    const chord = prog[bar];
    const i = s % 16;
    if (i === 0) for (const n of chord) tone(mtof(n), mtof(n), len16 * 16, "triangle", 0.035, when, musicBus);
    if (i % 2 === 0) {
      const oct = inten > 0.55 && i % 4 === 2 ? 12 : 0;
      tone(mtof(chord[0] - 24 + oct), mtof(chord[0] - 24 + oct), len16 * 1.6, "sawtooth", 0.06 + inten * 0.03, when, musicBus);
    }
    if (inten > 0.25 && i % 4 === 0) {
      tone(150, 40, 0.18, "sine", 0.35, when, musicBus);
    }
    if (inten > 0.5 && (i === 4 || i === 12)) noise(0.14, 4e3, 1200, 0.18, "bandpass", when, musicBus);
    if (inten > 0.15 && i % 2 === 1) noise(0.03, 9e3, 7e3, 0.05 + inten * 0.04, "highpass", when, musicBus);
    if (inten > 0.6) {
      const n = chord[[0, 1, 2, 1][i % 4]] + (i >= 8 ? 12 : 0) + 12;
      tone(mtof(n), mtof(n), len16 * 0.9, "square", 0.025 + (inten - 0.6) * 0.05, when, musicBus);
    }
    if (inten > 0.85 && (i === 0 || i === 6 || i === 10)) {
      const n = chord[2] + 24;
      tone(mtof(n), mtof(n), len16 * 3, "sawtooth", 0.03, when, musicBus);
    }
  }
  const m = {
    _id: id,
    intensity(v) {
      inten = Math.max(0, Math.min(1, v));
      return m;
    },
    style(n) {
      style = n;
      return m;
    },
    bpm(v) {
      bpm = v;
      return m;
    },
    stop() {
      playing = false;
      clearInterval(timer);
      if (current?._id === id) current = null;
    },
    get playing() {
      return playing;
    }
  };
  current = m;
  return m;
}
var sound = {
  unlock() {
    const c = ac();
    if (c && c.state === "suspended") c.resume().catch(() => {
    });
  },
  get muted() {
    return muted;
  },
  mute(v = !muted) {
    muted = v;
    if (master) master.gain.value = muted ? 0 : volume;
    return muted;
  },
  volume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.value = volume;
  },
  /** 0 = clear, 1 = heavy low-pass on the music (bullet time, pause, under water). */
  muffle(amount) {
    if (!ctx || !musicFilter) return;
    const f = 18e3 * Math.pow(1 - Math.max(0, Math.min(0.97, amount)), 2.2) + 250;
    musicFilter.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
  },
  music: startMusic,
  stopMusic() {
    current?.stop();
  },
  shoot() {
    if (throttle("shoot", 45)) tone(vary(920), 380, 0.09, "square", 0.08);
  },
  laser() {
    if (throttle("laser", 60)) tone(vary(1500), 160, 0.22, "sawtooth", 0.09);
  },
  hit() {
    if (throttle("hit", 30)) {
      noise(0.08, 3e3, 600, 0.22);
      tone(vary(220), 110, 0.08, "square", 0.08);
    }
  },
  explode(size = 1) {
    if (!throttle("explode", 40)) return;
    const d = 0.35 + size * 0.45;
    noise(d, 2400, 80, 0.35 + size * 0.1);
    tone(vary(120), 30, d * 0.8, "sine", 0.4);
  },
  coin() {
    if (throttle("coin", 35)) {
      tone(vary(988, 0.02), 988, 0.07, "square", 0.07);
      tone(1319, 1319, 0.16, "square", 0.07, 0.07);
    }
  },
  jump() {
    if (throttle("jump", 60)) tone(vary(300), 680, 0.14, "square", 0.09);
  },
  bounce() {
    if (throttle("bounce", 40)) tone(vary(520), 420, 0.06, "triangle", 0.15);
  },
  power() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.12, "square", 0.07, i * 0.06));
  },
  hurt() {
    if (throttle("hurt", 120)) {
      tone(260, 70, 0.35, "sawtooth", 0.16);
      noise(0.25, 1800, 200, 0.22);
    }
  },
  dash() {
    if (throttle("dash", 80)) noise(0.22, 600, 5e3, 0.2, "bandpass");
  },
  click() {
    tone(1200, 1200, 0.03, "square", 0.05);
  },
  warn() {
    if (throttle("warn", 200)) {
      tone(440, 440, 0.12, "square", 0.08);
      tone(440, 440, 0.12, "square", 0.08, 0.2);
    }
  },
  boss() {
    tone(70, 45, 1.6, "sawtooth", 0.22);
    noise(1.4, 400, 60, 0.25);
  },
  over() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.98, 0.3, "triangle", 0.14, i * 0.18));
  },
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.2, "triangle", 0.12, i * 0.1));
  },
  /** A raw tone for anything else: sound.tone(440, 220, 0.2, "square"). */
  tone(f0, f1 = f0, dur = 0.15, type = "square", vol = 0.1) {
    tone(f0, f1, dur, type, vol);
  },
  noise(dur = 0.2, from = 3e3, to = 300, vol = 0.2) {
    noise(dur, from, to, vol);
  },
  get state() {
    return ctx?.state ?? "none";
  }
};

// src/renderer.ts
var rr = (c, x, y, w, h, r) => {
  c.beginPath();
  c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h);
};
var polyCache = /* @__PURE__ */ new Map();
var SHAPES_2D = {
  ship(c, _e2, r, col, col2) {
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
      if (polyCache.size > 2e3) polyCache.delete(polyCache.keys().next().value);
    }
    c.fillStyle = col;
    c.strokeStyle = col2;
    c.lineWidth = Math.max(1, r * 0.12);
    c.beginPath();
    pts.forEach((k, i) => {
      const a = i / pts.length * Math.PI * 2;
      const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.closePath();
    c.fill();
    c.stroke();
  },
  ball(c, _e2, r, col) {
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
  bullet(c, _e2, r, col) {
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
  orb(c, _e2, r, col) {
    const gr = c.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, "#fff");
    gr.addColorStop(0.35, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = gr;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
  },
  crystal(c, _e2, r, col, col2) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(r, 0);
    c.lineTo(0, r * 0.6);
    c.lineTo(-r, 0);
    c.lineTo(0, -r * 0.6);
    c.closePath();
    c.fill();
    c.fillStyle = col2;
    c.globalAlpha *= 0.5;
    c.beginPath();
    c.moveTo(r, 0);
    c.lineTo(0, -r * 0.6);
    c.lineTo(0, 0);
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
  car(c, _e2, r, col, col2) {
    c.fillStyle = col;
    rr(c, -r * 1.1, -r * 0.6, r * 2.2, r * 1.2, r * 0.35);
    c.fill();
    c.fillStyle = col2;
    rr(c, -r * 0.2, -r * 0.45, r * 0.75, r * 0.9, r * 0.2);
    c.fill();
  },
  tree(c, _e2, r, col, col2) {
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
      const a = i / 24 * Math.PI * 2;
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
      const a = i / 10 * Math.PI * 2 - Math.PI / 2;
      const k = i % 2 ? 0.45 : 1;
      i ? c.lineTo(Math.cos(a) * r * k, Math.sin(a) * r * k) : c.moveTo(Math.cos(a) * r * k, Math.sin(a) * r * k);
    }
    c.closePath();
    c.fill();
  },
  circle(c, _e2, r, col) {
    c.fillStyle = col;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
  }
};
SHAPES_2D.wall = SHAPES_2D.block;
SHAPES_2D.pillar = SHAPES_2D.block;
SHAPES_2D.platform = SHAPES_2D.block;
SHAPES_2D.enemy = SHAPES_2D.drone;
SHAPES_2D.player = SHAPES_2D.ship;
SHAPES_2D.snake = SHAPES_2D.block;
SHAPES_2D.food = SHAPES_2D.coin;
var Render2D = class {
  constructor(g) {
    this.g = g;
    this.W = g.size[0];
    this.H = g.size[1];
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    g.root.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.cam.x = this.cam.tx = this.W / 2;
    this.cam.y = this.cam.ty = this.H / 2;
    const r = rng(7);
    for (let i = 0; i < 160; i++) this.stars.push({ x: r.next(), y: r.next(), z: 0.2 + r.next() * 0.8 });
    const self = this;
    this.camera = {
      yaw: 0,
      zoom: 1,
      shake(a) {
        self.cam.trauma = Math.min(1, self.cam.trauma + a);
      },
      follow(e, o = {}) {
        self.cam.target = e;
        self.cam.lerp = o.lerp ?? 6;
        self.cam.lead = o.lead ?? 0;
      },
      topdown(e, o) {
        if (e) this.follow(e, o);
      },
      chase(e, o) {
        this.follow(e, o);
      },
      orbit() {
      },
      firstPerson() {
      },
      fixed() {
      },
      center(x, y) {
        self.cam.target = null;
        self.cam.tx = x;
        self.cam.ty = y;
      }
    };
    this.resize();
  }
  g;
  is3d = false;
  canvas;
  ctx;
  W;
  H;
  scale = 1;
  dpr = 1;
  offX = 0;
  offY = 0;
  parts = [];
  beams = [];
  rings = [];
  stars = [];
  cam = { x: 0, y: 0, tx: 0, ty: 0, trauma: 0, target: null, lerp: 6, lead: 0, sx: 0, sy: 0 };
  camera;
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
  attach() {
  }
  detach(e) {
    polyCache.delete(e.id);
  }
  clear() {
    this.parts.length = 0;
    this.beams.length = 0;
    this.rings.length = 0;
    this.cam.target = null;
    this.cam.trauma = 0;
    this.cam.x = this.cam.tx = this.W / 2;
    this.cam.y = this.cam.ty = this.H / 2;
  }
  view() {
    const z = this.camera.zoom;
    return { kind: "rect", x0: this.cam.x - this.W / 2 / z, y0: this.cam.y - this.H / 2 / z, x1: this.cam.x + this.W / 2 / z, y1: this.cam.y + this.H / 2 / z };
  }
  project(x, y) {
    const z = this.camera.zoom;
    return {
      x: this.offX + ((x - this.cam.x) * z + this.W / 2) * this.scale,
      y: this.offY + ((y - this.cam.y) * z + this.H / 2) * this.scale
    };
  }
  updatePointer() {
    const p = this.g.input.pointer;
    const z = this.camera.zoom;
    p.world.x = ((p.x - this.offX) / this.scale - this.W / 2) / z + this.cam.x;
    p.world.y = ((p.y - this.offY) / this.scale - this.H / 2) / z + this.cam.y;
  }
  burst(at, o) {
    const n = o.count ?? 16;
    const r = this.g.rand;
    for (let i = 0; i < n && this.parts.length < 3e3; i++) {
      let ang = r(0, Math.PI * 2);
      if (o.dir) ang = Math.atan2(o.dir[1], o.dir[0]) + r(-(o.spread ?? 0.5), o.spread ?? 0.5);
      const sp = (o.speed ?? 180) * r(0.3, 1);
      const col = Array.isArray(o.color) ? o.color[i % o.color.length] : o.color ?? "#fff";
      const life = (o.life ?? 0.6) * r(0.6, 1);
      this.parts.push({ x: at[0], y: at[1], vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size: (o.size ?? 3) * r(0.6, 1.3), color: col, g: o.gravity ?? 0, fade: o.fade ?? true });
    }
  }
  beam(a, b, o) {
    this.beams.push({ a, b, color: o.color ?? "#fff", width: o.width ?? 3, life: o.life ?? 0.25, max: o.life ?? 0.25 });
  }
  ring(at, o) {
    this.rings.push({ at, color: o.color ?? "#fff", r: o.radius ?? 60, life: o.life ?? 0.4, max: o.life ?? 0.4, width: o.width ?? 3 });
  }
  render(alpha, dt) {
    const c = this.ctx, g = this.g, cam = this.cam;
    const s = g.current;
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
      for (let x = Math.floor(v.x0 / step) * step; x < v.x1; x += step) {
        c.moveTo(x, v.y0);
        c.lineTo(x, v.y1);
      }
      for (let y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) {
        c.moveTo(v.x0, y);
        c.lineTo(v.x1, y);
      }
      c.stroke();
    }
    if (!s) return;
    let list = s.entities;
    if (list.some((e) => e.opts.layer)) list = [...list].sort((a, b2) => (a.opts.layer ?? 0) - (b2.opts.layer ?? 0));
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
      if (o.glow) {
        c.shadowColor = o.color ?? "#fff";
        c.shadowBlur = 8 * o.glow;
      }
      const flash = e.flashT > 0;
      const col = flash ? "#ffffff" : o.color ?? "#e8eefc";
      const col2 = flash ? "#ffffff" : o.color2 ?? "rgba(255,255,255,.85)";
      try {
        if (o.draw) o.draw(c, e);
        else (SHAPES_2D[o.shape ?? (e.box ? "block" : "circle")] ?? SHAPES_2D.circle)(c, e, e.radius * (o.size ?? 1), col, col2);
      } catch (err) {
        g._error(err);
      }
      c.restore();
    }
    for (const f of s._drawFns) {
      c.save();
      try {
        f(c, s);
      } catch (err) {
        g._error(err);
      }
      c.restore();
    }
    c.globalCompositeOperation = "lighter";
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts[i] = this.parts[this.parts.length - 1];
        this.parts.pop();
        continue;
      }
      p.vy += p.g * dt;
      p.vx *= 1 - dt * 1.5;
      p.vy *= 1 - dt * 1.5;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.max;
      c.globalAlpha = p.fade ? t : 1;
      c.fillStyle = p.color;
      const sz = p.size * (0.4 + t * 0.6);
      c.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i];
      bm.life -= dt;
      if (bm.life <= 0) {
        this.beams.splice(i, 1);
        continue;
      }
      c.globalAlpha = bm.life / bm.max;
      c.strokeStyle = bm.color;
      c.lineWidth = bm.width;
      c.beginPath();
      c.moveTo(bm.a[0], bm.a[1]);
      c.lineTo(bm.b[0], bm.b[1]);
      c.stroke();
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.life -= dt;
      if (rg.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - rg.life / rg.max;
      c.globalAlpha = 1 - t;
      c.strokeStyle = rg.color;
      c.lineWidth = rg.width;
      c.beginPath();
      c.arc(rg.at[0], rg.at[1], rg.r * t, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }
  describe() {
    return { renderer: "canvas2d", size: [this.W, this.H], particles: this.parts.length, scale: +this.scale.toFixed(2) };
  }
};

// src/render3d.ts
import * as THREE2 from "three";

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/EffectComposer.js
import {
  HalfFloatType,
  NoBlending,
  Timer,
  Vector2,
  WebGLRenderTarget
} from "three";

// ../kimi-game/node_modules/three/examples/jsm/shaders/CopyShader.js
var CopyShader = {
  name: "CopyShader",
  uniforms: {
    "tDiffuse": { value: null },
    "opacity": { value: 1 }
  },
  vertexShader: (
    /* glsl */
    `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`
  ),
  fragmentShader: (
    /* glsl */
    `

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`
  )
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/ShaderPass.js
import {
  ShaderMaterial,
  UniformsUtils
} from "three";

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/Pass.js
import {
  BufferGeometry,
  Float32BufferAttribute,
  OrthographicCamera,
  Mesh
} from "three";
var Pass = class {
  /**
   * Constructs a new pass.
   */
  constructor() {
    this.isPass = true;
    this.enabled = true;
    this.needsSwap = true;
    this.clear = false;
    this.renderToScreen = false;
  }
  /**
   * Sets the size of the pass.
   *
   * @abstract
   * @param {number} width - The width to set.
   * @param {number} height - The height to set.
   */
  setSize() {
  }
  /**
   * This method holds the render logic of a pass. It must be implemented in all derived classes.
   *
   * @abstract
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render() {
    console.error("THREE.Pass: .render() must be implemented in derived pass.");
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the pass is no longer used in your app.
   *
   * @abstract
   */
  dispose() {
  }
};
var _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
var FullscreenTriangleGeometry = class extends BufferGeometry {
  constructor() {
    super();
    this.setAttribute("position", new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    this.setAttribute("uv", new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  }
};
var _geometry = new FullscreenTriangleGeometry();
var FullScreenQuad = class {
  /**
   * Constructs a new full screen quad.
   *
   * @param {?Material} material - The material to render te full screen quad with.
   */
  constructor(material) {
    this._mesh = new Mesh(_geometry, material);
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the instance is no longer used in your app.
   */
  dispose() {
    this._mesh.geometry.dispose();
  }
  /**
   * Renders the full screen quad.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   */
  render(renderer) {
    renderer.render(this._mesh, _camera);
  }
  /**
   * The quad's material.
   *
   * @type {?Material}
   */
  get material() {
    return this._mesh.material;
  }
  set material(value) {
    this._mesh.material = value;
  }
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/ShaderPass.js
var ShaderPass = class extends Pass {
  /**
   * Constructs a new shader pass.
   *
   * @param {Object|ShaderMaterial} [shader] - A shader object holding vertex and fragment shader as well as
   * defines and uniforms. It's also valid to pass a custom shader material.
   * @param {string} [textureID='tDiffuse'] - The name of the texture uniform that should sample
   * the read buffer.
   */
  constructor(shader, textureID = "tDiffuse") {
    super();
    this.textureID = textureID;
    this.uniforms = null;
    this.material = null;
    if (shader instanceof ShaderMaterial) {
      this.uniforms = shader.uniforms;
      this.material = shader;
    } else if (shader) {
      this.uniforms = UniformsUtils.clone(shader.uniforms);
      this.material = new ShaderMaterial({
        name: shader.name !== void 0 ? shader.name : "unspecified",
        defines: Object.assign({}, shader.defines),
        uniforms: this.uniforms,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader
      });
    }
    this._fsQuad = new FullScreenQuad(this.material);
  }
  /**
   * Performs the shader pass.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer, writeBuffer, readBuffer) {
    if (this.uniforms[this.textureID]) {
      this.uniforms[this.textureID].value = readBuffer.texture;
    }
    this._fsQuad.material = this.material;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this._fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      this._fsQuad.render(renderer);
    }
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the pass is no longer used in your app.
   */
  dispose() {
    this.material.dispose();
    this._fsQuad.dispose();
  }
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/MaskPass.js
var MaskPass = class extends Pass {
  /**
   * Constructs a new mask pass.
   *
   * @param {Scene} scene - The 3D objects in this scene will define the mask.
   * @param {Camera} camera - The camera.
   */
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.clear = true;
    this.needsSwap = false;
    this.inverse = false;
  }
  /**
   * Performs a mask pass with the configured scene and camera.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer, writeBuffer, readBuffer) {
    const context = renderer.getContext();
    const state = renderer.state;
    state.buffers.color.setMask(false);
    state.buffers.depth.setMask(false);
    state.buffers.color.setLocked(true);
    state.buffers.depth.setLocked(true);
    let writeValue, clearValue;
    if (this.inverse) {
      writeValue = 0;
      clearValue = 1;
    } else {
      writeValue = 1;
      clearValue = 0;
    }
    state.buffers.stencil.setTest(true);
    state.buffers.stencil.setOp(context.REPLACE, context.REPLACE, context.REPLACE);
    state.buffers.stencil.setFunc(context.ALWAYS, writeValue, 4294967295);
    state.buffers.stencil.setClear(clearValue);
    state.buffers.stencil.setLocked(true);
    renderer.setRenderTarget(readBuffer);
    if (this.clear) renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(writeBuffer);
    if (this.clear) renderer.clear();
    renderer.render(this.scene, this.camera);
    state.buffers.color.setLocked(false);
    state.buffers.depth.setLocked(false);
    state.buffers.color.setMask(true);
    state.buffers.depth.setMask(true);
    state.buffers.stencil.setLocked(false);
    state.buffers.stencil.setFunc(context.EQUAL, 1, 4294967295);
    state.buffers.stencil.setOp(context.KEEP, context.KEEP, context.KEEP);
    state.buffers.stencil.setLocked(true);
  }
};
var ClearMaskPass = class extends Pass {
  /**
   * Constructs a new clear mask pass.
   */
  constructor() {
    super();
    this.needsSwap = false;
  }
  /**
   * Performs the clear of the currently defined mask.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer) {
    renderer.state.buffers.stencil.setLocked(false);
    renderer.state.buffers.stencil.setTest(false);
  }
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/EffectComposer.js
var EffectComposer = class {
  /**
   * Constructs a new effect composer.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} [renderTarget] - This render target and a clone will
   * be used as the internal read and write buffers. If not given, the composer creates
   * the buffers automatically.
   */
  constructor(renderer, renderTarget) {
    this.renderer = renderer;
    this._pixelRatio = renderer.getPixelRatio();
    if (renderTarget === void 0) {
      const size = renderer.getSize(new Vector2());
      this._width = size.width;
      this._height = size.height;
      renderTarget = new WebGLRenderTarget(this._width * this._pixelRatio, this._height * this._pixelRatio, { type: HalfFloatType });
      renderTarget.texture.name = "EffectComposer.rt1";
    } else {
      this._width = renderTarget.width;
      this._height = renderTarget.height;
    }
    this.renderTarget1 = renderTarget;
    this.renderTarget2 = renderTarget.clone();
    this.renderTarget2.texture.name = "EffectComposer.rt2";
    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;
    this.renderToScreen = true;
    this.passes = [];
    this.copyPass = new ShaderPass(CopyShader);
    this.copyPass.material.blending = NoBlending;
    this.timer = new Timer();
  }
  /**
   * Swaps the internal read/write buffers.
   */
  swapBuffers() {
    const tmp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = tmp;
  }
  /**
   * Adds the given pass to the pass chain.
   *
   * @param {Pass} pass - The pass to add.
   */
  addPass(pass) {
    this.passes.push(pass);
    pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
  }
  /**
   * Inserts the given pass at a given index.
   *
   * @param {Pass} pass - The pass to insert.
   * @param {number} index - The index into the pass chain.
   */
  insertPass(pass, index) {
    this.passes.splice(index, 0, pass);
    pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
  }
  /**
   * Removes the given pass from the pass chain.
   *
   * @param {Pass} pass - The pass to remove.
   */
  removePass(pass) {
    const index = this.passes.indexOf(pass);
    if (index !== -1) {
      this.passes.splice(index, 1);
    }
  }
  /**
   * Returns `true` if the pass for the given index is the last enabled pass in the pass chain.
   *
   * @param {number} passIndex - The pass index.
   * @return {boolean} Whether the pass for the given index is the last pass in the pass chain.
   */
  isLastEnabledPass(passIndex) {
    for (let i = passIndex + 1; i < this.passes.length; i++) {
      if (this.passes[i].enabled) {
        return false;
      }
    }
    return true;
  }
  /**
   * Executes all enabled post-processing passes in order to produce the final frame.
   *
   * @param {number} deltaTime - The delta time in seconds. If not given, the composer computes
   * its own time delta value.
   */
  render(deltaTime) {
    this.timer.update();
    if (deltaTime === void 0) {
      deltaTime = this.timer.getDelta();
    }
    const currentRenderTarget = this.renderer.getRenderTarget();
    let maskActive = false;
    for (let i = 0, il = this.passes.length; i < il; i++) {
      const pass = this.passes[i];
      if (pass.enabled === false) continue;
      pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass(i);
      pass.render(this.renderer, this.writeBuffer, this.readBuffer, deltaTime, maskActive);
      if (pass.needsSwap) {
        if (maskActive) {
          const context = this.renderer.getContext();
          const stencil = this.renderer.state.buffers.stencil;
          stencil.setFunc(context.NOTEQUAL, 1, 4294967295);
          this.copyPass.render(this.renderer, this.writeBuffer, this.readBuffer, deltaTime);
          stencil.setFunc(context.EQUAL, 1, 4294967295);
        }
        this.swapBuffers();
      }
      if (MaskPass !== void 0) {
        if (pass instanceof MaskPass) {
          maskActive = true;
        } else if (pass instanceof ClearMaskPass) {
          maskActive = false;
        }
      }
    }
    this.renderer.setRenderTarget(currentRenderTarget);
  }
  /**
   * Resets the internal state of the EffectComposer.
   *
   * @param {WebGLRenderTarget} [renderTarget] - This render target has the same purpose like
   * the one from the constructor. If set, it is used to setup the read and write buffers.
   */
  reset(renderTarget) {
    if (renderTarget === void 0) {
      const size = this.renderer.getSize(new Vector2());
      this._pixelRatio = this.renderer.getPixelRatio();
      this._width = size.width;
      this._height = size.height;
      renderTarget = this.renderTarget1.clone();
      renderTarget.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
    }
    this.renderTarget1.dispose();
    this.renderTarget2.dispose();
    this.renderTarget1 = renderTarget;
    this.renderTarget2 = renderTarget.clone();
    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;
  }
  /**
   * Resizes the internal read and write buffers as well as all passes. Similar to {@link WebGLRenderer#setSize},
   * this method honors the current pixel ration.
   *
   * @param {number} width - The width in logical pixels.
   * @param {number} height - The height in logical pixels.
   */
  setSize(width, height) {
    this._width = width;
    this._height = height;
    const effectiveWidth = this._width * this._pixelRatio;
    const effectiveHeight = this._height * this._pixelRatio;
    this.renderTarget1.setSize(effectiveWidth, effectiveHeight);
    this.renderTarget2.setSize(effectiveWidth, effectiveHeight);
    for (let i = 0; i < this.passes.length; i++) {
      this.passes[i].setSize(effectiveWidth, effectiveHeight);
    }
  }
  /**
   * Sets device pixel ratio. This is usually used for HiDPI device to prevent blurring output.
   * Setting the pixel ratio will automatically resize the composer.
   *
   * @param {number} pixelRatio - The pixel ratio to set.
   */
  setPixelRatio(pixelRatio) {
    this._pixelRatio = pixelRatio;
    this.setSize(this._width, this._height);
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the composer is no longer used in your app.
   */
  dispose() {
    this.renderTarget1.dispose();
    this.renderTarget2.dispose();
    this.copyPass.dispose();
  }
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/RenderPass.js
import {
  Color
} from "three";
var RenderPass = class extends Pass {
  /**
   * Constructs a new render pass.
   *
   * @param {Scene} scene - The scene to render.
   * @param {Camera} camera - The camera.
   * @param {?Material} [overrideMaterial=null] - The override material. If set, this material is used
   * for all objects in the scene.
   * @param {?(number|Color|string)} [clearColor=null] - The clear color of the render pass.
   * @param {?number} [clearAlpha=null] - The clear alpha of the render pass.
   */
  constructor(scene, camera, overrideMaterial = null, clearColor = null, clearAlpha = null) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.overrideMaterial = overrideMaterial;
    this.clearColor = clearColor;
    this.clearAlpha = clearAlpha;
    this.clear = true;
    this.clearDepth = false;
    this.needsSwap = false;
    this.isRenderPass = true;
    this._oldClearColor = new Color();
  }
  /**
   * Performs a beauty pass with the configured scene and camera.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    let oldClearAlpha, oldOverrideMaterial;
    if (this.overrideMaterial !== null) {
      oldOverrideMaterial = this.scene.overrideMaterial;
      this.scene.overrideMaterial = this.overrideMaterial;
    }
    if (this.clearColor !== null) {
      renderer.getClearColor(this._oldClearColor);
      renderer.setClearColor(this.clearColor, renderer.getClearAlpha());
    }
    if (this.clearAlpha !== null) {
      oldClearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(this.clearAlpha);
    }
    if (this.clearDepth == true) {
      renderer.clearDepth();
    }
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    if (this.clear === true) {
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
    renderer.render(this.scene, this.camera);
    if (this.clearColor !== null) {
      renderer.setClearColor(this._oldClearColor);
    }
    if (this.clearAlpha !== null) {
      renderer.setClearAlpha(oldClearAlpha);
    }
    if (this.overrideMaterial !== null) {
      this.scene.overrideMaterial = oldOverrideMaterial;
    }
    renderer.autoClear = oldAutoClear;
  }
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js
import {
  AdditiveBlending,
  Color as Color3,
  HalfFloatType as HalfFloatType2,
  MeshBasicMaterial,
  ShaderMaterial as ShaderMaterial2,
  UniformsUtils as UniformsUtils2,
  Vector2 as Vector22,
  Vector3,
  WebGLRenderTarget as WebGLRenderTarget2
} from "three";

// ../kimi-game/node_modules/three/examples/jsm/shaders/LuminosityHighPassShader.js
import {
  Color as Color2
} from "three";
var LuminosityHighPassShader = {
  name: "LuminosityHighPassShader",
  uniforms: {
    "tDiffuse": { value: null },
    "luminosityThreshold": { value: 1 },
    "smoothWidth": { value: 1 },
    "defaultColor": { value: new Color2(0) },
    "defaultOpacity": { value: 0 }
  },
  vertexShader: (
    /* glsl */
    `

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`
  ),
  fragmentShader: (
    /* glsl */
    `

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			float v = luminance( texel.xyz );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`
  )
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js
var UnrealBloomPass = class _UnrealBloomPass extends Pass {
  /**
   * Constructs a new Unreal Bloom pass.
   *
   * @param {Vector2} [resolution] - The effect's resolution.
   * @param {number} [strength=1] - The Bloom strength.
   * @param {number} radius - The Bloom radius.
   * @param {number} threshold - The luminance threshold limits which bright areas contribute to the Bloom effect.
   */
  constructor(resolution, strength = 1, radius, threshold) {
    super();
    this.strength = strength;
    this.radius = radius;
    this.threshold = threshold;
    this.resolution = resolution !== void 0 ? new Vector22(resolution.x, resolution.y) : new Vector22(256, 256);
    this.clearColor = new Color3(0, 0, 0);
    this.needsSwap = false;
    this.renderTargetsHorizontal = [];
    this.renderTargetsVertical = [];
    this.nMips = 5;
    let resx = Math.round(this.resolution.x / 2);
    let resy = Math.round(this.resolution.y / 2);
    this.renderTargetBright = new WebGLRenderTarget2(resx, resy, { type: HalfFloatType2, depthBuffer: false });
    this.renderTargetBright.texture.name = "UnrealBloomPass.bright";
    this.renderTargetBright.texture.generateMipmaps = false;
    for (let i = 0; i < this.nMips; i++) {
      const renderTargetHorizontal = new WebGLRenderTarget2(resx, resy, { type: HalfFloatType2, depthBuffer: false });
      renderTargetHorizontal.texture.name = "UnrealBloomPass.h" + i;
      renderTargetHorizontal.texture.generateMipmaps = false;
      this.renderTargetsHorizontal.push(renderTargetHorizontal);
      const renderTargetVertical = new WebGLRenderTarget2(resx, resy, { type: HalfFloatType2, depthBuffer: false });
      renderTargetVertical.texture.name = "UnrealBloomPass.v" + i;
      renderTargetVertical.texture.generateMipmaps = false;
      this.renderTargetsVertical.push(renderTargetVertical);
      resx = Math.round(resx / 2);
      resy = Math.round(resy / 2);
    }
    const highPassShader = LuminosityHighPassShader;
    this.highPassUniforms = UniformsUtils2.clone(highPassShader.uniforms);
    this.highPassUniforms["luminosityThreshold"].value = threshold;
    this.highPassUniforms["smoothWidth"].value = 0.01;
    this.materialHighPassFilter = new ShaderMaterial2({
      uniforms: this.highPassUniforms,
      vertexShader: highPassShader.vertexShader,
      fragmentShader: highPassShader.fragmentShader
    });
    this.separableBlurMaterials = [];
    const kernelSizeArray = [6, 10, 14, 18, 22];
    resx = Math.round(this.resolution.x / 2);
    resy = Math.round(this.resolution.y / 2);
    for (let i = 0; i < this.nMips; i++) {
      this.separableBlurMaterials.push(this._getSeparableBlurMaterial(kernelSizeArray[i]));
      this.separableBlurMaterials[i].uniforms["invSize"].value = new Vector22(1 / resx, 1 / resy);
      resx = Math.round(resx / 2);
      resy = Math.round(resy / 2);
    }
    this.compositeMaterial = this._getCompositeMaterial(this.nMips);
    this.compositeMaterial.uniforms["blurTexture1"].value = this.renderTargetsVertical[0].texture;
    this.compositeMaterial.uniforms["blurTexture2"].value = this.renderTargetsVertical[1].texture;
    this.compositeMaterial.uniforms["blurTexture3"].value = this.renderTargetsVertical[2].texture;
    this.compositeMaterial.uniforms["blurTexture4"].value = this.renderTargetsVertical[3].texture;
    this.compositeMaterial.uniforms["blurTexture5"].value = this.renderTargetsVertical[4].texture;
    this.compositeMaterial.uniforms["bloomStrength"].value = strength;
    this.compositeMaterial.uniforms["bloomRadius"].value = 0.1;
    const bloomFactors = [1, 0.8, 0.6, 0.4, 0.2];
    this.compositeMaterial.uniforms["bloomFactors"].value = bloomFactors;
    this.bloomTintColors = [new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1), new Vector3(1, 1, 1)];
    this.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
    this.copyUniforms = UniformsUtils2.clone(CopyShader.uniforms);
    this.blendMaterial = new ShaderMaterial2({
      uniforms: this.copyUniforms,
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      premultipliedAlpha: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    this._oldClearColor = new Color3();
    this._oldClearAlpha = 1;
    this._basic = new MeshBasicMaterial();
    this._fsQuad = new FullScreenQuad(null);
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the pass is no longer used in your app.
   */
  dispose() {
    for (let i = 0; i < this.renderTargetsHorizontal.length; i++) {
      this.renderTargetsHorizontal[i].dispose();
    }
    for (let i = 0; i < this.renderTargetsVertical.length; i++) {
      this.renderTargetsVertical[i].dispose();
    }
    this.renderTargetBright.dispose();
    for (let i = 0; i < this.separableBlurMaterials.length; i++) {
      this.separableBlurMaterials[i].dispose();
    }
    this.compositeMaterial.dispose();
    this.blendMaterial.dispose();
    this._basic.dispose();
    this._fsQuad.dispose();
  }
  /**
   * Sets the size of the pass.
   *
   * @param {number} width - The width to set.
   * @param {number} height - The height to set.
   */
  setSize(width, height) {
    let resx = Math.round(width / 2);
    let resy = Math.round(height / 2);
    this.renderTargetBright.setSize(resx, resy);
    for (let i = 0; i < this.nMips; i++) {
      this.renderTargetsHorizontal[i].setSize(resx, resy);
      this.renderTargetsVertical[i].setSize(resx, resy);
      this.separableBlurMaterials[i].uniforms["invSize"].value = new Vector22(1 / resx, 1 / resy);
      resx = Math.round(resx / 2);
      resy = Math.round(resy / 2);
    }
  }
  /**
   * Performs the Bloom pass.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    if (maskActive) renderer.state.buffers.stencil.setTest(false);
    if (this.renderToScreen) {
      this._fsQuad.material = this._basic;
      this._basic.map = readBuffer.texture;
      renderer.setRenderTarget(null);
      renderer.clear();
      this._fsQuad.render(renderer);
    }
    this.highPassUniforms["tDiffuse"].value = readBuffer.texture;
    this.highPassUniforms["luminosityThreshold"].value = this.threshold;
    this._fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this._fsQuad.render(renderer);
    let inputRenderTarget = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      this._fsQuad.material = this.separableBlurMaterials[i];
      this.separableBlurMaterials[i].uniforms["colorTexture"].value = inputRenderTarget.texture;
      this.separableBlurMaterials[i].uniforms["direction"].value = _UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      this.separableBlurMaterials[i].uniforms["colorTexture"].value = this.renderTargetsHorizontal[i].texture;
      this.separableBlurMaterials[i].uniforms["direction"].value = _UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this._fsQuad.render(renderer);
      inputRenderTarget = this.renderTargetsVertical[i];
    }
    this._fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms["bloomStrength"].value = this.strength;
    this.compositeMaterial.uniforms["bloomRadius"].value = this.radius;
    this.compositeMaterial.uniforms["bloomTintColors"].value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this._fsQuad.render(renderer);
    this._fsQuad.material = this.blendMaterial;
    this.copyUniforms["tDiffuse"].value = this.renderTargetsHorizontal[0].texture;
    if (maskActive) renderer.state.buffers.stencil.setTest(true);
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this._fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(readBuffer);
      this._fsQuad.render(renderer);
    }
    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
  // internals
  _getSeparableBlurMaterial(kernelRadius) {
    const coefficients = [];
    const sigma = kernelRadius / 3;
    for (let i = 0; i < kernelRadius; i++) {
      coefficients.push(0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
    }
    const offsets = [];
    const weights = [];
    for (let i = 1; i < kernelRadius; i += 2) {
      const wa = coefficients[i];
      const wb = i + 1 < kernelRadius ? coefficients[i + 1] : 0;
      const w = wa + wb;
      offsets.push((i * wa + (i + 1) * wb) / w);
      weights.push(w);
    }
    return new ShaderMaterial2({
      defines: {
        "KERNEL_PAIRS": offsets.length
      },
      uniforms: {
        "colorTexture": { value: null },
        "invSize": { value: new Vector22(0.5, 0.5) },
        // inverse texture size
        "direction": { value: new Vector22(0.5, 0.5) },
        "centerWeight": { value: coefficients[0] },
        "gaussianOffsets": { value: offsets },
        "gaussianWeights": { value: weights }
      },
      vertexShader: (
        /* glsl */
        `

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`
      ),
      fragmentShader: (
        /* glsl */
        `

				#include <common>

				varying vec2 vUv;

				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float centerWeight;
				uniform float gaussianOffsets[KERNEL_PAIRS];
				uniform float gaussianWeights[KERNEL_PAIRS];

				void main() {

					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * centerWeight;

					for ( int i = 0; i < KERNEL_PAIRS; i ++ ) {

						vec2 uvOffset = direction * invSize * gaussianOffsets[ i ];
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += ( sample1 + sample2 ) * gaussianWeights[ i ];

					}

					gl_FragColor = vec4( diffuseSum, 1.0 );

				}`
      )
    });
  }
  _getCompositeMaterial(nMips) {
    return new ShaderMaterial2({
      defines: {
        "NUM_MIPS": nMips
      },
      uniforms: {
        "blurTexture1": { value: null },
        "blurTexture2": { value: null },
        "blurTexture3": { value: null },
        "blurTexture4": { value: null },
        "blurTexture5": { value: null },
        "bloomStrength": { value: 1 },
        "bloomFactors": { value: null },
        "bloomTintColors": { value: null },
        "bloomRadius": { value: 0 }
      },
      vertexShader: (
        /* glsl */
        `

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`
      ),
      fragmentShader: (
        /* glsl */
        `

				varying vec2 vUv;

				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor( const in float factor ) {

					float mirrorFactor = 1.2 - factor;
					return mix( factor, mirrorFactor, bloomRadius );

				}

				void main() {

					// 3.0 for backwards compatibility with previous alpha-based intensity
					vec3 bloom = 3.0 * bloomStrength * (
						lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 2 ] ) * bloomTintColors[ 2 ] * texture2D( blurTexture3, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 3 ] ) * bloomTintColors[ 3 ] * texture2D( blurTexture4, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 4 ] ) * bloomTintColors[ 4 ] * texture2D( blurTexture5, vUv ).rgb
					);

					float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );
					gl_FragColor = vec4( bloom, bloomAlpha );

				}`
      )
    });
  }
};
UnrealBloomPass.BlurDirectionX = new Vector22(1, 0);
UnrealBloomPass.BlurDirectionY = new Vector22(0, 1);

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/OutputPass.js
import {
  ColorManagement,
  RawShaderMaterial,
  UniformsUtils as UniformsUtils3,
  LinearToneMapping,
  ReinhardToneMapping,
  CineonToneMapping,
  AgXToneMapping,
  ACESFilmicToneMapping,
  NeutralToneMapping,
  CustomToneMapping,
  SRGBTransfer
} from "three";

// ../kimi-game/node_modules/three/examples/jsm/shaders/OutputShader.js
var OutputShader = {
  name: "OutputShader",
  uniforms: {
    "tDiffuse": { value: null },
    "toneMappingExposure": { value: 1 }
  },
  vertexShader: (
    /* glsl */
    `
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`
  ),
  fragmentShader: (
    /* glsl */
    `

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`
  )
};

// ../kimi-game/node_modules/three/examples/jsm/postprocessing/OutputPass.js
var OutputPass = class extends Pass {
  /**
   * Constructs a new output pass.
   */
  constructor() {
    super();
    this.isOutputPass = true;
    this.uniforms = UniformsUtils3.clone(OutputShader.uniforms);
    this.material = new RawShaderMaterial({
      name: OutputShader.name,
      uniforms: this.uniforms,
      vertexShader: OutputShader.vertexShader,
      fragmentShader: OutputShader.fragmentShader
    });
    this._fsQuad = new FullScreenQuad(this.material);
    this._outputColorSpace = null;
    this._toneMapping = null;
  }
  /**
   * Performs the output pass.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms["tDiffuse"].value = readBuffer.texture;
    this.uniforms["toneMappingExposure"].value = renderer.toneMappingExposure;
    if (this._outputColorSpace !== renderer.outputColorSpace || this._toneMapping !== renderer.toneMapping) {
      this._outputColorSpace = renderer.outputColorSpace;
      this._toneMapping = renderer.toneMapping;
      this.material.defines = {};
      if (ColorManagement.getTransfer(this._outputColorSpace) === SRGBTransfer) this.material.defines.SRGB_TRANSFER = "";
      if (this._toneMapping === LinearToneMapping) this.material.defines.LINEAR_TONE_MAPPING = "";
      else if (this._toneMapping === ReinhardToneMapping) this.material.defines.REINHARD_TONE_MAPPING = "";
      else if (this._toneMapping === CineonToneMapping) this.material.defines.CINEON_TONE_MAPPING = "";
      else if (this._toneMapping === ACESFilmicToneMapping) this.material.defines.ACES_FILMIC_TONE_MAPPING = "";
      else if (this._toneMapping === AgXToneMapping) this.material.defines.AGX_TONE_MAPPING = "";
      else if (this._toneMapping === NeutralToneMapping) this.material.defines.NEUTRAL_TONE_MAPPING = "";
      else if (this._toneMapping === CustomToneMapping) this.material.defines.CUSTOM_TONE_MAPPING = "";
      this.material.needsUpdate = true;
    }
    if (this.renderToScreen === true) {
      renderer.setRenderTarget(null);
      this._fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      this._fsQuad.render(renderer);
    }
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the pass is no longer used in your app.
   */
  dispose() {
    this.material.dispose();
    this._fsQuad.dispose();
  }
};

// src/big.ts
import * as THREE from "three";

// ../kimi-game/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js
import {
  BufferAttribute,
  BufferGeometry as BufferGeometry2,
  Float32BufferAttribute as Float32BufferAttribute2,
  InstancedBufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  MathUtils,
  TriangleFanDrawMode,
  TriangleStripDrawMode,
  TrianglesDrawMode,
  Vector3 as Vector32
} from "three";
function mergeGeometries(geometries, useGroups = false) {
  const isIndexed = geometries[0].index !== null;
  const attributesUsed = new Set(Object.keys(geometries[0].attributes));
  const morphAttributesUsed = new Set(Object.keys(geometries[0].morphAttributes));
  const attributes = {};
  const morphAttributes = {};
  const morphTargetsRelative = geometries[0].morphTargetsRelative;
  const mergedGeometry = new BufferGeometry2();
  mergedGeometry.morphTargetsRelative = morphTargetsRelative;
  let offset = 0;
  for (let i = 0; i < geometries.length; ++i) {
    const geometry = geometries[i];
    let attributesCount = 0;
    let morphAttributesCount = 0;
    if (isIndexed !== (geometry.index !== null)) {
      console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + ". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");
      return null;
    }
    for (const name in geometry.attributes) {
      if (!attributesUsed.has(name)) {
        console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + '. All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.');
        return null;
      }
      if (attributes[name] === void 0) attributes[name] = [];
      attributes[name].push(geometry.attributes[name]);
      attributesCount++;
    }
    if (attributesCount !== attributesUsed.size) {
      console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + ". Make sure all geometries have the same number of attributes.");
      return null;
    }
    if (morphTargetsRelative !== geometry.morphTargetsRelative) {
      console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + ". .morphTargetsRelative must be consistent throughout all geometries.");
      return null;
    }
    for (const name in geometry.morphAttributes) {
      if (!morphAttributesUsed.has(name)) {
        console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + ".  .morphAttributes must be consistent throughout all geometries.");
        return null;
      }
      if (geometry.morphAttributes[name].length !== geometries[0].morphAttributes[name].length) {
        console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + '. All geometries must have the same number of morph targets for the "' + name + '" morph attribute.');
        return null;
      }
      if (morphAttributes[name] === void 0) morphAttributes[name] = [];
      morphAttributes[name].push(geometry.morphAttributes[name]);
      morphAttributesCount++;
    }
    if (morphAttributesCount !== morphAttributesUsed.size) {
      console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + ". Make sure all geometries have the same number of morph attributes.");
      return null;
    }
    if (useGroups) {
      let count;
      if (isIndexed) {
        count = geometry.index.count;
      } else if (geometry.attributes.position !== void 0) {
        count = geometry.attributes.position.count;
      } else {
        console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index " + i + ". The geometry must have either an index or a position attribute");
        return null;
      }
      mergedGeometry.addGroup(offset, count, i);
      offset += count;
    }
  }
  if (isIndexed) {
    let indexOffset = 0;
    const mergedIndex = [];
    for (let i = 0; i < geometries.length; ++i) {
      const index = geometries[i].index;
      for (let j = 0; j < index.count; ++j) {
        mergedIndex.push(index.getX(j) + indexOffset);
      }
      indexOffset += geometries[i].attributes.position.count;
    }
    mergedGeometry.setIndex(mergedIndex);
  }
  for (const name in attributes) {
    const mergedAttribute = mergeAttributes(attributes[name]);
    if (!mergedAttribute) {
      console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the " + name + " attribute.");
      return null;
    }
    mergedGeometry.setAttribute(name, mergedAttribute);
  }
  for (const name in morphAttributes) {
    const numMorphTargets = morphAttributes[name][0].length;
    if (numMorphTargets === 0) continue;
    mergedGeometry.morphAttributes = mergedGeometry.morphAttributes || {};
    mergedGeometry.morphAttributes[name] = [];
    for (let i = 0; i < numMorphTargets; ++i) {
      const morphAttributesToMerge = [];
      for (let j = 0; j < morphAttributes[name].length; ++j) {
        morphAttributesToMerge.push(morphAttributes[name][j][i]);
      }
      const mergedMorphAttribute = mergeAttributes(morphAttributesToMerge);
      if (!mergedMorphAttribute) {
        console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the " + name + " morphAttribute.");
        return null;
      }
      mergedGeometry.morphAttributes[name].push(mergedMorphAttribute);
    }
  }
  return mergedGeometry;
}
function mergeAttributes(attributes) {
  let TypedArray;
  let itemSize;
  let normalized;
  let gpuType = -1;
  let arrayLength = 0;
  for (let i = 0; i < attributes.length; ++i) {
    const attribute = attributes[i];
    if (TypedArray === void 0) TypedArray = attribute.array.constructor;
    if (TypedArray !== attribute.array.constructor) {
      console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes.");
      return null;
    }
    if (itemSize === void 0) itemSize = attribute.itemSize;
    if (itemSize !== attribute.itemSize) {
      console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes.");
      return null;
    }
    if (normalized === void 0) normalized = attribute.normalized;
    if (normalized !== attribute.normalized) {
      console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes.");
      return null;
    }
    if (gpuType === -1) gpuType = attribute.gpuType;
    if (gpuType !== attribute.gpuType) {
      console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes.");
      return null;
    }
    arrayLength += attribute.count * itemSize;
  }
  const array = new TypedArray(arrayLength);
  const result = new BufferAttribute(array, itemSize, normalized);
  let offset = 0;
  for (let i = 0; i < attributes.length; ++i) {
    const attribute = attributes[i];
    if (attribute.isInterleavedBufferAttribute) {
      const tupleOffset = offset / itemSize;
      for (let j = 0, l = attribute.count; j < l; j++) {
        for (let c = 0; c < itemSize; c++) {
          const value = attribute.getComponent(j, c);
          result.setComponent(j + tupleOffset, c, value);
        }
      }
    } else {
      array.set(attribute.array, offset);
    }
    offset += attribute.count * itemSize;
  }
  if (gpuType !== void 0) {
    result.gpuType = gpuType;
  }
  return result;
}

// src/big.ts
var _m = new THREE.Matrix4();
var _q = new THREE.Quaternion();
var _e = new THREE.Euler();
var _p = new THREE.Vector3();
var _s = new THREE.Vector3();
var _sphere = new THREE.Sphere();
var _c = new THREE.Color();
var Instances = class {
  constructor(geometry, material, scene, opts = {}) {
    this.geometry = geometry;
    this.material = material;
    this.scene = scene;
    this.opts = opts;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.local = geometry.boundingSphere.clone();
  }
  geometry;
  material;
  scene;
  mesh = null;
  opts;
  mats = [];
  cols = null;
  spheres = [];
  // x, y, z, r per copy
  dirty = true;
  lastCam = new Float32Array(16);
  local;
  visible = 0;
  get count() {
    return this.mats.length / 16;
  }
  /** Add a copy at x, y, z. Returns its index. */
  add(x, y, z, o = {}) {
    const sc = o.scale ?? 1;
    const s = typeof sc === "number" ? _s.set(sc, sc, sc) : _s.set(sc[0], sc[1], sc[2]);
    _q.setFromEuler(_e.set(0, o.rotY ?? 0, 0));
    _m.compose(_p.set(x, y, z), _q, s);
    const i = this.count;
    for (const v of _m.elements) this.mats.push(v);
    _sphere.copy(this.local).applyMatrix4(_m);
    this.spheres.push(_sphere.center.x, _sphere.center.y, _sphere.center.z, _sphere.radius);
    if (o.color !== void 0) {
      if (!this.cols) {
        this.cols = [];
        for (let k = 0; k < i; k++) this.cols.push(1, 1, 1);
      }
      const c = Array.isArray(o.color) ? _c.setRGB(o.color[0], o.color[1], o.color[2]) : _c.set(o.color);
      this.cols.push(c.r, c.g, c.b);
    } else if (this.cols) this.cols.push(1, 1, 1);
    this.dirty = true;
    return i;
  }
  build() {
    const n = Math.max(1, this.count);
    if (this.mesh && this.mesh.instanceMatrix.count >= n) return;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    const im = new THREE.InstancedMesh(this.geometry, this.material, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.cols) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    im.castShadow = this.opts.shadow !== false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.count = 0;
    this.scene.add(im);
    this.mesh = im;
  }
  /** Called by the engine before each frame. */
  cull(cam, frustum, force = false) {
    if (!this.count) return;
    if (this.dirty || !this.mesh) this.build();
    const e = cam.matrixWorld.elements;
    let moved = this.dirty || force;
    for (let k2 = 0; k2 < 16 && !moved; k2++) if (Math.abs(e[k2] - this.lastCam[k2]) > 1e-4) moved = true;
    if (!moved) return;
    this.lastCam.set(e);
    this.dirty = false;
    const im = this.mesh;
    const far = this.opts.far ?? cam.far ?? 1e3;
    const near = this.opts.near ?? 30, near2 = near * near;
    const cx = e[12], cy = e[13], cz = e[14];
    const out = im.instanceMatrix.array, cout = im.instanceColor?.array;
    const S = this.spheres, M = this.mats, C = this.cols;
    let k = 0;
    for (let i = 0, n = this.count; i < n; i++) {
      const x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
      if (d2 > (far + r) * (far + r)) continue;
      if (d2 > near2) {
        _sphere.center.set(x, y, z);
        _sphere.radius = r;
        if (!frustum.intersectsSphere(_sphere)) continue;
      }
      for (let j = 0; j < 16; j++) out[k * 16 + j] = M[i * 16 + j];
      if (cout && C) {
        cout[k * 3] = C[i * 3];
        cout[k * 3 + 1] = C[i * 3 + 1];
        cout[k * 3 + 2] = C[i * 3 + 2];
      }
      k++;
    }
    im.count = k;
    this.visible = k;
    im.instanceMatrix.clearUpdateRanges();
    im.instanceMatrix.addUpdateRange(0, k * 16);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) {
      im.instanceColor.clearUpdateRanges();
      im.instanceColor.addUpdateRange(0, k * 3);
      im.instanceColor.needsUpdate = true;
    }
  }
  remove() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.mats = [];
    this.spheres = [];
    this.cols = null;
  }
};
function bake(root, o = {}) {
  const cell = o.cell ?? 64;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = /* @__PURE__ */ new Map();
  const done = [];
  root.traverse((ob) => {
    if (!ob.isMesh || ob.isInstancedMesh || ob.isSkinnedMesh || Array.isArray(ob.material) || !ob.visible) return;
    if (o.skip?.(ob)) return;
    const g0 = ob.geometry;
    if (!g0.boundingSphere) g0.computeBoundingSphere();
    _sphere.copy(g0.boundingSphere).applyMatrix4(ob.matrixWorld);
    const cx = Math.floor(_sphere.center.x / cell), cz = Math.floor(_sphere.center.z / cell);
    const attrs = Object.keys(g0.attributes).sort().join(",");
    const key = `${ob.material.uuid}|${attrs}|${cx},${cz}`;
    let gr = groups.get(key);
    if (!gr) {
      gr = { mat: ob.material, geos: [], cast: false, recv: false, name: ob.name || ob.material.name || "baked" };
      groups.set(key, gr);
    }
    const g = g0.clone().applyMatrix4(_m.multiplyMatrices(inv, ob.matrixWorld));
    for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
    gr.geos.push(g);
    gr.cast ||= ob.castShadow;
    gr.recv ||= ob.receiveShadow;
    done.push(ob);
  });
  const before = done.length;
  for (const m of done) m.removeFromParent();
  const out = [];
  for (const gr of groups.values()) {
    const indexed = gr.geos.every((g) => g.index);
    const list = indexed ? gr.geos : gr.geos.map((g) => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh2 = new THREE.Mesh(merged, gr.mat);
    mesh2.castShadow = gr.cast;
    mesh2.receiveShadow = gr.recv;
    mesh2.name = gr.name;
    mesh2.matrixAutoUpdate = false;
    root.add(mesh2);
    out.push(mesh2);
  }
  root.updateMatrixWorld(true);
  return { meshes: out, before, after: out.length };
}

// src/storage.ts
var mem = {};
function kimi() {
  return globalThis.kimi;
}
async function load(key, fallback) {
  try {
    const k = kimi();
    if (k?.storage?.get) {
      const v = await Promise.race([
        Promise.resolve(k.storage.get(key)),
        new Promise((r) => setTimeout(() => r(void 0), 800))
      ]);
      if (v !== void 0 && v !== null) return v;
    }
  } catch {
  }
  try {
    const raw = localStorage.getItem("kimi-game:" + key);
    if (raw) return JSON.parse(raw);
  } catch {
  }
  return mem[key] ?? fallback;
}
async function save(key, value) {
  mem[key] = value;
  try {
    const k = kimi();
    if (k?.storage?.set) await Promise.resolve(k.storage.set(key, value));
  } catch {
  }
  try {
    localStorage.setItem("kimi-game:" + key, JSON.stringify(value));
  } catch {
  }
}
async function addHighScore(game2, score, note) {
  const key = "hi:" + game2;
  const list = await load(key, []);
  const entry = { score: Math.round(score), at: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), note };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 5);
  await save(key, top);
  return { list: top, rank: top.indexOf(entry) };
}
async function highScores(game2) {
  return load("hi:" + game2, []);
}

// src/render3d.ts
var PRESETS = {
  neon: { sky: ["#02030b", "#0b0f2e"], fog: "#060918", fogDensity: 0.018, floor: "#05070f", grid: "#2fd7ff", hemi: ["#5a6cff", "#08040f", 0.6], sun: ["#9fb3ff", 0.9], bloom: 1.05, exposure: 1, stars: true, glow: 0.9 },
  night: { sky: ["#01020a", "#121a3a"], fog: "#0a0f22", fogDensity: 0.02, floor: "#0f1424", grid: "#3a4a80", hemi: ["#8090ff", "#101018", 0.5], sun: ["#aab8ff", 0.7], bloom: 0.8, exposure: 1, stars: true, glow: 0.6 },
  day: { sky: ["#5aa8ff", "#d9eeff"], fog: "#cfe6ff", fogDensity: 8e-3, floor: "#7cbf62", grid: "#5a9d48", hemi: ["#ffffff", "#5b6b3a", 1.1], sun: ["#fff4d6", 2.2], bloom: 0.25, exposure: 1, stars: false, glow: 0.15 },
  dusk: { sky: ["#2b1b4a", "#ff8a5c"], fog: "#5a3350", fogDensity: 0.014, floor: "#2a1f35", grid: "#ff7a59", hemi: ["#ffb08a", "#20102a", 0.8], sun: ["#ffb27a", 1.6], bloom: 0.6, exposure: 1.05, stars: false, glow: 0.5 },
  space: { sky: ["#000000", "#05051a"], fog: "#000005", fogDensity: 4e-3, floor: "", grid: "", hemi: ["#8899ff", "#000000", 0.5], sun: ["#ffffff", 1.4], bloom: 1, exposure: 1, stars: true, glow: 0.8 }
};
var geoCache = /* @__PURE__ */ new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
var matCache = /* @__PURE__ */ new Map();
function mat(color, glow, opts = {}) {
  const key = `${color}|${glow}|${opts.metal}|${opts.rough}|${opts.basic}|${opts.flat}`;
  let m = matCache.get(key);
  if (!m) {
    if (opts.basic) {
      const c = new THREE2.Color(color).multiplyScalar(1 + glow * 2);
      m = new THREE2.MeshBasicMaterial({ color: c, toneMapped: false });
    } else {
      m = new THREE2.MeshStandardMaterial({
        color,
        emissive: new THREE2.Color(color),
        emissiveIntensity: glow,
        metalness: opts.metal ?? 0.35,
        roughness: opts.rough ?? 0.45,
        flatShading: opts.flat ?? false
      });
    }
    matCache.set(key, m);
  }
  return m;
}
var FLASH = new THREE2.MeshBasicMaterial({ color: new THREE2.Color(4, 4, 4), toneMapped: false });
var mesh = (g, m) => {
  const o = new THREE2.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
};
var KITS = {
  ship(c, c2, glow) {
    const g = new THREE2.Group();
    const body = mesh(geo("ship-body", () => {
      const x = new THREE2.ConeGeometry(0.55, 2.2, 6);
      x.rotateZ(-Math.PI / 2);
      return x;
    }), mat(c, glow * 0.6, { flat: true }));
    const wing = mesh(geo("ship-wing", () => new THREE2.BoxGeometry(0.9, 0.08, 2.1)), mat(c, glow * 0.4, { flat: true }));
    wing.position.x = -0.35;
    const fin = mesh(geo("ship-fin", () => new THREE2.BoxGeometry(0.6, 0.5, 0.08)), mat(c2, glow));
    fin.position.set(-0.6, 0.25, 0);
    const eng = mesh(geo("ship-eng", () => new THREE2.SphereGeometry(0.28, 12, 8)), mat(c2, 2.5, { basic: true }));
    eng.position.x = -1.05;
    eng.name = "engine";
    const cock = mesh(geo("ship-cock", () => new THREE2.SphereGeometry(0.26, 12, 8)), mat("#ffffff", 0.6));
    cock.position.set(0.25, 0.22, 0);
    cock.scale.set(1.4, 0.6, 0.8);
    g.add(body, wing, fin, eng, cock);
    g.scale.setScalar(0.85);
    return g;
  },
  drone(c, c2, glow) {
    const g = new THREE2.Group();
    const core = mesh(geo("drone-core", () => new THREE2.IcosahedronGeometry(0.6, 0)), mat(c, glow, { flat: true }));
    const ring = mesh(geo("drone-ring", () => new THREE2.TorusGeometry(0.95, 0.08, 6, 24)), mat(c2, glow * 1.8, { basic: true }));
    ring.rotation.x = Math.PI / 2;
    ring.name = "spin";
    g.add(core, ring);
    return g;
  },
  orb(c, _c2, glow) {
    const g = new THREE2.Group();
    g.add(mesh(geo("orb", () => new THREE2.SphereGeometry(1, 20, 14)), mat(c, glow * 1.5 + 0.3, { basic: glow > 1 })));
    return g;
  },
  crystal(c, c2, glow) {
    const g = new THREE2.Group();
    const m = mesh(geo("crystal", () => {
      const x = new THREE2.OctahedronGeometry(1, 0);
      x.scale(1, 1.5, 1);
      return x;
    }), mat(c, glow, { flat: true, metal: 0.1, rough: 0.2 }));
    m.name = "spin";
    const inner = mesh(geo("crystal-in", () => new THREE2.OctahedronGeometry(0.45, 0)), mat(c2, 2, { basic: true }));
    g.add(m, inner);
    return g;
  },
  rock(c, _c2, glow, e) {
    const k = "rock" + e.id % 4;
    const g = new THREE2.Group();
    g.add(mesh(geo(k, () => {
      const x = new THREE2.DodecahedronGeometry(1, 0);
      const p = x.attributes.position;
      const r = rng(e.id % 4 + 11);
      const seen = /* @__PURE__ */ new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!seen.has(key)) seen.set(key, 0.75 + r.next() * 0.45);
        const s = seen.get(key);
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
      }
      x.computeVertexNormals();
      return x;
    }), mat(c, glow * 0.2, { flat: true, rough: 0.9, metal: 0.05 })));
    return g;
  },
  ball(c, _c2, glow) {
    const g = new THREE2.Group();
    g.add(mesh(geo("ball", () => new THREE2.SphereGeometry(1, 24, 16)), mat(c, glow, { metal: 0.2, rough: 0.3 })));
    return g;
  },
  bullet(c, _c2, glow) {
    const g = new THREE2.Group();
    const m = mesh(geo("bullet", () => {
      const x = new THREE2.CapsuleGeometry(0.5, 1.6, 4, 8);
      x.rotateZ(Math.PI / 2);
      return x;
    }), mat(c, 1.2 + glow, { basic: true }));
    m.castShadow = false;
    g.add(m);
    return g;
  },
  coin(c, c2, glow) {
    const g = new THREE2.Group();
    const m = mesh(geo("coin", () => {
      const x = new THREE2.CylinderGeometry(1, 1, 0.22, 24);
      x.rotateX(Math.PI / 2);
      return x;
    }), mat(c, glow + 0.3, { metal: 0.9, rough: 0.25 }));
    m.name = "spin";
    const ring = mesh(geo("coin-r", () => new THREE2.TorusGeometry(0.62, 0.08, 6, 24)), mat(c2, 1.2));
    m.add(ring);
    g.add(m);
    return g;
  },
  tank(c, c2, glow) {
    const g = new THREE2.Group();
    const body = mesh(geo("tank-body", () => new THREE2.BoxGeometry(2, 0.6, 1.5)), mat(c, glow * 0.3, { flat: true }));
    const turret = new THREE2.Group();
    turret.name = "turret";
    turret.position.y = 0.45;
    turret.add(mesh(geo("tank-tur", () => new THREE2.CylinderGeometry(0.5, 0.6, 0.4, 8)), mat(c2, glow * 0.3, { flat: true })));
    const barrel = mesh(geo("tank-bar", () => {
      const x = new THREE2.CylinderGeometry(0.12, 0.12, 1.3, 8);
      x.rotateZ(Math.PI / 2);
      x.translate(0.75, 0, 0);
      return x;
    }), mat(c2, glow * 0.3));
    turret.add(barrel);
    g.add(body, turret);
    g.scale.setScalar(0.6);
    return g;
  },
  car(c, c2, glow) {
    const g = new THREE2.Group();
    g.add(mesh(geo("car-body", () => new THREE2.BoxGeometry(2.2, 0.5, 1.1)), mat(c, glow * 0.3, { metal: 0.6, rough: 0.3 })));
    const cab = mesh(geo("car-cab", () => new THREE2.BoxGeometry(1, 0.4, 0.9)), mat(c2, glow * 0.2, { metal: 0.2, rough: 0.1 }));
    cab.position.set(-0.15, 0.42, 0);
    g.add(cab);
    for (const [x, z] of [[0.7, 0.55], [0.7, -0.55], [-0.7, 0.55], [-0.7, -0.55]]) {
      const w = mesh(geo("car-wheel", () => {
        const t = new THREE2.CylinderGeometry(0.28, 0.28, 0.22, 12);
        t.rotateX(Math.PI / 2);
        return t;
      }), mat("#111", 0));
      w.position.set(x, -0.2, z);
      g.add(w);
    }
    g.scale.setScalar(0.5);
    return g;
  },
  character(c, c2, glow) {
    const g = new THREE2.Group();
    const body = mesh(geo("char-body", () => new THREE2.CapsuleGeometry(0.45, 0.8, 4, 10)), mat(c, glow * 0.3));
    const head = mesh(geo("char-head", () => new THREE2.SphereGeometry(0.38, 14, 10)), mat(c2, glow * 0.3));
    head.position.y = 0.95;
    const eye = mesh(geo("char-eye", () => new THREE2.BoxGeometry(0.1, 0.1, 0.5)), mat("#111", 0));
    eye.position.set(0.32, 1, 0);
    g.add(body, head, eye);
    g.scale.setScalar(0.55);
    return g;
  },
  tree(c, c2) {
    const g = new THREE2.Group();
    const trunk = mesh(geo("tree-trunk", () => new THREE2.CylinderGeometry(0.15, 0.22, 1, 6)), mat(c2 === "#e6f0ff" ? "#6b4a2b" : c2, 0, { rough: 0.9 }));
    const top = mesh(geo("tree-top", () => new THREE2.ConeGeometry(0.8, 1.6, 7)), mat(c, 0.05, { flat: true, rough: 0.8 }));
    top.position.y = 1.2;
    g.add(trunk, top);
    return g;
  },
  building(c, c2, glow) {
    const g = new THREE2.Group();
    const b = mesh(geo("bld", () => {
      const x = new THREE2.BoxGeometry(1, 1, 1);
      return x;
    }), mat(c, glow * 0.15, { rough: 0.7 }));
    const w = mesh(geo("bld-w", () => new THREE2.BoxGeometry(1.02, 0.08, 1.02)), mat(c2, 1.5, { basic: true }));
    w.position.y = 0.2;
    const w2 = w.clone();
    w2.position.y = -0.1;
    g.add(b, w, w2);
    return g;
  },
  boss(c, c2, glow) {
    const g = new THREE2.Group();
    const core = mesh(geo("boss-core", () => new THREE2.IcosahedronGeometry(1, 1)), mat(c, glow * 0.5, { flat: true, metal: 0.6, rough: 0.35 }));
    core.name = "spin";
    const spikes = new THREE2.Group();
    const spikeGeo = geo("boss-spike", () => {
      const x = new THREE2.ConeGeometry(0.18, 0.7, 5);
      x.translate(0, 1.2, 0);
      return x;
    });
    const ico = new THREE2.IcosahedronGeometry(1, 0).attributes.position;
    const dirs = /* @__PURE__ */ new Set();
    for (let i = 0; i < ico.count; i++) dirs.add(`${ico.getX(i).toFixed(2)},${ico.getY(i).toFixed(2)},${ico.getZ(i).toFixed(2)}`);
    for (const d of dirs) {
      const [x, y, z] = d.split(",").map(Number);
      const s = mesh(spikeGeo, mat(c2, glow * 1.4));
      s.quaternion.setFromUnitVectors(new THREE2.Vector3(0, 1, 0), new THREE2.Vector3(x, y, z).normalize());
      spikes.add(s);
    }
    core.add(spikes);
    const ring1 = mesh(geo("boss-ring", () => new THREE2.TorusGeometry(1.7, 0.05, 6, 48)), mat(c2, 0.35, { basic: true }));
    ring1.name = "ring1";
    const ring2 = ring1.clone();
    ring2.name = "ring2";
    const eye = mesh(geo("boss-eye", () => new THREE2.SphereGeometry(0.42, 16, 12)), mat("#ffffff", 3, { basic: true }));
    eye.position.x = 0.85;
    eye.name = "eye";
    g.add(core, ring1, ring2, eye);
    return g;
  },
  star(c, _c2, glow) {
    const g = new THREE2.Group();
    const m = mesh(geo("star", () => new THREE2.OctahedronGeometry(1, 0)), mat(c, glow + 0.8, { flat: true }));
    m.name = "spin";
    g.add(m);
    return g;
  },
  pillar(c, c2, glow, e) {
    const g = new THREE2.Group();
    const h = e.box ? 1 : 2;
    const m = mesh(geo("pillar", () => new THREE2.CylinderGeometry(1, 1, 1, 12)), mat(c, glow * 0.2, { metal: 0.5, rough: 0.4 }));
    m.scale.y = e.box ? e.box[1] : h * e.radius;
    const band = mesh(geo("pillar-band", () => new THREE2.CylinderGeometry(1.03, 1.03, 0.12, 12)), mat(c2, 2, { basic: true }));
    band.position.y = m.scale.y * 0.3;
    g.add(m, band);
    g.userData.noScale = true;
    g.scale.set(e.radius, 1, e.radius);
    return g;
  },
  block(c, c2, glow, e) {
    const g = new THREE2.Group();
    const [w, h, d] = e.box ?? [e.radius * 2, e.radius * 2, e.radius * 2];
    const m = mesh(geo("block", () => new THREE2.BoxGeometry(1, 1, 1)), mat(c, glow * 0.3, { rough: 0.6 }));
    m.scale.set(w, h, d ?? w);
    const edge = new THREE2.LineSegments(geo("block-edge", () => new THREE2.EdgesGeometry(new THREE2.BoxGeometry(1, 1, 1))), new THREE2.LineBasicMaterial({ color: new THREE2.Color(c2 === "#e6f0ff" ? c : c2).multiplyScalar(2), toneMapped: false }));
    edge.scale.copy(m.scale);
    g.add(m, edge);
    g.userData.noScale = true;
    return g;
  },
  circle(c, _c2, glow) {
    const g = new THREE2.Group();
    g.add(mesh(geo("ball", () => new THREE2.SphereGeometry(1, 24, 16)), mat(c, glow)));
    return g;
  }
};
KITS.wall = KITS.block;
KITS.platform = KITS.block;
KITS.paddle = KITS.block;
KITS.enemy = KITS.drone;
KITS.player = KITS.ship;
KITS.food = KITS.coin;
KITS.snake = KITS.block;
var PMAX = 4e3;
var PVS = `
attribute float size; attribute vec4 rgba; varying vec4 vC;
void main(){ vC = rgba; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
var PFS = `
varying vec4 vC;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.0, r); gl_FragColor = vec4(vC.rgb * (1.0 + a), vC.a * a); }`;
var Particles = class {
  geo = new THREE2.BufferGeometry();
  pos = new Float32Array(PMAX * 3);
  col = new Float32Array(PMAX * 4);
  size = new Float32Array(PMAX);
  vel = new Float32Array(PMAX * 3);
  life = new Float32Array(PMAX);
  max = new Float32Array(PMAX);
  base = new Float32Array(PMAX);
  grav = new Float32Array(PMAX);
  rgb = new Float32Array(PMAX * 3);
  fade = new Uint8Array(PMAX);
  n = 0;
  points;
  constructor() {
    this.geo.setAttribute("position", new THREE2.BufferAttribute(this.pos, 3).setUsage(THREE2.DynamicDrawUsage));
    this.geo.setAttribute("rgba", new THREE2.BufferAttribute(this.col, 4).setUsage(THREE2.DynamicDrawUsage));
    this.geo.setAttribute("size", new THREE2.BufferAttribute(this.size, 1).setUsage(THREE2.DynamicDrawUsage));
    const m = new THREE2.ShaderMaterial({ vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false, blending: THREE2.AdditiveBlending, toneMapped: false });
    this.points = new THREE2.Points(this.geo, m);
    this.points.frustumCulled = false;
  }
  add(x, y, z, vx, vy, vz, life, size, c, g, fade) {
    let i = this.n;
    if (i >= PMAX) i = Math.floor(Math.random() * PMAX);
    else this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.rgb.set([c.r, c.g, c.b], i * 3);
    this.life[i] = this.max[i] = life;
    this.base[i] = size;
    this.grav[i] = g;
    this.fade[i] = fade ? 1 : 0;
  }
  update(dt) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.rgb.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.life[i] = this.life[j];
          this.max[i] = this.max[j];
          this.base[i] = this.base[j];
          this.grav[i] = this.grav[j];
          this.fade[i] = this.fade[j];
          i--;
        }
        continue;
      }
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) {
        this.pos[k + 1] = 0.02;
        this.vel[k + 1] *= -0.4;
      }
      const t = this.life[i] / this.max[i];
      const a = this.fade[i] ? t : 1;
      this.col[i * 4] = this.rgb[k];
      this.col[i * 4 + 1] = this.rgb[k + 1];
      this.col[i * 4 + 2] = this.rgb[k + 2];
      this.col[i * 4 + 3] = a;
      this.size[i] = this.base[i] * (0.35 + 0.65 * t);
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.rgba.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
  clear() {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
};
function gridFloor(size, color, base, radius) {
  const m = new THREE2.ShaderMaterial({
    uniforms: { uC: { value: new THREE2.Color(color) }, uB: { value: new THREE2.Color(base) }, uT: { value: 0 }, uR: { value: radius }, uPulse: { value: 0 }, uFog: { value: new THREE2.Color("#000") }, uFogD: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uC; uniform vec3 uB; uniform float uT; uniform float uR; uniform float uPulse; uniform vec3 uFog; uniform float uFogD; varying vec3 vW;
      float line(float x, float w){ float d = abs(fract(x - 0.5) - 0.5) / fwidth(x); return 1.0 - min(d / w, 1.0); }
      void main(){
        vec2 p = vW.xz;
        float g = max(line(p.x / 2.0, 1.0), line(p.y / 2.0, 1.0)) * 0.35 + max(line(p.x / 10.0, 1.4), line(p.y / 10.0, 1.4)) * 0.6;
        float d = length(p);
        float edge = uR > 0.0 ? smoothstep(uR - 0.6, uR, d) * (1.0 - smoothstep(uR, uR + 0.25, d)) : 0.0;
        float wave = uR > 0.0 ? exp(-pow((d - mod(uT * 9.0, uR * 1.6)) * 0.9, 2.0)) * 0.35 : 0.0;
        float inside = uR > 0.0 ? 1.0 - smoothstep(uR, uR + 6.0, d) * 0.7 : 1.0;
        vec3 col = uB + uC * (g * inside * (0.2 + uPulse * 0.5) + edge * 1.25 + wave * g * 0.7);
        float f = 1.0 - exp(-pow(uFogD * length(cameraPosition - vW), 2.0));
        gl_FragColor = vec4(mix(col, uFog, f), 1.0);
      }`,
    extensions: { derivatives: true }
  });
  const plane = new THREE2.Mesh(new THREE2.PlaneGeometry(size, size, 1, 1), m);
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = false;
  return plane;
}
function skyDome(top, bottom) {
  const m = new THREE2.ShaderMaterial({
    side: THREE2.BackSide,
    depthWrite: false,
    uniforms: { uTop: { value: new THREE2.Color(top) }, uBot: { value: new THREE2.Color(bottom) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP; void main(){ float h = clamp(vP.y * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(uBot, uTop, pow(h, 0.7)), 1.0); }`
  });
  return new THREE2.Mesh(new THREE2.SphereGeometry(400, 24, 12), m);
}
function starField(n) {
  const g = new THREE2.BufferGeometry();
  const p = new Float32Array(n * 3);
  const r = rng(3);
  for (let i = 0; i < n; i++) {
    const u = r.next() * 2 - 1, th = r.next() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    p.set([Math.cos(th) * s * 350, Math.abs(u) * 350 + 10, Math.sin(th) * s * 350], i * 3);
  }
  g.setAttribute("position", new THREE2.BufferAttribute(p, 3));
  return new THREE2.Points(g, new THREE2.PointsMaterial({ color: new THREE2.Color(1.6, 1.7, 2), size: 1.2, sizeAttenuation: false, toneMapped: false, fog: false }));
}
var Render3D = class {
  constructor(g) {
    this.g = g;
    const custom = g.opts.preset === "custom";
    const p = this.preset = PRESETS[g.opts.preset ?? "neon"] ?? PRESETS.neon;
    this.renderer = new THREE2.WebGLRenderer({ antialias: !custom, powerPreference: "high-performance", stencil: false });
    this.renderer.outputColorSpace = THREE2.SRGBColorSpace;
    this.renderer.toneMapping = THREE2.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = p.exposure;
    this.renderer.shadowMap.type = THREE2.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.canvas = this.renderer.domElement;
    g.root.prepend(this.canvas);
    this.cam = new THREE2.PerspectiveCamera(55, 1, 0.1, 900);
    if (!custom) {
      this.scene.fog = new THREE2.FogExp2(new THREE2.Color(p.fog), p.fogDensity);
      this.scene.add(skyDome(p.sky[1], p.sky[0]));
      if (p.stars) this.scene.add(starField(1400));
    }
    const hemi = new THREE2.HemisphereLight(p.hemi[0], p.hemi[1], p.hemi[2]);
    this.sun = new THREE2.DirectionalLight(p.sun[0], p.sun[1]);
    this.sun.position.set(18, 40, 12);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.far = 120;
    if (!custom) this.scene.add(hemi, this.sun, this.sun.target);
    const b = g.bounds;
    const size = b.kind === "circle" ? b.r * 6 : Math.max(b.x1 - b.x0, b.y1 - b.y0) * 3;
    if (g.opts.floor !== false && p.floor && !custom) {
      this.floor = gridFloor(Math.max(200, size), p.grid, p.floor, b.kind === "circle" ? b.r : 0);
      const u = this.floor.material.uniforms;
      u.uFog.value = new THREE2.Color(p.fog);
      u.uFogD.value = p.fogDensity;
      this.scene.add(this.floor);
    }
    this.scene.add(this.particles.points);
    const q = g.opts.quality ?? "auto";
    const cores = navigator.hardwareConcurrency ?? 4;
    this.quality = q === "low" ? 0 : q === "medium" ? 1 : q === "high" ? 3 : cores >= 8 ? 3 : 2;
    this.qualityMax = q === "auto" ? 3 : this.quality;
    this.makeLadder();
    this.step = this.ladder.findIndex(([lq]) => lq <= this.quality);
    this.applyQuality();
    this.perfKey = "perf:" + (g.opts.title ?? "game");
    if (q === "auto" && g.opts.adaptive !== false) {
      load(this.perfKey, {}).then((v) => {
        if (typeof v.step === "number" && v.step >= 0 && v.step < this.ladder.length) {
          this.savedStep = v.step;
          this.goStep(v.step, "kept from last time");
        }
      });
    }
    const self = this;
    this.camera = {
      yaw: 0,
      zoom: 1,
      shake(a) {
        self.trauma = Math.min(1, self.trauma + a);
      },
      follow(e, o = {}) {
        this.topdown(e, o);
      },
      topdown(e, o = {}) {
        self.modeCam = { kind: "topdown", e, height: o.height ?? 22, distance: o.distance ?? (o.height ?? 22) * 0.62, lerp: o.lerp ?? 5, lead: o.lead ?? 0.35 };
        this.yaw = 0;
      },
      chase(e, o = {}) {
        self.modeCam = { kind: "chase", e, distance: o.distance ?? 7, height: o.height ?? 3.2, lerp: o.lerp ?? 6 };
      },
      orbit(at, o = {}) {
        self.modeCam = { kind: "orbit", at, radius: o.radius ?? 30, height: o.height ?? 16, speed: o.speed ?? 0.12 };
      },
      firstPerson(e, o = {}) {
        self.modeCam = { kind: "first", e, height: o.height ?? 1.6 };
      },
      fixed(pos, look) {
        self.modeCam = { kind: "fixed", pos, look };
        this.yaw = 0;
      },
      manual() {
        self.modeCam = { kind: "manual" };
      },
      center(x, y) {
        this.fixed([x, 30, y + 18], [x, 0, y]);
      }
    };
    this.resize();
  }
  g;
  is3d = true;
  canvas;
  renderer;
  scene = new THREE2.Scene();
  cam;
  THREE = THREE2;
  composer;
  bloom;
  particles = new Particles();
  beams = [];
  rings = [];
  pool = /* @__PURE__ */ new Map();
  floor;
  sun;
  preset;
  ray = new THREE2.Raycaster();
  v3 = new THREE2.Vector3();
  quality = 2;
  qualityMax = 3;
  pipeline;
  qualityFns = [];
  // resolution scale and the adaptive ladder: (quality, scale) from best to cheapest
  scale = 1;
  scaleFns = [];
  ladder = [];
  step = 0;
  failed = /* @__PURE__ */ new Set();
  evalAt = 0;
  calm = 0;
  stableFor = 0;
  savedStep = -1;
  perfKey = "";
  // shadows are redrawn every n frames (0: by quality)
  shadowN = 0;
  shadowFrame = 0;
  shadowCount = 0;
  shadowRate = 0;
  shadowAt = 0;
  inst = [];
  frustum = new THREE2.Frustum();
  pv = new THREE2.Matrix4();
  culledEntities = 0;
  // where a frame's time goes: the CPU submitting the draw, and the GPU drawing it (when the
  // browser exposes timer queries; Chrome often does not)
  submitMs = 0;
  gpuMs = -1;
  timer = null;
  queries = [];
  lastDraw = 0;
  /** Entities with a mesh are hidden beyond this distance from the camera (0: never). Per entity: { cull: m }. */
  cullDistance = 0;
  modeCam = { kind: "topdown", e: null, height: 22, distance: 14, lerp: 5, lead: 0.35 };
  camPos = new THREE2.Vector3(0, 22, 14);
  camLook = new THREE2.Vector3();
  trauma = 0;
  camera;
  makeLadder() {
    const all = [[3, 1], [2, 1], [2, 0.85], [1, 1], [1, 0.85], [1, 0.7], [0, 1], [0, 0.85], [0, 0.7], [0, 0.6], [0, 0.5]];
    const ad = this.g.opts.adaptive;
    const min = typeof ad === "object" ? ad.minScale ?? 0.5 : 0.5;
    this.ladder = all.filter(([q, s]) => q <= this.qualityMax && s >= min - 1e-6);
  }
  goStep(i, why) {
    i = Math.max(0, Math.min(this.ladder.length - 1, i));
    const [q, sc] = this.ladder[i];
    const changedQ = q !== this.quality, changedS = sc !== this.scale;
    this.step = i;
    this.stableFor = 0;
    this.evalAt = performance.now() + 1500;
    if (changedQ) {
      this.quality = q;
      this.scale = sc;
      this.applyQuality();
    } else if (changedS) {
      this.scale = sc;
      this.applyScale();
    }
    if (changedQ || changedS) this.g._note(`quality ${q} at ${Math.round(sc * 100)}% resolution (${why})`);
  }
  /** Pixel ratio for a quality level before the resolution scale. */
  basePixelRatio(q = this.quality) {
    const dpr = devicePixelRatio || 1;
    return q >= 3 ? Math.min(2, dpr) : q === 2 ? Math.min(1.5, dpr) : q === 1 ? 1 : 0.75;
  }
  applyScale() {
    if (!this.pipeline) {
      this.renderer.setPixelRatio(this.basePixelRatio() * this.scale);
      this.resize();
    }
    for (const f of this.scaleFns) try {
      f(this.scale);
    } catch (err) {
      this.g._error(err);
    }
  }
  applyQuality() {
    const q = this.quality;
    this.renderer.setPixelRatio(this.basePixelRatio(q) * this.scale);
    this.renderer.shadowMap.enabled = q >= 3;
    this.sun.castShadow = q >= 3;
    if (q >= 2 && this.g.opts.bloom !== false && this.preset.bloom > 0) {
      if (!this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.cam));
        this.bloom = new UnrealBloomPass(new THREE2.Vector2(256, 256), this.preset.bloom * 0.8, 0.45, 0.8);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      }
    } else {
      this.composer?.dispose();
      this.composer = void 0;
      this.bloom = void 0;
    }
    this.resize();
    for (const f of this.qualityFns) try {
      f(q);
    } catch (err) {
      this.g._error(err);
    }
    for (const f of this.scaleFns) try {
      f(this.scale);
    } catch (err) {
      this.g._error(err);
    }
  }
  resize() {
    const w = this.g.root.clientWidth || innerWidth, h = this.g.root.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.cam.aspect = w / h;
    this.cam.fov = w / h < 0.8 ? 75 : 55;
    this.cam.updateProjectionMatrix();
  }
  poolKey(e) {
    const o = e.opts;
    return `${o.shape ?? "circle"}|${o.color}|${o.color2}|${o.glow}|${e.box?.join(",") ?? ""}|${o.shape === "rock" ? e.id % 4 : ""}|${o.shape === "pillar" ? e.radius : ""}`;
  }
  attach(e) {
    const o = e.opts;
    if (o.hidden) {
      e.visual = null;
      return;
    }
    let obj;
    if (o.mesh) obj = o.mesh;
    else {
      const key = this.poolKey(e);
      const pooled = this.pool.get(key)?.pop();
      const glow = o.glow ?? this.preset.glow;
      obj = pooled ?? (KITS[o.shape ?? (e.box ? "block" : "circle")] ?? KITS.circle)(o.color ?? "#e8eefc", o.color2 ?? "#e6f0ff", glow, e);
      obj.userData.poolKey = key;
      if (!obj.userData.base) obj.userData.base = obj.scale.clone();
      const s = (o.size ?? 1) * e.radius;
      if (!obj.userData.noScale) obj.scale.copy(obj.userData.base).multiplyScalar(s);
    }
    obj.visible = true;
    obj.position.set(e.x, e.y, e.z);
    obj.rotation.set(0, -e.rot, 0);
    if (!obj.userData.flashList) {
      const list = [];
      obj.traverse((c) => {
        if (c.isMesh) list.push(c);
      });
      obj.userData.flashList = list;
    }
    e.visual = obj;
    this.scene.add(obj);
  }
  detach(e) {
    const obj = e.visual;
    if (!obj) return;
    this.scene.remove(obj);
    if (obj.userData.flashing) this.setFlash(obj, false);
    const key = obj.userData.poolKey;
    if (key) {
      const list = this.pool.get(key) ?? [];
      if (list.length < 200) list.push(obj);
      this.pool.set(key, list);
    }
    e.visual = null;
  }
  setFlash(obj, on) {
    for (const m of obj.userData.flashList) {
      if (on) {
        m.userData.mat = m.userData.mat ?? m.material;
        m.material = FLASH;
      } else if (m.userData.mat) m.material = m.userData.mat;
    }
    obj.userData.flashing = on;
  }
  clear() {
    this.particles.clear();
    for (const b of this.beams) this.scene.remove(b.m);
    for (const r of this.rings) this.scene.remove(r.m);
    this.beams.length = 0;
    this.rings.length = 0;
    this.trauma = 0;
  }
  view() {
    return null;
  }
  project(x, y, z) {
    this.v3.set(x, y, z).project(this.cam);
    if (this.v3.z > 1) return null;
    const w = this.g.root.clientWidth, h = this.g.root.clientHeight;
    return { x: (this.v3.x * 0.5 + 0.5) * w, y: (-this.v3.y * 0.5 + 0.5) * h };
  }
  updatePointer() {
    const p = this.g.input.pointer;
    const w = this.g.root.clientWidth, h = this.g.root.clientHeight;
    this.ray.setFromCamera(new THREE2.Vector2(p.x / w * 2 - 1, -(p.y / h) * 2 + 1), this.cam);
    const plane = new THREE2.Plane(new THREE2.Vector3(0, 1, 0), -(this.g.opts.aimHeight ?? 0.6));
    const hit = new THREE2.Vector3();
    if (this.ray.ray.intersectPlane(plane, hit)) {
      p.world.x = hit.x;
      p.world.y = hit.z;
    }
  }
  burst(at, o) {
    const n = o.count ?? 20;
    const r = this.g.rand;
    const cols = (Array.isArray(o.color) ? o.color : [o.color ?? "#ffffff"]).map((c) => new THREE2.Color(c).multiplyScalar(1.6));
    for (let i = 0; i < n; i++) {
      let ang = r(0, Math.PI * 2);
      if (o.dir) ang = Math.atan2(o.dir[1], o.dir[0]) + r(-(o.spread ?? 0.5), o.spread ?? 0.5);
      const sp = (o.speed ?? 8) * r(0.25, 1);
      const up = (o.up ?? 0.5) * sp * r(0, 1);
      this.particles.add(at[0], at[1], at[2], Math.cos(ang) * sp, up, Math.sin(ang) * sp, (o.life ?? 0.7) * r(0.6, 1), (o.size ?? 0.35) * r(0.7, 1.3), cols[i % cols.length], o.gravity ?? 0, o.fade ?? true);
    }
  }
  beam(a, b, o) {
    const va = new THREE2.Vector3(a[0], a[1], a[2]), vb = new THREE2.Vector3(b[0], b[1], b[2]);
    const len2 = va.distanceTo(vb);
    const m = new THREE2.Mesh(
      geo("beam", () => {
        const x = new THREE2.CylinderGeometry(1, 1, 1, 6, 1, true);
        x.rotateX(Math.PI / 2);
        return x;
      }),
      new THREE2.MeshBasicMaterial({ color: new THREE2.Color(o.color ?? "#ffffff").multiplyScalar(2.5), transparent: true, blending: THREE2.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    const w = o.width ?? 0.12;
    m.scale.set(w, w, len2);
    m.position.copy(va).lerp(vb, 0.5);
    m.lookAt(vb);
    this.scene.add(m);
    this.beams.push({ m, life: o.life ?? 0.25, max: o.life ?? 0.25 });
  }
  ring(at, o) {
    const m = new THREE2.Mesh(
      geo("ringfx", () => {
        const x = new THREE2.RingGeometry(0.92, 1, 64);
        x.rotateX(-Math.PI / 2);
        return x;
      }),
      new THREE2.MeshBasicMaterial({ color: new THREE2.Color(o.color ?? "#ffffff").multiplyScalar(2.2), transparent: true, blending: THREE2.AdditiveBlending, depthWrite: false, side: THREE2.DoubleSide, toneMapped: false })
    );
    m.position.set(at[0], Math.max(0.05, (at[1] ?? 0) * 0.2), at[2]);
    this.scene.add(m);
    this.rings.push({ m, life: o.life ?? 0.45, max: o.life ?? 0.45, r: o.radius ?? 4 });
  }
  render(alpha, dt) {
    const g = this.g, s = g.current;
    const t = g.time;
    this.renderer.info.reset();
    const cp = this.cam.position;
    let culled = 0;
    if (s) {
      for (const e of s.entities) {
        const obj = e.visual;
        if (!obj) continue;
        obj.visible = e.visible && !(e.invuln > 0 && Math.floor(e.invuln * 20) % 2);
        const cd = e.opts.cull ?? this.cullDistance;
        if (cd > 0 && obj.visible) {
          const dx = e.x - cp.x, dy = e.y - cp.y, dz = e.z - cp.z;
          if (dx * dx + dy * dy + dz * dz > cd * cd) {
            obj.visible = false;
            culled++;
            continue;
          }
        }
        obj.position.set(lerp(e.ox, e.x, alpha), lerp(e.oy, e.y, alpha), lerp(e.oz, e.z, alpha));
        obj.rotation.y = -angleLerp(e.orot, e.rot, alpha);
        if (e.opts.shape === "ship" || e.opts.shape === "player") {
          const [vx, vz] = e.v;
          const side = (-Math.sin(e.rot) * vx + Math.cos(e.rot) * vz) / Math.max(1, e.speed);
          obj.rotation.x = lerp(obj.rotation.x, side * 0.6, 0.15);
        }
        if (!e.opts.mesh) {
          for (const c of obj.children) {
            if (c.name === "spin") c.rotation.y += dt * 2.2;
            if (c.name === "ring1") c.rotation.set(t * 1.3, t * 0.7, 0);
            if (c.name === "ring2") c.rotation.set(-t * 0.9, 0, t * 1.1);
          }
          const turret = obj.getObjectByName("turret");
          if (turret) turret.rotation.y = -(Math.atan2(e.aim[1], e.aim[0]) - e.rot);
          if (e.opts.shape === "coin" || e.opts.shape === "star" || e.opts.shape === "orb" || e.opts.shape === "crystal") obj.position.y += Math.sin(t * 3 + e.id) * 0.15;
        }
        const want = e.flashT > 0;
        if (want !== !!obj.userData.flashing) this.setFlash(obj, want);
        if (!obj.userData.noScale && obj.userData.base) obj.scale.copy(obj.userData.base).multiplyScalar((e.opts.size ?? 1) * e.radius * e.scale);
      }
    }
    this.culledEntities = culled;
    const mc = this.modeCam;
    if (mc.kind === "manual") {
      this.renderFx(dt);
      return;
    }
    const k = 1 - Math.exp(-(mc.lerp ?? 5) * Math.max(dt, 1 / 240));
    const target = new THREE2.Vector3();
    const look = new THREE2.Vector3();
    if ((mc.kind === "topdown" || mc.kind === "chase" || mc.kind === "first") && mc.e?.alive) {
      const e = mc.e;
      const ex = lerp(e.ox, e.x, alpha), ey = lerp(e.oy, e.y, alpha), ez = lerp(e.oz, e.z, alpha);
      if (mc.kind === "topdown") {
        const lx = ex + e.vx * mc.lead, lz = ez + e.vz * mc.lead;
        target.set(lx, mc.height, lz + mc.distance);
        look.set(lx, 0, lz);
        this.camera.yaw = 0;
      } else if (mc.kind === "chase") {
        const r = angleLerp(e.orot, e.rot, alpha);
        target.set(ex - Math.cos(r) * mc.distance, ey + mc.height, ez - Math.sin(r) * mc.distance);
        look.set(ex + Math.cos(r) * 4, ey + 0.5, ez + Math.sin(r) * 4);
        this.camera.yaw = r + Math.PI / 2;
      } else {
        const r = angleLerp(e.orot, e.rot, alpha);
        target.set(ex, ey + mc.height, ez);
        look.set(ex + Math.cos(r) * 10, ey + mc.height, ez + Math.sin(r) * 10);
        this.camera.yaw = r + Math.PI / 2;
      }
    } else if (mc.kind === "orbit") {
      const at = mc.at?.p ?? mc.at ?? [0, 0];
      const a = t * mc.speed;
      target.set(at[0] + Math.cos(a) * mc.radius, mc.height, at[1] + Math.sin(a) * mc.radius);
      look.set(at[0], 0, at[1]);
      this.camera.yaw = a + Math.PI / 2;
    } else if (mc.kind === "fixed") {
      target.set(mc.pos[0], mc.pos[1], mc.pos[2]);
      look.set(mc.look[0], mc.look[1], mc.look[2]);
    } else {
      target.copy(this.camPos);
      look.copy(this.camLook);
    }
    const snap = mc.kind === "first" ? 1 : k;
    this.camPos.lerp(target, snap);
    this.camLook.lerp(look, snap);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma;
    this.cam.position.copy(this.camPos);
    this.cam.position.x += (Math.random() * 2 - 1) * sh * 1.1;
    this.cam.position.y += (Math.random() * 2 - 1) * sh * 0.8;
    this.cam.lookAt(this.camLook);
    this.cam.rotateZ((Math.random() * 2 - 1) * sh * 0.05);
    this.sun.position.set(this.camLook.x + 18, 40, this.camLook.z + 12);
    this.sun.target.position.copy(this.camLook);
    this.renderFx(dt);
  }
  /** Effects, the frame itself, and quality adaptation (also for a game that drives its own camera). */
  renderFx(dt) {
    const t = this.g.time;
    this.particles.update(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.m);
        b.m.material.dispose();
        this.beams.splice(i, 1);
        continue;
      }
      b.m.material.opacity = b.life / b.max;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const p = 1 - r.life / r.max;
      r.m.scale.setScalar(0.2 + r.r * (1 - Math.pow(1 - p, 3)));
      r.m.material.opacity = 1 - p;
    }
    if (this.floor) {
      const u = this.floor.material.uniforms;
      u.uT.value = t;
      u.uPulse.value = Math.max(0, u.uPulse.value - dt * 1.5);
    }
    if (this.inst.length) {
      this.cam.updateMatrixWorld();
      this.pv.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.pv);
      for (const i of this.inst) i.cull(this.cam, this.frustum);
    }
    const sm = this.renderer.shadowMap;
    if (sm.enabled) {
      sm.autoUpdate = false;
      const every = this.shadowN || (this.quality >= 2 ? 1 : 2);
      if (++this.shadowFrame >= every) {
        this.shadowFrame = 0;
        sm.needsUpdate = true;
        this.shadowCount++;
      }
      const now = performance.now();
      if (now - this.shadowAt > 1e3) {
        this.shadowRate = this.shadowCount;
        this.shadowCount = 0;
        this.shadowAt = now;
      }
    } else this.shadowRate = 0;
    const nowT = performance.now();
    if (this.g.state === "paused" && nowT - this.lastDraw < 200) return;
    this.lastDraw = nowT;
    const q = this.beginGpu();
    const t0 = performance.now();
    if (this.pipeline) this.pipeline(dt);
    else if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.cam);
    this.submitMs = this.submitMs * 0.9 + (performance.now() - t0) * 0.1;
    this.endGpu(q);
    this.adapt(dt);
  }
  beginGpu() {
    const gl = this.renderer.getContext();
    if (this.timer === null) this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") ?? false;
    const ext = this.timer;
    for (let i = this.queries.length - 1; i >= 0; i--) {
      const qq2 = this.queries[i];
      if (!gl.getQueryParameter(qq2, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (ext && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(qq2, gl.QUERY_RESULT) / 1e6;
        this.gpuMs = this.gpuMs < 0 ? ms : this.gpuMs * 0.9 + ms * 0.1;
      }
      gl.deleteQuery(qq2);
      this.queries.splice(i, 1);
    }
    if (!ext || this.queries.length > 3) return null;
    const qq = gl.createQuery();
    if (!qq) return null;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, qq);
    return qq;
  }
  endGpu(qq) {
    if (!qq) return;
    const gl = this.renderer.getContext();
    gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.queries.push(qq);
  }
  /** Many copies of one thing, culled per copy: trees, lamps, crates, crowds of props. */
  instances(geometry, material, opts) {
    const i = new Instances(geometry, material, this.scene, opts);
    this.inst.push(i);
    return i;
  }
  /** Merge static meshes under root into one mesh per material per ground cell. */
  bake(root, opts) {
    return bake(root, opts);
  }
  /** Redraw the sun's shadows every n frames (1 = always; 0 = by quality). Call refreshShadows() after a big change. */
  shadowEvery(n) {
    this.shadowN = Math.max(0, Math.round(n));
  }
  refreshShadows() {
    this.renderer.shadowMap.needsUpdate = true;
  }
  /** fn(scale) now and whenever the resolution scale changes (0.5..1). For your own pipeline. */
  onScale(fn) {
    this.scaleFns.push(fn);
    fn(this.scale);
  }
  get renderScale() {
    return this.scale;
  }
  /** Brighten the floor grid for a moment (beats, shockwaves). */
  pulse(v = 0.6) {
    if (this.floor) this.floor.material.uniforms.uPulse.value = v;
  }
  /** Replace the final draw with your own (your own EffectComposer, passes, scopes…). null restores the default. */
  setPipeline(fn) {
    this.pipeline = fn ?? void 0;
  }
  /** Called with the new level (0 low … 3 ultra) whenever quality changes, and once at once. */
  onQuality(fn) {
    this.qualityFns.push(fn);
    fn(this.quality);
  }
  get level() {
    return this.quality;
  }
  /** Set quality yourself (0..3) at full resolution; adaptive changes continue unless adaptive is false. */
  setQuality(q) {
    q = Math.max(0, Math.min(3, Math.round(q)));
    if (q > this.qualityMax) {
      this.qualityMax = q;
      this.makeLadder();
    }
    const i = this.ladder.findIndex(([lq]) => lq === q);
    this.failed.clear();
    this.goStep(i < 0 ? this.ladder.length - 1 : i, "set");
  }
  /**
   * Adaptive quality, once a second: above lowerAbove ms a frame, one step down the ladder
   * (resolution first, then effects); below raiseBelow for three seconds, one step up unless that
   * step was already too slow. A setting that holds for 20 s is kept for the next start.
   */
  adapt(_dt) {
    if (this.g.state !== "play" && this.g.state !== "title") return;
    const ad = this.g.opts.adaptive;
    if (ad === false) return;
    const now = performance.now();
    if (now < this.evalAt) return;
    this.evalAt = now + 1e3;
    const lower = typeof ad === "object" ? ad.lowerAbove ?? 24 : 24;
    const raise = typeof ad === "object" ? ad.raiseBelow ?? 18 : 18;
    const ms = this.g.frameMs;
    if (ms > lower && this.step < this.ladder.length - 1) {
      this.failed.add(this.step);
      this.calm = 0;
      this.goStep(this.step + (ms > lower * 2 ? 2 : 1), `frame time ${ms.toFixed(0)} ms`);
      return;
    }
    if (ms < raise) {
      if (++this.calm >= 3 && this.step > 0 && !this.failed.has(this.step - 1)) {
        this.calm = 0;
        this.goStep(this.step - 1, `frame time ${ms.toFixed(0)} ms`);
        return;
      }
    } else this.calm = 0;
    if (++this.stableFor === 20 && this.step !== this.savedStep) {
      this.savedStep = this.step;
      save(this.perfKey, { step: this.step });
    }
  }
  describe() {
    const info = this.renderer.info;
    return {
      renderer: "three.js r" + THREE2.REVISION,
      quality: this.quality,
      scale: this.scale,
      bloom: !!this.composer,
      shadows: this.renderer.shadowMap.enabled,
      shadowsPerSec: this.shadowRate,
      submitMs: +this.submitMs.toFixed(1),
      gpuMs: this.gpuMs < 0 ? null : +this.gpuMs.toFixed(1),
      culled: this.culledEntities,
      instances: this.inst.reduce((a, i) => a + i.visible, 0) + "/" + this.inst.reduce((a, i) => a + i.count, 0),
      pixelRatio: this.renderer.getPixelRatio(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      particles: this.particles.n,
      camera: this.modeCam.kind
    };
  }
};

// src/game.ts
var VERSION = "0.3.0";
var STEP = 1 / 60;
var Game = class {
  opts;
  mode;
  size;
  root;
  input;
  ui;
  renderer;
  bounds;
  sound = sound;
  current = null;
  state = "boot";
  /** Game time in seconds (scaled by slow motion). */
  time = 0;
  timeScale = 1;
  frameMs = 16.7;
  fps = 60;
  r;
  scenes = /* @__PURE__ */ new Map();
  playName = "play";
  playParams;
  titleShown = false;
  acc = 0;
  last = 0;
  frozen = 0;
  slow = { target: 1, left: 0 };
  errors = [];
  notes = [];
  listeners = /* @__PURE__ */ new Map();
  reportOn = false;
  reportT = 0;
  postT = 0;
  collWin = [];
  stepMs = 0;
  /** Random numbers from the game's seed: rand(), rand(b), rand(a, b). */
  rand;
  int;
  pick;
  chance;
  constructor(opts = {}) {
    this.opts = opts;
    this.mode = opts.mode ?? "2d";
    this.size = opts.size ?? [800, 600];
    this.r = rng(opts.seed ?? Date.now() >>> 0);
    this.rand = this.r.rand;
    this.int = this.r.int;
    this.pick = this.r.pick;
    this.chance = this.r.chance;
    const parent2 = typeof opts.parent === "string" ? document.querySelector(opts.parent) : opts.parent;
    this.root = document.createElement("div");
    this.root.className = "kg-root";
    if (parent2) {
      this.root.style.cssText = "width:100%;height:100%";
      parent2.appendChild(this.root);
    } else {
      document.documentElement.style.cssText += ";height:100%;background:#000";
      document.body.style.cssText += ";margin:0;height:100%;overflow:hidden;background:#000";
      this.root.style.cssText = "position:fixed;inset:0";
      document.body.appendChild(this.root);
    }
    if (opts.accent) this.root.style.setProperty("--kg-accent", opts.accent);
    if (opts.title) document.title = opts.title;
    if (this.mode === "2d") {
      const [w, h] = opts.world ?? this.size;
      this.bounds = { kind: "rect", x0: 0, y0: 0, x1: w, y1: h };
    } else if (opts.world) {
      const [w, d] = opts.world;
      this.bounds = { kind: "rect", x0: -w / 2, y0: -d / 2, x1: w / 2, y1: d / 2 };
    } else this.bounds = { kind: "circle", cx: 0, cy: 0, r: opts.arena ?? 30 };
    this.input = new Input(this.root);
    this.ui = new UI(this.root);
    this.renderer = this.mode === "3d" ? new Render3D(this) : new Render2D(this);
    this.input.onAny(() => sound.unlock());
    if (opts.lockPointer) {
      this.input.onAny(() => {
        if (this.state === "play") this.input.lockPointer();
      });
      document.addEventListener("pointerlockchange", () => {
        if (!document.pointerLockElement && this.state === "play") this.pause();
      });
    }
    this.reportOn = !!opts.report;
    addEventListener("keydown", (e) => {
      if (e.code === "KeyM" && !e.repeat) {
        const m = sound.mute();
        this.ui.popup(this.root.clientWidth / 2, 60, m ? "sound off" : "sound on");
      }
      if ((e.code === "F3" || e.code === "Backquote") && !e.repeat) {
        e.preventDefault();
        this.reportOn = !this.reportOn;
        if (!this.reportOn) this.ui.report(null);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "play") this.pause();
    });
    addEventListener("error", (e) => this._error(e.error ?? e.message));
    addEventListener("unhandledrejection", (e) => this._error(e.reason));
    new ResizeObserver(() => this.renderer.resize()).observe(this.root);
    globalThis.__kimiGame = { game: this, report: () => this.report(), version: VERSION };
    requestAnimationFrame((t) => {
      this.last = t;
      this.frame(t);
    });
  }
  // ---------- scenes ----------
  /** Define a scene: g.scene("play", (s) => { … }). A "title" scene runs behind the title card. */
  scene(name, setup) {
    this.scenes.set(name, setup);
    return this;
  }
  /** Start a scene. The first start shows the title card unless titleScreen is false. */
  start(name = "play", params) {
    if (name !== "title") {
      this.playName = name;
      this.playParams = params;
    }
    if (!this.titleShown && this.opts.titleScreen !== false) {
      this.titleShown = true;
      this.showTitle();
      return;
    }
    this.titleShown = true;
    this.run(name, params);
  }
  /** Restart the last played scene. */
  restart() {
    this.run(this.playName, this.playParams);
  }
  run(name, params) {
    const setup = this.scenes.get(name);
    if (!setup) {
      this._error(new Error(`no scene called "${name}"`));
      return;
    }
    if (this.current) {
      this.current._end();
      for (const e of this.current.entities) this.renderer.detach(e);
    }
    this.renderer.clear();
    this.ui.clear();
    this.ui.hideCard();
    this.timeScale = 1;
    this.slow = { target: 1, left: 0 };
    this.frozen = 0;
    sound.muffle(0);
    const s = new Scene(this, name, params);
    this.current = s;
    this.state = name === "title" ? "title" : "play";
    if (this.opts.lockPointer && name !== "title") this.input.lockPointer();
    try {
      setup(s, params ?? {});
    } catch (err) {
      this._error(err);
    }
    this.input.refreshTouchButtons();
    this.emit("start", name);
  }
  async showTitle() {
    if (this.scenes.has("title")) this.run("title");
    else {
      this.current = null;
      this.state = "title";
    }
    this.state = "title";
    const o = this.opts;
    const hs = await highScores(o.title ?? "game");
    const how = (o.howto ?? this.defaultHowto()).map((l) => `<li>${keycaps(l)}</li>`).join("");
    const best = hs.length ? `<table class="kg-hs">${hs.slice(0, 3).map((h, i) => `<tr><td>${i + 1}</td><td>${h.score.toLocaleString("en-US")}</td><td>${h.at}</td></tr>`).join("")}</table>` : "";
    this.ui.showCard(
      `<h1>${o.title ?? "Kimi Game"}</h1><h3>${o.sub ?? "made with kimi/game"}</h3><ul>${how}</ul>${best}<div class="kg-go">${this.input.isTouch ? "Tap" : "Press any key"} to start</div><div class="kg-small">P pause \xB7 M sound \xB7 F3 engine report</div>`,
      this.scenes.has("title")
    );
    setTimeout(() => {
      const off = this.input.onAny(() => {
        if (this.state !== "title") return;
        off();
        sound.click();
        this.run(this.playName, this.playParams);
      });
    }, 350);
  }
  defaultHowto() {
    return ["Move: [W][A][S][D] or arrows \xB7 stick \xB7 touch", "Pause: [P] or [Esc]"];
  }
  // ---------- flow ----------
  /** End the round: shows the score, saves high scores, any key restarts. */
  async over(o = {}) {
    if (this.state !== "play") return;
    this.state = "over";
    this.slowmo(0.25, 1e9);
    sound.muffle(0.6);
    o.win ? sound.win() : sound.over();
    this.emit("over", o);
    const score = Math.round(o.score ?? 0);
    const { list, rank } = await addHighScore(this.opts.title ?? "game", score, o.message);
    await new Promise((r) => setTimeout(r, 700));
    if (this.state !== "over") return;
    const rows = list.map((h, i) => `<tr class="${i === rank ? "me" : ""}"><td>${i + 1}</td><td>${h.score.toLocaleString("en-US")}</td><td>${h.at}</td></tr>`).join("");
    this.ui.showCard(
      `<h1>${o.title ?? (o.win ? "You win" : "Game over")}</h1>` + (o.message ? `<h3>${o.message}</h3>` : `<h3>&nbsp;</h3>`) + `<div class="kg-big">${score.toLocaleString("en-US")}</div>` + (rank === 0 && list.length > 1 ? `<div class="kg-new">NEW BEST</div><br>` : "") + `<table class="kg-hs">${rows}</table><div class="kg-go">${this.input.isTouch ? "Tap" : "Press any key"} to play again</div>`
    );
    setTimeout(() => {
      const off = this.input.onAny(() => {
        if (this.state !== "over") return;
        off();
        sound.click();
        this.restart();
      });
    }, 600);
  }
  pause() {
    if (this.state !== "play") return;
    this.state = "paused";
    if (document.pointerLockElement) document.exitPointerLock?.();
    sound.muffle(0.9);
    const how = (this.opts.howto ?? this.defaultHowto()).map((l) => `<li>${keycaps(l)}</li>`).join("");
    this.ui.showCard(`<h1>Paused</h1><h3>${this.opts.title ?? ""}</h3><ul>${how}</ul><div class="kg-go">[P] to resume</div>`.replace("[P]", this.input.isTouch ? "Tap" : "P"));
    const off = this.input.onAny(() => {
      if (this.input.isTouch || this.opts.lockPointer && this.input.pointer.down) {
        off();
        this.resume();
      }
    });
    this.emit("pause");
  }
  resume() {
    if (this.state !== "paused") return;
    this.state = "play";
    if (this.opts.lockPointer) this.input.lockPointer();
    this.ui.hideCard();
    sound.muffle(this.timeScale < 1 ? 0.7 : 0);
    this.last = performance.now();
    this.emit("resume");
  }
  /** Slow motion: g.slowmo(0.3, 2) runs the world at 30 % for 2 s. Unscaled entities keep full speed. */
  slowmo(scale, seconds) {
    this.slow = { target: scale, left: seconds };
  }
  /** Hit-stop: freeze everything for a moment (0.03–0.12 s feels good). */
  freeze(seconds = 0.06) {
    this.frozen = Math.max(this.frozen, seconds);
  }
  /** Flash the screen. */
  flash(color = "#fff", strength = 0.45) {
    this.ui.flash(color, strength);
  }
  on(ev, fn) {
    const l = this.listeners.get(ev) ?? [];
    l.push(fn);
    this.listeners.set(ev, l);
    return this;
  }
  emit(ev, d) {
    for (const f of this.listeners.get(ev) ?? []) try {
      f(d);
    } catch (err) {
      this._error(err);
    }
  }
  /** three.js objects for anything the engine does not do (3D only). */
  get three() {
    const r = this.renderer;
    return r.is3d ? {
      THREE: r.THREE,
      scene: r.scene,
      camera: r.cam,
      renderer: r.renderer,
      pulse: (v) => r.pulse(v),
      /** Replace the final draw (your own composer and passes). */
      setPipeline: (fn) => r.setPipeline(fn),
      /** fn(level 0..3) now and whenever quality changes. */
      onQuality: (fn) => r.onQuality(fn),
      setQuality: (q) => r.setQuality(q),
      get quality() {
        return r.level;
      },
      /** Many copies of one thing in one draw, culled per copy: trees, lamps, crates. */
      instances: (geometry, material, o) => r.instances(geometry, material, o),
      /** Merge the static meshes under a group: one mesh per material per ground cell. */
      bake: (root, o) => r.bake(root, o),
      /** Redraw shadows every n frames (0: by quality); refreshShadows() after a big change. */
      shadowEvery: (n) => r.shadowEvery(n),
      refreshShadows: () => r.refreshShadows(),
      /** fn(scale 0.5..1) now and when the adaptive resolution changes (for your own pipeline). */
      onScale: (fn) => r.onScale(fn),
      get scale() {
        return r.renderScale;
      },
      /** Pixel ratio a quality level uses before the scale. */
      pixelRatio: (q) => r.basePixelRatio(q),
      /** Hide entity meshes beyond this distance from the camera (0: never; per entity: { cull: m }). */
      get cullDistance() {
        return r.cullDistance;
      },
      set cullDistance(v) {
        r.cullDistance = v;
      }
    } : null;
  }
  /** The 2D canvas context (2D only). */
  get ctx() {
    return this.renderer.ctx ?? null;
  }
  get width() {
    return this.mode === "2d" ? this.size[0] : this.root.clientWidth;
  }
  get height() {
    return this.mode === "2d" ? this.size[1] : this.root.clientHeight;
  }
  // ---------- loop ----------
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.max(0, (now - this.last) / 1e3);
    const realDt = Math.min(0.1, rawDt);
    this.last = now;
    if (rawDt > 0 && rawDt < 2) {
      this.frameMs = this.frameMs * 0.92 + rawDt * 1e3 * 0.08;
      this.fps = 1e3 / this.frameMs;
    }
    const running = this.state === "play" || this.state === "title" || this.state === "over";
    if (this.slow.left > 0) {
      this.slow.left -= realDt;
      this.timeScale += (this.slow.target - this.timeScale) * Math.min(1, realDt * 10);
    } else this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 4);
    if (Math.abs(1 - this.timeScale) < 0.01 && this.slow.left <= 0) this.timeScale = 1;
    this.renderer.updatePointer();
    let alpha = 1;
    const t0 = performance.now();
    if (running && this.current) {
      if (this.frozen > 0) {
        this.frozen -= realDt;
      } else {
        this.acc += realDt;
        let steps = 0;
        while (this.acc >= STEP && steps < 5) {
          this.input.beginStep();
          if (this.state === "play" && this.input.pressed("pause")) {
            this.input.endStep();
            this.pause();
            break;
          }
          const dt = STEP * this.timeScale;
          this.time += dt;
          this.current.step(dt, STEP);
          this.input.endStep();
          this.acc -= STEP;
          steps++;
        }
        if (steps === 5) this.acc = 0;
        alpha = this.acc / STEP;
      }
    } else {
      this.input.beginStep();
      if (this.state === "paused" && this.input.pressed("pause")) this.resume();
      this.input.endStep();
    }
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
    if (this.current && this.current.collisions) {
      this.collWin.push(now, this.current.collisions);
      this.current.collisions = 0;
      if (this.collWin.length > 400) this.collWin.splice(0, 200);
    }
    try {
      this.renderer.render(alpha, this.state === "paused" ? 0 : realDt * (this.frozen > 0 ? 0 : this.timeScale));
    } catch (err) {
      this._error(err);
    }
    this.reportT -= realDt;
    if (this.reportOn && this.reportT <= 0) {
      this.reportT = 0.25;
      this.ui.report(formatReport(this.report()));
    }
    this.postT -= realDt;
    if (this.postT <= 0) {
      this.postT = 2;
      const r = this.report();
      try {
        if (parent !== window) parent.postMessage({ type: "kimi-game:report", report: r }, "*");
      } catch {
      }
      try {
        globalThis.kimi?.report?.(r);
      } catch {
      }
    }
  }
  // ---------- report ----------
  /** What the engine knows right now: scenes, entities by tag (and whether they moved), collisions, frame time, input, warnings. */
  report() {
    const s = this.current;
    const tags = {};
    let total = 0;
    let player = null;
    if (s) {
      for (const e of s.entities) {
        if (!e.alive) continue;
        total++;
        for (const t of e.tags) {
          const r = tags[t] ??= { count: 0, moved: 0 };
          r.count++;
          if (e.moved) r.moved++;
        }
        if (e.opts.controls && !player) player = { tags: [...e.tags], moved: e.moved, everHit: !!e.data._everHit, hp: e.hp };
      }
    }
    let coll = 0;
    const keep = [];
    for (let i = 0; i < this.collWin.length; i += 2) if (performance.now() - this.collWin[i] < 1e3) {
      keep.push(this.collWin[i], this.collWin[i + 1]);
      coll += this.collWin[i + 1];
    }
    this.collWin = keep;
    const warnings = [];
    if (s && s.time > 3) {
      for (const [t, r] of Object.entries(tags)) {
        const movers = s.entities.filter((e) => e.alive && e.tags.has(t) && (e._ai.length || e.speed > 0 || e.opts.controls));
        if (movers.length >= 2 && r.moved === 0) warnings.push(`${r.count} ${t}, none moved`);
      }
      if (player && !player.moved && s.time > 6 && this.state === "play") warnings.push("the player never moved");
      if (player && !player.everHit && s.time > 12 && this.state === "play") warnings.push("the player never collided with anything");
      if (this.frameMs > 33) warnings.push(`frame time ${this.frameMs.toFixed(0)} ms`);
      if (total === 0) warnings.push("the scene is empty");
    }
    if (this.errors.length) warnings.push(`${this.errors.length} error(s)`);
    return {
      engine: `kimi/game@${VERSION}`,
      title: this.opts.title ?? "",
      mode: this.mode,
      state: this.state,
      scene: s?.name ?? null,
      sceneTime: s ? +s.time.toFixed(1) : 0,
      fps: Math.round(this.fps),
      frameMs: +this.frameMs.toFixed(1),
      stepMs: +this.stepMs.toFixed(2),
      timeScale: +this.timeScale.toFixed(2),
      entities: total,
      tags,
      player,
      collisionsPerSec: coll,
      input: this.input.describe(),
      ui: this.ui.describe(),
      render: this.renderer.describe(),
      sound: { state: sound.state, muted: sound.muted },
      warnings,
      notes: this.notes.slice(-5),
      errors: this.errors.slice(-5)
    };
  }
  _error(err) {
    const msg = err instanceof Error ? `${err.message}${err.stack ? " @ " + (err.stack.split("\n")[1] ?? "").trim() : ""}` : String(err);
    if (this.errors[this.errors.length - 1] === msg) return;
    this.errors.push(msg);
    if (this.errors.length > 20) this.errors.shift();
    console.error("[kimi/game]", err);
  }
  _note(msg) {
    this.notes.push(msg);
    if (this.notes.length > 20) this.notes.shift();
  }
};
function keycaps(s) {
  return s.replace(/\[([^\]]+)\]/g, "<kbd>$1</kbd>");
}
function formatReport(r) {
  const tagLines = Object.entries(r.tags).sort((a, b) => b[1].count - a[1].count).slice(0, 10).map(([t, v]) => `  ${t.padEnd(10)} ${String(v.count).padStart(4)}  moved ${v.moved}`).join("\n");
  const rd = r.render;
  return [
    `${r.engine}  ${r.mode}  ${r.state}`,
    `scene ${r.scene}  t=${r.sceneTime}s  \xD7${r.timeScale}`,
    `fps ${r.fps}  frame ${r.frameMs}ms  step ${r.stepMs}ms` + (r.render.submitMs !== void 0 ? `
draw (cpu) ${r.render.submitMs}ms  gpu ${r.render.gpuMs ?? "n/a"}${r.render.gpuMs !== null ? "ms" : ""}` : ""),
    rd.renderer + (rd.quality !== void 0 ? `  q${rd.quality} \xD7${rd.scale}${rd.bloom ? " bloom" : ""}${rd.shadows ? ` shadows ${rd.shadowsPerSec}/s` : ""}` : ""),
    rd.drawCalls !== void 0 ? `draw calls ${rd.drawCalls}  tris ${rd.triangles}` : "",
    rd.instances !== void 0 ? `instances ${rd.instances}  culled ${rd.culled}` : "",
    `particles ${rd.particles}  collisions/s ${r.collisionsPerSec}`,
    `entities ${r.entities}`,
    tagLines,
    `input ${r.input.using}  pads ${r.input.pads}  uses ${r.input.used.join(",")}`,
    r.warnings.length ? `warnings:
  ${r.warnings.join("\n  ")}` : "warnings: none",
    r.errors.length ? `errors:
  ${r.errors.join("\n  ")}` : ""
  ].filter(Boolean).join("\n");
}
function game(opts = {}) {
  return new Game(opts);
}

// src/index.ts
var SHAPES = [
  "ship",
  "rock",
  "ball",
  "paddle",
  "block",
  "coin",
  "bullet",
  "character",
  "drone",
  "orb",
  "crystal",
  "tank",
  "car",
  "tree",
  "building",
  "boss",
  "star",
  "pillar",
  "wall",
  "platform"
];
var sprite = Object.fromEntries(
  SHAPES.map((n) => [n, (o = {}) => ({ ...o, shape: n })])
);
export {
  Entity,
  Game,
  Input,
  Instances,
  KITS,
  PRESETS,
  SHAPES_2D,
  Scene,
  TAU,
  UI,
  VERSION,
  addHighScore,
  ai,
  angleDiff,
  bake,
  clamp,
  game,
  highScores,
  lerp,
  load,
  overlap,
  raycast,
  raycast3,
  rng,
  save,
  sound,
  sprite
};
