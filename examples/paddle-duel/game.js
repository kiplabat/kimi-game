// PADDLE DUEL — a whole 2D game in about 50 lines of kimi/game.
import { game, sprite, ai, sound } from "kimi/game";

const W = 800, H = 500, R = 9;
const g = game({ title: "PADDLE DUEL", sub: "first to 7", size: [W, H], backdrop: "grid", accent: "#3fd0e0",
  howto: ["Move: mouse, [W][S] or arrows, stick or thumb", "First to 7 points wins"] });

g.scene("play", (s) => {
  const me = s.add(sprite.paddle({ at: [36, H / 2], box: [14, 92], color: "#3fd0e0", controls: "mouse", axis: "y", speed: 560, tags: ["paddle"], glow: 1 }));
  const cpu = s.add(sprite.paddle({ at: [W - 36, H / 2], box: [14, 92], color: "#ff4d8d", speed: 390, bounds: "clamp", tags: ["paddle"], glow: 1 }));
  const you = s.ui.score({ at: "top-left", label: "You" });
  const them = s.ui.score({ at: "top-right", label: "Computer" });
  let ball = null, aimY = H / 2;

  function serve(dir) {
    ball = s.add(sprite.ball({ at: [W / 2, H / 2], radius: R, vel: [dir * 340, g.rand(-170, 170)], trail: { color: "#9ff" }, glow: 1.5 }));
    ball.on("hit", "paddle", (p) => {
      const off = Math.max(-1, Math.min(1, (ball.y - p.y) / 46)), sp = Math.min(980, ball.speedNow * 1.06);
      const dir = p === me ? 1 : -1;
      ball.v = [dir * sp * Math.cos(off * 0.95), sp * Math.sin(off * 0.95)];
      s.burst(ball, { count: 14, color: p.opts.color, speed: 220, dir: [dir, 0], spread: 1 });
      s.shake(0.12); sound.bounce();
    });
    ball.on("tick", () => {
      if (ball.y < R || ball.y > H - R) { ball.y = Math.max(R, Math.min(H - R, ball.y)); ball.vy *= -1; sound.bounce(); }
      if (ball.x < -20 || ball.x > W + 20) point(ball.x > W);
    });
  }
  function point(mine) {
    ball.die();
    (mine ? you : them).add(1);
    s.ring([mine ? W : 0, ball.y], { color: mine ? "#3fd0e0" : "#ff4d8d", radius: 200 });
    mine ? sound.coin() : sound.hurt();
    if (you.value === 7 || them.value === 7)
      return g.over({ score: you.value * 100 - them.value * 10, win: you.value === 7, message: `${you.value} – ${them.value}` });
    s.after(0.8, () => serve(mine ? -1 : 1));
  }
  // the computer: predicts where the ball meets its side, bounces included, and re-thinks a few times a second
  s.every(0.14, () => {
    if (!ball?.alive || ball.vx <= 0) { aimY = H / 2; return; }
    const t = (cpu.x - ball.x) / ball.vx, span = H - 2 * R;
    const m = (((ball.y + ball.vy * t - R) % (2 * span)) + 2 * span) % (2 * span);
    aimY = R + (m > span ? 2 * span - m : m) + g.rand(-1, 1) * 22 * (1 + them.value * 0.1 - you.value * 0.12);
  });
  cpu.on("tick", (dt) => ai.steerToward(cpu, [0, Math.max(-390, Math.min(390, (aimY - cpu.y) * 9))], dt, 5000));
  s.after(0.6, () => serve(1));
});
g.start("play");
