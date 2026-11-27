// Builds Nyota City: ground, towers (instanced, shader facades), buildings you can walk into
// (merged walls with real door gaps, interiors with props and lights), a parking garage with a
// ramp to its roof, compounds, a plaza, parks, street furniture, and the colliders, surfaces,
// cover points and navigation grid that the people in it use.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { rng } from "kimi/game";
import { N, HALF, PITCH, LOT, WALK, roadCentre, blockCentre, USE, PLACES, hash2 } from "./layout.js";
import { groundMaterial, facadeMaterial, STYLE_WALL, M, adTexture, AD_COUNT, canvasTexture } from "./materials.js";

// ---------------------------------------------------------------------------
// Geometry builder: boxes and quads with world-scaled UVs, sorted by material.
// ---------------------------------------------------------------------------
class Builder {
  constructor() { this.parts = new Map(); }
  part(key) {
    let p = this.parts.get(key);
    if (!p) { p = { pos: [], nrm: [], uv: [], idx: [] }; this.parts.set(key, p); }
    return p;
  }
  quad(key, a, b, c, d, n, tile = 2) {
    const p = this.part(key);
    const base = p.pos.length / 3;
    for (const v of [a, b, c, d]) {
      p.pos.push(v[0], v[1], v[2]);
      p.nrm.push(n[0], n[1], n[2]);
      // world-scaled UVs from the two axes the face spans
      if (Math.abs(n[0]) > 0.5) p.uv.push(v[2] / tile, v[1] / tile);
      else if (Math.abs(n[1]) > 0.5) p.uv.push(v[0] / tile, v[2] / tile);
      else p.uv.push(v[0] / tile, v[1] / tile);
    }
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Axis-aligned box from min corner to max corner. faces: { px, nx, py, ny, pz, nz } → material key or null. */
  box(x0, y0, z0, x1, y1, z1, faces, tile = 2) {
    const f = typeof faces === "string" ? { px: faces, nx: faces, py: faces, ny: faces, pz: faces, nz: faces } : faces;
    if (f.px) this.quad(f.px, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], tile);
    if (f.nx) this.quad(f.nx, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], tile);
    if (f.py) this.quad(f.py, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], tile);
    if (f.ny) this.quad(f.ny, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], tile);
    if (f.pz) this.quad(f.pz, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], tile);
    if (f.nz) this.quad(f.nz, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], tile);
  }
  /** A sloped quad (ramps): corners in order, normal computed. */
  slope(key, a, b, c, d, tile = 2) {
    const u = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const v = new THREE.Vector3(...d).sub(new THREE.Vector3(...a));
    const n = new THREE.Vector3().crossVectors(v, u).normalize();
    this.quad(key, a, b, c, d, [n.x, n.y, n.z], tile);
  }
  meshes(materials) {
    const out = [];
    for (const [key, p] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(p.nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
      g.setIndex(p.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials[key] ?? M.concrete());
      m.castShadow = m.receiveShadow = true;
      m.name = key;
      out.push(m);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Instanced things
// ---------------------------------------------------------------------------
class Instancer {
  constructor(geometry, material, opts = {}) {
    this.geometry = geometry; this.material = material; this.list = []; this.opts = opts;
  }
  add(x, y, z, sx = 1, sy = 1, sz = 1, rotY = 0, color = null) { this.list.push({ x, y, z, sx, sy, sz, rotY, color }); }
  build() {
    const im = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, this.list.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    this.list.forEach((t, i) => {
      q.setFromEuler(e.set(0, t.rotY, 0));
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.sx, t.sy, t.sz));
      im.setMatrixAt(i, m);
      if (t.color) im.setColorAt(i, new THREE.Color(...t.color));
    });
    im.count = this.list.length;
    im.castShadow = this.opts.shadow !== false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }
}
const unitBox = () => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; };

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------
export class World {
  constructor(g, scene, plan, sky) {
    this.g = g; this.scene = scene; this.plan = plan; this.sky = sky;
    this.root = new THREE.Group();
    this.three = g.three.scene;
    this.b = new Builder();
    this.r = rng(plan.seed);
    this.surfaces = [];      // walkable/drivable heights above the ground
    this.covers = [];        // [x, z, nx, nz] points beside low obstacles
    this.interiors = [];     // { x, z, w, d, h, light positions }
    this.spots = {};         // named places for missions
    this.pickupSpots = [];   // where weapons/ammo/armour can lie
    this.parking = [];       // where parked cars go: [x, z, rot]
    this.sidewalkLoops = []; // pedestrian loops per block
    this.lampLights = [];    // positions of street lamps (for the pool of real lights)
    this.colliders = [];
    this.inst = {
      glass: new Instancer(unitBox(), facadeMaterial("glass")),
      concrete: new Instancer(unitBox(), facadeMaterial("concrete")),
      plaster: new Instancer(unitBox(), facadeMaterial("plaster")),
      brick: new Instancer(unitBox(), facadeMaterial("brick")),
    };
    this.props = {};
    this.build();
  }

  // ---------- colliders and surfaces ----------
  /** A static box collider (min/max corners in world space). */
  solid(x0, y0, z0, x1, y1, z1, tags = ["wall"]) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const e = this.scene.add({ at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], box: [w, h, d], tags, solid: true, static: true, hidden: true });
    this.colliders.push({ x0, y0, z0, x1, y1, z1, e });
    if (h >= 0.9 && y0 < 0.5 && w < 14 && d < 14) this.addCover(x0, z0, x1, z1);
    return e;
  }
  /** Something rays hit but bodies don't bump into (roof slabs people stand on). */
  slab(x0, y0, z0, x1, y1, z1) {
    return this.scene.add({ at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], box: [x1 - x0, y1 - y0, z1 - z0], tags: ["prop", "slab"], static: true, hidden: true });
  }
  /** A round static collider (poles, trunks). */
  post(x, z, r, h = 4, tags = ["prop"]) {
    return this.scene.add({ at: [x, h / 2, z], radius: r, capsule: [r, h], height: h / 2, tags, solid: true, static: true, hidden: true });
  }
  addCover(x0, z0, x1, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, o = 0.7;
    this.covers.push([x0 - o, cz, -1, 0], [x1 + o, cz, 1, 0], [cx, z0 - o, 0, -1], [cx, z1 + o, 0, 1]);
  }
  /** Highest surface under (x,z) not more than `step` above y (feet height). */
  groundAt(x, z, y = 0, step = 0.75) {
    let best = 0;
    for (const s of this.surfaces) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      let h = s.y;
      if (s.ramp) {
        const t = s.ramp === "z" ? (z - s.z0) / (s.z1 - s.z0) : (x - s.x0) / (s.x1 - s.x0);
        h = s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, t));
      }
      if (h <= y + step && h > best) best = h;
    }
    return best;
  }

  // ---------- build ----------
  build() {
    const { three } = this;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600, 1, 1), groundMaterial(this.plan));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    three.add(ground);
    this.ground = ground;

    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) this.block(i, j, this.plan.use[i][j]);
    this.streets();
    this.edges();
    this.mountains();

    // merged static geometry
    const mats = {
      concrete: M.concrete(), dark: M.darkConcrete(), plaster: M.plaster(), metal: M.metal(), darkMetal: M.darkMetal(),
      wood: M.wood(), tile: M.tile(), glass: M.glass(),
      shopFacade: facadeMaterial("plaster", { height: 5.2 }),
      brickFacade: facadeMaterial("brick", { height: 8.5 }),
      lobbyFacade: facadeMaterial("concrete", { height: 6.5 }),
      lamp: M.lampOn(),
      ceilLamp: (() => { const m = M.lampOn().clone(); m.userData.night = 3; m.emissive.set(0xfff1d6); return m; })(),
      corrugated: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.7,
        map: canvasTexture(64, 64, (c, w, h) => { for (let x = 0; x < w; x += 8) { const gr = c.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, "#777"); gr.addColorStop(0.5, "#ddd"); gr.addColorStop(1, "#777"); c.fillStyle = gr; c.fillRect(x, 0, 8, h); } }) }),
    };
    this.sky.lamps.push(mats.lamp, mats.ceilLamp);
    for (const m of this.b.meshes(mats)) three.add(m);
    for (const [k, inst] of Object.entries(this.inst)) { const im = inst.build(); im.name = "towers-" + k; three.add(im); }
    for (const [k, inst] of Object.entries(this.props)) { const im = inst.build(); im.name = "props-" + k; three.add(im); }
    this.buildNav();
  }

  /** An instanced prop kind, made once (mat may be a function so it is only built the first time). */
  prop(name, make, mat, opts) {
    if (!this.props[name]) this.props[name] = new Instancer(make(), typeof mat === "function" ? mat() : mat, opts);
    return this.props[name];
  }

  /** A tower or block of flats drawn with the instanced facade shader (not enterable). */
  tower(x0, z0, x1, z1, h, style, y0 = 0) {
    const w = x1 - x0, d = z1 - z0;
    const wall = STYLE_WALL[style];
    const tint = 0.85 + this.r.next() * 0.3;
    const col = style === "glass" ? [wall[0] * tint, wall[1] * tint, wall[2] * tint] : wall.map((c) => Math.min(1, c * tint));
    this.inst[style].add((x0 + x1) / 2, y0, (z0 + z1) / 2, w, h, d, 0, col);
    this.solid(x0, y0, z0, x1, y0 + h, z1, ["wall", "building"]);
    // rooftop things
    if (h < 45 && w > 8 && d > 8) {
      const ac = this.prop("ac", () => { const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.08); g.translate(0, 0.5, 0); return g; }, M.metal());
      const n = 1 + Math.floor(this.r.next() * 3);
      for (let k = 0; k < n; k++) ac.add(x0 + 2 + this.r.next() * (w - 4), y0 + h, z0 + 2 + this.r.next() * (d - 4), 1.6, 1.1, 1.2);
      if (this.r.next() < 0.45) {
        const tank = this.prop("tank", () => { const g = new THREE.CylinderGeometry(0.9, 0.9, 1.8, 14); g.translate(0, 0.9, 0); return g; }, new THREE.MeshStandardMaterial({ color: 0x1f2a36, roughness: 0.6 }));
        tank.add(x0 + 3, y0 + h, z1 - 3);
      }
    } else if (h >= 45) {
      const ant = this.prop("antenna", () => { const g = new THREE.CylinderGeometry(0.08, 0.15, 1, 6); g.translate(0, 0.5, 0); return g; }, M.darkMetal());
      ant.add((x0 + x1) / 2, y0 + h, (z0 + z1) / 2, 1, 6 + this.r.next() * 8, 1);
      const beacon = this.prop("beacon", () => new THREE.SphereGeometry(0.25, 8, 6), () => { const m = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 }); m.userData.night = 8; this.sky.lamps.push(m); return m; }, { shadow: false });
      beacon.add((x0 + x1) / 2, y0 + h + 14, (z0 + z1) / 2);
    }
    // billboards on some mid-rise roofs
    if (h > 10 && h < 40 && this.r.next() < 0.18) this.billboard((x0 + x1) / 2, y0 + h, z0 + 1, Math.floor(this.r.next() * AD_COUNT));
  }

  billboard(x, y, z, ad) {
    const frame = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshStandardMaterial({ map: adTexture(ad), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, roughness: 0.5 }));
    panel.material.emissiveMap = panel.material.map;
    panel.material.userData.night = 0.9;
    this.sky.lamps.push(panel.material);
    panel.position.set(0, 4.5, 0);
    panel.rotation.y = Math.PI;
    const back = new THREE.Mesh(new THREE.BoxGeometry(10.4, 5.4, 0.3), M.darkMetal());
    back.position.set(0, 4.5, 0.2);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3), M.darkMetal());
    legs.position.set(-3, 1, 0.2);
    const legs2 = legs.clone(); legs2.position.x = 3;
    frame.add(panel, back, legs, legs2);
    frame.position.set(x, y, z);
    frame.traverse((o) => { o.castShadow = true; });
    this.three.add(frame);
  }

  /**
   * A building you can walk into. Walls are merged quads with real door gaps (facade outside,
   * plaster inside), each wall run is a collider, and the inside gets a floor, ceiling and lights.
   * doors: [{ side: "n"|"s"|"e"|"w", at: offset along the wall from its centre, width }]
   */
  room(x0, z0, x1, z1, h, doors, o = {}) {
    const t = 0.35;
    const outKey = o.facade ?? "shopFacade", inKey = o.inside ?? "plaster";
    const sides = {
      s: { a: [x0, z0], b: [x1, z0], out: "nz" }, n: { a: [x0, z1], b: [x1, z1], out: "pz" },
      w: { a: [x0, z0], b: [x0, z1], out: "nx" }, e: { a: [x1, z0], b: [x1, z1], out: "px" },
    };
    for (const [side, s] of Object.entries(sides)) {
      const alongX = side === "s" || side === "n";
      const len = alongX ? x1 - x0 : z1 - z0;
      const gaps = doors.filter((d) => d.side === side).map((d) => [len / 2 + (d.at ?? 0) - d.width / 2, len / 2 + (d.at ?? 0) + d.width / 2, d]);
      gaps.sort((a, b) => a[0] - b[0]);
      const runs = [];
      let cur = 0;
      for (const [g0, g1] of gaps) { if (g0 > cur) runs.push([cur, g0]); cur = g1; }
      if (cur < len) runs.push([cur, len]);
      const faces = (outward) => ({ px: outward === "px" ? outKey : inKey, nx: outward === "nx" ? outKey : inKey, pz: outward === "pz" ? outKey : inKey, nz: outward === "nz" ? outKey : inKey, py: "dark", ny: null });
      for (const [r0, r1] of runs) {
        let bx0, bz0, bx1, bz1;
        if (alongX) { bx0 = s.a[0] + r0; bx1 = s.a[0] + r1; bz0 = s.a[1] - t / 2; bz1 = s.a[1] + t / 2; }
        else { bz0 = s.a[1] + r0; bz1 = s.a[1] + r1; bx0 = s.a[0] - t / 2; bx1 = s.a[0] + t / 2; }
        const glass = o.glassSide === side;
        if (glass) {
          this.b.box(bx0, 0, bz0, bx1, h, bz1, { px: "glass", nx: "glass", pz: "glass", nz: "glass", py: "dark" });
          // mullions
          for (let k = 0; k <= (r1 - r0) / 3; k++) {
            const m = r0 + k * 3;
            if (alongX) this.b.box(s.a[0] + m - 0.08, 0, bz0 - 0.05, s.a[0] + m + 0.08, h, bz1 + 0.05, "darkMetal");
            else this.b.box(bx0 - 0.05, 0, s.a[1] + m - 0.08, bx1 + 0.05, h, s.a[1] + m + 0.08, "darkMetal");
          }
        } else this.b.box(bx0, 0, bz0, bx1, h, bz1, faces(s.out));
        this.solid(bx0, 0, bz0, bx1, h, bz1, ["wall"]);
      }
      // lintel above each door, and a roller shutter rolled up on wide doors
      for (const [g0, g1, d] of gaps) {
        const top = d.height ?? Math.min(h, d.width > 4 ? 4.6 : 2.8);
        if (top < h) {
          if (alongX) this.b.box(s.a[0] + g0, top, s.a[1] - t / 2, s.a[0] + g1, h, s.a[1] + t / 2, faces(s.out));
          else this.b.box(s.a[0] - t / 2, top, s.a[1] + g0, s.a[0] + t / 2, h, s.a[1] + g1, faces(s.out));
        }
        if (d.width > 4) {
          if (alongX) this.b.box(s.a[0] + g0, top - 0.6, s.a[1] - t, s.a[0] + g1, top, s.a[1] + t, "corrugated");
          else this.b.box(s.a[0] - t, top - 0.6, s.a[1] + g0, s.a[0] + t, top, s.a[1] + g1, "corrugated");
        }
        // remember door centres for navigation and missions
        const along = (g0 + g1) / 2;
        const p = alongX ? [s.a[0] + along, s.a[1]] : [s.a[0], s.a[1] + along];
        (this.doors ??= []).push(p);
      }
    }
    // floor, ceiling, roof
    this.b.box(x0, 0.0, z0, x1, 0.03, z1, { py: o.floor ?? "tile" }, 2);
    this.b.box(x0 - t / 2, h, z0 - t / 2, x1 + t / 2, h + 0.4, z1 + t / 2, { py: "dark", ny: "plaster", px: outKey, nx: outKey, pz: outKey, nz: outKey });
    // ceiling lamps
    const lamps = [];
    const nx = Math.max(1, Math.round((x1 - x0) / 8)), nz = Math.max(1, Math.round((z1 - z0) / 8));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = x0 + ((i + 0.5) * (x1 - x0)) / nx, lz = z0 + ((j + 0.5) * (z1 - z0)) / nz;
      this.b.box(lx - 0.6, h - 0.08, lz - 0.25, lx + 0.6, h, lz + 0.25, { ny: "ceilLamp", px: "metal", nx: "metal", pz: "metal", nz: "metal" });
      lamps.push([lx, h - 0.4, lz]);
    }
    const room = { x0, z0, x1, z1, h, lamps, name: o.name };
    this.interiors.push(room);
    return room;
  }

  crate(x, z, s = 1.2, stack = 1, tags = ["prop", "cover"]) {
    const c = this.prop("crate", () => { const g = new RoundedBoxGeometry(1, 1, 1, 1, 0.04); g.translate(0, 0.5, 0); return g; }, M.wood());
    for (let k = 0; k < stack; k++) c.add(x, k * s, z, s, s, s, (hash2(x, z + k) - 0.5) * 0.4);
    this.solid(x - s / 2, 0, z - s / 2, x + s / 2, s * stack, z + s / 2, tags);
  }
  container(x, z, rotX, color) {
    const c = this.prop("container", () => unitBox(), () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.5,
      map: canvasTexture(128, 64, (cx, w, h) => { cx.fillStyle = "#ddd"; cx.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 6) { cx.fillStyle = x % 12 ? "#bbb" : "#f2f2f2"; cx.fillRect(x, 0, 3, h); } }) }));
    const [w, d] = rotX ? [6, 2.5] : [2.5, 6];
    c.add(x, 0, z, w, 2.6, d, 0, color);
    this.solid(x - w / 2, 0, z - d / 2, x + w / 2, 2.6, z + d / 2, ["wall", "cover"]);
  }
  barrier(x, z, rotX) {
    const b = this.prop("barrier", () => { const g = new THREE.CylinderGeometry(0.25, 0.4, 0.9, 4, 1); g.rotateY(Math.PI / 4); g.scale(1, 1, 1); g.translate(0, 0.45, 0); return g; }, M.concrete());
    const [w, d] = rotX ? [2.2, 0.6] : [0.6, 2.2];
    b.add(x, 0, z, w * 1.4, 1, d * 1.4);
    this.solid(x - w / 2, 0, z - d / 2, x + w / 2, 0.95, z + d / 2, ["prop", "cover"]);
  }
  tree(x, z, s = 1) {
    const trunk = this.prop("trunk", () => { const g = new THREE.CylinderGeometry(0.16, 0.26, 1, 7); g.translate(0, 0.5, 0); return g; }, M.trunk());
    trunk.add(x, 0, z, s, 3.2 * s, s);
    const crown = this.prop("crown", () => {
      // acacia-like flat crowns and rounder ones, displaced for a hand-made look
      const parts = [];
      for (let k = 0; k < 3; k++) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) { const n = 0.8 + 0.35 * hash2(i * 7 + k, i * 3); p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.6, p.getZ(i) * n); }
        g.translate((k - 1) * 0.9, k === 1 ? 0.35 : 0, (k % 2) * 0.6 - 0.3);
        parts.push(g.index ? g.toNonIndexed() : g);
      }
      const m = mergeGeometries(parts);
      m.computeVertexNormals();
      m.translate(0, 3.6, 0);
      return m;
    }, M.foliage());
    crown.add(x, 0, z, s * 1.25, s, s * 1.25, hash2(x, z) * 6.28, [0.75 + hash2(z, x) * 0.4, 0.85 + hash2(x + 1, z) * 0.3, 0.7]);
    this.post(x, z, 0.3 * s, 3.5, ["prop", "tree"]);
  }
  lamp(x, z, rot) {
    const pole = this.prop("lampPole", () => {
      const a = new THREE.CylinderGeometry(0.07, 0.11, 7, 8); a.translate(0, 3.5, 0);
      const b = new THREE.BoxGeometry(1.8, 0.1, 0.12); b.translate(0.85, 7, 0);
      return mergeGeometries([a, b]);
    }, M.darkMetal());
    pole.add(x, 0, z, 1, 1, 1, rot);
    const head = this.prop("lampHead", () => { const g = new THREE.BoxGeometry(0.6, 0.12, 0.3); g.translate(1.6, 6.9, 0); return g; }, M.lampOn(), { shadow: false });
    head.add(x, 0, z, 1, 1, 1, rot);
    this.lampLights.push([x + Math.cos(-rot) * 1.6, 6.6, z + Math.sin(-rot) * 1.6]);
    this.post(x, z, 0.15, 7, ["prop", "pole"]);
  }
  bench(x, z, rot) {
    const b = this.prop("bench", () => {
      const s = new THREE.BoxGeometry(1.8, 0.08, 0.45); s.translate(0, 0.45, 0);
      const back = new THREE.BoxGeometry(1.8, 0.4, 0.06); back.translate(0, 0.75, -0.2);
      const l1 = new THREE.BoxGeometry(0.08, 0.45, 0.45); l1.translate(-0.8, 0.22, 0);
      const l2 = l1.clone(); l2.translate(1.6, 0, 0);
      return mergeGeometries([s, back, l1, l2]);
    }, M.wood());
    b.add(x, 0, z, 1, 1, 1, rot);
  }
  kiosk(x, z, rot, color) {
    // a market kiosk: counter, posts and a sloped mabati roof
    const g = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1.05, 1.4), M.wood());
    counter.position.y = 0.52;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 2.6), new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.6 }));
    roof.position.set(0, 2.5, 0.2); roof.rotation.x = 0.15;
    g.add(counter, roof);
    for (const px of [-1.6, 1.6]) for (const pz of [-0.9, 1.2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), M.darkMetal());
      p.position.set(px, 1.25, pz); g.add(p);
    }
    // goods on the counter
    for (let k = 0; k < 6; k++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hash2(x + k, z), 0.7, 0.5), roughness: 0.6 }));
      box.position.set(-1.2 + k * 0.48, 1.18, -0.2); g.add(box);
    }
    g.position.set(x, 0, z); g.rotation.y = rot;
    g.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    this.three.add(g);
    const c = Math.abs(Math.sin(rot)) > 0.5;
    this.solid(x - (c ? 0.7 : 1.5), 0, z - (c ? 1.5 : 0.7), x + (c ? 0.7 : 1.5), 1.05, z + (c ? 1.5 : 0.7), ["prop", "cover"]);
  }

  // ---------- blocks ----------
  block(i, j, use) {
    const cx = blockCentre(i), cz = blockCentre(j);
    const x0 = cx - LOT / 2, x1 = cx + LOT / 2, z0 = cz - LOT / 2, z1 = cz + LOT / 2;
    const r = this.r;
    const key = `${i},${j}`;
    const isPlace = (k) => PLACES[k][0] === i && PLACES[k][1] === j;
    // pedestrians walk around every block on the sidewalk
    const sw = PITCH / 2 - WALK + 2;
    this.sidewalkLoops.push([[cx - sw, cz - sw], [cx + sw, cz - sw], [cx + sw, cz + sw], [cx - sw, cz + sw]]);

    if (use === USE.towers) {
      const split = r.next() < 0.5;
      if (split) {
        const m = x0 + LOT * (0.4 + r.next() * 0.2);
        this.tower(x0, z0, m - 3, z1, 40 + r.next() * 60, r.pick(["glass", "glass", "concrete"]));
        this.tower(m + 3, z0, x1, z1, 30 + r.next() * 50, r.pick(["glass", "concrete"]));
      } else {
        const inset = 4 + r.next() * 6;
        this.tower(x0 + inset, z0 + inset, x1 - inset, z1 - inset, 55 + r.next() * 50, "glass");
        this.parking.push([x0 + 2, z0 + 1.5, 0], [x1 - 6, z0 + 1.5, 0]);
      }
    } else if (use === USE.midrise || use === USE.lowrise) {
      const nSub = use === USE.midrise ? 2 : 3;
      const cell = LOT / nSub;
      for (let a = 0; a < nSub; a++) for (let b = 0; b < nSub; b++) {
        if (use === USE.lowrise && r.next() < 0.2) { this.tree(x0 + (a + 0.5) * cell, z0 + (b + 0.5) * cell, 1.2); continue; }
        const gap = use === USE.midrise ? 2.5 : 3;
        const h = use === USE.midrise ? 12 + r.next() * 22 : 5 + r.next() * 6;
        this.tower(x0 + a * cell + gap, z0 + b * cell + gap, x0 + (a + 1) * cell - gap, z0 + (b + 1) * cell - gap, h, r.pick(use === USE.midrise ? ["concrete", "plaster", "brick"] : ["plaster", "plaster", "brick"]));
      }
    } else if (use === USE.park) {
      for (let k = 0; k < 14; k++) {
        const a = r.next() * Math.PI * 2, d = 6 + r.next() * 18;
        const tx = cx + Math.cos(a) * d, tz = cz + Math.sin(a) * d;
        if (Math.abs(tx - cx) < 3 || Math.abs(tz - cz) < 3 || Math.abs(Math.hypot(tx - cx, tz - cz) - 12) < 2.5) continue;
        this.tree(tx, tz, 0.9 + r.next() * 0.7);
      }
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; this.bench(cx + Math.cos(a) * 14.2, cz + Math.sin(a) * 14.2, -a - Math.PI / 2); }
      this.fountain(cx, cz, 3.5);
    } else if (use === USE.plaza) {
      this.plaza(cx, cz);
    } else if (use === USE.compound) {
      this.compound(cx, cz, x0, z0, x1, z1, isPlace("compound"));
    } else if (use === USE.shops) {
      this.shopRow(cx, cz, x0, z0, x1, z1, isPlace("safehouse"), isPlace("market"));
    } else if (use === USE.garage) {
      this.garage(cx, cz, x0, z0, x1, z1);
    } else if (use === USE.gangTower) {
      this.gangTower(cx, cz, x0, z0, x1, z1);
    }
    void key;
  }

  fountain(x, z, r) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 10, 40), M.concrete());
    rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.45, z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshStandardMaterial({ color: 0x1d4f6b, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.5 }));
    water.rotation.x = -Math.PI / 2; water.position.set(x, 0.55, z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 2.4, 12), M.concrete());
    col.position.set(x, 1.2, z);
    for (const m of [rim, water, col]) { m.castShadow = m.receiveShadow = true; this.three.add(m); }
    this.solid(x - r, 0, z - r, x + r, 0.8, z + r, ["prop"]);
    this.post(x, z, 0.6, 2.4, ["prop"]);
    this.fountains = [...(this.fountains ?? []), [x, z]];
  }

  plaza(cx, cz) {
    // monument, kiosks, jersey barriers, planters: a square built for fights
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 1.2, 8), M.concrete());
    base.position.set(cx, 0.6, cz);
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.1, 14, 4), new THREE.MeshStandardMaterial({ color: 0xb7a58a, roughness: 0.7 }));
    obelisk.position.set(cx, 8.2, cz); obelisk.rotation.y = Math.PI / 4;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), (() => { const m = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0, metalness: 0.8, roughness: 0.2 }); m.userData.night = 3; this.sky.lamps.push(m); return m; })());
    star.position.set(cx, 15.8, cz);
    for (const m of [base, obelisk, star]) { m.castShadow = m.receiveShadow = true; this.three.add(m); }
    this.solid(cx - 3, 0, cz - 3, cx + 3, 1.2, cz + 3, ["prop", "cover"]);
    this.post(cx, cz, 1.1, 15, ["prop"]);
    const colors = [0xd62828, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xe9c46a, 0x6a4c93];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      this.kiosk(cx + Math.cos(a) * 19, cz + Math.sin(a) * 19, -a + Math.PI / 2, colors[k]);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.barrier(cx + Math.cos(a) * 11, cz + Math.sin(a) * 11, Math.abs(Math.cos(a)) < 0.5);
    }
    for (const [dx, dz] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) {
      this.b.box(cx + dx - 1.6, 0, cz + dz - 1.6, cx + dx + 1.6, 0.7, cz + dz + 1.6, "concrete");
      this.solid(cx + dx - 1.6, 0, cz + dz - 1.6, cx + dx + 1.6, 0.7, cz + dz + 1.6, ["prop", "cover"]);
      this.tree(cx + dx, cz + dz, 1.1);
    }
    this.spots.plaza = [cx, cz];
  }

  compound(cx, cz, x0, z0, x1, z1, mission) {
    // perimeter wall with a gate toward the road (south)
    const wh = 2.8, t = 0.4;
    const gate = 9;
    this.b.box(x0, 0, z1 - t, x1, wh, z1, "dark");
    this.solid(x0, 0, z1 - t, x1, wh, z1);
    this.b.box(x0, 0, z0, x0 + t, wh, z1, "dark"); this.solid(x0, 0, z0, x0 + t, wh, z1);
    this.b.box(x1 - t, 0, z0, x1, wh, z1, "dark"); this.solid(x1 - t, 0, z0, x1, wh, z1);
    this.b.box(x0, 0, z0, cx - gate / 2, wh, z0 + t, "dark"); this.solid(x0, 0, z0, cx - gate / 2, wh, z0 + t);
    this.b.box(cx + gate / 2, 0, z0, x1, wh, z0 + t, "dark"); this.solid(cx + gate / 2, 0, z0, x1, wh, z0 + t);
    // the warehouse
    const wx0 = cx - 15, wx1 = cx + 15, wz0 = cz + 2, wz1 = cz + 22;
    const room = this.room(wx0, wz0, wx1, wz1, 8.5, [{ side: "s", at: -6, width: 7 }, { side: "e", at: 4, width: 2.2 }], { facade: "brickFacade", inside: "concrete", floor: "concrete", name: "warehouse" });
    // shelving rows and crates inside: cover for a gunfight
    for (const sx of [-9, -3, 3, 9]) {
      this.b.box(cx + sx - 0.6, 0, cz + 9, cx + sx + 0.6, 3.2, cz + 17, { px: "metal", nx: "metal", py: "wood", pz: "metal", nz: "metal" });
      this.solid(cx + sx - 0.6, 0, cz + 9, cx + sx + 0.6, 3.2, cz + 17, ["wall", "cover"]);
    }
    this.crate(cx - 11, cz + 5, 1.2, 2); this.crate(cx + 12, cz + 6, 1.2, 1); this.crate(cx + 1, cz + 5.5, 1.4, 1);
    // yard: containers, crates, a parked truck spot
    const cols = [[0.75, 0.2, 0.15], [0.15, 0.35, 0.65], [0.2, 0.5, 0.3], [0.8, 0.55, 0.1]];
    this.container(cx - 18, cz - 10, false, cols[0]); this.container(cx - 13, cz - 14, true, cols[1]);
    this.container(cx + 16, cz - 8, false, cols[2]); this.container(cx + 10, cz - 15, true, cols[3]);
    this.crate(cx - 6, cz - 8); this.crate(cx + 5, cz - 6, 1.2, 2); this.crate(cx - 2, cz - 15);
    this.barrier(cx, cz - 19, true);
    const spot = { center: [cx, cz], gate: [cx, z0 - 2], inside: [cx, cz + 12], yard: [cx, cz - 9], room };
    if (mission) this.spots.compound = spot;
    (this.spots.compounds ??= []).push(spot);
    this.pickupSpots.push([cx + 13, cz + 20], [cx - 13, cz + 4]);
  }

  shopRow(cx, cz, x0, z0, x1, z1, safehouse, market) {
    // four shops along the south side, doors to the sidewalk; flats behind
    const w = LOT / 4;
    for (let k = 0; k < 4; k++) {
      const sx0 = x0 + k * w + 0.6, sx1 = x0 + (k + 1) * w - 0.6;
      const isSafe = safehouse && k === 3; // the east end: its garage door opens onto the sidewalk
      const doors = [{ side: "s", at: 0, width: isSafe ? 2.2 : 3 }];
      if (isSafe) doors.push({ side: "e", at: -1, width: 4.2 });
      const room = this.room(sx0, z0, sx1, z0 + 14, 5.2, doors, { name: isSafe ? "safehouse" : market ? "market" : "shop" });
      const mid = (sx0 + sx1) / 2;
      if (isSafe) {
        // the safehouse: a weapons locker, a sofa and a table
        this.b.box(sx0 + 0.4, 0, z0 + 11.4, sx0 + 3.6, 2.4, z0 + 13.6, { px: "darkMetal", nx: "darkMetal", py: "darkMetal", pz: "darkMetal", nz: "darkMetal" });
        this.solid(sx0 + 0.4, 0, z0 + 11.4, sx0 + 3.6, 2.4, z0 + 13.6, ["wall", "locker"]);
        this.b.box(sx1 - 3.5, 0, z0 + 10.5, sx1 - 0.6, 0.8, z0 + 12.2, "wood");
        this.solid(sx1 - 3.5, 0, z0 + 10.5, sx1 - 0.6, 0.8, z0 + 12.2, ["prop", "cover"]);
        this.spots.safehouse = { door: [mid, z0 - 2], inside: [mid, z0 + 6], locker: [sx0 + 2, z0 + 10.4], garage: [sx1 + 4, z0 + 6], room };
      } else {
        // counter and shelves
        this.b.box(sx0 + 1, 0, z0 + 6, sx1 - 1, 1.05, z0 + 7, { px: "wood", nx: "wood", py: "wood", pz: "wood", nz: "wood" });
        this.solid(sx0 + 1, 0, z0 + 6, sx1 - 1, 1.05, z0 + 7, ["prop", "cover"]);
        this.b.box(sx0 + 0.4, 0, z0 + 12.6, sx1 - 0.4, 2.6, z0 + 13.6, { pz: "wood", nz: "wood", py: "wood", px: "wood", nx: "wood" });
        this.solid(sx0 + 0.4, 0, z0 + 12.6, sx1 - 0.4, 2.6, z0 + 13.6);
        this.pickupSpots.push([mid, z0 + 10]);
      }
      if (market) (this.spots.market ??= []).push([mid, z0 - 2]);
    }
    // awning strip along the shopfronts
    this.b.box(x0, 3.3, z0 - 2.2, x1, 3.45, z0, { py: "darkMetal", ny: "darkMetal", nz: "darkMetal" });
    // flats behind
    this.tower(x0 + 2, z0 + 18, cx - 2, z1 - 2, 14 + this.r.next() * 14, this.r.pick(["concrete", "plaster"]));
    this.tower(cx + 2, z0 + 18, x1 - 2, z1 - 2, 10 + this.r.next() * 18, this.r.pick(["brick", "plaster"]));
    this.parking.push([x0 + 4, z0 - 5.4, 0], [x1 - 12, z0 - 5.4, 0]); // at the kerb, on the road
  }

  garage(cx, cz, x0, z0, x1, z1) {
    // a two-level parking structure: columns below, a roof deck at 8 m, a ramp up the east side
    const H = 8, gx0 = x0 + 2, gx1 = x1 - 2, gz0 = z0 + 2, gz1 = z1 - 2;
    const rampW = 7, rx0 = gx1 - rampW, rz0 = gz0 + 4, rz1 = gz1 - 2;
    // roof slab (with a hole over the ramp)
    this.b.box(gx0, H - 0.5, gz0, rx0, H, gz1, { py: "concrete", ny: "dark", px: "concrete", nx: "concrete", pz: "concrete", nz: "concrete" }, 4);
    this.b.box(rx0, H - 0.5, gz0, gx1, H, rz0, { py: "concrete", ny: "dark", px: "concrete", nz: "concrete", pz: "concrete" }, 4);
    this.b.box(rx0, H - 0.5, rz1, gx1, H, gz1, { py: "concrete", ny: "dark", px: "concrete", nz: "concrete", pz: "concrete" }, 4);
    this.surfaces.push({ x0: gx0, x1: rx0, z0: gz0, z1: gz1, y: H }, { x0: rx0, x1: gx1, z0: gz0, z1: rz0, y: H }, { x0: rx0, x1: gx1, z0: rz1, z1: gz1, y: H });
    this.slab(gx0, H - 0.5, gz0, rx0, H, gz1); this.slab(rx0, H - 0.5, gz0, gx1, H, rz0); this.slab(rx0, H - 0.5, rz1, gx1, H, gz1);
    // the ramp rises toward the south (from z = rz1 at the ground to rz0 at the roof)
    this.b.slope("concrete", [rx0, H, rz0], [gx1, H, rz0], [gx1, 0.02, rz1], [rx0, 0.02, rz1], 4);
    this.surfaces.push({ x0: rx0, x1: gx1, z0: rz0, z1: rz1, ramp: "z", y0: H, y1: 0 });
    // a wall under the low end of the ramp, so nobody walks or drives into its underside
    this.b.box(rx0 - 0.3, 0, rz1 - 14, rx0, 2.2, rz1, "concrete");
    this.solid(rx0 - 0.3, 0, rz1 - 14, rx0, 2.2, rz1, ["wall"]);
    // columns (and their colliders) under the deck
    for (let x = gx0 + 1; x < rx0 - 1; x += 8) for (let z = gz0 + 1; z < gz1; z += 9) {
      this.b.box(x - 0.35, 0, z - 0.35, x + 0.35, H - 0.5, z + 0.35, "concrete");
      this.solid(x - 0.35, 0, z - 0.35, x + 0.35, H - 0.5, z + 0.35, ["wall", "cover"]);
    }
    // parapets on the deck (they stop people and cars falling off, but only up there)
    const p = 1.1;
    const parapet = (a0, b0, a1, b1) => { this.b.box(a0, H, b0, a1, H + p, b1, "concrete"); this.solid(a0, H, b0, a1, H + p, b1, ["wall", "cover"]); };
    parapet(gx0, gz0, gx1, gz0 + 0.3);
    parapet(gx0, gz1 - 0.3, gx1, gz1);
    parapet(gx0, gz0, gx0 + 0.3, gz1);
    parapet(gx1 - 0.3, gz0, gx1, rz0);
    parapet(rx0 - 0.3, rz0, rx0, rz1); // inner edge of the ramp hole
    // deck lamps
    for (const [lx, lz] of [[gx0 + 4, gz0 + 4], [gx0 + 4, gz1 - 4], [rx0 - 6, gz1 - 4]]) {
      this.b.box(lx - 0.08, H, lz - 0.08, lx + 0.08, H + 4, lz + 0.08, "darkMetal");
      this.b.box(lx - 0.4, H + 4, lz - 0.2, lx + 0.4, H + 4.15, lz + 0.2, { ny: "lamp", py: "darkMetal" });
      this.lampLights.push([lx, H + 3.8, lz]);
    }
    this.spots.garage = { roof: [cx - 8, cz], rampFoot: [gx1 - rampW / 2, gz1 + 4], center: [cx, cz] };
    this.parking.push([gx0 + 5, gz0 + 6, Math.PI / 2], [gx0 + 13, gz0 + 6, Math.PI / 2], [gx0 + 5, gz1 - 6, Math.PI / 2]);
  }

  gangTower(cx, cz, x0, z0, x1, z1) {
    // Kivuli's tower: an enterable glass lobby with the tower standing on top of it
    const lx0 = cx - 15, lx1 = cx + 15, lz0 = cz - 12, lz1 = cz + 14, H = 6.5;
    const room = this.room(lx0, lz0, lx1, lz1, H, [{ side: "s", at: 0, width: 4 }, { side: "n", at: 8, width: 2.4 }], { facade: "lobbyFacade", inside: "concrete", floor: "tile", glassSide: "s", name: "lobby" });
    this.tower(lx0, lz0, lx1, lz1, 70, "glass", H + 0.4);
    for (const [px, pz] of [[-8, -4], [8, -4], [-8, 6], [8, 6]]) {
      this.b.box(cx + px - 0.6, 0, cz + pz - 0.6, cx + px + 0.6, H, cz + pz + 0.6, { px: "lobbyFacade", nx: "lobbyFacade", pz: "lobbyFacade", nz: "lobbyFacade" });
      this.solid(cx + px - 0.6, 0, cz + pz - 0.6, cx + px + 0.6, H, cz + pz + 0.6, ["wall", "cover"]);
    }
    this.b.box(cx - 4, 0, cz + 9, cx + 4, 1.1, cz + 10.5, { px: "darkMetal", nx: "darkMetal", py: "wood", pz: "darkMetal", nz: "darkMetal" });
    this.solid(cx - 4, 0, cz + 9, cx + 4, 1.1, cz + 10.5, ["prop", "cover"]);
    // a forecourt with barriers and parked cars
    for (const bx of [-10, -4, 4, 10]) this.barrier(cx + bx, z0 + 3, true);
    this.spots.gangTower = { door: [cx, lz0 - 3], inside: [cx, cz], court: [cx, z0 + 6], room };
    this.parking.push([x0 + 3, z0 + 1.5, 0], [x1 - 7, z0 + 1.5, 0]);
  }

  streets() {
    // lamps and trees along every road, bollards at corners, bus/matatu stages
    for (let i = 0; i <= N; i++) {
      const c = roadCentre(i);
      for (let k = 0; k < N; k++) {
        const b0 = roadCentre(k) + WALK + 4, b1 = roadCentre(k + 1) - WALK - 4;
        for (let t = b0; t <= b1; t += 22) {
          // roads along z (x = c) and along x (z = c), both sides
          if (Math.abs(c) < HALF + 1) {
            this.lamp(c - 8.2, t, 0); this.lamp(c + 8.2, t + 11, Math.PI);
            this.lamp(t + 11, c - 8.2, -Math.PI / 2); this.lamp(t, c + 8.2, Math.PI / 2);
          }
        }
        for (let t = b0 + 6; t <= b1 - 4; t += 33) {
          this.tree(c - 9.6, t, 0.85); this.tree(c + 9.6, t + 8, 0.85);
          this.tree(t + 8, c - 9.6, 0.85); this.tree(t, c + 9.6, 0.85);
        }
      }
    }
    // matatu stages: shelters at a few corners
    for (const [i, j] of [[2, 3], [4, 5], [5, 2], [3, 6], [6, 4]]) {
      const x = roadCentre(i) + 9, z = blockCentre(j);
      this.b.box(x - 0.6, 0, z - 3, x + 0.6, 0.1, z + 3, "metal");
      this.b.box(x + 0.4, 0, z - 3, x + 0.5, 2.6, z + 3, "glass");
      this.b.box(x - 0.9, 2.6, z - 3.2, x + 0.7, 2.75, z + 3.2, { py: "darkMetal", ny: "darkMetal", px: "darkMetal", nx: "darkMetal", pz: "darkMetal", nz: "darkMetal" });
      this.bench(x + 0.1, z, -Math.PI / 2);
      (this.spots.stages ??= []).push([x - 2, z]);
    }
  }

  edges() {
    // the city ends: a low wall and earth berm all around, so nothing drives off the world
    const E = HALF + 30, t = 2;
    for (const [a, b, c, d] of [[-E, -E - t, E, -E], [-E, E, E, E + t], [-E - t, -E, -E, E], [E, -E, E + t, E]]) {
      this.b.box(a, 0, b, c, 3, d, "dark");
      this.solid(a, 0, b, c, 6, d, ["wall", "edge"]);
    }
  }

  mountains() {
    // the Ngong-like hills on the horizon: low-poly ridges beyond the fog's reach (not fogged)
    const g = new THREE.BufferGeometry();
    const pos = [];
    const R1 = 1500, R2 = 1900, n = 90;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const h0 = 120 + 220 * Math.pow(hash2(k, 7), 2) + 80 * Math.sin(k * 0.7), h1 = 120 + 220 * Math.pow(hash2(k + 1, 7), 2) + 80 * Math.sin((k + 1) * 0.7);
      const p = (a, r, h) => [Math.cos(a) * r, h, Math.sin(a) * r];
      pos.push(...p(a0, R1, -5), ...p(a1, R1, -5), ...p(a1, R2, h1), ...p(a0, R1, -5), ...p(a1, R2, h1), ...p(a0, R2, h0));
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x506070, fog: false, side: THREE.DoubleSide }));
    this.hills = m;
    this.three.add(m);
  }

  // ---------- navigation grid (2 m cells), for people on foot ----------
  buildNav() {
    const C = 2, S = Math.ceil((HALF * 2 + 60) / C);
    this.nav = { C, S, off: HALF + 30, grid: new Uint8Array(S * S) };
    const g = this.nav.grid;
    for (const c of this.colliders) {
      if (c.y0 > 1.5) continue; // only what blocks people at street level
      const i0 = Math.floor((c.x0 + this.nav.off - 0.45) / C), i1 = Math.floor((c.x1 + this.nav.off + 0.45) / C);
      const j0 = Math.floor((c.z0 + this.nav.off - 0.45) / C), j1 = Math.floor((c.z1 + this.nav.off + 0.45) / C);
      for (let i = Math.max(0, i0); i <= Math.min(S - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(S - 1, j1); j++) g[j * S + i] = 1;
    }
    // reopen door cells (a wall run's padding can close a doorway)
    for (const [x, z] of this.doors ?? []) {
      const i = Math.floor((x + this.nav.off) / C), j = Math.floor((z + this.nav.off) / C);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const k = (j + dj) * S + (i + di);
        if (k >= 0 && k < g.length && Math.abs(di) + Math.abs(dj) < 2) g[k] = 0;
      }
    }
  }
  navCell(x, z) { return [Math.floor((x + this.nav.off) / this.nav.C), Math.floor((z + this.nav.off) / this.nav.C)]; }
  navFree(i, j) { const { S, grid } = this.nav; return i >= 0 && j >= 0 && i < S && j < S && grid[j * S + i] === 0; }
  cellCentre(i, j) { const { C, off } = this.nav; return [i * C - off + C / 2, j * C - off + C / 2]; }

  /** A* with a binary heap on the 2 m grid. Returns world points, or null. */
  path(from, to, maxNodes = 6000) {
    const { S } = this.nav;
    let [si, sj] = this.navCell(from[0], from[1]);
    let [gi, gj] = this.navCell(to[0], to[1]);
    const near = (i, j) => { for (let r = 0; r < 4; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (this.navFree(i + a, j + b)) return [i + a, j + b]; return null; };
    const s2 = near(si, sj), g2 = near(gi, gj);
    if (!s2 || !g2) return null;
    [si, sj] = s2; [gi, gj] = g2;
    const start = sj * S + si, goal = gj * S + gi;
    const gs = new Map([[start, 0]]), from_ = new Map();
    const heap = [[0, start]];
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const closed = new Set();
    let n = 0;
    while (heap.length && n++ < maxNodes) {
      const [, k] = pop();
      if (k === goal) {
        const out = [];
        let c = k;
        while (c !== undefined) { out.unshift(this.cellCentre(c % S, Math.floor(c / S))); c = from_.get(c); }
        return this.smooth(out);
      }
      if (closed.has(k)) continue;
      closed.add(k);
      const i = k % S, j = Math.floor(k / S);
      for (const [di, dj, cost] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const ni = i + di, nj = j + dj;
        if (!this.navFree(ni, nj)) continue;
        if (di && dj && (!this.navFree(i + di, j) || !this.navFree(i, j + dj))) continue;
        const nk = nj * S + ni, ng = gs.get(k) + cost;
        if (ng < (gs.get(nk) ?? Infinity)) {
          gs.set(nk, ng); from_.set(nk, k);
          push(ng + Math.hypot(ni - gi, nj - gj), nk);
        }
      }
    }
    return null;
  }
  /** Straight line free on the grid? */
  clearLine(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / 1);
    for (let k = 0; k <= n; k++) {
      const t = k / Math.max(1, n);
      const [i, j] = this.navCell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!this.navFree(i, j)) return false;
    }
    return true;
  }
  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = pts.length - 1; m > k + 1; m--) if (this.clearLine(pts[k], pts[m])) { far = m; break; }
      out.push(pts[far]);
      k = far;
    }
    return out;
  }

  /** Is (x,z) indoors (under a roof we built)? */
  indoors(x, z) {
    return this.interiors.find((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ?? null;
  }
  /** A random free spot on a sidewalk, away from a point. */
  sidewalkSpot(r, avoid, minD = 0) {
    for (let k = 0; k < 30; k++) {
      const loop = r.pick(this.sidewalkLoops);
      const a = r.int(0, 3), b = (a + 1) % 4, t = r.rand();
      const p = [loop[a][0] + (loop[b][0] - loop[a][0]) * t, loop[a][1] + (loop[b][1] - loop[a][1]) * t];
      if (!avoid || Math.hypot(p[0] - avoid[0], p[1] - avoid[1]) > minD) return p;
    }
    return [0, 0];
  }
}
