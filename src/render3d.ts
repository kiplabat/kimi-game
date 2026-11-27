// The 3D renderer on three.js: shape kits made in code, world presets, cameras,
// pooled particles/beams/rings, bloom, and quality that adapts to the machine.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Entity } from "./entity";
import type { Game } from "./game";
import type { Renderer, CameraCtl, BurstOpts, BeamOpts, RingOpts, Rect } from "./renderer";
import { lerp, angleLerp, rng } from "./math";

export const PRESETS: Record<string, { sky: [string, string]; fog: string; fogDensity: number; floor: string; grid: string; hemi: [string, string, number]; sun: [string, number]; bloom: number; exposure: number; stars: boolean; glow: number }> = {
  neon: { sky: ["#02030b", "#0b0f2e"], fog: "#060918", fogDensity: 0.018, floor: "#05070f", grid: "#2fd7ff", hemi: ["#5a6cff", "#08040f", 0.6], sun: ["#9fb3ff", 0.9], bloom: 1.05, exposure: 1.0, stars: true, glow: 0.9 },
  night: { sky: ["#01020a", "#121a3a"], fog: "#0a0f22", fogDensity: 0.02, floor: "#0f1424", grid: "#3a4a80", hemi: ["#8090ff", "#101018", 0.5], sun: ["#aab8ff", 0.7], bloom: 0.8, exposure: 1.0, stars: true, glow: 0.6 },
  day: { sky: ["#5aa8ff", "#d9eeff"], fog: "#cfe6ff", fogDensity: 0.008, floor: "#7cbf62", grid: "#5a9d48", hemi: ["#ffffff", "#5b6b3a", 1.1], sun: ["#fff4d6", 2.2], bloom: 0.25, exposure: 1.0, stars: false, glow: 0.15 },
  dusk: { sky: ["#2b1b4a", "#ff8a5c"], fog: "#5a3350", fogDensity: 0.014, floor: "#2a1f35", grid: "#ff7a59", hemi: ["#ffb08a", "#20102a", 0.8], sun: ["#ffb27a", 1.6], bloom: 0.6, exposure: 1.05, stars: false, glow: 0.5 },
  space: { sky: ["#000000", "#05051a"], fog: "#000005", fogDensity: 0.004, floor: "", grid: "", hemi: ["#8899ff", "#000000", 0.5], sun: ["#ffffff", 1.4], bloom: 1.0, exposure: 1.0, stars: true, glow: 0.8 },
};

// ---------- shape kits (built facing +x, unit size) ----------
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const matCache = new Map<string, THREE.Material>();
function mat(color: string, glow: number, opts: { metal?: number; rough?: number; basic?: boolean; flat?: boolean } = {}) {
  const key = `${color}|${glow}|${opts.metal}|${opts.rough}|${opts.basic}|${opts.flat}`;
  let m = matCache.get(key);
  if (!m) {
    if (opts.basic) {
      const c = new THREE.Color(color).multiplyScalar(1 + glow * 2);
      m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    } else {
      m = new THREE.MeshStandardMaterial({
        color, emissive: new THREE.Color(color), emissiveIntensity: glow,
        metalness: opts.metal ?? 0.35, roughness: opts.rough ?? 0.45, flatShading: opts.flat ?? false,
      });
    }
    matCache.set(key, m);
  }
  return m;
}
const FLASH = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), toneMapped: false });

type Kit = (c: string, c2: string, glow: number, e: Entity) => THREE.Object3D;
const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
};

export const KITS: Record<string, Kit> = {
  ship(c, c2, glow) {
    const g = new THREE.Group();
    const body = mesh(geo("ship-body", () => { const x = new THREE.ConeGeometry(0.55, 2.2, 6); x.rotateZ(-Math.PI / 2); return x; }), mat(c, glow * 0.6, { flat: true }));
    const wing = mesh(geo("ship-wing", () => new THREE.BoxGeometry(0.9, 0.08, 2.1)), mat(c, glow * 0.4, { flat: true }));
    wing.position.x = -0.35;
    const fin = mesh(geo("ship-fin", () => new THREE.BoxGeometry(0.6, 0.5, 0.08)), mat(c2, glow));
    fin.position.set(-0.6, 0.25, 0);
    const eng = mesh(geo("ship-eng", () => new THREE.SphereGeometry(0.28, 12, 8)), mat(c2, 2.5, { basic: true }));
    eng.position.x = -1.05;
    eng.name = "engine";
    const cock = mesh(geo("ship-cock", () => new THREE.SphereGeometry(0.26, 12, 8)), mat("#ffffff", 0.6));
    cock.position.set(0.25, 0.22, 0);
    cock.scale.set(1.4, 0.6, 0.8);
    g.add(body, wing, fin, eng, cock);
    g.scale.setScalar(0.85);
    return g;
  },
  drone(c, c2, glow) {
    const g = new THREE.Group();
    const core = mesh(geo("drone-core", () => new THREE.IcosahedronGeometry(0.6, 0)), mat(c, glow, { flat: true }));
    const ring = mesh(geo("drone-ring", () => new THREE.TorusGeometry(0.95, 0.08, 6, 24)), mat(c2, glow * 1.8, { basic: true }));
    ring.rotation.x = Math.PI / 2;
    ring.name = "spin";
    g.add(core, ring);
    return g;
  },
  orb(c, _c2, glow) {
    const g = new THREE.Group();
    g.add(mesh(geo("orb", () => new THREE.SphereGeometry(1, 20, 14)), mat(c, glow * 1.5 + 0.3, { basic: glow > 1 })));
    return g;
  },
  crystal(c, c2, glow) {
    const g = new THREE.Group();
    const m = mesh(geo("crystal", () => { const x = new THREE.OctahedronGeometry(1, 0); x.scale(1, 1.5, 1); return x; }), mat(c, glow, { flat: true, metal: 0.1, rough: 0.2 }));
    m.name = "spin";
    const inner = mesh(geo("crystal-in", () => new THREE.OctahedronGeometry(0.45, 0)), mat(c2, 2, { basic: true }));
    g.add(m, inner);
    return g;
  },
  rock(c, _c2, glow, e) {
    const k = "rock" + (e.id % 4);
    const g = new THREE.Group();
    g.add(mesh(geo(k, () => {
      const x = new THREE.DodecahedronGeometry(1, 0);
      const p = x.attributes.position as THREE.BufferAttribute;
      const r = rng(e.id % 4 + 11);
      const seen = new Map<string, number>();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!seen.has(key)) seen.set(key, 0.75 + r.next() * 0.45);
        const s = seen.get(key)!;
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
      }
      x.computeVertexNormals();
      return x;
    }), mat(c, glow * 0.2, { flat: true, rough: 0.9, metal: 0.05 })));
    return g;
  },
  ball(c, _c2, glow) {
    const g = new THREE.Group();
    g.add(mesh(geo("ball", () => new THREE.SphereGeometry(1, 24, 16)), mat(c, glow, { metal: 0.2, rough: 0.3 })));
    return g;
  },
  bullet(c, _c2, glow) {
    const g = new THREE.Group();
    const m = mesh(geo("bullet", () => { const x = new THREE.CapsuleGeometry(0.5, 1.6, 4, 8); x.rotateZ(Math.PI / 2); return x; }), mat(c, 1.2 + glow, { basic: true }));
    m.castShadow = false;
    g.add(m);
    return g;
  },
  coin(c, c2, glow) {
    const g = new THREE.Group();
    const m = mesh(geo("coin", () => { const x = new THREE.CylinderGeometry(1, 1, 0.22, 24); x.rotateX(Math.PI / 2); return x; }), mat(c, glow + 0.3, { metal: 0.9, rough: 0.25 }));
    m.name = "spin";
    const ring = mesh(geo("coin-r", () => new THREE.TorusGeometry(0.62, 0.08, 6, 24)), mat(c2, 1.2));
    m.add(ring);
    g.add(m);
    return g;
  },
  tank(c, c2, glow) {
    const g = new THREE.Group();
    const body = mesh(geo("tank-body", () => new THREE.BoxGeometry(2, 0.6, 1.5)), mat(c, glow * 0.3, { flat: true }));
    const turret = new THREE.Group();
    turret.name = "turret";
    turret.position.y = 0.45;
    turret.add(mesh(geo("tank-tur", () => new THREE.CylinderGeometry(0.5, 0.6, 0.4, 8)), mat(c2, glow * 0.3, { flat: true })));
    const barrel = mesh(geo("tank-bar", () => { const x = new THREE.CylinderGeometry(0.12, 0.12, 1.3, 8); x.rotateZ(Math.PI / 2); x.translate(0.75, 0, 0); return x; }), mat(c2, glow * 0.3));
    turret.add(barrel);
    g.add(body, turret);
    g.scale.setScalar(0.6);
    return g;
  },
  car(c, c2, glow) {
    const g = new THREE.Group();
    g.add(mesh(geo("car-body", () => new THREE.BoxGeometry(2.2, 0.5, 1.1)), mat(c, glow * 0.3, { metal: 0.6, rough: 0.3 })));
    const cab = mesh(geo("car-cab", () => new THREE.BoxGeometry(1, 0.4, 0.9)), mat(c2, glow * 0.2, { metal: 0.2, rough: 0.1 }));
    cab.position.set(-0.15, 0.42, 0);
    g.add(cab);
    for (const [x, z] of [[0.7, 0.55], [0.7, -0.55], [-0.7, 0.55], [-0.7, -0.55]]) {
      const w = mesh(geo("car-wheel", () => { const t = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12); t.rotateX(Math.PI / 2); return t; }), mat("#111", 0));
      w.position.set(x, -0.2, z);
      g.add(w);
    }
    g.scale.setScalar(0.5);
    return g;
  },
  character(c, c2, glow) {
    const g = new THREE.Group();
    const body = mesh(geo("char-body", () => new THREE.CapsuleGeometry(0.45, 0.8, 4, 10)), mat(c, glow * 0.3));
    const head = mesh(geo("char-head", () => new THREE.SphereGeometry(0.38, 14, 10)), mat(c2, glow * 0.3));
    head.position.y = 0.95;
    const eye = mesh(geo("char-eye", () => new THREE.BoxGeometry(0.1, 0.1, 0.5)), mat("#111", 0));
    eye.position.set(0.32, 1.0, 0);
    g.add(body, head, eye);
    g.scale.setScalar(0.55);
    return g;
  },
  tree(c, c2) {
    const g = new THREE.Group();
    const trunk = mesh(geo("tree-trunk", () => new THREE.CylinderGeometry(0.15, 0.22, 1, 6)), mat(c2 === "#e6f0ff" ? "#6b4a2b" : c2, 0, { rough: 0.9 }));
    const top = mesh(geo("tree-top", () => new THREE.ConeGeometry(0.8, 1.6, 7)), mat(c, 0.05, { flat: true, rough: 0.8 }));
    top.position.y = 1.2;
    g.add(trunk, top);
    return g;
  },
  building(c, c2, glow) {
    const g = new THREE.Group();
    const b = mesh(geo("bld", () => { const x = new THREE.BoxGeometry(1, 1, 1); return x; }), mat(c, glow * 0.15, { rough: 0.7 }));
    const w = mesh(geo("bld-w", () => new THREE.BoxGeometry(1.02, 0.08, 1.02)), mat(c2, 1.5, { basic: true }));
    w.position.y = 0.2;
    const w2 = w.clone(); w2.position.y = -0.1;
    g.add(b, w, w2);
    return g;
  },
  boss(c, c2, glow) {
    const g = new THREE.Group();
    const core = mesh(geo("boss-core", () => new THREE.IcosahedronGeometry(1, 1)), mat(c, glow * 0.5, { flat: true, metal: 0.6, rough: 0.35 }));
    core.name = "spin";
    const spikes = new THREE.Group();
    const spikeGeo = geo("boss-spike", () => { const x = new THREE.ConeGeometry(0.18, 0.7, 5); x.translate(0, 1.2, 0); return x; });
    const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position as THREE.BufferAttribute;
    const dirs = new Set<string>();
    for (let i = 0; i < ico.count; i++) dirs.add(`${ico.getX(i).toFixed(2)},${ico.getY(i).toFixed(2)},${ico.getZ(i).toFixed(2)}`);
    for (const d of dirs) {
      const [x, y, z] = d.split(",").map(Number);
      const s = mesh(spikeGeo, mat(c2, glow * 1.4));
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z).normalize());
      spikes.add(s);
    }
    core.add(spikes);
    const ring1 = mesh(geo("boss-ring", () => new THREE.TorusGeometry(1.7, 0.05, 6, 48)), mat(c2, 0.35, { basic: true }));
    ring1.name = "ring1";
    const ring2 = ring1.clone();
    ring2.name = "ring2";
    const eye = mesh(geo("boss-eye", () => new THREE.SphereGeometry(0.42, 16, 12)), mat("#ffffff", 3, { basic: true }));
    eye.position.x = 0.85;
    eye.name = "eye";
    g.add(core, ring1, ring2, eye);
    return g;
  },
  star(c, _c2, glow) {
    const g = new THREE.Group();
    const m = mesh(geo("star", () => new THREE.OctahedronGeometry(1, 0)), mat(c, glow + 0.8, { flat: true }));
    m.name = "spin";
    g.add(m);
    return g;
  },
  pillar(c, c2, glow, e) {
    const g = new THREE.Group();
    const h = e.box ? 1 : 2;
    const m = mesh(geo("pillar", () => new THREE.CylinderGeometry(1, 1, 1, 12)), mat(c, glow * 0.2, { metal: 0.5, rough: 0.4 }));
    m.scale.y = e.box ? e.box[1] : h * e.radius;
    const band = mesh(geo("pillar-band", () => new THREE.CylinderGeometry(1.03, 1.03, 0.12, 12)), mat(c2, 2, { basic: true }));
    band.position.y = m.scale.y * 0.3;
    g.add(m, band);
    g.userData.noScale = true;
    g.scale.set(e.radius, 1, e.radius);
    return g;
  },
  block(c, c2, glow, e) {
    const g = new THREE.Group();
    const [w, h, d] = e.box ?? [e.radius * 2, e.radius * 2, e.radius * 2];
    const m = mesh(geo("block", () => new THREE.BoxGeometry(1, 1, 1)), mat(c, glow * 0.3, { rough: 0.6 }));
    m.scale.set(w, h, d ?? w);
    const edge = new THREE.LineSegments(geo("block-edge", () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))), new THREE.LineBasicMaterial({ color: new THREE.Color(c2 === "#e6f0ff" ? c : c2).multiplyScalar(2), toneMapped: false }));
    edge.scale.copy(m.scale);
    g.add(m, edge);
    g.userData.noScale = true;
    return g;
  },
  circle(c, _c2, glow) {
    const g = new THREE.Group();
    g.add(mesh(geo("ball", () => new THREE.SphereGeometry(1, 24, 16)), mat(c, glow)));
    return g;
  },
};
KITS.wall = KITS.block;
KITS.platform = KITS.block;
KITS.paddle = KITS.block;
KITS.enemy = KITS.drone;
KITS.player = KITS.ship;
KITS.food = KITS.coin;
KITS.snake = KITS.block;

// ---------- particles ----------
const PMAX = 4000;
const PVS = `
attribute float size; attribute vec4 rgba; varying vec4 vC;
void main(){ vC = rgba; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const PFS = `
varying vec4 vC;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.0, r); gl_FragColor = vec4(vC.rgb * (1.0 + a), vC.a * a); }`;

class Particles {
  geo = new THREE.BufferGeometry();
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
  points: THREE.Points;
  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("rgba", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.points = new THREE.Points(this.geo, m);
    this.points.frustumCulled = false;
  }
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color, g: number, fade: boolean) {
    let i = this.n;
    if (i >= PMAX) i = Math.floor(Math.random() * PMAX); else this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.rgb.set([c.r, c.g, c.b], i * 3);
    this.life[i] = this.max[i] = life;
    this.base[i] = size;
    this.grav[i] = g;
    this.fade[i] = fade ? 1 : 0;
  }
  update(dt: number) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.rgb.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.base[i] = this.base[j];
          this.grav[i] = this.grav[j]; this.fade[i] = this.fade[j];
          i--;
        }
        continue;
      }
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= drag; this.vel[k + 1] *= drag; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) { this.pos[k + 1] = 0.02; this.vel[k + 1] *= -0.4; }
      const t = this.life[i] / this.max[i];
      const a = this.fade[i] ? t : 1;
      this.col[i * 4] = this.rgb[k]; this.col[i * 4 + 1] = this.rgb[k + 1]; this.col[i * 4 + 2] = this.rgb[k + 2]; this.col[i * 4 + 3] = a;
      this.size[i] = this.base[i] * (0.35 + 0.65 * t);
    }
    this.geo.setDrawRange(0, this.n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.rgba as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

// ---------- floor and sky ----------
function gridFloor(size: number, color: string, base: string, radius: number) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uB: { value: new THREE.Color(base) }, uT: { value: 0 }, uR: { value: radius }, uPulse: { value: 0 }, uFog: { value: new THREE.Color("#000") }, uFogD: { value: 0 } },
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
    extensions: { derivatives: true } as any,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), m);
  plane.rotation.x = -Math.PI / 2;
  plane.receiveShadow = false;
  return plane;
}
function skyDome(top: string, bottom: string) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uBot: { value: new THREE.Color(bottom) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP; void main(){ float h = clamp(vP.y * 0.5 + 0.5, 0.0, 1.0); gl_FragColor = vec4(mix(uBot, uTop, pow(h, 0.7)), 1.0); }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), m);
}
function starField(n: number) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3);
  const r = rng(3);
  for (let i = 0; i < n; i++) {
    const u = r.next() * 2 - 1, th = r.next() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    p.set([Math.cos(th) * s * 350, Math.abs(u) * 350 + 10, Math.sin(th) * s * 350], i * 3);
  }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.7, 2), size: 1.2, sizeAttenuation: false, toneMapped: false, fog: false }));
}

// ---------- the renderer ----------
export class Render3D implements Renderer {
  readonly is3d = true;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam: THREE.PerspectiveCamera;
  readonly THREE = THREE;
  composer?: EffectComposer;
  bloom?: UnrealBloomPass;
  private particles = new Particles();
  private beams: { m: THREE.Mesh; life: number; max: number }[] = [];
  private rings: { m: THREE.Mesh; life: number; max: number; r: number }[] = [];
  private pool = new Map<string, THREE.Object3D[]>();
  private floor?: THREE.Mesh;
  private sun!: THREE.DirectionalLight;
  private preset: (typeof PRESETS)[string];
  private ray = new THREE.Raycaster();
  private v3 = new THREE.Vector3();
  private quality = 2;
  private qualityMax = 3;
  private frameMs: number[] = [];
  private raisedOnce = false;
  private pipeline?: (dt: number) => void;
  private qualityFns: ((q: number) => void)[] = [];
  private modeCam: any = { kind: "topdown", e: null, height: 22, distance: 14, lerp: 5, lead: 0.35 };
  private camPos = new THREE.Vector3(0, 22, 14);
  private camLook = new THREE.Vector3();
  private trauma = 0;
  camera: CameraCtl;

  constructor(private g: Game) {
    const custom = g.opts.preset === "custom";
    const p = (this.preset = PRESETS[g.opts.preset ?? "neon"] ?? PRESETS.neon);
    this.renderer = new THREE.WebGLRenderer({ antialias: !custom, powerPreference: "high-performance", stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = p.exposure;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.canvas = this.renderer.domElement;
    g.root.prepend(this.canvas);
    this.cam = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
    if (!custom) {
      this.scene.fog = new THREE.FogExp2(new THREE.Color(p.fog), p.fogDensity);
      this.scene.add(skyDome(p.sky[1], p.sky[0]));
      if (p.stars) this.scene.add(starField(1400));
    }
    const hemi = new THREE.HemisphereLight(p.hemi[0], p.hemi[1], p.hemi[2]);
    this.sun = new THREE.DirectionalLight(p.sun[0], p.sun[1]);
    this.sun.position.set(18, 40, 12);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.far = 120;
    // preset "custom": the game brings its own sky, lights and fog
    if (!custom) this.scene.add(hemi, this.sun, this.sun.target);
    const b = g.bounds;
    const size = b.kind === "circle" ? b.r * 6 : Math.max(b.x1 - b.x0, b.y1 - b.y0) * 3;
    if (g.opts.floor !== false && p.floor && !custom) {
      this.floor = gridFloor(Math.max(200, size), p.grid, p.floor, b.kind === "circle" ? b.r : 0);
      const u = (this.floor.material as THREE.ShaderMaterial).uniforms;
      u.uFog.value = new THREE.Color(p.fog);
      u.uFogD.value = p.fogDensity;
      this.scene.add(this.floor);
    }
    this.scene.add(this.particles.points);
    // quality: start from what the machine suggests, then adapt
    const q = g.opts.quality ?? "auto";
    const cores = navigator.hardwareConcurrency ?? 4;
    this.quality = q === "low" ? 0 : q === "medium" ? 1 : q === "high" ? 3 : cores >= 8 ? 3 : 2;
    this.qualityMax = q === "auto" ? 3 : this.quality;
    this.applyQuality();

    const self = this;
    this.camera = {
      yaw: 0,
      zoom: 1,
      shake(a) { self.trauma = Math.min(1, self.trauma + a); },
      follow(e, o = {}) { this.topdown(e, o as any); },
      topdown(e, o = {}) { self.modeCam = { kind: "topdown", e, height: o.height ?? 22, distance: o.distance ?? (o.height ?? 22) * 0.62, lerp: o.lerp ?? 5, lead: o.lead ?? 0.35 }; this.yaw = 0; },
      chase(e, o = {}) { self.modeCam = { kind: "chase", e, distance: o.distance ?? 7, height: o.height ?? 3.2, lerp: o.lerp ?? 6 }; },
      orbit(at, o = {}) { self.modeCam = { kind: "orbit", at, radius: o.radius ?? 30, height: o.height ?? 16, speed: o.speed ?? 0.12 }; },
      firstPerson(e, o = {}) { self.modeCam = { kind: "first", e, height: o.height ?? 1.6 }; },
      fixed(pos, look) { self.modeCam = { kind: "fixed", pos, look }; this.yaw = 0; },
      manual() { self.modeCam = { kind: "manual" }; },
      center(x, y) { this.fixed([x, 30, y + 18], [x, 0, y]); },
    };
    this.resize();
  }

  private applyQuality() {
    const q = this.quality;
    const dpr = devicePixelRatio || 1;
    this.renderer.setPixelRatio(q >= 3 ? Math.min(2, dpr) : q === 2 ? Math.min(1.5, dpr) : q === 1 ? 1 : 0.75);
    this.renderer.shadowMap.enabled = q >= 3;
    this.sun.castShadow = q >= 3;
    if (q >= 2 && this.g.opts.bloom !== false && this.preset.bloom > 0) {
      if (!this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.cam));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.preset.bloom * 0.8, 0.45, 0.8);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      }
    } else {
      this.composer?.dispose();
      this.composer = undefined;
      this.bloom = undefined;
    }
    this.resize();
    // the game's own settings come last, so they win (shadows, pixel ratio, its own passes)
    for (const f of this.qualityFns) try { f(q); } catch (err) { this.g._error(err); }
  }

  resize() {
    const w = this.g.root.clientWidth || innerWidth, h = this.g.root.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.cam.aspect = w / h;
    // keep the whole arena in view on tall phones
    this.cam.fov = w / h < 0.8 ? 75 : 55;
    this.cam.updateProjectionMatrix();
  }

  private poolKey(e: Entity) {
    const o = e.opts;
    return `${o.shape ?? "circle"}|${o.color}|${o.color2}|${o.glow}|${e.box?.join(",") ?? ""}|${o.shape === "rock" ? e.id % 4 : ""}|${o.shape === "pillar" ? e.radius : ""}`;
  }
  attach(e: Entity) {
    const o = e.opts;
    if (o.hidden) { e.visual = null; return; }
    let obj: THREE.Object3D;
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
      const list: THREE.Mesh[] = [];
      obj.traverse((c: any) => { if (c.isMesh) list.push(c); });
      obj.userData.flashList = list;
    }
    e.visual = obj;
    this.scene.add(obj);
  }
  detach(e: Entity) {
    const obj = e.visual as THREE.Object3D;
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
  private setFlash(obj: THREE.Object3D, on: boolean) {
    for (const m of obj.userData.flashList as THREE.Mesh[]) {
      if (on) { m.userData.mat = m.userData.mat ?? m.material; m.material = FLASH; }
      else if (m.userData.mat) m.material = m.userData.mat;
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

  view(): Rect | null { return null; }
  project(x: number, y: number, z: number) {
    this.v3.set(x, y, z).project(this.cam);
    if (this.v3.z > 1) return null;
    const w = this.g.root.clientWidth, h = this.g.root.clientHeight;
    return { x: (this.v3.x * 0.5 + 0.5) * w, y: (-this.v3.y * 0.5 + 0.5) * h };
  }
  updatePointer() {
    const p = this.g.input.pointer;
    const w = this.g.root.clientWidth, h = this.g.root.clientHeight;
    this.ray.setFromCamera(new THREE.Vector2((p.x / w) * 2 - 1, -(p.y / h) * 2 + 1), this.cam);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.g.opts.aimHeight ?? 0.6));
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(plane, hit)) { p.world.x = hit.x; p.world.y = hit.z; }
  }

  burst(at: number[], o: BurstOpts) {
    const n = o.count ?? 20;
    const r = this.g.rand;
    const cols = (Array.isArray(o.color) ? o.color : [o.color ?? "#ffffff"]).map((c) => new THREE.Color(c).multiplyScalar(1.6));
    for (let i = 0; i < n; i++) {
      let ang = r(0, Math.PI * 2);
      if (o.dir) ang = Math.atan2(o.dir[1], o.dir[0]) + r(-(o.spread ?? 0.5), o.spread ?? 0.5);
      const sp = (o.speed ?? 8) * r(0.25, 1);
      const up = (o.up ?? 0.5) * sp * r(0, 1);
      this.particles.add(at[0], at[1], at[2], Math.cos(ang) * sp, up, Math.sin(ang) * sp, (o.life ?? 0.7) * r(0.6, 1), (o.size ?? 0.35) * r(0.7, 1.3), cols[i % cols.length], o.gravity ?? 0, o.fade ?? true);
    }
  }
  beam(a: number[], b: number[], o: BeamOpts) {
    const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
    const len = va.distanceTo(vb);
    const m = new THREE.Mesh(
      geo("beam", () => { const x = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); x.rotateX(Math.PI / 2); return x; }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? "#ffffff").multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    const w = (o.width ?? 0.12);
    m.scale.set(w, w, len);
    m.position.copy(va).lerp(vb, 0.5);
    m.lookAt(vb);
    this.scene.add(m);
    this.beams.push({ m, life: o.life ?? 0.25, max: o.life ?? 0.25 });
  }
  ring(at: number[], o: RingOpts) {
    const m = new THREE.Mesh(
      geo("ringfx", () => { const x = new THREE.RingGeometry(0.92, 1, 64); x.rotateX(-Math.PI / 2); return x; }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? "#ffffff").multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    m.position.set(at[0], Math.max(0.05, (at[1] ?? 0) * 0.2), at[2]);
    this.scene.add(m);
    this.rings.push({ m, life: o.life ?? 0.45, max: o.life ?? 0.45, r: o.radius ?? 4 });
  }

  render(alpha: number, dt: number) {
    const g = this.g, s = g.current;
    const t = g.time;
    this.renderer.info.reset();
    if (s) {
      for (const e of s.entities) {
        const obj = e.visual as THREE.Object3D;
        if (!obj) continue;
        obj.visible = e.visible && !(e.invuln > 0 && Math.floor(e.invuln * 20) % 2);
        obj.position.set(lerp(e.ox, e.x, alpha), lerp(e.oy, e.y, alpha), lerp(e.oz, e.z, alpha));
        obj.rotation.y = -angleLerp(e.orot, e.rot, alpha);
        // a little life: bank when turning, spin parts
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
    // camera
    const mc = this.modeCam;
    if (mc.kind === "manual") { this.renderFx(dt); return; }
    const k = 1 - Math.exp(-(mc.lerp ?? 5) * Math.max(dt, 1 / 240));
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    if ((mc.kind === "topdown" || mc.kind === "chase" || mc.kind === "first") && mc.e?.alive) {
      const e = mc.e as Entity;
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
  private renderFx(dt: number) {
    const t = this.g.time;
    // fx
    this.particles.update(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) { this.scene.remove(b.m); (b.m.material as THREE.Material).dispose(); this.beams.splice(i, 1); continue; }
      (b.m.material as THREE.MeshBasicMaterial).opacity = b.life / b.max;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) { this.scene.remove(r.m); (r.m.material as THREE.Material).dispose(); this.rings.splice(i, 1); continue; }
      const p = 1 - r.life / r.max;
      r.m.scale.setScalar(0.2 + r.r * (1 - Math.pow(1 - p, 3)));
      (r.m.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }
    if (this.floor) {
      const u = (this.floor.material as THREE.ShaderMaterial).uniforms;
      u.uT.value = t;
      u.uPulse.value = Math.max(0, u.uPulse.value - dt * 1.5);
    }
    if (this.pipeline) this.pipeline(dt);
    else if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.cam);
    this.adapt(dt);
  }

  /** Brighten the floor grid for a moment (beats, shockwaves). */
  pulse(v = 0.6) {
    if (this.floor) (this.floor.material as THREE.ShaderMaterial).uniforms.uPulse.value = v;
  }

  /** Replace the final draw with your own (your own EffectComposer, passes, scopes…). null restores the default. */
  setPipeline(fn: ((dt: number) => void) | null) { this.pipeline = fn ?? undefined; }
  /** Called with the new level (0 low … 3 ultra) whenever quality changes, and once at once. */
  onQuality(fn: (q: number) => void) { this.qualityFns.push(fn); fn(this.quality); }
  get level() { return this.quality; }
  /** Set quality yourself (0..3); adaptive changes continue unless adaptive is false. */
  setQuality(q: number) { this.quality = Math.max(0, Math.min(3, Math.round(q))); this.qualityMax = Math.max(this.qualityMax, this.quality); this.applyQuality(); }

  private adapt(dt: number) {
    if (this.g.state !== "play" && this.g.state !== "title") return;
    const ad = this.g.opts.adaptive;
    if (ad === false) return;
    const lower = typeof ad === "object" ? ad.lowerAbove ?? 24 : 24;
    const raise = typeof ad === "object" ? ad.raiseBelow ?? 11 : 11;
    this.frameMs.push(dt * 1000 / Math.max(this.g.timeScale, 0.05));
    if (this.frameMs.length < 120) return;
    const real = this.g.frameMs;
    this.frameMs.length = 0;
    if (real > lower && this.quality > 0) {
      this.quality--;
      this.applyQuality();
      this.g._note(`quality lowered to ${this.quality} (frame time ${real.toFixed(0)} ms)`);
    } else if (real < raise && this.quality < this.qualityMax && !this.raisedOnce) {
      this.raisedOnce = true;
      this.quality++;
      this.applyQuality();
    }
  }

  describe() {
    const info = this.renderer.info;
    return {
      renderer: "three.js r" + THREE.REVISION,
      quality: this.quality,
      bloom: !!this.composer,
      shadows: this.renderer.shadowMap.enabled,
      pixelRatio: this.renderer.getPixelRatio(),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      particles: this.particles.n,
      camera: this.modeCam.kind,
    };
  }
}
