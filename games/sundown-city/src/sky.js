// Sky, sun and moon, day and night. The sky drives the light colours, the fog (drawn in the
// final pass, see render.js), the reflections every shiny thing uses (a PMREM environment map
// refreshed as the sun moves), the stars, and how much windows and street lamps glow.

import * as THREE from "three";
import { WORLD, NOISE_TEX } from "./materials.js";

// A stylised sky: a zenith-to-horizon gradient, a sun disc with glow, and drifting clouds.
// (A physical sky blew out to white around a high sun; this one stays rich and controllable.)
const SKY_VS = `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FS = `
uniform vec3 uSun, uZenith, uHorizon, uSunCol, uCloud; uniform float uNight, uTime; uniform sampler2D uNoise; varying vec3 vDir;
float fbm(vec2 p){ return texture2D(uNoise, p * 0.0625).r * 0.8 + texture2D(uNoise, p * 0.25 + 0.37).b * 0.2; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));             // below the horizon
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += uSunCol * (pow(sd, 18.0) * 0.35 + pow(sd, 400.0) * 1.2);         // glow
  col += uSunCol * smoothstep(0.99955, 0.9998, sd) * 12.0 * (1.0 - uNight); // disc
  if (h > 0.0) {                                                            // clouds
    vec2 p = d.xz / (h + 0.12) * 0.55 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = fbm(p * 1.4);
    float cov = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.22, h);
    float lit = 0.75 + 0.25 * fbm(p * 2.8 + 4.0) + pow(sd, 6.0) * 0.6;
    col = mix(col, uCloud * lit, cov * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}`;
class StylSky extends THREE.Mesh {
  constructor() {
    super(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: true,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uSunCol: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 }, uNoise: { value: NOISE_TEX } },
    }));
    this.frustumCulled = false;
    this.renderOrder = -10;
  }
}

const DAY_MINUTES = 16; // one game day in real minutes

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = 16.5; // start in the late afternoon: long shadows
    this.sky = new StylSky();
    this.sky.scale.setScalar(4000);
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 400;
    this.setShadowSize(70);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a2e22, 0.6);
    scene.add(this.hemi);

    // stars and a moon for the night
    const n = 2200, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random(), th = Math.random() * Math.PI * 2;
      const y = 0.05 + u1 * 0.95, s = Math.sqrt(1 - y * y);
      p.set([Math.cos(th) * s * 3000, y * 3000, Math.sin(th) * s * 3000], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdde6ff, fog: false, transparent: true, opacity: 0 }));
    scene.add(this.moon);

    // fog is drawn by the final pass from the depth buffer; these are its colours
    scene.fog = null;
    this.fogColor = new THREE.Color(0xa8b8c8);
    this.scatterColor = new THREE.Color();
    this.fogDensity = 0.003;
    this.warm = 0;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new StylSky();
    this.envSky.scale.setScalar(1000);
    this.envSky.material = this.sky.material; // same uniforms
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.envHour = -99;
    this.sunDir = new THREE.Vector3();
    this.lamps = [];
    this.update(0, new THREE.Vector3());
  }

  setShadowSize(s) {
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -s; sc.right = sc.top = s;
    sc.updateProjectionMatrix();
  }

  /** 0 day … 1 night. */
  get night() { return WORLD.uNight.value; }
  get timeText() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  update(dt, focus) {
    this.hour = (this.hour + (dt / 60) * (24 / DAY_MINUTES)) % 24;
    // sun path: rises at 6, sets at 18
    const a = ((this.hour - 6) / 12) * Math.PI;
    const elev = Math.sin(a);                  // -1 … 1
    const sunUp = elev > -0.05;
    this.sunDir.set(Math.cos(a) * 0.9, elev, 0.35).normalize();
    const night = THREE.MathUtils.smoothstep(-elev, -0.02, 0.22);
    WORLD.uNight.value = night;
    const lowSun = 1 - THREE.MathUtils.smoothstep(elev, 0.02, 0.4);   // golden hour
    const u = this.sky.material.uniforms;
    u.uSun.value.copy(this.sunDir);
    u.uNight.value = night;
    u.uTime.value += dt;
    const lerp3 = (a, b, t) => new THREE.Color(...a).lerp(new THREE.Color(...b), t);
    const zen = lerp3([0.16, 0.38, 0.95], [0.22, 0.25, 0.6], lowSun).lerp(new THREE.Color(0.004, 0.008, 0.025), night);
    const hor = lerp3([0.62, 0.78, 1.0], [1.15, 0.6, 0.35], lowSun).lerp(new THREE.Color(0.03, 0.04, 0.08), night);
    u.uZenith.value.copy(zen).multiplyScalar(1.5);
    u.uHorizon.value.copy(hor).multiplyScalar(1.5);
    u.uSunCol.value.copy(lerp3([1.0, 0.95, 0.85], [1.0, 0.5, 0.2], lowSun)).multiplyScalar(1 - night * 0.9);
    u.uCloud.value.copy(lerp3([1.25, 1.25, 1.3], [1.3, 0.75, 0.55], lowSun)).lerp(new THREE.Color(0.05, 0.06, 0.09), night);

    // the light that casts shadows: the sun by day, the moon by night
    const light = sunUp ? this.sunDir : new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, 0.2).normalize();
    this.sun.position.copy(focus).addScaledVector(light, 200);
    this.sun.target.position.copy(focus);
    const low = THREE.MathUtils.smoothstep(elev, 0.0, 0.35);
    const warm = new THREE.Color(1.0, 0.55 + 0.4 * low, 0.32 + 0.6 * low);
    if (sunUp) { this.sun.color.copy(warm); this.sun.intensity = 0.25 + 4.1 * THREE.MathUtils.smoothstep(elev, -0.05, 0.25); }
    else { this.sun.color.setRGB(0.55, 0.68, 1.0); this.sun.intensity = 0.9; }
    // daylight is mostly sun: a sun-to-sky ratio near 4:1 gives shape and contrast (sky fills, sun models)
    this.hemi.color.setRGB(0.62 + 0.12 * low, 0.66 + 0.08 * low, 0.78).lerp(new THREE.Color(0.3, 0.38, 0.6), night);
    this.hemi.groundColor.setRGB(0.3, 0.24, 0.17).lerp(new THREE.Color(0.12, 0.1, 0.1), night);
    this.hemi.intensity = 0.5 + 0.22 * (1 - night) * (0.6 + 0.4 * low);

    // fog takes the horizon's colour, a little darker, so far buildings melt into the sky;
    // the sun lights it from its side (warm haze at golden hour)
    this.fogColor.copy(hor).multiplyScalar(0.62);
    this.scatterColor.copy(u.uSunCol.value).multiplyScalar(0.55 * (1 - night) * (0.5 + 0.5 * lowSun));
    this.fogDensity = 0.0022 + 0.0016 * lowSun + 0.0018 * night;
    this.warm = lowSun * (1 - night);
    this.renderer.toneMappingExposure = 0.42 + 0.12 * (1 - night) + night * 0.5;

    this.stars.material.opacity = night * 0.9;
    this.stars.position.copy(focus);
    this.moon.material.opacity = night;
    this.moon.position.copy(focus).addScaledVector(new THREE.Vector3(-this.sunDir.x, Math.abs(this.sunDir.y) + 0.25, -0.4).normalize(), 2600);
    this.sky.position.copy(focus);
    if (this.hills) this.hills.material.color.copy(hor).multiplyScalar(0.42 + 0.1 * night).lerp(new THREE.Color(0.12, 0.16, 0.12), 0.25 * (1 - night));

    for (const m of this.lamps) m.emissiveIntensity = night * (m.userData.night ?? 4);

    // reflections follow the sky: refresh the environment map now and then
    if (Math.abs(this.hour - this.envHour) > 0.35 || this.envTarget === null) {
      this.envHour = this.hour;
      this.envTarget?.dispose();
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1100);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = 0.14 + 0.34 * (1 - night);
    }
  }
}
