// Effects: smoke and fire (pooled GPU particles), bullet holes and scorch marks (instanced
// decals), muzzle flashes with real light, explosions with light, fire, smoke, debris and a ring.
// Sparks use the engine's additive particles (s.burst).

import * as THREE from "three";
import { softSprite, canvasTexture } from "./materials.js";

const VS = `
attribute float aSize; attribute vec4 aCol; varying vec4 vCol;
void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * (600.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `
uniform sampler2D map; varying vec4 vCol;
void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vCol.rgb, vCol.a * t.a); }`;

class Puffs {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max); this.base = new Float32Array(max); this.rgb = new Float32Array(max * 3); this.alpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aCol", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({ uniforms: { map: { value: softSprite() } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  add(p, v, life, size, grow, color, alpha) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos.set(p, i * 3); this.vel.set(v, i * 3);
    this.life[i] = this.maxLife[i] = life; this.base[i] = size; this.grow[i] = grow;
    this.rgb.set(color, i * 3); this.alpha[i] = alpha;
  }
  update(dt, rise) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (const [a, k] of [[this.pos, 3], [this.vel, 3], [this.rgb, 3]]) a.copyWithin(i * k, j * k, j * k + k);
          for (const a of [this.life, this.maxLife, this.base, this.grow, this.alpha]) a[i] = a[j];
          i--;
        }
        continue;
      }
      const k = i * 3, t = 1 - this.life[i] / this.maxLife[i];
      this.vel[k + 1] += rise * dt;
      const d = Math.exp(-1.5 * dt);
      this.vel[k] *= d; this.vel[k + 2] *= d; this.vel[k + 1] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.base[i] * (1 + this.grow[i] * t);
      const a = this.alpha[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      this.col.set([this.rgb[k], this.rgb[k + 1], this.rgb[k + 2], a], i * 4);
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ["position", "aCol", "aSize"]) this.geo.attributes[a].needsUpdate = true;
  }
}

class Decals {
  constructor(scene, max, texture, color, opacity = 0.9) {
    this.max = max; this.i = 0;
    const m = new THREE.MeshStandardMaterial({ map: texture, color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }
  add(p, n, size) {
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.v.set(n[0], n[1], n[2]).normalize());
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    this.m.compose(new THREE.Vector3(p[0] + n[0] * 0.015, p[1] + n[1] * 0.015, p[2] + n[2] * 0.015), this.q, this.s.set(size, size, size));
    this.mesh.setMatrixAt(this.i % this.max, this.m);
    this.i++;
    this.mesh.count = Math.min(this.i, this.max);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Contact shadows: a soft dark patch under every car and person on screen, in one draw call.
 * They ground things when the sun's shadow map is off (low quality) or too coarse to show it.
 */
export class ContactShadows {
  constructor(scene, cap = 160) {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, "rgba(0,0,0,0.85)"); gr.addColorStop(0.55, "rgba(0,0,0,0.45)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    });
    tex.repeat.set(1, 1);
    const m = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    m.toneMapped = false;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), m, cap);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.n = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }
  begin() { this.n = 0; }
  add(x, y, z, sx, sz, rot) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this._q.setFromEuler(this._e.set(0, -rot, 0));
    this.mesh.setMatrixAt(this.n++, this._m.compose(this._p.set(x, y + 0.03, z), this._q, this._s.set(sx, 1, sz)));
  }
  end() {
    const im = this.mesh;
    im.count = this.n;
    im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, this.n * 16);
    im.instanceMatrix.needsUpdate = true;
  }
}

export class FX {
  constructor(g, scene) {
    this.g = g; this.three = g.three.scene;
    this.smoke = new Puffs(this.three, 1400, false);
    this.fire = new Puffs(this.three, 900, true);
    const hole = canvasTexture(64, 64, (c, w, h) => {
      const gr = c.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      gr.addColorStop(0, "rgba(10,10,10,1)"); gr.addColorStop(0.25, "rgba(20,18,16,0.95)"); gr.addColorStop(0.5, "rgba(60,55,50,0.4)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    });
    this.holes = new Decals(this.three, 300, hole, 0xffffff);
    this.scorch = new Decals(this.three, 40, hole, 0x222222, 0.85);
    this.blood = new Decals(this.three, 80, softSprite(), 0x4a0303, 0.8);
    // a few real lights for flashes and fires
    this.lights = [];
    for (let k = 0; k < 4; k++) {
      const l = new THREE.PointLight(0xffaa55, 0, 18, 1.6);
      l.userData.life = 0; l.userData.max = 1; l.userData.peak = 0;
      this.three.add(l); this.lights.push(l);
    }
    const flashMat = new THREE.MeshBasicMaterial({ map: this.starTexture(), color: new THREE.Color(3, 2.2, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.flashes = [];
    for (let k = 0; k < 6; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flashMat);
      m.visible = false; m.userData.t = 0;
      this.three.add(m); this.flashes.push(m);
    }
    this.burning = []; // wrecks that keep burning
    this.cam = g.three.camera;
    this.contact = new ContactShadows(this.three);
  }
  /** Lights for flashes and fires: fewer at low quality (every light costs every lit pixel). */
  setQuality(q) { const n = [1, 1, 3, 4][q]; this.lights.forEach((l, i) => (l.visible = i < n)); }
  starTexture() {
    return canvasTexture(64, 64, (c, w, h) => {
      c.translate(w / 2, h / 2);
      const gr = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      gr.addColorStop(0, "rgba(255,255,230,1)"); gr.addColorStop(0.3, "rgba(255,200,90,0.8)"); gr.addColorStop(1, "rgba(255,120,20,0)");
      c.fillStyle = gr;
      for (let k = 0; k < 5; k++) { c.rotate((Math.PI * 2) / 5); c.beginPath(); c.moveTo(0, -4); c.lineTo(w / 2, 0); c.lineTo(0, 4); c.fill(); }
      c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill();
    });
  }
  light(p, color, peak, life, dist = 18) {
    const l = this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.set(p[0], p[1], p[2]); l.color.set(color); l.distance = dist;
    l.userData.life = l.userData.max = life; l.userData.peak = peak; l.intensity = peak;
  }
  muzzle(p, dir, big = false) {
    const m = this.flashes.find((f) => !f.visible) ?? this.flashes[0];
    m.visible = true; m.userData.t = 0.05;
    m.position.copy(p);
    m.lookAt(this.cam.position);
    m.scale.setScalar(big ? 1.8 : 1 + Math.random() * 0.4);
    m.rotation.z = Math.random() * 6.28;
    this.light([p.x, p.y, p.z], 0xffb060, big ? 40 : 14, 0.06, 10);
    void dir;
  }
  impact(p, n, kind = "wall") {
    const s = this.g.current;
    if (kind === "flesh") {
      s.burst(p, { count: 10, color: ["#8a0b0b", "#5a0505"], speed: 3, life: 0.35, size: 0.12, gravity: 9, up: 0.6 });
      return;
    }
    s.burst(p, { count: 7, color: ["#ffd27a", "#ffffff"], speed: 7, life: 0.18, size: 0.07, gravity: 12, up: 0.8 });
    this.smoke.add(p, [n[0] * 0.8, n[1] * 0.8 + 0.3, n[2] * 0.8], 0.6, 0.35, 2.5, [0.55, 0.52, 0.48], 0.45);
    if (kind === "wall") this.holes.add(p, n, 0.16);
  }
  bloodPool(p) { this.blood.add([p[0], 0.02, p[2]], [0, 1, 0], 0.8 + Math.random() * 0.6); }
  explosion(p, size = 1) {
    const s = this.g.current;
    this.light(p, 0xff9040, 260 * size, 0.5, 30 * size);
    for (let k = 0; k < 28 * size; k++) {
      const a = Math.random() * 6.28, u = Math.random();
      this.fire.add(p, [Math.cos(a) * 7 * u * size, 2 + Math.random() * 6 * size, Math.sin(a) * 7 * u * size], 0.45 + Math.random() * 0.4, 1.6 * size, 2.2, [1, 0.45 + Math.random() * 0.25, 0.12], 0.95);
    }
    for (let k = 0; k < 26 * size; k++) {
      const a = Math.random() * 6.28, u = Math.random();
      this.smoke.add([p[0], p[1] + 0.5, p[2]], [Math.cos(a) * 4 * u * size, 1.5 + Math.random() * 3, Math.sin(a) * 4 * u * size], 2.5 + Math.random() * 2.5, 2.4 * size, 3, [0.07, 0.065, 0.06], 0.85);
    }
    s.burst(p, { count: 60 * size, color: ["#ffd27a", "#ff7a2a", "#ffffff"], speed: 22 * size, life: 0.9, size: 0.12, gravity: 14, up: 1.2 });
    s.ring([p[0], p[1], p[2]], { color: "#ffb36b", radius: 9 * size, life: 0.45 });
    this.scorch.add([p[0], 0.02, p[2]], [0, 1, 0], 4 * size);
  }
  burn(entity, until) { this.burning.push({ e: entity, until }); }
  update(dt, time) {
    this.smoke.update(dt, 1.1);
    this.fire.update(dt, 3.5);
    for (const l of this.lights) {
      if (l.userData.life > 0) { l.userData.life -= dt; l.intensity = l.userData.peak * Math.max(0, l.userData.life / l.userData.max); }
      else l.intensity = 0;
    }
    for (const f of this.flashes) if (f.visible) { f.userData.t -= dt; if (f.userData.t <= 0) f.visible = false; }
    this.burning = this.burning.filter((b) => b.until > time);
    for (const b of this.burning) {
      if (Math.random() < dt * 30) {
        const e = b.e;
        const p = [e.x + (Math.random() - 0.5) * 2, e.y + 0.6, e.z + (Math.random() - 0.5) * 2];
        this.fire.add(p, [0, 1.5, 0], 0.5 + Math.random() * 0.4, 0.8, 1.2, [1, 0.5, 0.15], 0.8);
        if (Math.random() < 0.5) this.smoke.add([p[0], p[1] + 1, p[2]], [0.4, 2, 0.2], 3, 1.2, 3.5, [0.1, 0.1, 0.1], 0.6);
      }
    }
  }
}
