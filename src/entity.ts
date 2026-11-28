// An entity is anything in a scene: the player, an enemy, a bullet, a wall, a coin.
// Positions are world units. 2D games use x,y (pixels, y down). 3D games move on the
// ground plane x,z with y up. "Plane" helpers use whichever pair the game's mode uses.

import type { Scene } from "./scene";
import type { Scheme } from "./input";

export type AiFn = (e: Entity, dt: number, s: Scene) => void;
type Handler = (other: Entity, self: Entity) => void;

export interface EntityOpts {
  /** A built-in shape drawn by the engine: ship, rock, ball, paddle, block, coin, bullet, character, drone, orb, crystal, tank, car, tree, building, boss, star, pillar, wall. */
  shape?: string;
  color?: string;
  color2?: string;
  /** Visual scale multiplier (the shape is drawn at its radius × size). */
  size?: number;
  /** [x,y] in 2D; [x,z] or [x,y,z] in 3D. */
  at?: number[];
  vel?: number[];
  rot?: number;
  /** Collision circle/sphere radius. */
  radius?: number;
  /** Collision box [w,h] (2D) or [w,h,d] (3D, h is height). */
  box?: number[];
  tags?: string[];
  name?: string;
  /** Units per second for controls and AI. */
  speed?: number;
  accel?: number;
  controls?: Scheme;
  /** Lock control movement to one axis (paddles). */
  axis?: "x" | "y";
  player?: number;
  hp?: number;
  /** Remove after N seconds, or when "offscreen" (2D) / out of bounds. */
  dies?: "offscreen" | "bounds" | number;
  /** What happens at the world edge. */
  bounds?: "clamp" | "wrap" | "bounce" | "die" | "none";
  /** Solid things push each other apart. Static ones never move (walls). A list of tags: solid only against those (["wall"]). */
  solid?: boolean | string[];
  static?: boolean;
  mass?: number;
  /** 0..1: how much speed is kept when bouncing off solids/edges. */
  bounce?: number;
  gravity?: number;
  /** Jump speed for controls "platformer". */
  jump?: number;
  /** Fraction of speed lost per second (0 = none, 3 = strong). */
  drag?: number;
  maxSpeed?: number;
  /** Turn to face the movement ("move"), the aim ("aim"), keep ("none"), or "spin". */
  face?: "move" | "aim" | "none";
  spin?: number;
  ai?: AiFn | AiFn[];
  /** 2D: custom drawing (ctx is at the entity's position and rotation). */
  draw?: (ctx: CanvasRenderingContext2D, e: Entity) => void;
  /** 3D: a custom three.js Object3D. */
  mesh?: any;
  /** Emissive glow (3D bloom / 2D shadow blur), 0..3. */
  glow?: number;
  /** 3D height above the floor. */
  height?: number;
  /** No visual at all (invisible colliders, triggers). */
  hidden?: boolean;
  /** 3D: hide the mesh beyond this distance from the camera (big worlds). */
  cull?: number;
  /** 3D: a standing capsule [radius, height] for raycasts and the height check (people). */
  capsule?: [number, number];
  /** Ignores slow motion (the player in bullet time). */
  unscaled?: boolean;
  /** Draw order in 2D (higher on top). */
  layer?: number;
  /** Leave a fading trail of particles. */
  trail?: boolean | { color?: string; every?: number; size?: number };
  data?: Record<string, any>;
}

let NEXT_ID = 1;

export class Entity {
  readonly id = NEXT_ID++;
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  /** Previous step's position and rotation, for smooth drawing between steps. */
  ox = 0; oy = 0; oz = 0; orot = 0;
  rot = 0;
  radius: number;
  box?: number[];
  tags: Set<string>;
  name?: string;
  hp: number;
  maxHp: number;
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
  aim: [number, number] = [1, 0];
  data: Record<string, any>;
  opts: EntityOpts;
  /** Renderer-owned visual (three.js object in 3D). */
  visual: any = null;
  scene!: Scene;
  moved = false;
  contacts = new Set<number>();
  private sx = 0; private sy = 0; private sz = 0;
  _tick: ((dt: number, e: Entity) => void)[] = [];
  _hit = new Map<string, Handler[]>();
  _overlap = new Map<string, Handler[]>();
  _die: ((e: Entity, why: string) => void)[] = [];
  _damage: ((n: number, from: Entity | undefined, e: Entity) => void)[] = [];
  _ai: AiFn[];
  _trailT = 0;
  diedBecause = "";

  constructor(o: EntityOpts) {
    this.opts = o;
    this.radius = o.radius ?? (o.box ? Math.max(o.box[0], o.box[o.box.length - 1]) / 2 : 1);
    this.box = o.box;
    this.tags = new Set(o.tags ?? []);
    this.name = o.name;
    this.hp = this.maxHp = o.hp ?? 1;
    this.rot = this.orot = o.rot ?? 0;
    this.data = { ...(o.data ?? {}) };
    this._ai = o.ai ? (Array.isArray(o.ai) ? o.ai : [o.ai]) : [];
  }

  /** Called by the scene when added. */
  _place(mode: "2d" | "3d") {
    const a = this.opts.at ?? [0, 0];
    const v = this.opts.vel ?? [0, 0];
    if (mode === "2d") {
      this.x = a[0]; this.y = a[1] ?? 0;
      this.vx = v[0] ?? 0; this.vy = v[1] ?? 0;
    } else {
      const ground = this.opts.height ?? (this.box ? this.box[1] / 2 : this.radius);
      if (a.length >= 3) { this.x = a[0]; this.y = a[1]; this.z = a[2]; }
      else { this.x = a[0]; this.y = ground; this.z = a[1] ?? 0; }
      if (v.length >= 3) { this.vx = v[0]; this.vy = v[1]; this.vz = v[2]; }
      else { this.vx = v[0] ?? 0; this.vz = v[1] ?? 0; }
    }
    this.ox = this.x; this.oy = this.y; this.oz = this.z;
    this.sx = this.x; this.sy = this.y; this.sz = this.z;
  }
  _checkMoved(eps: number) {
    if (this.moved) return;
    const d = Math.abs(this.x - this.sx) + Math.abs(this.y - this.sy) + Math.abs(this.z - this.sz);
    if (d > eps) this.moved = true;
  }

  get is3d() { return this.scene?.g.mode === "3d"; }
  /** Position on the play plane: [x,y] in 2D, [x,z] in 3D. */
  get p(): [number, number] { return this.is3d ? [this.x, this.z] : [this.x, this.y]; }
  set p(v: [number, number]) { this.x = v[0]; if (this.is3d) this.z = v[1]; else this.y = v[1]; }
  /** Velocity on the play plane. */
  get v(): [number, number] { return this.is3d ? [this.vx, this.vz] : [this.vx, this.vy]; }
  set v(v: [number, number]) { this.vx = v[0]; if (this.is3d) this.vz = v[1]; else this.vy = v[1]; }
  get speedNow() { const [a, b] = this.v; return Math.hypot(a, b); }
  get speed() { return this.opts.speed ?? 0; }
  set speed(s: number) { this.opts.speed = s; }

  has(tag: string) { return this.tags.has(tag); }
  tag(...t: string[]) { t.forEach((x) => this.tags.add(x)); return this; }
  untag(...t: string[]) { t.forEach((x) => this.tags.delete(x)); return this; }

  /**
   * e.on("hit", "enemy", fn)      once when touching starts
   * e.on("overlap", "zone", fn)   every step while touching
   * e.on("tick", fn(dt))          every step
   * e.on("die", fn(e, why))       when it dies
   * e.on("damage", fn(n, from))   when damaged
   */
  on(ev: "hit" | "overlap", tag: string, fn: Handler): this;
  on(ev: "tick", fn: (dt: number, e: Entity) => void): this;
  on(ev: "die", fn: (e: Entity, why: string) => void): this;
  on(ev: "damage", fn: (n: number, from: Entity | undefined, e: Entity) => void): this;
  on(ev: string, a: any, b?: any): this {
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
  damage(n = 1, from?: Entity): number {
    if (!this.alive || this.invuln > 0) return this.hp;
    this.hp -= n;
    this.flashT = 0.08;
    for (const f of this._damage) f(n, from, this);
    if (this.hp <= 0) this.die("killed");
    return this.hp;
  }
  heal(n = 1) { this.hp = Math.min(this.maxHp, this.hp + n); return this.hp; }

  die(why = "removed") {
    if (!this.alive) return;
    this.alive = false;
    this.diedBecause = why;
    for (const f of this._die) f(this, why);
  }

  /** Plane distance to another entity or point. */
  dist(o: Entity | [number, number]) {
    const [a, b] = this.p;
    const [c, d] = o instanceof Entity ? o.p : o;
    return Math.hypot(c - a, d - b);
  }
  /** Unit direction on the plane toward another entity or point. */
  dirTo(o: Entity | [number, number]): [number, number] {
    const [a, b] = this.p;
    const [c, d] = o instanceof Entity ? o.p : o;
    const l = Math.hypot(c - a, d - b) || 1;
    return [(c - a) / l, (d - b) / l];
  }
  angleTo(o: Entity | [number, number]) {
    const [a, b] = this.dirTo(o);
    return Math.atan2(b, a);
  }
  /** Set plane velocity toward a direction at a speed (default: own speed). */
  go(dir: [number, number], speed = this.speed) {
    this.v = [dir[0] * speed, dir[1] * speed];
    return this;
  }
  /** Add an impulse to the plane velocity. */
  push(a: number, b: number) {
    const [x, y] = this.v;
    this.v = [x + a, y + b];
    return this;
  }
  /** Point in front of the entity (plane), d units away along its facing or aim. */
  ahead(d = 1, useAim = false): [number, number] {
    const [a, b] = this.p;
    const [ux, uy] = useAim ? this.aim : [Math.cos(this.rot), Math.sin(this.rot)];
    return [a + ux * d, b + uy * d];
  }
}
