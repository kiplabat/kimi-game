// People, made in code: one skinned mesh per person (a single draw call), with a skeleton that is
// animated procedurally: walk, run, strafe, crouch, aim with a rifle or a pistol, recoil, flinch,
// ride, and fall. Faces forward along +x (right side is +z), feet at y = -0.9 in the entity.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const BONES = ["hips", "spine", "chest", "neck", "head",
  "shoulderL", "upperArmL", "foreArmL", "handL", "shoulderR", "upperArmR", "foreArmR", "handR",
  "thighL", "shinL", "footL", "thighR", "shinR", "footR"];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
// bone pivots in the bind pose (character space, feet at y = 0)
const PIVOT = {
  hips: [0, 0.95, 0], spine: [0, 1.05, 0], chest: [0, 1.22, 0], neck: [0, 1.52, 0], head: [0, 1.62, 0],
  shoulderL: [0, 1.46, -0.17], upperArmL: [0, 1.46, -0.23], foreArmL: [0, 1.19, -0.25], handL: [0, 0.94, -0.26],
  shoulderR: [0, 1.46, 0.17], upperArmR: [0, 1.46, 0.23], foreArmR: [0, 1.19, 0.25], handR: [0, 0.94, 0.26],
  thighL: [0, 0.93, -0.1], shinL: [0, 0.5, -0.1], footL: [0, 0.08, -0.1],
  thighR: [0, 0.93, 0.1], shinR: [0, 0.5, 0.1], footR: [0, 0.08, 0.1],
};
const PARENT = {
  spine: "hips", chest: "spine", neck: "chest", head: "neck",
  shoulderL: "chest", upperArmL: "shoulderL", foreArmL: "upperArmL", handL: "foreArmL",
  shoulderR: "chest", upperArmR: "shoulderR", foreArmR: "upperArmR", handR: "foreArmR",
  thighL: "hips", shinL: "thighL", footL: "shinL", thighR: "hips", shinR: "thighR", footR: "shinR",
};

export const LOOKS = {
  player:  { skin: 0x6b4430, shirt: 0x2b6f8f, sleeve: "short", pants: 0x2a2f3a, shoes: 0x1a1a1a, hat: "cap", hatColor: 0x1f2a36, vest: 0x3c4a2a },
  gang:    { skin: 0x5a3a28, shirt: 0x1d1d22, sleeve: "long", pants: 0x2b2b30, shoes: 0x111111, hat: "bandana", hatColor: 0xb3261e, vest: null },
  gangBoss:{ skin: 0x4a2f20, shirt: 0x5a1010, sleeve: "long", pants: 0x161616, shoes: 0x0d0d0d, hat: "beret", hatColor: 0x111111, vest: 0x2b2b2b },
  police:  { skin: 0x6e4a33, shirt: 0x24406e, sleeve: "short", pants: 0x16233d, shoes: 0x0d0d0d, hat: "police", hatColor: 0x16233d, vest: 0x2e3238 },
  civilian:{ skin: 0x7a5038, shirt: 0xc0a060, sleeve: "short", pants: 0x3a4a6a, shoes: 0x3a2a1a, hat: null, hatColor: 0, vest: null },
};
const SKINS = [0x3e2a1e, 0x4f3324, 0x6b4430, 0x7a5038, 0x8d5f43, 0xa87556, 0xc69479];
const CLOTHES = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400, 0x16a085, 0xe8d5b0, 0x7f8c8d, 0xff6f91];
const PANTS = [0x2c3e50, 0x34495e, 0x5d4037, 0x1b2631, 0x6d6d6d, 0x8b7d6b];

/** A civilian look with varied skin and clothes. */
export function civilianLook(r) {
  return { skin: r.pick(SKINS), shirt: r.pick(CLOTHES), sleeve: r.chance(0.6) ? "short" : "long", pants: r.pick(PANTS),
    shoes: r.pick([0x1a1a1a, 0x3a2a1a, 0xdedede]), hat: r.chance(0.25) ? r.pick(["cap", "kofia"]) : null, hatColor: r.pick(CLOTHES), vest: null,
    dress: r.chance(0.28) ? r.pick(CLOTHES) : null };
}

function colorize(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}
function skin(g, bone) {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = B[bone]; w[i * 4] = 1; }
  g.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(w, 4));
  return g;
}
const prep = (g) => { if (g.index) g = g.toNonIndexed(); g.deleteAttribute("uv"); return g; };
/** A limb segment from a to b (capsule). */
function limb(a, b, r, color, bone) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 3, 8);
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return skin(colorize(prep(g), color), bone);
}
function block(w, h, d, x, y, z, color, bone, radius = 0.04) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2));
  g.translate(x, y, z);
  return skin(colorize(prep(g), color), bone);
}
function ball(r, x, y, z, color, bone, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return skin(colorize(prep(g), color), bone);
}

const geoCache = new Map();
function bodyGeometry(look) {
  const key = JSON.stringify(look);
  if (geoCache.has(key)) return geoCache.get(key);
  const P = PIVOT, parts = [];
  const sleeve = look.sleeve === "long" ? look.shirt : look.skin;
  // legs (a dress covers the thighs)
  for (const s of ["L", "R"]) {
    parts.push(limb(P["thigh" + s], P["shin" + s], 0.078, look.dress ?? look.pants, "thigh" + s));
    parts.push(limb(P["shin" + s], P["foot" + s], 0.062, look.dress ? look.skin : look.pants, "shin" + s));
    parts.push(block(0.25, 0.08, 0.11, P["foot" + s][0] + 0.06, 0.04, P["foot" + s][2], look.shoes, "foot" + s, 0.03));
    parts.push(limb(P["upperArm" + s], P["foreArm" + s], 0.058, look.shirt, "upperArm" + s));
    parts.push(limb(P["foreArm" + s], P["hand" + s], 0.05, sleeve, "foreArm" + s));
    parts.push(block(0.08, 0.11, 0.06, 0, P["hand" + s][1] - 0.05, P["hand" + s][2], look.skin, "hand" + s, 0.025));
  }
  parts.push(block(0.24, 0.22, 0.36, 0, 0.97, 0, look.dress ?? look.pants, "hips", 0.07));
  parts.push(block(0.24, 0.24, 0.38, 0, 1.17, 0, look.shirt, "spine", 0.08));
  parts.push(block(0.26, 0.3, 0.44, 0, 1.38, 0, look.shirt, "chest", 0.1));
  if (look.dress) parts.push(block(0.34, 0.3, 0.42, 0, 0.82, 0, look.dress, "hips", 0.1));
  if (look.vest) parts.push(block(0.3, 0.42, 0.42, 0, 1.31, 0, look.vest, "chest", 0.06));
  parts.push(limb([0, 1.52, 0], [0, 1.62, 0], 0.055, look.skin, "neck"));
  parts.push(ball(0.115, 0.01, 1.73, 0, look.skin, "head", 1.0, 1.15, 0.95));
  parts.push(block(0.04, 0.05, 0.04, 0.115, 1.72, 0, look.skin, "head", 0.015)); // nose
  if (look.hat === "cap" || look.hat === "police") {
    parts.push(ball(0.122, 0.0, 1.79, 0, look.hatColor, "head", 1.05, 0.7, 1.0));
    parts.push(block(0.12, 0.02, 0.2, 0.13, 1.8, 0, look.hatColor, "head", 0.01));
    if (look.hat === "police") parts.push(block(0.03, 0.05, 0.08, 0.1, 1.84, 0, 0xd4af37, "head", 0.01));
  } else if (look.hat === "bandana") {
    parts.push(ball(0.121, 0.0, 1.78, 0, look.hatColor, "head", 1.04, 0.72, 1.0));
  } else if (look.hat === "beret") {
    parts.push(ball(0.13, -0.02, 1.83, 0.02, look.hatColor, "head", 1.1, 0.45, 1.05));
  } else if (look.hat === "kofia") {
    const g = new THREE.CylinderGeometry(0.115, 0.118, 0.1, 14); g.translate(0, 1.82, 0);
    parts.push(skin(colorize(prep(g), look.hatColor), "head"));
  } else if (look.hat === "helmet") {
    parts.push(ball(0.15, 0.0, 1.75, 0, look.hatColor, "head", 1.05, 1.0, 1.0));
  } else {
    parts.push(ball(0.118, -0.01, 1.77, 0, 0x151110, "head", 1.0, 0.85, 0.96)); // short hair
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });

// ---------------------------------------------------------------------------
// Weapons (models only; behaviour lives in weapons.js). All point along +x.
// ---------------------------------------------------------------------------
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.35, metalness: 0.85 });
const gunPoly = new THREE.MeshStandardMaterial({ color: 0x2b2a26, roughness: 0.7, metalness: 0.1 });
const gunWood = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: 0.6 });
const gunTan = new THREE.MeshStandardMaterial({ color: 0x6b6247, roughness: 0.6, metalness: 0.2 });
const lens = new THREE.MeshStandardMaterial({ color: 0x0a1a2a, roughness: 0.05, metalness: 1, emissive: 0x0a2440, emissiveIntensity: 0.4 });
function piece(geo, mat, x, y, z, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; return m; }
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, l) => { const g = new THREE.CylinderGeometry(r, r, l, 10); g.rotateZ(Math.PI / 2); return g; };

export function weaponModel(kind) {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  muzzle.name = "muzzle";
  if (kind === "pistol") {
    g.add(piece(bx(0.2, 0.05, 0.035), gunMetal, 0.06, 0.03, 0), piece(bx(0.05, 0.11, 0.035), gunPoly, -0.01, -0.03, 0, 0.25));
    muzzle.position.set(0.17, 0.035, 0);
  } else if (kind === "rifle") {
    g.add(piece(bx(0.42, 0.07, 0.05), gunMetal, 0.12, 0.02, 0), piece(cyl(0.015, 0.3), gunMetal, 0.47, 0.035, 0),
      piece(bx(0.22, 0.08, 0.045), gunWood, -0.2, 0.0, 0), piece(bx(0.05, 0.16, 0.04), gunMetal, 0.12, -0.08, 0, -0.35),
      piece(bx(0.05, 0.1, 0.04), gunPoly, -0.02, -0.06, 0, 0.3), piece(bx(0.16, 0.05, 0.05), gunWood, 0.3, 0.0, 0));
    muzzle.position.set(0.63, 0.035, 0);
  } else if (kind === "shotgun") {
    g.add(piece(cyl(0.022, 0.6), gunMetal, 0.28, 0.035, 0), piece(cyl(0.02, 0.45), gunMetal, 0.22, 0.0, 0),
      piece(bx(0.26, 0.08, 0.05), gunWood, -0.2, 0.0, 0), piece(bx(0.14, 0.05, 0.05), gunWood, 0.2, -0.01, 0));
    muzzle.position.set(0.59, 0.035, 0);
  } else if (kind === "sniper") {
    g.add(piece(bx(0.4, 0.06, 0.05), gunTan, 0.05, 0.0, 0), piece(cyl(0.016, 0.55), gunMetal, 0.52, 0.02, 0),
      piece(bx(0.3, 0.09, 0.045), gunTan, -0.3, -0.01, 0), piece(cyl(0.032, 0.3), gunMetal, 0.08, 0.09, 0),
      piece(new THREE.CircleGeometry(0.028, 12).rotateY(Math.PI / 2), lens, 0.235, 0.09, 0), piece(bx(0.05, 0.13, 0.04), gunPoly, -0.06, -0.07, 0, 0.3));
    muzzle.position.set(0.8, 0.02, 0);
  } else if (kind === "rocket") {
    g.add(piece(cyl(0.075, 1.0), gunTan, 0.15, 0.06, 0), piece(cyl(0.085, 0.12), gunMetal, 0.65, 0.06, 0),
      piece(bx(0.05, 0.14, 0.04), gunPoly, 0.05, -0.05, 0, 0.2), piece(bx(0.12, 0.06, 0.05), gunMetal, 0.2, 0.15, 0));
    muzzle.position.set(0.72, 0.06, 0);
  } else if (kind === "grenade") {
    g.add(piece(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6 }), 0, 0, 0));
    muzzle.position.set(0.05, 0, 0);
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// ---------------------------------------------------------------------------
// A person
// ---------------------------------------------------------------------------
export class Person {
  constructor(look) {
    this.look = look;
    this.group = new THREE.Group();
    const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
    for (const n of BONES) {
      const b = bones[B[n]];
      const p = PIVOT[n], pp = PARENT[n] ? PIVOT[PARENT[n]] : [0, 0, 0];
      b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      if (PARENT[n]) bones[B[PARENT[n]]].add(b);
    }
    this.bones = Object.fromEntries(BONES.map((n) => [n, bones[B[n]]]));
    const mesh = new THREE.SkinnedMesh(bodyGeometry(look), MAT);
    mesh.add(bones[B.hips]);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds don't follow bones; we cull by distance instead
    mesh.position.y = -0.9;
    this.mesh = mesh;
    this.body = new THREE.Group(); // leans and falls
    this.body.add(mesh);
    this.group.add(this.body);
    this.phase = Math.random() * 10;
    this.weapon = null;
    this.weaponKind = null;
    this.recoil = 0; this.flinch = 0; this.dead = 0; this.deadDir = 1; this.crouch = 0; this.aimBlend = 0;
  }

  setWeapon(kind) {
    if (this.weaponKind === kind) return;
    if (this.weapon) this.weapon.removeFromParent();
    this.weaponKind = kind;
    this.weapon = kind ? weaponModel(kind) : null;
    if (this.weapon) {
      // the hand bone points down the arm (−y); weapons point along +x
      this.weapon.rotation.set(0, 0, -Math.PI / 2);
      this.weapon.position.set(0, -0.09, 0.02);
      this.bones.handR.add(this.weapon);
    }
  }
  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.weapon) return this.bones.handR.getWorldPosition(out);
    this.group.updateWorldMatrix(true, true);
    return this.weapon.userData.muzzle.getWorldPosition(out);
  }

  /**
   * s: { speed, fwd, side (−1..1 movement relative to facing), aim (bool), pitch, crouch, dead, ride: null|"car"|"bike", sprint }
   */
  animate(dt, s) {
    const b = this.bones;
    const lerp = (a, c, t) => a + (c - a) * Math.min(1, t);
    this.aimBlend = lerp(this.aimBlend, s.aim ? 1 : 0, dt * 12);
    this.crouch = lerp(this.crouch, s.crouch ? 1 : 0, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.flinch = Math.max(0, this.flinch - dt * 4);
    for (const n of BONES) b[n].rotation.set(0, 0, 0);
    b.hips.position.set(0, PIVOT.hips[1], 0);

    if (s.dead) {
      this.dead = Math.min(1, this.dead + dt * 2.4);
      const t = 1 - Math.pow(1 - this.dead, 3);
      this.body.rotation.z = -this.deadDir * t * 1.5;
      this.body.position.y = -t * 0.75;
      b.thighL.rotation.z = 0.3 * t; b.thighR.rotation.z = -0.2 * t;
      b.upperArmL.rotation.x = -1.2 * t; b.upperArmR.rotation.x = 1.2 * t;
      return;
    }
    this.dead = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);

    if (s.ride) {
      // seated: thighs forward, shins down, hands on the wheel or bars
      b.hips.position.y = PIVOT.hips[1] - (s.ride === "bike" ? 0.05 : 0.38);
      b.thighL.rotation.z = b.thighR.rotation.z = 1.45;
      b.shinL.rotation.z = b.shinR.rotation.z = s.ride === "bike" ? -1.75 : -1.45;
      const lean = s.ride === "bike" ? 0.35 : 0.1;
      b.spine.rotation.z = -lean;
      b.upperArmL.rotation.z = b.upperArmR.rotation.z = 1.0 + lean;
      b.foreArmL.rotation.z = b.foreArmR.rotation.z = 0.4;
      b.upperArmL.rotation.x = 0.15; b.upperArmR.rotation.x = -0.15;
      if (s.aim) { b.upperArmR.rotation.z = 1.5; b.foreArmR.rotation.z = 0; b.chest.rotation.z = s.pitch * 0.6; }
      return;
    }

    // legs: a walk or run cycle scaled by speed
    const sp = s.speed;
    const stride = s.sprint ? 2.1 : 1.45;
    this.phase += (sp / stride) * Math.PI * dt;
    const ph = this.phase;
    const amp = Math.min(1, sp / 2.2) * (s.sprint ? 0.95 : 0.62);
    const dir = s.fwd < -0.3 ? -1 : 1;
    const sideways = Math.abs(s.side) > 0.5 && Math.abs(s.fwd) < 0.5;
    const swing = Math.sin(ph) * amp * dir;
    if (sideways) {
      b.thighL.rotation.x = Math.sin(ph) * amp * 0.6 * Math.sign(s.side);
      b.thighR.rotation.x = -Math.sin(ph) * amp * 0.6 * Math.sign(s.side);
    } else {
      b.thighL.rotation.z = swing;
      b.thighR.rotation.z = -swing;
    }
    b.shinL.rotation.z = -Math.max(0, -Math.cos(ph)) * amp * 1.3;
    b.shinR.rotation.z = -Math.max(0, Math.cos(ph)) * amp * 1.3;
    b.footL.rotation.z = -swing * 0.3; b.footR.rotation.z = swing * 0.3;
    const bob = Math.abs(Math.cos(ph)) * amp * 0.06;
    b.hips.position.y = PIVOT.hips[1] - bob - this.crouch * 0.32;
    b.hips.rotation.y = swing * 0.15;
    b.spine.rotation.z = -(s.sprint ? 0.22 : 0.06) * Math.min(1, sp / 3) + this.crouch * 0.3;
    // crouch
    if (this.crouch > 0.01) {
      b.thighL.rotation.z += this.crouch * 0.95; b.thighR.rotation.z += this.crouch * 0.75;
      b.shinL.rotation.z -= this.crouch * 1.5; b.shinR.rotation.z -= this.crouch * 1.25;
      b.footL.rotation.z += this.crouch * 0.5; b.footR.rotation.z += this.crouch * 0.5;
    }

    // arms: swing when relaxed, hold the weapon when aiming (blend)
    const relaxL = { z: -swing * 0.8, x: 0.12 }, relaxR = { z: swing * 0.8, x: -0.12 };
    const pitch = s.pitch ?? 0;
    const twoHanded = this.weaponKind && this.weaponKind !== "pistol" && this.weaponKind !== "grenade";
    const holdK = this.weaponKind ? Math.max(this.aimBlend, twoHanded ? 0.35 : 0) : 0;
    const recoil = this.recoil * (twoHanded ? 0.12 : 0.3);
    // aiming: the right arm points the weapon forward, the left arm supports it
    const aimR = { z: 1.5 + pitch * 0.8 + recoil, x: 0, y: 0.12, fz: 0.0 };
    const aimL = twoHanded ? { z: 1.3 + pitch * 0.8, x: 0, y: -0.6, fz: 0.25 } : { z: 1.45 + pitch * 0.8, x: 0, y: -0.45, fz: 0.1 };
    b.upperArmR.rotation.z = lerp(relaxR.z, aimR.z, holdK);
    b.upperArmR.rotation.x = lerp(relaxR.x, aimR.x, holdK);
    b.upperArmR.rotation.y = lerp(0, aimR.y, holdK);
    b.foreArmR.rotation.z = lerp(0.15, aimR.fz, holdK);
    b.upperArmL.rotation.z = lerp(relaxL.z, aimL.z, holdK);
    b.upperArmL.rotation.x = lerp(relaxL.x, aimL.x, holdK);
    b.upperArmL.rotation.y = lerp(0, aimL.y, holdK);
    b.foreArmL.rotation.z = lerp(0.15, aimL.fz, holdK);
    // aim up/down with the chest, and a flinch when hit
    b.chest.rotation.z = pitch * 0.35 * holdK + this.recoil * 0.05 - this.flinch * 0.25;
    b.chest.rotation.x = this.flinch * 0.2 * Math.sin(this.phase * 3);
    b.head.rotation.z = pitch * 0.25;
  }
}
