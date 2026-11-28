// The frame. The scene is drawn once into a half-float target at the adaptive resolution
// (the engine's ladder lowers the scale before it lowers the effects), then one full-screen pass
// does everything else at the screen's own resolution:
//   height fog with the sun scattered in it (from the depth buffer, so no material pays for fog),
//   exposure and filmic tone mapping, grading, vignette, the red edges when hurt, a light
//   sharpen when the scene was drawn below full resolution, and dithering against banding.
// Then FXAA on the lower levels; MSAA on the higher ones.
//
//   level  shadows       anti-aliasing  bloom  ambient occlusion  view
//   0      none          FXAA           -      baked only         170 m
//   1      1024, ½ rate  FXAA           yes    baked only         260 m
//   2      2048          4× MSAA        yes    baked only         360 m
//   3      4096          4× MSAA        yes    baked + GTAO       520 m

import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

export const VIEW = [170, 260, 360, 520];

const FINAL = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
    uFogCol: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uFogNear: { value: 60 }, uFogFar: { value: 300 }, uFogDen: { value: 0.006 }, uFogFall: { value: 0.035 },
    uExposure: { value: 1 }, uSat: { value: 1.16 }, uCon: { value: 1.12 }, uVig: { value: 0.3 }, uHurt: { value: 0 }, uTime: { value: 0 }, uWarm: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) }, uSharp: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 uProjInv, uViewInv; uniform vec3 uCam;
    uniform vec3 uFogCol, uSunDir, uSunCol; uniform float uFogNear, uFogFar, uFogDen, uFogFall;
    uniform float uExposure, uSat, uCon, uVig, uHurt, uTime, uWarm, uSharp; uniform vec2 uTexel;
    varying vec2 vUv;
    vec3 aces(vec3 x) { // Hill's fitted ACES
      const mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      x = i * x;
      vec3 a = x * (x + 0.0245786) - 0.000090537, b = x * (0.983729 * x + 0.4329510) + 0.238081;
      return clamp(o * (a / b), 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uSharp > 0.0) { // drawn below full resolution: a little contrast-adaptive sharpening
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
        vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
        vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0);
        vec3 k = -sqrt(amp) * uSharp * 0.2;
        c = max((c + (n + s + e + w) * k) / (1.0 + 4.0 * k), 0.0);
      }
      float d = texture2D(tDepth, vUv).x;
      if (d < 1.0) {
        vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        v.xyz /= v.w;
        float dist = length(v.xyz);
        if (dist < 1200.0) {                       // the hills and the moon are a backdrop: no fog
          vec3 dir = normalize((uViewInv * vec4(v.xyz, 0.0)).xyz);
          // height fog: thick in the streets, thin above the roofs (analytic integral along the ray)
          float k = uFogFall * dir.y * dist;
          float amount = uFogDen * exp(-uFogFall * max(uCam.y, 0.0)) * dist * (abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0);
          float f = 1.0 - exp(-amount);
          f = max(f, smoothstep(uFogNear, uFogFar, dist)); // and nothing past the view distance
          vec3 fc = uFogCol + uSunCol * pow(max(dot(dir, uSunDir), 0.0), 7.0) * 0.8;
          c = mix(c, fc, clamp(f, 0.0, 1.0));
        }
      }
      c = toSRGB(aces(c * uExposure));
      // grading on the display image (as a colourist would)
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);
      c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
      c *= vec3(1.0 + uWarm * 0.05, 1.0, 1.0 - uWarm * 0.04);
      vec2 q = vUv - 0.5;
      float r = dot(q, q);
      c *= 1.0 - uVig * smoothstep(0.1, 0.6, r);
      float edge = smoothstep(0.12, 0.5, r) * uHurt * (0.75 + 0.25 * sin(uTime * 9.0));
      c = mix(c, vec3(0.55, 0.0, 0.03), edge);
      float nz = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c += (nz - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Pipeline {
  constructor(g, sky) {
    this.g = g;
    this.sky = sky;
    const t = g.three;
    this.renderer = t.renderer;
    this.scene = t.scene;
    this.camera = t.camera;
    this.camera.near = 0.08;
    this.camera.far = 6000;
    this.quality = -1;
    this.scale = 1;
    this.fogNear = 60; this.fogFar = 260;
    this.final = new THREE.ShaderMaterial({ ...FINAL, uniforms: THREE.UniformsUtils.clone(FINAL.uniforms), depthTest: false, depthWrite: false });
    this.finalQuad = new FullScreenQuad(this.final);
    this.fxaa = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
    this.fxaaQuad = new FullScreenQuad(this.fxaa);
    this.onQualityFns = [];
    this.renderer.autoClear = true;
    t.setPipeline((dt) => this.render(dt));
    t.onQuality((q) => this.build(q));
    t.onScale((s) => { this.scale = s; if (this.quality >= 0) this.resize(); });
    new ResizeObserver(() => this.resize()).observe(g.root);
  }

  size() {
    return [this.g.root.clientWidth || innerWidth, this.g.root.clientHeight || innerHeight];
  }
  outRatio(q) {
    const dpr = devicePixelRatio || 1;
    return [1, 1, Math.min(dpr, 1.25), Math.min(dpr, 1.5)][q];
  }

  build(q) {
    this.quality = q;
    const r = this.renderer;
    r.setPixelRatio(this.outRatio(q));
    r.shadowMap.enabled = q >= 1;
    r.shadowMap.type = THREE.PCFShadowMap;
    const sun = this.sky.sun;
    const size = [512, 1024, 2048, 4096][q];
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = q >= 1;
    this.sky.setShadowSize([45, 50, 65, 85][q]);
    this.fogFar = VIEW[q];
    this.fogNear = VIEW[q] * 0.35;
    r.shadowMap.needsUpdate = true;
    this.msaa = q >= 2 ? 4 : 0;
    this.useFxaa = q < 2;
    this.bloomOn = q >= 1;
    this.gtaoOn = q >= 3;
    this.rtKey = "";
    this.resize();
    for (const f of this.onQualityFns) f(q);
  }
  onQuality(fn) { this.onQualityFns.push(fn); if (this.quality >= 0) fn(this.quality); }

  resize() {
    if (this.quality < 0) return;
    const [w, h] = this.size();
    const r = this.renderer;
    r.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = r.getPixelRatio();
    const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
    const sw = Math.max(1, Math.round(W * this.scale)), sh = Math.max(1, Math.round(H * this.scale));
    const key = `${sw}x${sh}x${this.msaa}x${this.bloomOn}x${this.gtaoOn}x${this.useFxaa}x${W}x${H}x${this.quality}`;
    if (key === this.rtKey) return;
    this.rtKey = key;
    this.sceneRT?.dispose(); this.sceneRT?.depthTexture?.dispose();
    const depth = new THREE.DepthTexture(sw, sh);
    this.sceneRT = new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, samples: this.msaa, depthTexture: depth });
    if (this.bloomOn) {
      // the glow is soft anyway: at medium quality it is worked out at half resolution (a quarter of the cost)
      const bk = this.quality >= 2 ? 1 : 0.5;
      if (!this.bloom) this.bloom = new UnrealBloomPass(new THREE.Vector2(sw, sh), 0.25, 0.4, 0.93);
      this.bloom.setSize(Math.max(1, Math.round(sw * bk)), Math.max(1, Math.round(sh * bk)));
    }
    this.aoRT?.dispose(); this.aoRT = null;
    if (this.gtaoOn) {
      this.gtao?.dispose?.();
      this.gtao = new GTAOPass(this.scene, this.camera, sw, sh);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 });
      this.aoRT = new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType });
    }
    this.outRT?.dispose(); this.outRT = null;
    if (this.useFxaa) this.outRT = new THREE.WebGLRenderTarget(W, H);
    this.final.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    this.final.uniforms.uSharp.value = this.scale < 0.95 ? 1 - this.scale : 0;
    this.fxaa.uniforms.resolution.value.set(1 / W, 1 / H);
  }

  /** Per-frame look: hurt edges. */
  set hurt(v) { this.final.uniforms.uHurt.value = v; }

  render(dt) {
    this.beforeRender?.(dt);
    if (!this.sceneRT) return;
    const r = this.renderer, cam = this.camera, sky = this.sky, u = this.final.uniforms;
    // the scene
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);
    let src = this.sceneRT;
    if (this.gtao && this.gtaoOn) { this.gtao.render(r, this.aoRT, src, dt, false); src = this.aoRT; }
    if (this.bloom && this.bloomOn) {
      this.bloom.strength = 0.12 + 0.3 * sky.night;
      this.bloom.render(r, null, src, dt, false);
    }
    // fog, tone, grade, sharpen
    cam.updateMatrixWorld();
    u.tDiffuse.value = src.texture;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uViewInv.value.copy(cam.matrixWorld);
    u.uCam.value.copy(cam.position);
    u.uFogCol.value.copy(sky.fogColor);
    u.uSunDir.value.copy(sky.sunDir);
    u.uSunCol.value.copy(sky.scatterColor);
    u.uFogNear.value = this.fogNear; u.uFogFar.value = this.fogFar;
    u.uFogDen.value = sky.fogDensity;
    u.uExposure.value = r.toneMappingExposure / 0.6; // as three.js's ACES does
    u.uTime.value += dt;
    u.uWarm.value = sky.warm ?? 0;
    r.setRenderTarget(this.useFxaa ? this.outRT : null);
    this.finalQuad.render(r);
    if (this.useFxaa) {
      this.fxaa.uniforms.tDiffuse.value = this.outRT.texture;
      r.setRenderTarget(null);
      this.fxaaQuad.render(r);
    }
  }
}
