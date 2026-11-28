// Big worlds: the two tools that keep a city or a forest cheap to draw.
//   instances(): thousands of copies of one thing in one draw call, and only the copies the camera
//                can see (or that are close enough to cast a shadow into view) are drawn.
//   bake():      many static meshes merged into one mesh per material per cell of the ground, so a
//                street costs a few draw calls and whole cells drop out when they are off screen.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface InstanceOpts {
  /** Cast shadows (default true). */
  shadow?: boolean;
  /** Not drawn beyond this distance from the camera (default: the camera's far plane). */
  far?: number;
  /** Always drawn within this distance, even off screen, so shadows from behind the camera stay (default 30). */
  near?: number;
}
export interface AddOpts {
  scale?: number | [number, number, number];
  rotY?: number;
  color?: string | number | [number, number, number];
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _sphere = new THREE.Sphere(), _c = new THREE.Color();

/** Many copies of one geometry and material. Add copies, then the engine culls them every frame. */
export class Instances {
  mesh: THREE.InstancedMesh | null = null;
  readonly opts: InstanceOpts;
  private mats: number[] = [];
  private cols: number[] | null = null;
  private spheres: number[] = []; // x, y, z, r per copy
  private dirty = true;
  private lastCam = new Float32Array(16);
  private local: THREE.Sphere;
  visible = 0;
  constructor(readonly geometry: THREE.BufferGeometry, readonly material: THREE.Material, private scene: THREE.Scene, opts: InstanceOpts = {}) {
    this.opts = opts;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    this.local = geometry.boundingSphere!.clone();
  }
  get count() { return this.mats.length / 16; }

  /** Add a copy at x, y, z. Returns its index. */
  add(x: number, y: number, z: number, o: AddOpts = {}) {
    const sc = o.scale ?? 1;
    const s = typeof sc === "number" ? _s.set(sc, sc, sc) : _s.set(sc[0], sc[1], sc[2]);
    _q.setFromEuler(_e.set(0, o.rotY ?? 0, 0));
    _m.compose(_p.set(x, y, z), _q, s);
    const i = this.count;
    for (const v of _m.elements) this.mats.push(v);
    _sphere.copy(this.local).applyMatrix4(_m);
    this.spheres.push(_sphere.center.x, _sphere.center.y, _sphere.center.z, _sphere.radius);
    if (o.color !== undefined) {
      if (!this.cols) { this.cols = []; for (let k = 0; k < i; k++) this.cols.push(1, 1, 1); }
      const c = Array.isArray(o.color) ? _c.setRGB(o.color[0], o.color[1], o.color[2]) : _c.set(o.color as any);
      this.cols.push(c.r, c.g, c.b);
    } else if (this.cols) this.cols.push(1, 1, 1);
    this.dirty = true;
    return i;
  }

  private build() {
    const n = Math.max(1, this.count);
    if (this.mesh && this.mesh.instanceMatrix.count >= n) return;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    const im = new THREE.InstancedMesh(this.geometry, this.material, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.cols) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    im.castShadow = this.opts.shadow !== false;
    im.receiveShadow = true;
    im.frustumCulled = false; // we cull per copy
    im.count = 0;
    this.scene.add(im);
    this.mesh = im;
  }

  /** Called by the engine before each frame. */
  cull(cam: THREE.Camera, frustum: THREE.Frustum, force = false) {
    if (!this.count) return;
    if (this.dirty || !this.mesh) this.build();
    const e = cam.matrixWorld.elements;
    let moved = this.dirty || force;
    for (let k = 0; k < 16 && !moved; k++) if (Math.abs(e[k] - this.lastCam[k]) > 1e-4) moved = true;
    if (!moved) return;
    this.lastCam.set(e);
    this.dirty = false;
    const im = this.mesh!;
    const far = this.opts.far ?? (cam as THREE.PerspectiveCamera).far ?? 1000;
    const near = this.opts.near ?? 30, near2 = near * near;
    const cx = e[12], cy = e[13], cz = e[14];
    const out = im.instanceMatrix.array as Float32Array, cout = im.instanceColor?.array as Float32Array | undefined;
    const S = this.spheres, M = this.mats, C = this.cols;
    let k = 0;
    for (let i = 0, n = this.count; i < n; i++) {
      const x = S[i * 4], y = S[i * 4 + 1], z = S[i * 4 + 2], r = S[i * 4 + 3];
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz);
      if (d2 > (far + r) * (far + r)) continue;
      if (d2 > near2) {
        _sphere.center.set(x, y, z); _sphere.radius = r;
        if (!frustum.intersectsSphere(_sphere)) continue;
      }
      for (let j = 0; j < 16; j++) out[k * 16 + j] = M[i * 16 + j];
      if (cout && C) { cout[k * 3] = C[i * 3]; cout[k * 3 + 1] = C[i * 3 + 1]; cout[k * 3 + 2] = C[i * 3 + 2]; }
      k++;
    }
    im.count = k;
    this.visible = k;
    im.instanceMatrix.clearUpdateRanges();
    im.instanceMatrix.addUpdateRange(0, k * 16);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) { im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, k * 3); im.instanceColor.needsUpdate = true; }
  }

  remove() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; } this.mats = []; this.spheres = []; this.cols = null; }
}

export interface BakeOpts {
  /** Size of a ground cell in metres (default 64). Smaller cells cull better; larger cells mean fewer draws. */
  cell?: number;
  /** Keep these out of the bake (moving or changing things). */
  skip?: (m: THREE.Mesh) => boolean;
}

/**
 * Merge every static mesh under root into one mesh per material per ground cell (x/z).
 * The originals are removed. Returns the merged meshes and the draw calls before and after.
 */
export function bake(root: THREE.Object3D, o: BakeOpts = {}) {
  const cell = o.cell ?? 64;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean; name: string }>();
  const done: THREE.Mesh[] = [];
  root.traverse((ob: any) => {
    if (!ob.isMesh || ob.isInstancedMesh || ob.isSkinnedMesh || Array.isArray(ob.material) || !ob.visible) return;
    if (o.skip?.(ob)) return;
    const g0 = ob.geometry as THREE.BufferGeometry;
    if (!g0.boundingSphere) g0.computeBoundingSphere();
    _sphere.copy(g0.boundingSphere!).applyMatrix4(ob.matrixWorld);
    const cx = Math.floor(_sphere.center.x / cell), cz = Math.floor(_sphere.center.z / cell);
    const attrs = Object.keys(g0.attributes).sort().join(",");
    const key = `${ob.material.uuid}|${attrs}|${cx},${cz}`;
    let gr = groups.get(key);
    if (!gr) { gr = { mat: ob.material, geos: [], cast: false, recv: false, name: ob.name || ob.material.name || "baked" }; groups.set(key, gr); }
    const g = g0.clone().applyMatrix4(_m.multiplyMatrices(inv, ob.matrixWorld));
    for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
    gr.geos.push(g);
    gr.cast ||= ob.castShadow; gr.recv ||= ob.receiveShadow;
    done.push(ob);
  });
  const before = done.length;
  for (const m of done) m.removeFromParent();
  const out: THREE.Mesh[] = [];
  for (const gr of groups.values()) {
    const indexed = gr.geos.every((g) => g.index);
    const list = indexed ? gr.geos : gr.geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, gr.mat);
    mesh.castShadow = gr.cast; mesh.receiveShadow = gr.recv;
    mesh.name = gr.name;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    out.push(mesh);
  }
  root.updateMatrixWorld(true);
  return { meshes: out, before, after: out.length };
}
