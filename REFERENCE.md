# kimi/game reference (v0.3)

A small game engine. Write the game in one module script. You can use the same calls in 2D (canvas) and 3D (three.js). Keys, mouse, touch and gamepads, the title card, pause, game over, high scores, sound and the report all come built in.

```js
import { game, sprite, ai, sound } from "kimi/game";
const g = game({ title: "Space Dodge", mode: "2d", size: [800, 600], backdrop: "stars",
  howto: ["Move [←][→]", "Dodge the rocks"] });
g.scene("play", (s) => {
  const ship = s.add(sprite.ship({ at: [400, 540], rot: -Math.PI / 2, face: "none", controls: "arrows", speed: 320 }));
  const score = s.ui.score();
  s.every(0.5, () => s.add(sprite.rock({ at: [g.rand(20, 780), -30], vel: [0, g.rand(150, 300)], dies: "offscreen", tags: ["rock"] })));
  ship.on("hit", "rock", () => { s.burst(ship, { count: 60 }); sound.explode(); g.over({ score: score.value }); });
  s.on("tick", (dt) => score.add(dt * 10));
});
g.start("play");
```

## game(options)
`title`, `sub`, `howto` (lines; `[Key]` draws a key cap), `mode` (`"2d"` | `"3d"`), `size` (2D screen, default `[800,600]`), `world` (2D world larger than the screen; 3D rectangle `[w,d]`), `arena` (3D round arena radius, default 30), `background`, `backdrop` (2D: `"stars"` | `"grid"`), `preset` (3D: `"neon"` | `"night"` | `"day"` | `"dusk"` | `"space"`), `quality` (`"auto"` adapts to the machine), `accent`, `seed`, `titleScreen` (default true).

- `g.scene(name, (s, params) => {…})`: define a scene. A `"title"` scene runs behind the title card (attract mode).
- `g.start("play")`, `g.restart()`, `g.over({ score, message, win, title })`: shows the score and the top five, then any key restarts.
- `g.rand(a, b)`, `g.int(a, b)`, `g.pick(list)`, `g.chance(p)`: seeded random numbers.
- `g.slowmo(scale, seconds)`, `g.freeze(seconds)` (hit-stop), `g.flash(color)`, `g.time`, `g.input`, `g.three` (3D: `{ THREE, scene, camera, renderer }`), `g.ctx` (2D canvas).
- Built-in keys: P/Esc pause, M sound on/off, F3 engine report.

## Coordinates
- **2D:** `x, y` are pixels, and y points down.
- **3D:** things move on the ground plane `x, z`, and y points up. `at: [x, z]` puts a thing on the floor, and `at: [x, y, z]` places it at a height.
- `e.p` is the position on the plane and `e.v` is the velocity on the plane. Both work in either mode, and the AI uses them.

## Scene `s`
- `s.add(options)` → entity. `s.every(sec, fn)`, `s.after(sec, fn)` (both return `{ cancel() }`).
- `s.on("tick", (dt) => …)`, `s.on("draw", (ctx) => …)` (2D, after entities).
- `s.find(tag)`, `s.count(tag)`, `s.first(tag)`, `s.nearest(tag, from, max)`, `s.within(tag, [x, y], r)`, `s.ray(from, dir, max, tags)`.
- Effects:
  - `s.burst(at, { count, color, speed, life, size, dir, spread, gravity })`
  - `s.ring(at, { color, radius })`
  - `s.beam(a, b, { color, width, life })`
  - `s.shake(0..1)`
  - `s.popup(at, "+100", color)`
- Camera:
  - 2D: `s.camera.follow(e)`.
  - 3D: `s.camera.topdown(e, { height })`, `s.camera.chase(e)`, `s.camera.orbit(at)`, `s.camera.firstPerson(e)`, `s.camera.fixed(pos, look)`.

## Entities: `s.add(sprite.<shape>({ … }))`
Shapes are drawn in code, in 2D and in 3D: `ship rock ball paddle block coin bullet character drone orb crystal tank car tree building boss star pillar wall platform`. Each shape has a sensible size and colour, so you can leave them out.

| Option | Meaning |
|---|---|
| `at`, `vel`, `rot` | start position, velocity, angle |
| `radius` or `box: [w,h]` (3D `[w,h,d]`) | collision shape |
| `tags: ["enemy"]` | used by collisions and queries |
| `speed`, `accel` | for controls and AI |
| `controls` | `"arrows"` `"wasd"` `"keys"` (both) `"mouse"` `"twin"` (move + aim) `"platformer"` (with `gravity`, `jump`) |
| `axis: "y"` | lock control movement to one axis (paddles) |
| `hp` | `e.damage(n)` flashes it and kills it at 0 |
| `dies` | seconds, `"offscreen"` or `"bounds"` |
| `bounds` | `"clamp"` `"bounce"` `"wrap"` `"die"` at the world edge |
| `solid: true` / `solid: ["wall"]`, `static: true` | push-out; static never moves |
| `gravity`, `drag`, `maxSpeed`, `bounce` | motion |
| `face` | `"move"` `"aim"` `"none"`; `spin` (rad/s) |
| `ai` | a behaviour or a list (below) |
| `color`, `color2`, `size`, `glow`, `trail: { color }`, `layer`, `height` | looks |
| `unscaled: true` | ignores slow motion (the player in bullet time) |
| `draw(ctx, e)` (2D) / `mesh` (3D) | your own visual |

Entity:
- Fields: `e.x e.y e.z`, `e.p`, `e.v`, `e.hp`, `e.alive`, `e.age`, `e.aim`, `e.data`.
- Methods:
  - `e.on("hit", "tag", (other) => …)`: once, when touching starts.
  - `e.on("overlap", "tag", fn)`: every step while touching.
  - `e.on("tick", (dt) => …)`, `e.on("die", (e, why) => …)`.
  - `e.damage(n)`, `e.heal(n)`, `e.die()`.
  - `e.dist(o)`, `e.dirTo(o)`, `e.go(dir, speed)`, `e.push(x, y)`.
  - `e.invuln = seconds` (no damage while it lasts).

## Input `g.input`
- Actions: `down(a)`, `pressed(a)`, `released(a)`. They are:
  - `"fire"`: J, Z, left click, RT/X, the touch button; also Space if the game never asks for jump.
  - `"jump"` (also `"dash"`): Space, K, X, A.
  - `"alt"` (also `"slow"`, `"bomb"`, `"special"`): Shift, E, C, right click, B/LB/RB.
  - `"pause"`.
- `move()` gives `{ x, y }`. `rightStick()` gives the aim stick or null. `pointer.world` is the mouse position in world coordinates.
- `bind("name", ["KeyT", "pad:3"])` adds keys to an action, and `vibrate(ms)` rumbles the gamepad.
- Touch sticks and buttons appear only on touch screens, and only for the actions the game uses.

## AI `ai`
Behaviours go in `ai:`. All take an optional `speed`. `target` can be an entity, a tag (meaning the nearest one) or a function.
- Steering:
  - `ai.chase({ target, lead, separate: "enemy" })`
  - `ai.fleeFrom({ from, radius })`
  - `ai.wanderAround()`
  - `ai.circle({ target, radius })`
  - `ai.kite({ target, min, max })`
  - `ai.patrol({ path: [[x, y], …] })`
- `ai.steer({ seek, lead, flee, orbit, keep, keepRange, wander, separate, separateRadius, w: { seek: 1 } })` blends behaviours, for flocks for example.
- `ai.shooter({ target, every, range, lead: bulletSpeed, spread, blockers: ["wall"], fire: (e, dir, target) => … })` shoots with line of sight and leads its shots.
- `ai.machine({ initial, states: { name: { enter(e, s), tick(e, dt, s, t) → "next", exit } } })` is a state machine.
- Helpers:
  - `ai.seek`, `ai.flee`, `ai.arrive`, `ai.pursue`, `ai.orbit` return a velocity.
  - `ai.steerToward(e, vel, dt)` turns an entity toward that velocity.
  - `ai.predict(from, target, speed)` gives the point to aim at.
  - `ai.faceToward(e, point, rate, dt)` turns an entity to face a point.
- `ai.astar(rows, [c, r], [c, r])` finds a path on a text grid where `#` is a wall.
- `ai.minimax({ state, player, depth, moves, apply, score, done })` searches turn-based games with alpha-beta pruning.
- `await ai.ask(question, { fallback, timeout })` asks the person's model and falls back to code.

## Interface `s.ui`
- `score({ label, at })` returns `.add(n)`, `.set(n)` and `.value`.
- `text({ text, at, label })` returns `.set(t)`.
- `bar({ label, max, color, at })` returns `.set(v)` and `.show(bool)`.
- `lives(3)` returns `.lose()`.
- `timer({ from: 60, onEnd })`.
- `banner("WAVE 2", { sub })`.
- `vignette(0..1)`.

`at` is `"top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right" | "center"`.

## Sound `sound`
- Effects: `shoot hit explode(size) coin jump bounce power hurt dash laser warn boss over win click`, and `tone(f0, f1, dur, type)`.
- Music: `sound.music({ style: "drive" | "calm" | "tense", bpm, intensity })` returns `.intensity(0..1)`, `.style(s)` and `.stop()`. `sound.muffle(0..1)` softens the music.

## Report
`g.report()` (also posted to the parent window as `kimi-game:report` every 2 s) gives:
- frame time, entities by tag and how many moved, collisions per second, input used;
- warnings such as `"3 enemy, none moved"` or `"the player never collided with anything"`, and errors.

F3 shows the report on screen.

## Your own 3D look (v0.2)
For big 3D games, the engine still runs the loop, input, entities, collisions, AI, sound and the report, while you draw the world yourself:
- `game({ mode: "3d", preset: "custom", bloom: false, floor: false })`: no built-in sky, lights, fog or floor.
- `s.camera.manual()`, then move `g.three.camera` yourself.
- `g.three.setPipeline((dt) => composer.render(dt))` replaces the final draw.
- `g.three.onQuality((q) => …)` is called with the quality level (0–3) now and on every change.
- `g.three.setQuality(q)`; `adaptive: false` or `{ lowerAbove: 30 }` (frame ms).

Mouse look and 3D hits:
- `g.input.lockPointer()`, then `g.input.look()` (mouse plus right stick deltas) and `g.input.wheel()`.
- `g.input.bind(action, keys, { replace: true })`.
- `s.ray3([x, y, z], [dx, dy, dz], max, tags, ignore)` returns `{ entity, dist, point, normal, part }`, where `part` is `"head"` on the top of a capsule.

Entity options:
- `capsule: [r, h]` for people (enables head shots).
- `hidden: true` for invisible colliders.
- `static: true` things are hashed once, so thousands of walls are cheap.

## Big worlds (v0.3)
- `g.three.instances(geometry, material, { far })`, then `.add(x, y, z, { scale, rotY, color })`: thousands of copies in one draw, only those in view.
- `g.three.bake(group)` merges static meshes per material per 64 m cell.
- Entity `cull: m` (or `g.three.cullDistance`) hides far meshes.
- Adaptive quality lowers resolution first; your own pipeline reads it with `g.three.onScale(fn)`.

## Rules for good games
- Tag everything that collides. Use `on("hit")` for events and `solid` only for things that must block.
- Give every enemy an `ai`. Use `s.every` to spawn and `dies` to clean up bullets.
- Call `g.over({ score })` when the round ends. Do not write your own loop, input handling or menus.
- For anything the engine cannot do, `g.three` and `g.ctx` give you three.js and the canvas.
