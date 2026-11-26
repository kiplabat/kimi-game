// SPACE DODGE — the example at the top of REFERENCE.md, unchanged: a whole game in 12 lines.
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
