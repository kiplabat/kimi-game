// Vehicles: sedans, SUVs, police cars, painted minibuses (vans), armoured SUVs and
// motorbikes. Arcade physics with grip, drift on the handbrake, ramps and jumps,
// crashes against the city's walls (oriented corners against boxes), damage, fire and explosions.
// Traffic keeps right and follows the road grid.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { N, roadCentre, LANE, HALF } from "./layout.js";
import { M, liveryTexture } from "./materials.js";
import { Person, civilianLook } from "./characters.js";

export const VTYPES = {
  sedan:   { len: 4.4, wid: 1.9, hgt: 1.5, accel: 14, top: 47, grip: 7.5, turn: 2.0, hp: 220, brake: 30, seatY: 0.62, seatX: -0.25 },
  suv:     { len: 4.8, wid: 2.05, hgt: 1.95, accel: 12, top: 43, grip: 7.0, turn: 1.8, hp: 300, brake: 28, seatY: 0.85, seatX: -0.3 },
  police:  { len: 4.8, wid: 2.05, hgt: 1.95, accel: 13.5, top: 48, grip: 7.6, turn: 1.9, hp: 320, brake: 30, seatY: 0.85, seatX: -0.3 },
  armored: { len: 5.0, wid: 2.2, hgt: 2.1, accel: 10, top: 40, grip: 7.0, turn: 1.6, hp: 650, brake: 26, seatY: 0.9, seatX: -0.3 },
  van:     { len: 5.6, wid: 2.1, hgt: 2.45, accel: 10, top: 38, grip: 6.2, turn: 1.55, hp: 340, brake: 24, seatY: 0.95, seatX: 1.6 },
  bike:    { len: 2.0, wid: 0.7, hgt: 1.15, accel: 17, top: 52, grip: 9, turn: 2.7, hp: 110, brake: 34, seatY: 0.62, seatX: -0.15, bike: true },
};
const PAINTS = [0xb71c1c, 0x0d47a1, 0x1b5e20, 0xf9a825, 0xeeeeee, 0x212121, 0x6a1b9a, 0x00838f, 0xbf360c, 0x9e9e9e, 0x3e2723, 0x1a237e];

const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 18).rotateX(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2);
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.04, metalness: 0.3, envMapIntensity: 2, clearcoat: 1 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.2, roughness: 0.1 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.4, roughness: 0.2 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55, metalness: 0.3 });
const charMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
const redBar = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0020, emissiveIntensity: 0 });
const blueBar = new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x2040ff, emissiveIntensity: 0 });
// lights shared by every vehicle (night); police bars and brake lights are per vehicle
export const VEHICLE_LIGHTS = { head: 0.2, tail: 0.4 };
const GLOW = { headMat: 1, tailMat: 2, redBar: 3, blueBar: 4 };

// Paint: clear-coated at high quality, plain standard (much cheaper per pixel) below.
let richPaint = true;
export function setVehicleQuality(q) { richPaint = q >= 2; }
function paintMat(color) {
  return richPaint
    ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.6, envMapIntensity: 1.5 });
}

/**
 * Everything on a vehicle that is not paint or glass, in one material: colours ride on the
 * vertices, and lamps glow by channel (1 head, 2 tail, 3 red bar, 4 blue bar) from uniforms.
 */
function detailMat() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 });
  const u = { uGlow: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] } };
  m.userData.glow = u.uGlow.value;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = u.uGlow;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aGlow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vGlow;\nuniform vec3 uGlow[4];")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        if (vGlow > 0.5) {
          vec3 gc = vGlow < 1.5 ? uGlow[0] : vGlow < 2.5 ? uGlow[1] : vGlow < 3.5 ? uGlow[2] : uGlow[3];
          totalEmissiveRadiance += gc;
        }`);
  };
  m.customProgramCacheKey = () => "veh-detail";
  return m;
}

/** A rounded box: fewer segments for small parts (most of a car's triangles were in its trim). */
function rb(w, h, d, r, mat, x, y, z) {
  const big = Math.max(w, h, d);
  const seg = big > 1.5 ? 3 : big > 0.5 ? 2 : 1;
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01)), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** A wheel is only a pivot: the tyres and rims of every vehicle are drawn as two instanced meshes. */
function wheel(r, w, x, z, front) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  g.position.set(x, r, z);
  return { g, spin, front, r, tire: new THREE.Matrix4().makeScale(r, r, w), rim: new THREE.Matrix4().makeScale(r * 0.6, r * 0.6, w * 1.04) };
}

/** Merge a vehicle's parts into three meshes: paint, glass and details (one draw call each). */
function mergeVehicle(body, paint) {
  const parts = { paint: [], glass: [], detail: [] };
  const own = new Map(); // textured parts (a van's livery) keep their own material
  const col = new THREE.Color();
  for (const o of [...body.children]) {
    if (!o.isMesh) continue;
    o.updateMatrix();
    const g = o.geometry.clone().applyMatrix4(o.matrix);
    if (o.material.map) {
      if (!own.has(o.material)) own.set(o.material, []);
      own.get(o.material).push(g.index ? g.toNonIndexed() : g);
      body.remove(o); o.geometry.dispose();
      continue;
    }
    const kind = o.material === paint ? "paint" : o.material === glassMat ? "glass" : "detail";
    if (kind === "detail") {
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3), gl = new Float32Array(n);
      col.copy(o.material.color);
      if (o.material.map) col.setRGB(0.9, 0.9, 0.9);
      const ch = o.material === headMat ? 1 : o.material === tailMat ? 2 : o.material === redBar ? 3 : o.material === blueBar ? 4 : 0;
      for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; gl[i] = ch; }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      g.setAttribute("aGlow", new THREE.BufferAttribute(gl, 1));
    }
    parts[kind].push(g.index ? g.toNonIndexed() : g);
    body.remove(o);
    o.geometry.dispose();
  }
  const det = detailMat();
  const out = {};
  for (const [kind, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list), kind === "paint" ? paint : kind === "glass" ? glassMat : det);
    m.castShadow = kind !== "glass"; m.receiveShadow = true;
    body.add(m);
    out[kind] = m;
  }
  out.own = [];
  for (const [mat, list] of own) {
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = m.receiveShadow = true;
    body.add(m);
    out.own.push(m);
  }
  return { ...out, det };
}

function buildMesh(type, paint, i) {
  const T = VTYPES[type];
  const root = new THREE.Group();
  const body = new THREE.Group(); // pitches and rolls
  root.add(body);
  const wheels = [];
  const add = (...m) => body.add(...m);
  const p = paint;
  let bar = null;
  if (type === "bike") {
    add(rb(0.62, 0.26, 0.3, 0.1, p, 0.15, 0.82, 0)); // fuel tank
    add(rb(0.8, 0.12, 0.3, 0.05, trimMat, -0.35, 0.86, 0)); // seat
    add(rb(0.5, 0.35, 0.28, 0.06, M.darkMetal(), 0.05, 0.5, 0)); // engine
    add(rb(0.45, 0.06, 0.4, 0.03, p, -0.75, 0.88, 0)); // rack
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6), M.metal()); fork.position.set(0.72, 0.68, 0); fork.rotation.z = -0.35; add(fork);
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6).rotateX(Math.PI / 2), trimMat); bars.position.set(0.6, 1.08, 0); add(bars);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), headMat); lamp.position.set(0.82, 0.95, 0); add(lamp);
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 8).rotateZ(Math.PI / 2), M.metal()); exh.position.set(-0.4, 0.38, 0.17); add(exh);
    for (const [x, f] of [[0.8, true], [-0.72, false]]) { const w = wheel(0.33, 0.1, x, 0, f); add(w.g); wheels.push(w); }
  } else if (type === "van") {
    const liv = new THREE.MeshPhysicalMaterial({ map: liveryTexture(i), roughness: 0.35, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.2 });
    add(rb(5.6, 1.75, 2.1, 0.25, liv, 0, 1.3, 0));
    add(rb(4.4, 0.55, 2.14, 0.12, glassMat, -0.5, 1.75, 0)); // side windows
    add(rb(0.12, 0.8, 1.9, 0.05, glassMat, 2.78, 1.65, 0)); // windscreen
    add(rb(3.6, 0.12, 1.6, 0.04, M.darkMetal(), -0.4, 2.25, 0)); // roof rack
    add(rb(0.2, 0.3, 2.0, 0.08, trimMat, 2.82, 0.6, 0), rb(0.2, 0.3, 2.0, 0.08, trimMat, -2.82, 0.6, 0));
    add(rb(0.06, 0.15, 0.4, 0.03, headMat, 2.85, 0.95, 0.72), rb(0.06, 0.15, 0.4, 0.03, headMat, 2.85, 0.95, -0.72));
    add(rb(0.06, 0.25, 0.25, 0.03, tailMat, -2.83, 1.0, 0.85), rb(0.06, 0.25, 0.25, 0.03, tailMat, -2.83, 1.0, -0.85));
    for (const [x, z, f] of [[1.85, 0.95, true], [1.85, -0.95, true], [-1.85, 0.95, false], [-1.85, -0.95, false]]) { const w = wheel(0.4, 0.28, x, z, f); add(w.g); wheels.push(w); }
  } else {
    const big = type !== "sedan";
    const L = T.len, W = T.wid;
    const bodyH = big ? 0.9 : 0.62, bodyY = big ? 0.88 : 0.7;
    add(rb(L, bodyH, W, 0.2, p, 0, bodyY, 0));
    const cabL = big ? L * 0.62 : L * 0.5, cabX = big ? -0.35 : -0.25, cabH = big ? 0.66 : 0.55, cabY = bodyY + bodyH / 2 + cabH / 2 - 0.04;
    add(rb(cabL, cabH, W * 0.9, 0.18, glassMat, cabX, cabY, 0));
    add(rb(cabL * 0.92, 0.09, W * 0.88, 0.04, p, cabX - 0.05, cabY + cabH / 2, 0)); // roof
    add(rb(0.2, 0.28, W * 0.96, 0.08, trimMat, L / 2, bodyY - 0.2, 0), rb(0.2, 0.28, W * 0.96, 0.08, trimMat, -L / 2, bodyY - 0.2, 0)); // bumpers
    add(rb(0.08, 0.13, 0.42, 0.04, headMat, L / 2 + 0.01, bodyY + 0.12, W * 0.32), rb(0.08, 0.13, 0.42, 0.04, headMat, L / 2 + 0.01, bodyY + 0.12, -W * 0.32));
    add(rb(0.08, 0.14, 0.36, 0.04, tailMat, -L / 2 - 0.01, bodyY + 0.14, W * 0.34), rb(0.08, 0.14, 0.36, 0.04, tailMat, -L / 2 - 0.01, bodyY + 0.14, -W * 0.34));
    add(rb(0.05, 0.22, W * 0.45, 0.03, trimMat, L / 2 + 0.02, bodyY - 0.02, 0)); // grille
    if (type === "police") {
      const band = rb(L * 0.7, 0.18, W + 0.02, 0.05, new THREE.MeshStandardMaterial({ color: 0x1a3fa0, roughness: 0.4 }), 0, bodyY + 0.05, 0);
      add(band);
      bar = [rb(0.3, 0.12, 0.55, 0.04, redBar, cabX, cabY + cabH / 2 + 0.1, 0.32), rb(0.3, 0.12, 0.55, 0.04, blueBar, cabX, cabY + cabH / 2 + 0.1, -0.32)];
      add(...bar);
    }
    if (type === "armored") {
      add(rb(L * 0.5, 0.06, W + 0.06, 0.02, M.darkMetal(), 0.3, bodyY + 0.3, 0), rb(0.15, 0.5, W * 0.9, 0.05, M.darkMetal(), L / 2 + 0.12, bodyY - 0.05, 0));
    }
    const r = big ? 0.42 : 0.34, ax = L / 2 - (big ? 0.95 : 0.8), wz = W / 2 - 0.12;
    for (const [x, z, f] of [[ax, wz, true], [ax, -wz, true], [-ax, wz, false], [-ax, -wz, false]]) { const w = wheel(r, big ? 0.3 : 0.24, x, z, f); add(w.g); wheels.push(w); }
  }
  const merged = mergeVehicle(body, p);
  return { root, body, wheels, bar: !!bar, merged };
}

let VID = 1;

export class Vehicle {
  constructor(ctx, type, x, z, rot, o = {}) {
    this.ctx = ctx;
    this.id = VID++;
    this.type = type;
    this.T = VTYPES[type];
    this.paint = paintMat(o.paint ?? (type === "police" ? 0xf2f2f2 : type === "armored" ? 0x14161a : ctx.g.pick(PAINTS)));
    const m = buildMesh(type, this.paint, o.livery ?? Math.floor(Math.random() * 6));
    this.mesh = m;
    const T = this.T;
    const y0 = ctx.world.groundAt(x, z, 0);
    this.e = ctx.g.current.add({ at: [x, y0 + T.hgt / 2, z], capsule: [T.wid * 0.55, T.hgt], radius: T.bike ? 0.55 : T.wid * 0.6,
      mesh: m.root, cull: 190, tags: ["vehicle"], solid: ["vehicle", "person"], mass: T.bike ? 3 : 14, face: "none", hp: T.hp, rot });
    m.root.children[0].position.y = -T.hgt / 2;
    this.e.data.vehicleObj = this;
    this.e.rot = this.e.orot = rot;
    this.vy = 0;
    this.speed = 0;      // forward speed (m/s)
    this.steerVis = 0;
    this.driver = null;  // a Person shown in the seat (NPC) or the player
    this.wrecked = false;
    this.pitch = 0; this.roll = 0;
    this.air = 0;
    this.ai = null;      // { mode: "traffic"|"chase"|"route", … }
    this.lastHit = 0;
    this.e.on("hit", "person", (p) => this.runOver(p));
  }

  get x() { return this.e.x; }
  get z() { return this.e.z; }
  get groundY() { return this.e.y - this.T.hgt / 2; }
  get fwd() { return [Math.cos(this.e.rot), Math.sin(this.e.rot)]; }

  /** Seat a person (their mesh rides along). */
  seat(person) {
    this.driver = person;
    if (person) {
      const T = this.T;
      // traffic keeps right, so the driver sits on the left (−z)
      person.group.position.set(T.seatX, T.seatY + 0.9 - 0.15, T.bike ? 0 : -0.38);
      person.group.rotation.set(0, 0, 0);
      this.mesh.body.add(person.group);
      person.animate(0.016, { speed: 0, ride: T.bike ? "bike" : "car" });
    }
  }
  unseat() {
    const p = this.driver;
    if (p) { p.group.removeFromParent(); this.driver = null; }
    return p;
  }

  /** controls: { throttle −1..1, steer −1..1, brake (handbrake) } */
  drive(dt, c) {
    const e = this.e, T = this.T, w = this.ctx.world;
    if (this.wrecked) c = { throttle: 0, steer: 0, brake: true };
    this.lastThrottle = c.throttle;
    const [fx, fz] = this.fwd;
    const rx = -fz, rz = fx;
    let vf = e.vx * fx + e.vz * fz;
    let vr = e.vx * rx + e.vz * rz;
    const onGround = this.air <= 0;
    if (onGround) {
      const th = c.throttle;
      if (th > 0) vf += T.accel * th * dt * Math.max(0, 1 - vf / T.top) * (vf < 0 ? 2 : 1);
      else if (th < 0) { if (vf > 0.6) vf -= T.brake * -th * dt; else vf = Math.max(-12, vf + T.accel * 0.6 * th * dt); }
      else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
      vf *= Math.exp(-0.06 * dt);
      const grip = c.brake ? T.grip * 0.12 : T.grip;
      vr *= Math.exp(-grip * dt);
      if (c.brake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
      const sp = Math.min(1, Math.abs(vf) / 7) * Math.sign(vf);
      const yaw = c.steer * T.turn * sp * (c.brake ? 1.45 : 1) * (1 - 0.4 * Math.min(1, Math.abs(vf) / T.top));
      e.rot += yaw * dt;
      // a little slide when turning hard at speed
      vr += -yaw * vf * 0.04 * dt * (c.brake ? 6 : 1);
    }
    const [nfx, nfz] = this.fwd;
    e.vx = nfx * vf + -nfz * vr;
    e.vz = nfz * vf + nfx * vr;
    this.speed = vf;
    this.steerVis += (c.steer - this.steerVis) * Math.min(1, dt * 8);

    // height: ramps, roofs, jumps
    const gy = w.groundAt(e.x, e.z, this.groundY + 0.5, 0.9);
    const prev = this.groundY;
    if (prev > gy + 0.06 || this.vy > 0.5) {
      this.vy -= 22 * dt;
      e.y += this.vy * dt;
      this.air = 0.2;
      if (this.groundY <= gy) {
        e.y = gy + T.hgt / 2;
        if (this.vy < -9) { this.damage(-this.vy * 2.5, null); this.ctx.fx.impact([e.x, gy + 0.1, e.z], [0, 1, 0], "ground"); this.ctx.audio.impact([e.x, gy, e.z], "metal"); this.ctx.shake?.([e.x, gy, e.z], 0.4); }
        this.vy = 0;
      }
    } else {
      // follow the surface; leaving a ramp at speed keeps the climb rate (that is a jump)
      const climb = (gy - prev) / Math.max(dt, 1e-4);
      e.y = gy + T.hgt / 2;
      this.vy = Math.max(0, Math.min(climb, 14));
      this.air = Math.max(0, this.air - dt);
    }
    // body pitch and roll from the slope and from cornering
    const ahead = w.groundAt(e.x + nfx * T.len * 0.45, e.z + nfz * T.len * 0.45, this.groundY + 0.6, 0.9);
    const behind = w.groundAt(e.x - nfx * T.len * 0.45, e.z - nfz * T.len * 0.45, this.groundY + 0.6, 0.9);
    const slope = this.air > 0 ? this.pitch : Math.atan2(ahead - behind, T.len * 0.9);
    this.pitch += (slope - this.pitch) * Math.min(1, dt * 8);
    const lean = T.bike ? -c.steer * Math.min(1, Math.abs(vf) / 12) * 0.5 : c.steer * Math.min(1, Math.abs(vf) / 20) * 0.06;
    this.roll += (lean - this.roll) * Math.min(1, dt * 6);
    this.mesh.body.rotation.set(this.roll, 0, this.pitch, "YXZ");
    // wheels
    for (const wh of this.mesh.wheels) {
      wh.spin.rotation.z -= (vf / wh.r) * dt;
      if (wh.front) wh.g.rotation.y = -this.steerVis * 0.5;
    }
    this.collideStatic(dt);
  }

  /** Corner points against static boxes and posts: push out, lose speed, take damage. */
  collideStatic(dt) {
    const e = this.e, T = this.T, s = this.ctx.g.current;
    const [fx, fz] = this.fwd;
    const rx = -fz, rz = fx;
    const hl = T.len / 2, hw = T.wid / 2;
    const pts = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]];
    const y0 = this.groundY + 0.25, y1 = this.groundY + T.hgt;
    let px = 0, pz = 0, hit = 0;
    const buf = [];
    for (const [a, b] of pts) {
      const x = e.x + fx * a + rx * b, z = e.z + fz * a + rz * b;
      buf.length = 0;
      for (const c of s.staticHash.query(x, z, 0.3, buf)) {
        if (c.box) {
          const h2 = c.box[1] / 2;
          if (c.y + h2 < y0 || c.y - h2 > y1) continue;
          const dx = x - c.x, dz = z - c.z, ex = c.box[0] / 2, ez = (c.box[2] ?? c.box[0]) / 2;
          if (Math.abs(dx) < ex && Math.abs(dz) < ez) {
            const ox = ex - Math.abs(dx), oz = ez - Math.abs(dz);
            if (ox < oz) px += Math.sign(dx) * ox; else pz += Math.sign(dz) * oz;
            hit++;
          }
        } else if (c.opts.capsule) {
          const r = c.radius + 0.05, dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
          if (d < r && c.y + c.opts.capsule[1] / 2 > y0) { px += (dx / (d || 1)) * (r - d); pz += (dz / (d || 1)) * (r - d); hit++; }
        }
      }
    }
    if (!hit) return;
    const l = Math.hypot(px, pz) || 1;
    const nx = px / l, nz = pz / l;
    e.x += px / Math.max(1, hit * 0.5); e.z += pz / Math.max(1, hit * 0.5);
    const vn = e.vx * nx + e.vz * nz;
    if (vn < 0) {
      e.vx -= 1.3 * vn * nx; e.vz -= 1.3 * vn * nz;
      const impact = -vn;
      if (impact > 6 && this.ctx.g.time - this.lastHit > 0.3) {
        this.lastHit = this.ctx.g.time;
        this.damage(impact * impact * 0.35, null);
        this.ctx.audio.impact([e.x, e.y, e.z], "metal");
        this.ctx.fx.impact([e.x + nx * -1, e.y, e.z + nz * -1], [nx, 0, nz], "metal");
        if (this.driver?.isPlayer) { this.ctx.shake?.([e.x, e.y, e.z], Math.min(1, impact / 25)); this.ctx.g.input.vibrate(120, Math.min(1, impact / 20)); }
      }
    }
  }

  runOver(p) {
    const sp = Math.hypot(this.e.vx, this.e.vz);
    if (sp < 5 || p.data.vehicle === this) return;
    this.ctx.combat.hurt(p, sp * 7, this.driver?.entity ?? null, { runOver: true });
    p.data.knock = [this.e.vx * 0.5, 4, this.e.vz * 0.5];
    this.ctx.audio.impact([p.x, p.y, p.z], "flesh");
    if (this.driver?.isPlayer) this.ctx.noise([p.x, p.y, p.z], 30, this.driver.entity);
  }

  damage(n, from) {
    if (this.wrecked || n <= 0) return;
    this.e.hp -= n;
    this.e.data.lastHitBy = from;
    this.onDamage?.(n, from);
    if (this.e.hp <= this.T.hp * 0.3 && Math.random() < 0.3) this.smoking = true;
    if (this.e.hp <= 0) this.explode(from);
  }
  explode(from) {
    if (this.wrecked) return;
    this.wrecked = true;
    const e = this.e, p = [e.x, e.y, e.z];
    this.ctx.fx.explosion(p, 1.3);
    this.ctx.audio.explosion(p, 1.3);
    this.ctx.fx.burn(e, this.ctx.g.time + 14);
    this.ctx.noise(p, 140, from);
    this.ctx.shake?.(p, 1.4);
    this.vy = 7;
    this.e.y += 0.1;
    for (const k of ["paint", "glass", "detail"]) if (this.mesh.merged[k]) this.mesh.merged[k].material = charMat;
    for (const m of this.mesh.merged.own) m.material = charMat;
    // people around get hurt; the driver too
    this.ctx.combat.explode(p, { id: "car", splash: 6, dmg: 120 }, from);
    this.onWreck?.(from);
    this.ctx.onVehicleWrecked?.(this, from);
  }

  /** Ray against this vehicle's oriented box. */
  ray(from, dir, max) {
    if (!this.e.alive) return null;
    const e = this.e, T = this.T;
    const c = Math.cos(-e.rot), s = Math.sin(-e.rot);
    const ox = from[0] - e.x, oz = from[2] - e.z, oy = from[1] - (this.groundY + T.hgt * 0.55);
    const lx = ox * c - oz * s, lz = ox * s + oz * c;
    const dx = dir[0] * c - dir[2] * s, dz = dir[0] * s + dir[2] * c, dy = dir[1];
    const l = Math.hypot(dx, dy, dz) || 1;
    const D = [dx / l, dy / l, dz / l], O = [lx, oy, lz], H = [T.len / 2, T.hgt * 0.45, T.wid / 2];
    let t0 = 0, t1 = max, axis = -1, sign = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(D[k]) < 1e-9) { if (Math.abs(O[k]) > H[k]) return null; continue; }
      let a = (-H[k] - O[k]) / D[k], b = (H[k] - O[k]) / D[k];
      let sg = -1;
      if (a > b) { [a, b] = [b, a]; sg = 1; }
      if (a > t0) { t0 = a; axis = k; sign = sg * Math.sign(D[k]) * -1 * -1; }
      t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    const n = [0, 0, 0];
    if (axis >= 0) n[axis] = -Math.sign(D[axis]);
    // back to world
    const wnx = n[0] * Math.cos(e.rot) - n[2] * Math.sin(e.rot), wnz = n[0] * Math.sin(e.rot) + n[2] * Math.cos(e.rot);
    void sign;
    return { vehicle: this, dist: t0, point: [from[0] + dir[0] / l * t0, from[1] + dir[1] / l * t0, from[2] + dir[2] / l * t0], normal: [wnx, n[1], wnz] };
  }

  /** Lights: headlights at night, a flashing bar on police cars. */
  lights(night, t) {
    if (this.wrecked) return;
    const gl = this.mesh.merged.det.userData.glow;
    gl[0].setRGB(1, 0.95, 0.82).multiplyScalar(VEHICLE_LIGHTS.head);
    const braking = this.driver && this.speed > 1 && this.lastThrottle < 0;
    gl[1].setRGB(1, 0.06, 0.06).multiplyScalar(VEHICLE_LIGHTS.tail * (braking ? 2.5 : 1));
    if (this.mesh.bar) {
      const on = this.siren ? 1 : 0;
      const ph = Math.floor(t * 6) % 2;
      gl[2].setRGB(1, 0, 0.12).multiplyScalar(on * (ph ? 6 : 0.3));
      gl[3].setRGB(0.12, 0.25, 1).multiplyScalar(on * (ph ? 0.3 : 6));
    }
    void night;
  }

  remove() {
    this.unseat();
    this.e.die("removed");
  }
}

// ---------------------------------------------------------------------------
// All vehicles: traffic, parked cars, lookups
// ---------------------------------------------------------------------------
export class Vehicles {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.trafficTarget = 18;
    // every tyre and every rim in the city: two draw calls
    const cap = 512;
    this.tires = new THREE.InstancedMesh(tireGeo, M.rubber(), cap);
    this.rims = new THREE.InstancedMesh(rimGeo, M.metal(), cap);
    for (const im of [this.tires, this.rims]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false; im.count = 0; im.receiveShadow = true;
      ctx.g.three.scene.add(im);
    }
    this.tires.castShadow = true;
    this._m = new THREE.Matrix4();
  }
  /** After the engine has placed the vehicles for this frame: wheels of the ones on screen. */
  drawWheels() {
    let k = 0;
    const cap = this.tires.instanceMatrix.count, m = this._m;
    for (const v of this.list) {
      const root = v.mesh.root;
      if (!v.e.alive || !root.visible || !root.parent) continue;
      root.updateMatrixWorld(true);
      for (const wh of v.mesh.wheels) {
        if (k >= cap) break;
        this.tires.setMatrixAt(k, m.multiplyMatrices(wh.spin.matrixWorld, wh.tire));
        this.rims.setMatrixAt(k, m.multiplyMatrices(wh.spin.matrixWorld, wh.rim));
        k++;
      }
    }
    for (const im of [this.tires, this.rims]) {
      im.count = k;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, k * 16);
      im.instanceMatrix.needsUpdate = true;
    }
  }
  spawn(type, x, z, rot, o = {}) {
    const v = new Vehicle(this.ctx, type, x, z, rot, o);
    this.list.push(v);
    return v;
  }
  ray(from, dir, max, ignore) {
    let best = null;
    for (const v of this.list) {
      if (v === ignore || !v.e.alive) continue;
      const dx = v.x - from[0], dz = v.z - from[2];
      if (dx * dx + dz * dz > (max + 6) ** 2) continue;
      const h = v.ray(from, dir, best ? best.dist : max);
      if (h && (!best || h.dist < best.dist)) best = h;
    }
    return best;
  }
  blast(p, R, dmg, owner) {
    for (const v of this.list) {
      const d = Math.hypot(v.x - p[0], v.z - p[2]);
      if (d < R && !v.wrecked) {
        v.damage(dmg * (1 - d / R) * 1.4, owner);
        v.e.vx += ((v.x - p[0]) / (d || 1)) * (1 - d / R) * 6;
        v.e.vz += ((v.z - p[2]) / (d || 1)) * (1 - d / R) * 6;
        v.vy = Math.max(v.vy, (1 - d / R) * 5);
      }
    }
  }
  nearest(p, r, filter = () => true) {
    let best = null, bd = r;
    for (const v of this.list) {
      if (!v.e.alive || !filter(v)) continue;
      const d = Math.hypot(v.x - p[0], v.z - p[1]);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---------- traffic on the road grid (keeps right) ----------
  /** A lane point: on road between intersections a→b, with t along it. */
  lanePoint(a, b, t) {
    const ax = roadCentre(a[0]), az = roadCentre(a[1]), bx = roadCentre(b[0]), bz = roadCentre(b[1]);
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    // right of the direction of travel: (−dz, dx)/l
    return [ax + dx * t + (-dz / l) * LANE, az + dz * t + (dx / l) * LANE];
  }
  nextNode(from, at) {
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [at[0] + di, at[1] + dj])
      .filter(([i, j]) => i >= 0 && j >= 0 && i <= N && j <= N && !(i === from[0] && j === from[1]));
    return this.ctx.g.pick(opts.length ? opts : [from]);
  }
  spawnTraffic(near, minD, maxD, avoidView) {
    const g = this.ctx.g;
    for (let tries = 0; tries < 20; tries++) {
      const a = [g.int(0, N), g.int(0, N)];
      const b = this.nextNode([-9, -9], a);
      const t = g.rand(0.15, 0.85);
      const [x, z] = this.lanePoint(a, b, t);
      const d = Math.hypot(x - near[0], z - near[1]);
      if (d < minD || d > maxD) continue;
      if (avoidView && avoidView(x, z)) continue;
      if (this.nearest([x, z], 9)) continue;
      const type = g.pick(["sedan", "sedan", "sedan", "suv", "van", "van", "bike", "bike"]);
      const v = this.spawn(type, x, z, Math.atan2(roadCentre(b[1]) - roadCentre(a[1]), roadCentre(b[0]) - roadCentre(a[0])));
      v.ai = { mode: "traffic", a, b, speed: type === "bike" ? 13 : type === "van" ? 12 : 11 };
      const driver = new Person(civilianLook(g));
      if (type === "bike") driver.look.hat = "helmet";
      v.seat(driver);
      v.npcDriver = true;
      return v;
    }
    return null;
  }

  /** Drive toward a point: returns controls. Brakes for things ahead. */
  steerTo(v, tx, tz, want) {
    const e = v.e;
    const ang = Math.atan2(tz - e.z, tx - e.x);
    let d = ang - e.rot;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const steer = Math.max(-1, Math.min(1, d * 2.2));
    const speedWant = want * (1 - Math.min(0.55, Math.abs(d) * 0.7));
    // anything in front?
    const [fx, fz] = v.fwd;
    let block = 99;
    const s = this.ctx.g.current;
    for (const o of s.within("vehicle", [e.x + fx * 7, e.z + fz * 7], 6)) {
      if (o === e) continue;
      const rx = o.x - e.x, rz = o.z - e.z, ahead = rx * fx + rz * fz, side = Math.abs(-rx * fz + rz * fx);
      if (ahead > 0 && side < 2.2) block = Math.min(block, ahead);
    }
    for (const o of s.within("person", [e.x + fx * 6, e.z + fz * 6], 5)) {
      const rx = o.x - e.x, rz = o.z - e.z, ahead = rx * fx + rz * fz, side = Math.abs(-rx * fz + rz * fx);
      if (ahead > 0 && side < 1.8) block = Math.min(block, ahead);
    }
    let throttle = v.speed < speedWant ? 1 : 0.1;
    if (block < 12) throttle = block < 6 ? -1 : 0;
    return { throttle, steer, brake: false, blocked: block < 6 };
  }

  update(dt, playerVehicle) {
    const t = this.ctx.g.time, night = this.ctx.sky.night;
    VEHICLE_LIGHTS.head = 0.2 + night * 5;
    VEHICLE_LIGHTS.tail = 0.4 + night * 2.5;
    for (const v of this.list) {
      if (!v.e.alive) continue;
      v.lights(night, t);
      if (v === playerVehicle) continue; // the player drives it
      let c = { throttle: 0, steer: 0, brake: true };
      if (v.wrecked) c = { throttle: 0, steer: 0, brake: true };
      else if (v.ai && v.driver) {
        const ai = v.ai;
        if (ai.mode === "traffic") {
          const [px, pz] = this.lanePoint(ai.a, ai.b, 1.0);
          const ex = roadCentre(ai.b[0]), ez = roadCentre(ai.b[1]);
          if (Math.hypot(v.x - ex, v.z - ez) < 10) { const n = this.nextNode(ai.a, ai.b); ai.a = ai.b; ai.b = n; }
          c = this.steerTo(v, px, pz, ai.speed);
          if (ai.panic) c.throttle = 1, ai.speed = 18;
          if (c.blocked) { ai.stuck = (ai.stuck ?? 0) + dt; if (ai.stuck > 5 && !ai.panic) c = { throttle: -1, steer: -c.steer, brake: false }; if (ai.stuck > 7) ai.stuck = 0; }
          else ai.stuck = 0;
        } else if (ai.mode === "chase" || ai.mode === "route") {
          const tgt = ai.mode === "chase" ? ai.target() : ai.route[ai.i];
          if (tgt) {
            const d = Math.hypot(tgt[0] - v.x, tgt[1] - v.z);
            if (ai.mode === "route" && d < 12) ai.i = (ai.i + 1) % ai.route.length;
            const want = ai.mode === "chase" ? (d < (ai.stopAt ?? 14) ? 0 : ai.speed ?? 24) : ai.speed ?? 15;
            // around buildings: follow the road grid toward the target
            const goal = this.roadGoal(v, tgt);
            c = this.steerTo(v, goal[0], goal[1], want);
            if (ai.mode === "chase" && d < (ai.stopAt ?? 14)) { c.throttle = v.speed > 1 ? -1 : 0; ai.arrived = true; }
            if (c.blocked && ai.mode === "chase") c.throttle = 0.4; // police push through
          }
        }
      }
      v.drive(dt, c);
      if (v.smoking && Math.random() < dt * 8) this.ctx.fx.smoke.add([v.x, v.e.y + 0.4, v.z], [0, 1.5, 0], 2, 0.6, 2.5, [0.2, 0.2, 0.2], 0.5);
    }
    this.list = this.list.filter((v) => v.e.alive);
  }

  /** Next point toward a target along roads (intersections) when not in a straight line. */
  roadGoal(v, tgt) {
    const w = this.ctx.world;
    if (Math.hypot(tgt[0] - v.x, tgt[1] - v.z) < 30 || w.clearLine([v.x, v.z], tgt)) return tgt;
    // nearest intersection that is closer to the target
    const ri = Math.round((v.x + HALF) / 72), rj = Math.round((v.z + HALF) / 72);
    let best = [roadCentre(ri), roadCentre(rj)], bd = Infinity;
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = Math.max(0, Math.min(N, ri + di)), j = Math.max(0, Math.min(N, rj + dj));
      const p = [roadCentre(i), roadCentre(j)];
      if (Math.hypot(p[0] - v.x, p[1] - v.z) < 9) continue;
      const d = Math.hypot(p[0] - tgt[0], p[1] - tgt[1]) + Math.hypot(p[0] - v.x, p[1] - v.z) * 0.6;
      if (d < bd && w.clearLine([v.x, v.z], p)) { bd = d; best = p; }
    }
    return best;
  }
}
