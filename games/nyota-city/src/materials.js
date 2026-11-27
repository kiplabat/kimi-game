// Materials made in code: the ground (roads, markings, sidewalks, parks, plazas) and the
// building facades (windows that reflect the sky by day and light up at night) are shaders on
// top of three.js's physical material, so they get real lighting, shadows and fog for free.
// Small textures (smoke, ads, liveries) are drawn on canvases.

import * as THREE from "three";
import { HALF, PITCH, N } from "./layout.js";

const NOISE = /* glsl */ `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** Shared uniforms the sky updates (night 0..1 lights windows and lamps). */
export const WORLD = { uNight: { value: 0 }, uTime: { value: 0 } };

function worldPosVarying(shader, instanced) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vSeed;\nvarying float vH;")
    .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
      {
        mat4 m = modelMatrix;
        ${instanced ? "#ifdef USE_INSTANCING\n m = modelMatrix * instanceMatrix;\n#endif" : ""}
        vWPos = (m * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(m) * objectNormal);
        vSeed = fract(sin(dot(m[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        vH = length(m[1].xyz);
      }`);
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
export function groundMaterial(plan) {
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = (j * N + i) * 4;
    data[k] = plan.use[i][j] * 16;
    data[k + 3] = 255;
  }
  const blocks = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  blocks.magFilter = blocks.minFilter = THREE.NearestFilter;
  blocks.needsUpdate = true;

  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBlocks = { value: blocks };
    shader.uniforms.uNight = WORLD.uNight;
    worldPosVarying(shader, false);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vSeed; varying float vH;
        uniform sampler2D uBlocks; uniform float uNight;
        ${NOISE}
        const float HALF = ${HALF.toFixed(1)}; const float PITCH = ${PITCH.toFixed(1)};
        float gRough = 0.85;
        vec3 groundCol(vec2 p) {
          float fx = mod(p.x + HALF, PITCH), fz = mod(p.y + HALF, PITCH);
          float dx = min(fx, PITCH - fx), dz = min(fz, PITCH - fz);
          bool outside = abs(p.x) > HALF + 7.0 || abs(p.y) > HALF + 7.0;
          bool rz = dx < 7.0 && abs(p.y) < HALF + 7.0, rx = dz < 7.0 && abs(p.x) < HALF + 7.0;
          float n = fbm(p * 0.35), n2 = vnoise(p * 3.1);
          if (outside && !rz && !rx) {           // dry grass and red soil around the city
            gRough = 1.0;
            return mix(vec3(0.20, 0.16, 0.08), vec3(0.18, 0.22, 0.08), smoothstep(0.35, 0.65, fbm(p * 0.05))) * (0.75 + 0.5 * n);
          }
          if (rz || rx) {                         // asphalt
            vec3 c = vec3(0.055, 0.057, 0.062) * (0.78 + 0.45 * n) + 0.02 * n2;
            c = mix(c, vec3(0.035), smoothstep(0.6, 0.75, fbm(p * 0.08 + 7.0)) * 0.6); // patches
            gRough = 0.78 + 0.2 * n2;
            bool inter = rz && rx;
            float paint = 0.0;
            if (rz && !inter) {
              paint += step(dx, 0.12) * step(mod(p.y, 9.0), 4.5);      // dashed centre line
              paint += step(abs(dx - 6.3), 0.1);                       // edge lines
              if (dz > 7.6 && dz < 10.6 && dx < 6.0) paint += step(mod(p.x, 1.3), 0.65); // zebra
            }
            if (rx && !inter) {
              paint += step(dz, 0.12) * step(mod(p.x, 9.0), 4.5);
              paint += step(abs(dz - 6.3), 0.1);
              if (dx > 7.6 && dx < 10.6 && dz < 6.0) paint += step(mod(p.y, 1.3), 0.65);
            }
            paint = clamp(paint, 0.0, 1.0) * (0.7 + 0.3 * vnoise(p * 5.0)); // worn paint
            gRough = mix(gRough, 0.55, paint);
            return mix(c, vec3(0.62, 0.62, 0.58), paint);
          }
          if (dx < 11.0 || dz < 11.0) {           // sidewalks with a stone curb
            float d = min(dx, dz);
            if (d < 7.4) { gRough = 0.7; return vec3(0.36, 0.35, 0.33) * (0.9 + 0.2 * n2); }
            vec2 t = fract(p / 1.5);
            float grout = step(t.x, 0.04) + step(t.y, 0.04);
            gRough = 0.8;
            vec3 c = vec3(0.27, 0.26, 0.245) * (0.85 + 0.3 * h21(floor(p / 1.5))) * (0.9 + 0.2 * n);
            return mix(c, vec3(0.12), clamp(grout, 0.0, 1.0) * 0.8);
          }
          // inside a block: what kind?
          vec2 bi = floor((p + HALF) / PITCH);
          float use = floor(texture2D(uBlocks, (bi + 0.5) / ${N.toFixed(1)}).r * 255.0 / 16.0 + 0.5);
          vec2 lp = p - (-HALF + bi * PITCH + PITCH * 0.5);
          if (abs(use - 2.0) < 0.5) {             // park: grass with paths
            float path = step(abs(lp.x), 1.6) + step(abs(lp.y), 1.6) + step(abs(length(lp) - 12.0), 1.5);
            vec3 grass = mix(vec3(0.07, 0.17, 0.04), vec3(0.16, 0.24, 0.06), fbm(p * 0.2)) * (0.8 + 0.4 * n2);
            gRough = mix(0.95, 0.85, clamp(path, 0.0, 1.0));
            return mix(grass, vec3(0.34, 0.27, 0.2) * (0.85 + 0.3 * n2), clamp(path, 0.0, 1.0));
          }
          if (abs(use - 3.0) < 0.5) {             // plaza paving
            vec2 t = fract(lp / 2.0);
            float g = step(t.x, 0.03) + step(t.y, 0.03);
            float ring = step(abs(length(lp) - 9.0), 0.6) + step(abs(length(lp) - 15.0), 0.4);
            vec3 c = mix(vec3(0.36, 0.30, 0.25), vec3(0.42, 0.40, 0.36), h21(floor(lp / 2.0))) * (0.9 + 0.2 * n);
            c = mix(c, vec3(0.55, 0.22, 0.12), clamp(ring, 0.0, 1.0) * 0.7);
            gRough = 0.75;
            return mix(c, vec3(0.15), clamp(g, 0.0, 1.0) * 0.6);
          }
          // concrete yards and alleys, with joints and oil stains
          vec2 t = fract(lp / 4.0);
          float j = step(t.x, 0.015) + step(t.y, 0.015);
          vec3 c = vec3(0.28, 0.28, 0.27) * (0.8 + 0.35 * n);
          c *= 1.0 - smoothstep(0.62, 0.8, fbm(p * 0.3 + 3.0)) * 0.5;
          gRough = 0.9;
          return mix(c, vec3(0.1), clamp(j, 0.0, 1.0) * 0.7);
        }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.rgb *= groundCol(vWPos.xz);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = gRough;`);
  };
  m.customProgramCacheKey = () => "nyota-ground";
  return m;
}

// ---------------------------------------------------------------------------
// Facades: one shader, a few styles. Windows are drawn from the world position,
// so a box of any size gets the right number of windows.
// ---------------------------------------------------------------------------
const STYLES = {
  // window width, floor height, glass share, shopfront at street level
  glass:    { ww: 2.2, fh: 3.8, frame: 0.06, shop: 0, wall: [0.16, 0.2, 0.24], glassTint: [0.1, 0.16, 0.2], mullion: 1 },
  concrete: { ww: 3.0, fh: 3.6, frame: 0.18, shop: 1, wall: [0.55, 0.53, 0.5], glassTint: [0.06, 0.08, 0.1], mullion: 0 },
  plaster:  { ww: 3.4, fh: 3.4, frame: 0.24, shop: 1, wall: [0.7, 0.62, 0.5], glassTint: [0.05, 0.07, 0.08], mullion: 0 },
  brick:    { ww: 3.2, fh: 3.5, frame: 0.22, shop: 0, wall: [0.45, 0.22, 0.14], glassTint: [0.05, 0.07, 0.08], mullion: 0 },
};

export function facadeMaterial(styleName, opts = {}) {
  const st = STYLES[styleName];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, envMapIntensity: 1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = WORLD.uNight;
    worldPosVarying(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vSeed; varying float vH;
        uniform float uNight;
        ${NOISE}
        float fRough = 0.8, fMetal = 0.0; vec3 fEmit = vec3(0.0);
        vec3 facade(vec3 base) {
          vec3 n = normalize(vWNrm);
          if (n.y > 0.5) { fRough = 0.95; return vec3(0.22, 0.22, 0.21) * (0.8 + 0.4 * vnoise(vWPos.xz * 1.7)); }   // roof
          if (n.y < -0.5) { return base * 0.4; }
          float u = abs(n.x) > 0.5 ? vWPos.z : vWPos.x;
          float v = vWPos.y;
          float H = ${opts.height ? opts.height.toFixed(2) : "vH"};
          const float WW = ${st.ww.toFixed(2)}; const float FH = ${st.fh.toFixed(2)}; const float FR = ${st.frame.toFixed(2)};
          vec2 cell = vec2(floor(u / WW), floor(v / FH));
          vec2 c = vec2(fract(u / WW), fract(v / FH));
          float grime = 0.85 + 0.3 * vnoise(vec2(u, v) * 0.15) - 0.15 * smoothstep(1.5, 0.0, v);
          vec3 wall = base * grime;
          if (v > H - 0.7) { fRough = 0.8; return wall * 0.75; }                       // parapet
          bool shopFloor = ${st.shop ? "v < 4.4" : "false"};
          if (shopFloor) {
            if (v > 3.7) { fRough = 0.6; return mix(vec3(0.6, 0.12, 0.08), vec3(0.1, 0.3, 0.55), step(0.5, vSeed)) * 0.8; } // signboard band
            float sc = fract(u / 6.0);
            if (v > 0.15 && v < 3.4 && sc > 0.06 && sc < 0.94) {                      // shop window
              fRough = 0.05; fMetal = 0.9;
              float lit = step(0.35, h21(vec2(floor(u / 6.0), vSeed * 91.0)));
              fEmit = vec3(1.0, 0.78, 0.5) * lit * (0.08 + 0.55 * uNight);
              return vec3(${st.glassTint.map((x) => x.toFixed(3)).join(",")});
            }
            fRough = 0.7;
            return wall * 0.6;
          }
          ${st.mullion ? `
          // glass tower: continuous glass with thin mullions and floor bands
          float mull = step(c.x, FR) + step(abs(c.y - 0.02), 0.03);
          if (mull > 0.5) { fRough = 0.4; fMetal = 0.6; return vec3(0.18, 0.2, 0.22); }
          fRough = 0.03; fMetal = 1.0;
          float lit = step(0.76, h21(cell + vSeed * 37.0));
          fEmit = mix(vec3(1.0, 0.85, 0.6), vec3(0.7, 0.85, 1.0), h21(cell.yx + 3.0)) * lit * uNight * 0.5;
          return vec3(${st.glassTint.map((x) => x.toFixed(3)).join(",")}) * (0.8 + 0.4 * h21(cell * 1.3));` : `
          bool win = c.x > FR && c.x < 1.0 - FR && c.y > 0.3 && c.y < 0.86 && v > 1.2;
          if (win) {
            float sill = step(c.y, 0.33);
            if (sill > 0.5) { fRough = 0.6; return vec3(0.75); }
            fRough = 0.06; fMetal = 0.85;
            float lit = step(0.66, h21(cell + vSeed * 37.0));
            float curtain = step(0.7, h21(cell * 2.1 + 9.0));
            fEmit = mix(vec3(1.0, 0.75, 0.45), vec3(0.75, 0.85, 1.0), step(0.8, h21(cell.yx))) * lit * uNight * (curtain > 0.5 ? 0.25 : 0.55);
            return mix(vec3(${st.glassTint.map((x) => x.toFixed(3)).join(",")}), vec3(0.5, 0.45, 0.38), curtain * 0.6);
          }
          ${styleName === "brick" ? `
          vec2 b = vec2(u * 4.0 + step(1.0, mod(floor(v * 12.0), 2.0)) * 0.5, v * 12.0);
          float mortar = step(fract(b.x), 0.06) + step(fract(b.y), 0.1);
          float bfar = smoothstep(0.15, 0.5, max(fwidth(b.x), fwidth(b.y))); // too small to draw: blend to the average
          vec3 brick = mix(wall * (0.8 + 0.4 * h21(floor(b))), vec3(0.42, 0.4, 0.36), clamp(mortar, 0.0, 1.0));
          wall = mix(brick, mix(wall, vec3(0.42, 0.4, 0.36), 0.15), bfar);` : ""}
          fRough = 0.85;
          return wall;`}
        }
        // far away: the average of wall and glass, so distant towers don't shimmer
        vec3 facadeAA(vec3 base) {
          vec3 n = normalize(vWNrm);
          vec3 c = facade(base);
          if (abs(n.y) > 0.5) return c;
          float u = abs(n.x) > 0.5 ? vWPos.z : vWPos.x;
          float fw = max(fwidth(u / ${st.ww.toFixed(2)}), fwidth(vWPos.y / ${st.fh.toFixed(2)}));
          float far = smoothstep(0.07, 0.28, fw);
          if (far <= 0.0) return c;
          vec3 glass = vec3(${st.glassTint.map((x) => x.toFixed(3)).join(",")});
          vec3 avg = mix(base * 0.9, glass, ${st.mullion ? "0.8" : "0.4"});
          fEmit = mix(fEmit, vec3(1.0, 0.82, 0.55) * uNight * ${st.mullion ? "0.12" : "0.13"}, far);
          fRough = mix(fRough, ${st.mullion ? "0.15" : "0.5"}, far);
          fMetal = mix(fMetal, ${st.mullion ? "0.8" : "0.3"}, far);
          return mix(c, avg, far);
        }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        diffuseColor.rgb = facadeAA(diffuseColor.rgb);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = fRough;`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = fMetal;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmit;`);
  };
  m.customProgramCacheKey = () => "nyota-facade-" + styleName + (opts.height ?? "");
  if (opts.height) m.color = new THREE.Color(...st.wall); // a single building: its own wall colour
  return m;
}
export const STYLE_WALL = Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.wall]));

// ---------------------------------------------------------------------------
// Plain materials, shared
// ---------------------------------------------------------------------------
const cache = new Map();
export function mat(key, make) {
  let m = cache.get(key);
  if (!m) { m = make(); cache.set(key, m); }
  return m;
}
export const M = {
  concrete: () => mat("concrete", () => new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 0.9 })),
  darkConcrete: () => mat("dconcrete", () => new THREE.MeshStandardMaterial({ color: 0x4a4846, roughness: 0.95 })),
  plaster: () => mat("plaster", () => new THREE.MeshStandardMaterial({ color: 0xa89f8c, roughness: 0.9 })),
  metal: () => mat("metal", () => new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.35, metalness: 0.9 })),
  darkMetal: () => mat("dmetal", () => new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.8 })),
  wood: () => mat("wood", () => new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.75 })),
  rubber: () => mat("rubber", () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 })),
  glass: () => mat("glass", () => new THREE.MeshPhysicalMaterial({ color: 0x0b1418, roughness: 0.05, metalness: 0.2, transmission: 0, transparent: true, opacity: 0.55, envMapIntensity: 1.6 })),
  foliage: () => mat("foliage", () => new THREE.MeshStandardMaterial({ color: 0x2f5f1f, roughness: 0.85, flatShading: true })),
  trunk: () => mat("trunk", () => new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 })),
  lampOn: () => mat("lamp", () => { const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0 }); m.userData.night = 6; return m; }),
  tile: () => mat("tile", () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    m.map = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = "#b9b2a6"; c.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const k = 160 + ((x + y) % 2) * 30 + Math.random() * 10;
        c.fillStyle = `rgb(${k},${k - 6},${k - 14})`;
        c.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      }
    }, 4);
    return m;
  }),
};

/** Draw a texture on a canvas: canvasTexture(256, 128, (ctx, w, h) => …, repeat). */
export function canvasTexture(w, h, draw, repeat = 1) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/** Billboards: original brands only. */
const ADS = [
  ["NYOTA COLA", "ice cold since 1963", "#c81e2b", "#fff"],
  ["MATATU EXPRESS", "every route · every day", "#1b9e5a", "#ffe14d"],
  ["SIMBA DATA", "4G everywhere you roam", "#ffb300", "#1a1a1a"],
  ["KIMI OS", "talk to your computer", "#101828", "#36e2ff"],
  ["MAZIWA FRESH", "milk from the highlands", "#f4f1ea", "#1f6fb2"],
  ["BODA SAFE", "helmets save lives", "#ff5a1f", "#fff"],
];
export function adTexture(i) {
  const [title, sub, bg, fg] = ADS[i % ADS.length];
  return canvasTexture(512, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, bg); g.addColorStop(1, shade(bg, -0.25));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.globalAlpha = 0.15;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(w * 0.85, h * 0.5, 30 + k * 28, 0, Math.PI * 2); c.lineWidth = 8; c.strokeStyle = fg; c.stroke(); }
    c.globalAlpha = 1;
    c.font = "900 64px system-ui, sans-serif";
    c.fillText(title, 28, 118);
    c.font = "500 28px system-ui, sans-serif";
    c.fillText(sub, 30, 170);
  });
}
export const AD_COUNT = ADS.length;

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return "#" + c.getHexString();
}

/** A matatu's painted side: bright colours and a name, the way Nairobi's are. */
const MATATU_NAMES = ["NYOTA", "MOTO MOTO", "BARAKA", "SAFARI", "TUKO PAMOJA", "KASI"];
export function liveryTexture(i) {
  const palettes = [["#ffd60a", "#e63946", "#1d3557"], ["#06d6a0", "#118ab2", "#073b4c"], ["#ff006e", "#8338ec", "#ffbe0b"], ["#f77f00", "#fcbf49", "#003049"]];
  const [a, b, d] = palettes[i % palettes.length];
  return canvasTexture(512, 128, (c, w, h) => {
    c.fillStyle = a; c.fillRect(0, 0, w, h);
    c.fillStyle = b;
    c.beginPath(); c.moveTo(0, h * 0.55); c.bezierCurveTo(w * 0.3, h * 0.2, w * 0.6, h * 0.95, w, h * 0.45); c.lineTo(w, h); c.lineTo(0, h); c.fill();
    c.fillStyle = d;
    c.fillRect(0, h * 0.88, w, h * 0.12);
    c.font = "italic 900 54px system-ui, sans-serif";
    c.fillStyle = "#fff"; c.strokeStyle = d; c.lineWidth = 6;
    const name = MATATU_NAMES[i % MATATU_NAMES.length];
    c.strokeText(name, 30, 74); c.fillText(name, 30, 74);
  });
}

/** Soft round sprite for smoke and glows. */
export function softSprite() {
  return mat("soft", () => canvasTexture(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }));
}
