// The frame: three.js EffectComposer with passes chosen by quality.
//   0 low:    no shadows, FXAA, 0.75 resolution, short view
//   1 medium: shadows 1024, light bloom, FXAA
//   2 high:   soft shadows 2048, 4× MSAA, bloom
//   3 ultra:  shadows 4096, 4× MSAA, ambient occlusion (GTAO), bloom, longer view
// A grading pass adds contrast, saturation, a vignette and the red edges when hurt.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

const Grade = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uSat: { value: 1.2 }, uCon: { value: 1.16 }, uHurt: { value: 0 }, uTime: { value: 0 }, uWarm: { value: 0.0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVig, uSat, uCon, uHurt, uTime, uWarm; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uCon + 0.5;
      c *= vec3(1.0 + uWarm * 0.06, 1.0, 1.0 - uWarm * 0.05);
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      c *= 1.0 - uVig * smoothstep(0.08, 0.55, r);
      float edge = smoothstep(0.12, 0.5, r) * uHurt * (0.75 + 0.25 * sin(uTime * 9.0));
      c = mix(c, vec3(0.55, 0.0, 0.03), edge);
      // a little film grain against banding
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) / 255.0 * 2.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export const VIEW = [190, 280, 380, 520];

export class Pipeline {
  constructor(g, sky) {
    this.g = g;
    this.sky = sky;
    const t = g.three;
    this.renderer = t.renderer;
    this.scene = t.scene;
    this.camera = t.camera;
    this.camera.near = 0.08;
    this.quality = -1;
    this.grade = new ShaderPass(Grade);
    this.onQualityFns = [];
    t.setPipeline((dt) => this.render(dt));
    t.onQuality((q) => this.build(q));
    new ResizeObserver(() => this.resize()).observe(g.root);
  }

  size() {
    const w = this.g.root.clientWidth || innerWidth, h = this.g.root.clientHeight || innerHeight;
    return [w, h];
  }

  build(q) {
    this.quality = q;
    const r = this.renderer;
    const dpr = devicePixelRatio || 1;
    const pr = [0.75, 1, Math.min(dpr, 1.25), Math.min(dpr, 1.5)][q];
    r.setPixelRatio(pr);
    r.shadowMap.enabled = q >= 1;
    r.shadowMap.type = THREE.PCFShadowMap; // r187 filters PCF softly; PCFSoft is gone
    const sun = this.sky.sun;
    const size = [512, 1024, 2048, 4096][q];
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = q >= 1;
    this.sky.setShadowSize([50, 55, 70, 90][q]);
    this.scene.fog.far = VIEW[q];
    this.scene.fog.near = VIEW[q] * 0.3;
    this.camera.far = 6000;
    this.camera.updateProjectionMatrix();
    r.shadowMap.needsUpdate = true;

    this.composer?.dispose();
    const [w, h] = this.size();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q >= 2 ? 4 : 0 });
    const c = new EffectComposer(r, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (q >= 3) {
      const ao = new GTAOPass(this.scene, this.camera, w, h);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 });
      c.addPass(ao);
    }
    if (q >= 1) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.25, 0.4, 0.93);
      c.addPass(this.bloom);
    } else this.bloom = null;
    c.addPass(new OutputPass());
    c.addPass(this.grade);
    if (q < 2) c.addPass(new FXAAPass());
    c.setPixelRatio(pr);
    c.setSize(w, h);
    this.composer = c;
    for (const f of this.onQualityFns) f(q);
  }
  onQuality(fn) { this.onQualityFns.push(fn); if (this.quality >= 0) fn(this.quality); }

  resize() {
    const [w, h] = this.size();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Per-frame look: hurt edges, night bloom. */
  set hurt(v) { this.grade.uniforms.uHurt.value = v; }
  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    if (this.bloom) this.bloom.strength = 0.14 + 0.3 * this.sky.night;
    this.beforeRender?.(dt);
    this.composer?.render(dt);
  }
}
