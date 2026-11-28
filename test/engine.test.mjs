// Engine tests that need no browser: physics, AI, random numbers and a scene's step.
// Run: npm run build && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Entity, Scene, overlap, raycast, ai, rng } from "../dist/kimi-game.js";

// a game without a screen: enough for Scene.step
function fakeGame(mode = "2d") {
  const r = rng(1);
  return {
    mode,
    bounds: { kind: "rect", x0: 0, y0: 0, x1: 800, y1: 600 },
    renderer: { is3d: mode === "3d", attach() {}, detach() {}, burst() {}, beam() {}, ring() {}, view: () => null, camera: { yaw: 0, shake() {} } },
    input: { wantsAimStick: false, used: new Set(), move: () => ({ x: 0, y: 0 }), rightStick: () => null, down: () => false, pressed: () => false, released: () => false, pointer: { moved: false, world: { x: 0, y: 0 } } },
    ui: { tick() {} },
    rand: r.rand, int: r.int, pick: r.pick, chance: r.chance,
    _error(e) { throw e; },
  };
}
const ent = (o) => new Entity(o);
const place = (s, o) => s.add(o);

test("random numbers repeat for a seed", () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.rand(), b.rand());
  const c = rng(7);
  for (let i = 0; i < 1000; i++) { const v = c.int(1, 6); assert.ok(v >= 1 && v <= 6); }
});

test("circle, box and mixed overlaps give a push-out normal from b to a", () => {
  const s = new Scene(fakeGame(), "t", {});
  const a = place(s, { at: [0, 0], radius: 10 }), b = place(s, { at: [15, 0], radius: 10 });
  const c = overlap(a, b);
  assert.ok(c && c.nx < 0 && Math.abs(c.depth - 5) < 1e-9);
  const box = place(s, { at: [100, 100], box: [40, 20] }), ball = place(s, { at: [100, 85], radius: 6 });
  const d = overlap(ball, box);
  assert.ok(d && d.ny < 0, "ball above the box is pushed up");
  const far = place(s, { at: [300, 300], radius: 5 });
  assert.equal(overlap(a, far), null);
  const b1 = place(s, { at: [0, 0], box: [10, 10] }), b2 = place(s, { at: [8, 1], box: [10, 10] });
  const e = overlap(b1, b2);
  assert.ok(e && e.nx === -1 && Math.abs(e.depth - 2) < 1e-9);
});

test("a ray stops at the nearest tagged thing", () => {
  const s = new Scene(fakeGame(), "t", {});
  place(s, { at: [100, 0], radius: 10, tags: ["wall"] });
  place(s, { at: [50, 0], radius: 5, tags: ["enemy"] });
  const hit = raycast(s.entities, [0, 0], [1, 0], 500, ["wall"]);
  assert.ok(hit && Math.abs(hit.dist - 90) < 1e-6 && hit.entity.has("wall"));
  assert.equal(raycast(s.entities, [0, 0], [0, 1], 500, ["wall"]), null);
  const box = place(s, { at: [0, 200], box: [40, 40], tags: ["crate"] });
  const h2 = raycast(s.entities, [0, 0], [0, 1], 500, ["crate"]);
  assert.ok(h2 && h2.entity === box && Math.abs(h2.dist - 180) < 1e-6);
});

test("hit fires once per contact, overlap every step, and solids push apart", () => {
  const s = new Scene(fakeGame(), "t", {});
  const a = place(s, { at: [100, 100], radius: 10, solid: true });
  const b = place(s, { at: [112, 100], radius: 10, tags: ["thing"], solid: true });
  let hits = 0, overlaps = 0;
  a.on("hit", "thing", () => hits++);
  a.on("overlap", "thing", () => overlaps++);
  s.step(1 / 60, 1 / 60);
  assert.ok(a.dist(b) >= 19.9, "pushed apart");
  // keep them touching (non-solid) for a few steps
  a.opts.solid = false; b.opts.solid = false;
  b.x = 110; b.ox = 110;
  for (let i = 0; i < 5; i++) s.step(1 / 60, 1 / 60);
  assert.equal(hits, 1);
  assert.ok(overlaps >= 5);
  b.x = 400;
  s.step(1 / 60, 1 / 60);
  b.x = 110;
  s.step(1 / 60, 1 / 60);
  assert.equal(hits, 2, "a new contact after separating");
});

test("solid against tags only, static walls never move", () => {
  const s = new Scene(fakeGame(), "t", {});
  const wall = place(s, { at: [200, 200], radius: 20, solid: true, static: true, tags: ["wall"] });
  const ghost = place(s, { at: [205, 200], radius: 5, solid: ["nothing"] });
  const body = place(s, { at: [210, 200], radius: 5, solid: ["wall"] });
  s.step(1 / 60, 1 / 60);
  assert.deepEqual(wall.p, [200, 200]);
  assert.ok(body.dist(wall) >= 24.9);
  assert.ok(ghost.dist(wall) < 10, "a solid filtered against other tags passes through");
});

test("lifetimes, timers, bounds and the moved flag", () => {
  const s = new Scene(fakeGame(), "t", {});
  const shortLived = place(s, { at: [10, 10], dies: 0.5 });
  const mover = place(s, { at: [100, 100], vel: [120, 0] });
  const stay = place(s, { at: [5, 300], vel: [-200, 0], bounds: "clamp", radius: 5 });
  let ticks = 0, once = 0;
  s.every(0.25, () => ticks++);
  s.after(0.3, () => once++);
  for (let i = 0; i < 66; i++) s.step(1 / 60, 1 / 60); // 1.1 s
  assert.equal(shortLived.alive, false);
  assert.ok(!s.entities.includes(shortLived));
  assert.equal(ticks, 4);
  assert.equal(once, 1);
  assert.ok(Math.abs(mover.x - 232) < 1e-6 && mover.moved);
  assert.equal(stay.x, 5);
});

test("pursuit leads a moving target and A* walks around walls", () => {
  const s = new Scene(fakeGame(), "t", {});
  const t = place(s, { at: [100, 0], vel: [0, 50] });
  const aim = ai.predict([0, 0], t, 100);
  assert.ok(aim[1] > 0, "aims ahead of the target");
  const grid = ["S.#....", "..#.##.", "..#..#.", "....#.G"];
  const path = ai.astar(grid, [0, 0], [6, 3]);
  assert.ok(path.length > 0);
  assert.deepEqual(path[0], [0, 0]);
  assert.deepEqual(path[path.length - 1], [6, 3]);
  for (const [c, r] of path) assert.notEqual(grid[r][c], "#");
  assert.deepEqual(ai.astar(["S#G"], [0, 0], [2, 0]), []);
});

test("minimax takes a winning move and blocks a losing one (noughts and crosses)", () => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winner = (b) => { for (const [a, c, d] of lines) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]; return 0; };
  const game = (board, player) => ai.minimax({
    state: board, player, depth: 9,
    moves: (b) => (winner(b) ? [] : b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0)),
    apply: (b, m, p) => { const n = b.slice(); n[m] = p; return n; },
    score: (b, p) => winner(b) * p * 10,
    done: (b) => !!winner(b),
  });
  assert.equal(game([1, 1, 0, -1, -1, 0, 0, 0, 0], 1).move, 2, "wins");
  assert.equal(game([1, 1, 0, -1, 0, 0, 0, 0, 0], -1).move, 2, "blocks");
});

test("a state machine switches states and counts time in each", () => {
  const s = new Scene(fakeGame(), "t", {});
  const seen = [];
  const e = place(s, { at: [0, 0], ai: ai.machine({ initial: "a", states: {
    a: { enter: () => seen.push("a"), tick: (_e, _dt, _s, t) => (t > 0.1 ? "b" : undefined) },
    b: { enter: () => seen.push("b") },
  } }) });
  for (let i = 0; i < 12; i++) s.step(1 / 60, 1 / 60);
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(e.data.state, "b");
});

test("flocking keeps a swarm apart while it chases", () => {
  const s = new Scene(fakeGame(), "t", {});
  const target = place(s, { at: [700, 300] });
  const swarm = [];
  for (let i = 0; i < 12; i++) swarm.push(place(s, { at: [100 + (i % 4) * 2, 300 + Math.floor(i / 4) * 2], radius: 8, speed: 120, tags: ["bug"],
    ai: ai.steer({ seek: target, separate: "bug", separateRadius: 30 }) }));
  for (let i = 0; i < 120; i++) s.step(1 / 60, 1 / 60);
  let minD = Infinity;
  for (let i = 0; i < swarm.length; i++) for (let j = i + 1; j < swarm.length; j++) minD = Math.min(minD, swarm[i].dist(swarm[j]));
  assert.ok(minD > 8, `spread out (closest pair ${minD.toFixed(1)})`);
  assert.ok(swarm.every((b) => b.x > 150), "and moved toward the target");
});

test("3D rays hit boxes, standing capsules (with head shots) and spheres", () => {
  const s = new Scene(fakeGame("3d"), "t", {});
  s.g.bounds = { kind: "circle", cx: 0, cy: 0, r: 500 };
  const wall = place(s, { at: [10, 2, 0], box: [1, 4, 6], tags: ["wall"] });
  const man = place(s, { at: [5, 0.9, 3], capsule: [0.4, 1.8], radius: 0.4, tags: ["person"] });
  place(s, { at: [5, 1, -3], radius: 0.5, tags: ["thing"] });
  s.step(1 / 60, 1 / 60);
  const w = s.ray3([0, 1, 0], [1, 0, 0], 100, ["wall"]);
  assert.ok(w && w.entity === wall && Math.abs(w.dist - 9.5) < 1e-6 && w.normal[0] === -1);
  const body = s.ray3([0, 1, 3], [1, 0, 0], 100, ["person"]);
  assert.ok(body && body.entity === man && body.part === "body" && Math.abs(body.dist - 4.6) < 1e-3);
  const head = s.ray3([0, 1.65, 3], [1, 0, 0], 100, ["person"]);
  assert.ok(head && head.part === "head");
  assert.equal(s.ray3([0, 2.5, 3], [1, 0, 0], 100, ["person"]), null, "over the head");
  const ball = s.ray3([0, 1, -3], [1, 0, 0], 100, ["thing"]);
  assert.ok(ball && Math.abs(ball.dist - 4.5) < 1e-6);
  assert.equal(s.ray3([0, 1, 0], [1, 0, 0], 5, ["wall"]), null, "out of range");
});

test("static things stay hashed without being re-added, and tag-filtered solids", () => {
  const s = new Scene(fakeGame(), "t", {});
  for (let i = 0; i < 200; i++) place(s, { at: [i * 30, 500], radius: 5, solid: true, static: true, tags: ["post"] });
  const mover = place(s, { at: [30, 488], vel: [0, 100], radius: 5, solid: ["post"] });
  for (let i = 0; i < 20; i++) s.step(1 / 60, 1 / 60);
  assert.ok(mover.dist([30, 500]) >= 9.9, "stopped by the static post");
  assert.ok(s.query(30, 500, 1).some((e) => e.has("post")), "found through the static hash");
  assert.equal(s.within("post", [30, 500], 1).length, 1);
});

// ---------- 0.3: big worlds ----------
import * as THREE from "three";
import { Instances, bake } from "../dist/kimi-game.js";

test("instances draw only the copies in view, near ones always (for shadows), none past far", () => {
  const scene = new THREE.Scene();
  const inst = new Instances(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), scene, { far: 100, near: 10 });
  inst.add(0, 0, -20);                       // ahead, in view
  inst.add(0, 0, 20);                        // behind, outside the near radius
  inst.add(3, 0, 4);                         // behind but near: kept for its shadow
  inst.add(0, 0, -150);                      // ahead but past far
  inst.add(5, 0, -30, { scale: [2, 3, 2], rotY: 1, color: "#ff0000" });
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 0, 0); cam.lookAt(0, 0, -1); cam.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  inst.cull(cam, fr);
  assert.equal(inst.count, 5);
  assert.equal(inst.mesh.count, 3);
  assert.ok(inst.mesh.instanceColor, "colours follow the copies");
  // nothing moved: no work, same result
  inst.cull(cam, fr);
  assert.equal(inst.mesh.count, 3);
  // turn around
  cam.lookAt(0, 0, 1); cam.updateMatrixWorld();
  fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  inst.cull(cam, fr);
  assert.equal(inst.mesh.count, 2); // the one behind (now ahead) and the near one
});

test("bake merges static meshes per material per cell and keeps them in place", () => {
  const root = new THREE.Group();
  root.position.set(10, 0, 0);
  const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(box, i % 2 ? a : b); m.position.set(i * 2, 0, 0); root.add(m); }
  const far = new THREE.Mesh(box, a); far.position.set(200, 0, 0); root.add(far);
  const r = bake(root, { cell: 64 });
  assert.equal(r.before, 7);
  assert.equal(r.after, 3); // a and b near, a far
  const all = new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(all.min.x - (10 - 0.5)) < 1e-4 && Math.abs(all.max.x - (210 + 0.5)) < 1e-4, "same place as before");
});
