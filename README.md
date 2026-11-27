# kimi/game

A small game engine written for language models first and people second. It is built on **three.js** (r187) for 3D and **canvas 2D** for 2D. It is made for [KimiLM](https://github.com/kiplabat/KimiLM) and [KimiOS](https://github.com/kiplabat/KimiOS).

A model that writes a game on its own also has to write the game loop, the input handling, collisions, cameras, sound, menus and the computer's player, and it can make a mistake in every one of those. With kimi/game, most of a game becomes a few calls to parts that are written and tested once:

- **Shorter:** a complete game in 12–50 lines; the showcase in about 360 (see [Examples](#examples)).
- **Consistent:** every game gets the same:
  - keys, mouse, touch sticks and gamepads;
  - title card, pause, game over and high scores;
  - synthesised sound and music.
- **Checkable:** the engine reports what is happening, so a builder can be told "3 enemy, none moved" instead of only "no errors".

Every call is the same in 2D and 3D: `sprite.ship()` is a vector ship on a canvas or a low-poly ship in three.js.

## Examples

| | Lines | What it shows |
|---|---|---|
| [`space-dodge`](examples/space-dodge/game.js) | 12 | The example from the top of [REFERENCE.md](REFERENCE.md), unchanged |
| [`paddle-duel`](examples/paddle-duel/game.js) | 48 | 2D: mouse or keys, a computer that predicts bounces, particles, first to 7 |
| [`nyota-arena`](examples/nyota-arena/game.js) | ~360 | 3D showcase, described below |
| [`games/nyota-city`](games/nyota-city/README.md) | ~4,800 | An open-world third-person action game: a city you can enter, cars and boda-bodas, six weapons with a scope, gang and police AI, missions, day and night. Ships as a desktop app (Windows and Linux) and in KimiLM |

Nyota Arena is a twin-stick arena game. It shows:
- swarms that flock;
- hunters that keep their distance and lead their shots;
- snipers run by a state machine;
- a five-move boss;
- bullet time, dash, combos, power-ups and cover;
- music that follows the fight;
- an autopilot (`T`) that plays the game itself, also running behind the title screen.

Play any example without a server: open `dist/play/<name>.html`. Each one is a single file with three.js and the engine inlined.

## Use

```html
<script type="importmap">{ "imports": { "three": "…/three.module.min.js", "kimi/game": "…/kimi-game.js" } }</script>
<script type="module">
  import { game, sprite, ai, sound } from "kimi/game";
  const g = game({ title: "Space Dodge", mode: "2d" });
  g.scene("play", (s) => { /* … */ });
  g.start("play");
</script>
```

[REFERENCE.md](REFERENCE.md) is the whole API, kept under 2,500 tokens so that it fits in a model's prompt.

## What is inside

| Part | |
|---|---|
| game | Fixed 60 Hz step with interpolation; scenes and a title scene that runs behind the title card. Also: pause (P/Esc, and when the window is hidden), game over with the top five scores, seeded random numbers, slow motion with entities that ignore it, hit-stop and screen flash. |
| input | Keys, mouse, gamepads (with rumble) and touch, mapped to one set of actions. Touch shows virtual sticks and only the buttons the game uses. Control schemes: arrows, wasd, mouse, twin-stick, platformer. |
| physics | Circles and boxes on the play plane, a spatial hash, `hit`/`overlap` events by tag, solids (filtered by tag) with bounce, ground detection and raycasts. |
| ai | Steering (seek, flee, arrive, pursue with lead, wander, separation, orbit, kite, patrol) that can be blended. Also: shooters with line of sight, state machines, A*, minimax with alpha-beta, and `ai.ask` for the person's model with a code fallback. |
| 2D | Canvas renderer with 20 shapes drawn in code; camera follow, zoom and shake; particles, beams, rings, starfield and grid backdrops. |
| 3D | Twenty shape kits built from three.js primitives; neon, night, day, dusk and space presets with a shader grid floor; topdown, chase, orbit, first-person and fixed cameras. Also: pooled meshes, GPU particles, bloom, and quality that drops resolution, bloom and shadows when frames are slow. |
| sound | Web Audio effects and a four-layer music sequencer (drive, calm, tense) with intensity and a muffle for bullet time and pause. |
| ui | Score, text, bars, lives, timers, banners, floating popups, vignette and cards, sized for phones and large screens. |
| report | Entities by tag and how many moved, collisions per second, frame and step time, input in use, render stats, warnings and errors. F3 shows it on screen; it is also posted to a parent window as `kimi-game:report`. |
| storage | High scores through KimiLM's `kimi.storage`, then localStorage, then memory. |

## 0.2: for big 3D games

Nyota City needed the engine to step aside where a game wants its own look, and to scale to a whole city:
- **Custom look:** preset `"custom"`, a manual camera, `setPipeline` for your own post-processing, and `onQuality` events.
- **Input:** pointer-lock mouse look (`input.look()`, with a free-look fallback), the wheel, and replaceable bindings. Mouse buttons now use mouse events, so you can click to shoot while holding right-click to aim.
- **3D raycasts:** `s.ray3` against boxes, standing capsules (with head shots) and spheres, through a hash broadphase.
- **Colliders:** invisible colliders (`hidden`), and solids filtered by tag.
- **Static things:** kept in their own hash, so a city of about 1,800 colliders costs little per step.

## Build and test

```sh
npm install
npm run build     # dist/kimi-game.js (three external), .min.js, dist/play/*.html
npm run check     # TypeScript
npm test          # physics, AI and scene tests (node, no browser)
npm run serve     # then open http://localhost:8080/examples/nyota-arena/
```

The engine is TypeScript; games are plain JavaScript. `dist/kimi-game.js` leaves only the bare `three` import to the page's import map, and the post-processing addons are bundled in. This means KimiLM's existing three.js entry is enough.

## Licence

Apache-2.0. three.js is MIT.
