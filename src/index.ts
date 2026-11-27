// kimi/game — a small game engine for models (and people), on three.js and canvas 2D.
//
//   import { game, sprite, ai, sound } from "kimi/game";
//   const g = game({ title: "Space Dodge", mode: "2d" });
//   g.scene("play", (s) => { const ship = s.add(sprite.ship({ at: [400, 540], controls: "arrows" })); … });
//   g.start("play");

import type { EntityOpts } from "./entity";

export { game, Game, VERSION, type GameOpts } from "./game";
export { Scene } from "./scene";
export { Entity, type EntityOpts, type AiFn } from "./entity";
export { Input, type Scheme } from "./input";
export { UI } from "./ui";
export { sound, type Music } from "./sound";
export { ai } from "./ai";
export { rng, clamp, lerp, angleDiff, TAU } from "./math";
export { overlap, raycast, raycast3, type Ray3Hit } from "./physics";
export { addHighScore, highScores, load, save } from "./storage";
export { KITS, PRESETS } from "./render3d";
export { SHAPES_2D } from "./renderer";

const SHAPES = [
  "ship", "rock", "ball", "paddle", "block", "coin", "bullet", "character", "drone", "orb", "crystal",
  "tank", "car", "tree", "building", "boss", "star", "pillar", "wall", "platform",
] as const;
export type ShapeName = (typeof SHAPES)[number];

/** Entity options with a built-in shape: s.add(sprite.rock({ at: [100, 0], speed: 200 })). */
export const sprite = Object.fromEntries(
  SHAPES.map((n) => [n, (o: EntityOpts = {}) => ({ ...o, shape: n })]),
) as Record<ShapeName, (o?: EntityOpts) => EntityOpts>;
