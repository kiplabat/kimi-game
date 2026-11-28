// STAR ARENA — the kimi/game showcase. A 3D twin-stick arena where the computer plays too:
// swarms that flock, hunters that lead their shots, snipers with a state machine, a boss,
// bullet time, dash, combos, music that follows the fight, and an autopilot that flies for you.

import { game, sprite, ai, sound } from "kimi/game";

const C = { me: "#36e2ff", shot: "#a8fbff", swarm: "#ff3d9a", hunter: "#ff8a3d", split: "#b06bff",
  sniper: "#ffe14d", boss: "#ff2b55", foe: "#ff6a3d", energy: "#6bff9e", gold: "#ffd166", heal: "#ff7ab6" };
const R = 26; // arena radius

const g = game({
  title: "STAR ARENA", sub: "a kimi/game showcase", mode: "3d", arena: R, preset: "neon", accent: C.me,
  howto: [
    "Move [W][A][S][D] · aim with the mouse · hold click to fire",
    "[Space] dash: you can't be hurt mid-dash, and it rams",
    "[Shift] Star time: the world slows down, you don't",
    "Gamepad: twin sticks · [A] dash · [B] Star time · [Y] autopilot",
    "Touch: left thumb moves, right thumb aims and fires",
    "[T] let the computer fly",
  ],
});
g.input.bind("pilot", ["KeyT", "pad:3"]);
let music = null;

function arena(s, demo) {
  const st = { score: 0, mult: 1, combo: 0, comboT: 0, best: 1, wave: 0, energy: 40, slowT: 0, cd: 0, dashCd: 0,
    spreadT: 0, shield: false, pilot: demo, left: 0, boss: null, dead: false };
  const hud = demo ? null : {
    score: s.ui.score({ at: "top-left" }),
    mult: s.ui.text({ at: "top-left", text: "×1", color: C.gold }),
    wave: s.ui.text({ at: "top", label: "Wave", text: "1" }),
    pilot: s.ui.text({ at: "top-right", text: "", color: C.energy }),
    hp: s.ui.bar({ at: "bottom-left", label: "Hull", max: 5, color: C.me }),
    star: s.ui.bar({ at: "bottom-left", label: "Star", max: 100, value: 40, color: C.energy }),
    boss: s.ui.bar({ at: "top", label: "The Warden", max: 1, color: C.boss, width: "26em" }),
  };
  hud?.boss.show(false);
  if (!demo) st.wave = Math.max(0, (+new URLSearchParams(location.search).get("wave") || 1) - 1); // ?wave=5 starts at the boss
  music = sound.music({ style: "drive", bpm: 124, intensity: demo ? 0.3 : 0.4 });

  // cover: four pillars that block bodies and bullets
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    s.add(sprite.pillar({ at: [Math.cos(a) * 12, Math.sin(a) * 12], radius: 1.6, box: undefined, height: 1.4,
      color: "#1a2140", color2: C.me, solid: true, static: true, tags: ["wall"] }));
  }

  const p = s.add(sprite.ship({ at: [0, 0], controls: demo ? "none" : "twin", speed: 13, accel: 95, hp: 5, height: 0.6,
    tags: ["player"], unscaled: true, face: "aim", bounds: "clamp", solid: ["wall"], trail: { color: C.me, every: 0.025, size: 0.45 } }));
  s.camera.topdown(p, { height: 27, distance: 16, lead: 0.22 });

  // ---------- the player ----------
  function shoot() {
    const n = st.spreadT > 0 ? 5 : 1;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(p.aim[1], p.aim[0]) + (i - (n - 1) / 2) * 0.13;
      const d = [Math.cos(a), Math.sin(a)];
      const b = s.add(sprite.bullet({ at: [p.x + d[0], p.z + d[1]], vel: [d[0] * 44, d[1] * 44], rot: a, radius: 0.22,
        color: C.shot, tags: ["pshot"], dies: 0.9, unscaled: true, height: 0.6 }));
      b.on("hit", "enemy", (e) => { b.die(); e.damage(1, b); s.burst(b, { count: 5, color: e.opts.color, speed: 7 }); sound.hit(); });
      b.on("hit", "wall", () => { b.die(); s.burst(b, { count: 6, color: C.shot, speed: 6 }); });
    }
    s.burst([p.x + p.aim[0] * 1.1, 0.6, p.z + p.aim[1] * 1.1], { count: 3, color: C.shot, speed: 6, dir: p.aim, spread: 0.4, life: 0.15 });
    sound.shoot();
    st.cd = st.spreadT > 0 ? 0.11 : 0.085;
  }
  function dash() {
    const [vx, vz] = p.v;
    const l = Math.hypot(vx, vz);
    const d = l > 1 ? [vx / l, vz / l] : p.aim;
    p.v = [d[0] * 40, d[1] * 40];
    p.invuln = Math.max(p.invuln, 0.28);
    p.data.dashing = 0.28;
    st.dashCd = 0.85;
    s.ring(p, { color: C.me, radius: 3, life: 0.3 });
    s.burst(p, { count: 14, color: C.me, speed: 9, dir: [-d[0], -d[1]], spread: 0.6 });
    sound.dash();
  }
  function starTime() {
    if (st.energy < 30 || st.slowT > 0) return;
    st.slowT = 1 + st.energy / 30;
    st.energy = 0;
    g.slowmo(0.22, st.slowT);
    s.ring(p, { color: C.energy, radius: 30, life: 0.8, width: 0.4 });
    g.flash("#6bff9e", 0.2);
    sound.power();
  }
  function hurt() {
    if (p.invuln > 0 || st.dead) return;
    if (st.shield) {
      st.shield = false;
      p.invuln = 1;
      s.ring(p, { color: "#7cf6ff", radius: 6, life: 0.5 });
      sound.bounce();
      return;
    }
    p.damage(1);
    p.invuln = 1.3;
    st.mult = 1; st.combo = 0;
    s.shake(0.55);
    g.freeze(0.09);
    g.flash("#ff2050", 0.35);
    g.input.vibrate(220, 0.9);
    sound.hurt();
    if (p.hp <= 0) die();
  }
  function die() {
    if (demo) { p.hp = p.maxHp; p.alive = true; p.invuln = 2; return; }
    st.dead = true;
    s.burst(p, { count: 120, color: [C.me, "#fff", C.shot], speed: 22, up: 1, life: 1.4 });
    s.ring(p, { color: C.me, radius: 14, life: 0.9 });
    s.shake(1);
    sound.explode(2);
    g.over({ score: st.score, message: `wave ${st.wave} · best combo ×${st.best}` });
  }
  p.on("hit", "enemy", (e) => {
    if (p.data.dashing > 0) { e.damage(e.has("boss") ? 4 : 3, p); s.shake(0.25); g.freeze(0.04); }
    else hurt();
  });
  p.on("hit", "foeshot", (b) => { b.die(); hurt(); });
  p.on("overlap", "pickup", (k) => collect(k));
  p.on("die", () => { if (demo) { p.alive = true; p.hp = p.maxHp; } });

  // the computer as the pilot: dodges bullets crossing its path, keeps fighting distance, leads its shots
  function pilot(me, dt) {
    let fx = 0, fz = 0;
    for (const b of s.within("foeshot", me.p, 7)) {
      const dx = me.x - b.x, dz = me.z - b.z, d = Math.hypot(dx, dz) || 0.1;
      const [vx, vz] = b.v, vl = Math.hypot(vx, vz) || 1;
      if (-(dx * vx + dz * vz) / (d * vl) > 0.35) {
        const side = Math.sign(dx * -vz + dz * vx) || 1;
        fx += (-vz / vl) * side * 3.5 / d; fz += (vx / vl) * side * 3.5 / d;
      }
    }
    for (const e of s.within("enemy", me.p, 8)) {
      const d = me.dist(e) || 0.1;
      fx += ((me.x - e.x) / d) * (4 + e.radius * 2) / d; fz += ((me.z - e.z) / d) * (4 + e.radius * 2) / d;
    }
    const r = Math.hypot(me.x, me.z);
    if (r > R - 9) { fx -= (me.x / r) * (r - R + 9) * 0.5; fz -= (me.z / r) * (r - R + 9) * 0.5; }
    const k = s.nearest("pickup", me, 12);
    if (k) { const [ux, uz] = me.dirTo(k); fx += ux * 0.9; fz += uz * 0.9; }
    const t = s.nearest("boss", me) ?? s.nearest("enemy", me);
    if (t) {
      const d = me.dist(t), [ux, uz] = me.dirTo(t), push = d < 8 ? -0.9 : d > 13 ? 0.6 : 0;
      const turn = me.id % 2 ? 0.45 : -0.45;
      fx += ux * push - uz * turn; fz += uz * push + ux * turn;
      const at = ai.predict(me.p, t, 44);
      const a = Math.atan2(at[1] - me.z, at[0] - me.x);
      me.aim = [Math.cos(a), Math.sin(a)];
    }
    const l = Math.hypot(fx, fz), m = Math.min(1, l);
    ai.steerToward(me, l > 0.05 ? [(fx / l) * me.speed * m, (fz / l) * me.speed * m] : [0, 0], dt, 95);
    me.data.fire = !!t;
    me.data.dash = !!(s.nearest("foeshot", me, 2) || s.nearest("enemy", me, 1.8));
    me.data.slow = st.energy >= 90 && (s.count("enemy") > 12 || !!st.boss);
  }
  function setPilot(on) {
    st.pilot = on;
    p.opts.controls = on ? "none" : "twin";
    p._ai = on ? [pilot] : [];
    hud?.pilot.set(on ? "AUTOPILOT · [T] to take over" : "");
  }
  setPilot(demo);

  p.on("tick", (dt) => {
    st.cd -= dt; st.dashCd -= dt; st.spreadT -= dt; p.data.dashing = (p.data.dashing ?? 0) - dt;
    if (!demo && g.input.pressed("pilot")) setPilot(!st.pilot);
    const want = st.pilot ? p.data : { fire: g.input.down("fire"), dash: g.input.pressed("dash"), slow: g.input.pressed("slow") };
    if (want.fire && st.cd <= 0) shoot();
    if (want.dash && st.dashCd <= 0) dash();
    if (want.slow) starTime();
    if (st.slowT > 0) { st.slowT -= dt; s.ui.vignette(0.5, "60,255,170"); sound.muffle(0.55); if (st.slowT <= 0) { s.ui.vignette(0); sound.muffle(0); } }
    st.comboT -= dt;
    if (st.comboT <= 0 && st.combo) { st.combo = 0; st.mult = 1; }
    if (hud) {
      hud.hp.set(p.hp); hud.star.set(st.energy); hud.score.set(st.score);
      hud.mult.set(st.mult > 1 ? `×${st.mult}  combo ${st.combo}` : "×1");
      if (st.boss?.hp !== undefined) hud.boss.set(st.boss.hp, st.boss.maxHp);
      if (p.hp <= 2 && !st.slowT) s.ui.vignette(0.35 + Math.sin(g.time * 8) * 0.15);
    }
    music.intensity(0.35 + Math.min(0.5, st.mult * 0.07) + (st.boss ? 0.3 : 0));
  });

  // ---------- enemies ----------
  function foeShot(e, dir, speed = 20, color = C.foe) {
    const b = s.add(sprite.bullet({ at: [e.x + dir[0] * (e.radius + 0.3), e.z + dir[1] * (e.radius + 0.3)], vel: [dir[0] * speed, dir[1] * speed],
      rot: Math.atan2(dir[1], dir[0]), radius: 0.3, color, tags: ["foeshot"], dies: "bounds", height: 0.6 }));
    b.on("hit", "wall", () => { b.die(); s.burst(b, { count: 4, color, speed: 5 }); });
    return b;
  }
  function foe(o, value) {
    const e = s.add({ ...o, tags: ["enemy", ...(o.tags ?? [])], bounds: "clamp", solid: ["wall"], height: o.height ?? (o.radius ?? 0.7) + 0.1 });
    e.data.value = value;
    e.on("die", () => kill(e));
    return e;
  }
  function kill(e) {
    if (e.diedBecause !== "killed") return;
    const big = e.radius > 1;
    s.burst(e, { count: big ? 60 : 26, color: [e.opts.color, "#fff"], speed: big ? 18 : 13, up: 0.8, life: big ? 1.1 : 0.7 });
    s.ring(e, { color: e.opts.color, radius: e.radius * 4, life: 0.4 });
    sound.explode(big ? 1.2 : 0.4);
    s.shake(big ? 0.35 : 0.08);
    st.combo++; st.comboT = 2.4;
    st.mult = Math.min(8, 1 + Math.floor(st.combo / 6));
    st.best = Math.max(st.best, st.mult);
    const pts = e.data.value * st.mult;
    st.score += pts;
    if (!demo) s.popup(e, st.mult > 1 ? `+${pts} ×${st.mult}` : `+${pts}`, e.opts.color);
    st.energy = Math.min(100, st.energy + (big ? 8 : 3));
    const roll = g.rand();
    if (roll < 0.18) drop(e, "energy");
    else if (roll < 0.215) drop(e, g.pick(["spread", "shield", "heal"]));
    g.three.pulse(big ? 0.8 : 0.25);
  }

  function swarm(at) {
    return foe(sprite.drone({ at, hp: 1, speed: g.rand(8, 10.5), tags: ["swarm"], color: C.swarm, color2: "#ffc2e0",
      ai: ai.steer({ seek: p, separate: "enemy", separateRadius: 2.4, wander: 0.3 }) }), 50);
  }
  function hunter(at) {
    const e = foe(sprite.ship({ at, hp: 3, speed: 11, face: "none", color: C.hunter, color2: "#fff0c2", tags: ["hunter"],
      ai: [ai.kite({ target: p, min: 9, max: 14, separate: "enemy" }),
        ai.shooter({ target: p, every: 1.5, lead: 22, range: 24, blockers: ["wall"], fire: (e, d) => { foeShot(e, d, 22); sound.laser(); } })] }), 150);
    e.on("tick", (dt) => ai.faceToward(e, p.p, 6, dt));
    return e;
  }
  function splitter(at, size = 1) {
    const e = foe(sprite.crystal({ at, hp: size === 1 ? 4 : 1, radius: 0.9 * size, speed: size === 1 ? 6 : 12, color: C.split, color2: "#f3e6ff",
      tags: ["splitter"], ai: ai.steer({ seek: p, wander: 0.7, separate: "enemy" }) }), size === 1 ? 120 : 40);
    if (size === 1) e.on("die", (_, why) => { if (why === "killed") for (let i = 0; i < 3; i++) splitter([e.x + g.rand(-1, 1), e.z + g.rand(-1, 1)], 0.55); });
    return e;
  }
  // the sniper thinks in states: reposition → aim (a visible beam) → fire → reposition
  function sniper(at) {
    return foe(sprite.orb({ at, hp: 2, speed: 7, radius: 0.6, color: C.sniper, glow: 1.4, tags: ["sniper"],
      ai: ai.machine({ initial: "move", states: {
        move: { tick: (e, dt, sc, t) => { kiteSn(e, dt, sc); if (t > 2.2) return "aim"; } },
        aim: {
          enter: (e) => { e.v = [0, 0]; sound.warn(); },
          tick: (e, dt, sc, t) => { e.data.lock = [p.x, p.z]; if (Math.floor(t * 30) % 2 === 0) s.beam(e, [p.x, 0.6, p.z], { color: C.sniper, width: 0.04 + t * 0.06, life: 0.04 }); if (t > 0.9) return "fire"; },
        },
        fire: { enter: (e) => { const [ux, uz] = e.dirTo(e.data.lock); foeShot(e, [ux, uz], 48, C.sniper); sound.laser(); }, tick: (e, dt, sc, t) => { if (t > 0.2) return "move"; } },
      } }) }), 200);
  }
  const kiteSn = ai.kite({ target: () => p, min: 15, max: 21 });

  // ---------- the boss: a state machine with five moves ----------
  function warden() {
    const tier = Math.floor(st.wave / 5);
    const e = foe(sprite.boss({ at: [0, -R + 4], hp: 90 + tier * 50, radius: 3, speed: 7, color: C.boss, color2: "#ffd0dc", glow: 0.8, face: "none", tags: ["boss"], height: 3.3,
      ai: ai.machine({ initial: "enter", states: {
        enter: { enter: (e) => { e.invuln = 2.5; }, tick: (e, dt, sc, t) => { ai.steerToward(e, ai.arrive(e, [0, -4], 8, 3), dt); if (t > 2.5) return "spiral"; } },
        spiral: { tick: (e, dt, sc, t) => {
          e.rot += dt * 1.6; ai.steerToward(e, ai.orbit(e, [0, 0], 4, 3), dt);
          e.data.f = (e.data.f ?? 0) - dt;
          if (e.data.f <= 0) { e.data.f = e.hp < e.maxHp / 2 ? 0.07 : 0.1; for (let k = 0; k < 3; k++) { const a = e.rot + (k * Math.PI * 2) / 3; foeShot(e, [Math.cos(a), Math.sin(a)], 13, C.boss); } }
          if (t > 4.5) return next(e);
        } },
        charge: {
          enter: (e) => { e.v = [0, 0]; e.data.edge = null; e.data.go = false; sound.warn(); },
          tick: (e, dt, sc, t) => {
            if (t < 0.8) { e.data.to = [p.x, p.z]; ai.faceToward(e, e.data.to, 8, dt); s.beam(e, [p.x, 0.6, p.z], { color: C.boss, width: 0.3 * t, life: 0.04 }); return; }
            if (!e.data.go) { e.data.go = true; e.go(e.dirTo(e.data.to), 34); sound.dash(); }
            if (t > 1.6 || e.data.edge) { e.data.go = false; e.data.edge = null; s.shake(0.5); s.ring(e, { color: C.boss, radius: 10 }); radial(e, 18, 11); return next(e); }
          },
        },
        summon: { enter: (e) => { s.ring(e, { color: C.swarm, radius: 12, life: 0.6 }); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; swarm([e.x + Math.cos(a) * 5, e.z + Math.sin(a) * 5]); } },
          tick: (e, dt, sc, t) => { ai.steerToward(e, [0, 0], dt); if (t > 1.5) return next(e); } },
        nova: { tick: (e, dt, sc, t) => {
          ai.steerToward(e, ai.seek(e, p.p, 4), dt);
          e.data.n = (e.data.n ?? 0) - dt;
          if (e.data.n <= 0) { e.data.n = 0.7; radial(e, 26, 12, g.rand(0, 1)); s.ring(e, { color: C.boss, radius: 6, life: 0.3 }); }
          if (t > 3) return next(e);
        } },
      } }) }), 5000);
    st.boss = e;
    hud?.boss.show(true);
    s.ui.banner("THE WARDEN", { sub: "boss", color: C.boss, time: 2 });
    sound.boss();
    music.style("tense");
    e.on("die", (_, why) => {
      st.boss = null;
      hud?.boss.show(false);
  if (!demo) st.wave = Math.max(0, (+new URLSearchParams(location.search).get("wave") || 1) - 1); // ?wave=5 starts at the boss
      music.style("drive");
      if (why !== "killed") return;
      g.slowmo(0.15, 1.6);
      g.flash("#fff", 0.6);
      s.shake(1);
      s.burst(e, { count: 220, color: [C.boss, "#fff", C.gold], speed: 26, up: 1.2, life: 1.6 });
      for (let k = 0; k < 8; k++) drop([e.x + g.rand(-3, 3), e.z + g.rand(-3, 3)], k < 6 ? "energy" : g.pick(["spread", "heal"]));
      s.ui.banner("WARDEN DOWN", { sub: `+${5000 * st.mult}`, color: C.gold });
    });
    return e;
  }
  function next(e) { return g.pick(e.hp < e.maxHp / 2 ? ["spiral", "charge", "nova", "nova", "summon"] : ["spiral", "charge", "summon", "nova"]); }
  function radial(e, n, speed, off = 0) { for (let k = 0; k < n; k++) { const a = off + (k / n) * Math.PI * 2; foeShot(e, [Math.cos(a), Math.sin(a)], speed, C.boss); } }

  // ---------- pickups ----------
  const PICK = { energy: ["orb", C.energy, 0.4], spread: ["star", C.gold, 0.6], shield: ["crystal", "#7cf6ff", 0.55], heal: ["coin", C.heal, 0.55] };
  function drop(at, kind) {
    const [shape, color, radius] = PICK[kind];
    const pos = Array.isArray(at) ? at : [at.x, at.z];
    const k = s.add({ shape, color, radius, glow: 1.5, at: pos, tags: ["pickup"], dies: 9, height: 0.8, data: { kind } });
    k.on("tick", () => { if (k.dist(p) < 6) k.go(k.dirTo(p), 18); else k.v = [0, 0]; });
  }
  function collect(k) {
    const kind = k.data.kind;
    k.die();
    s.burst(k, { count: 10, color: k.opts.color, speed: 6 });
    if (kind === "energy") { st.energy = Math.min(100, st.energy + 15); sound.coin(); return; }
    sound.power();
    s.ring(p, { color: k.opts.color, radius: 5 });
    if (kind === "spread") { st.spreadT = 10; if (!demo) s.popup(p, "SPREAD", C.gold); }
    if (kind === "shield") { st.shield = true; if (!demo) s.popup(p, "SHIELD", "#7cf6ff"); }
    if (kind === "heal") { p.heal(1); if (!demo) s.popup(p, "+1 HULL", C.heal); }
  }

  // ---------- waves ----------
  function spawnAt(make) {
    const a = g.rand(0, Math.PI * 2), r = R - 2.5;
    const at = [Math.cos(a) * r, Math.sin(a) * r];
    s.ring(at, { color: "#ff3d9a", radius: 3, life: 0.6 });
    s.after(0.6, () => { if (!st.dead) make(at); });
  }
  function startWave() {
    st.wave++;
    hud?.wave.set(String(st.wave));
    if (!demo) s.ui.banner(`WAVE ${st.wave}`, { sub: st.wave % 5 === 0 ? "the warden wakes" : `${4 + st.wave * 3} contacts` });
    if (st.wave % 5 === 0) { st.boss = "coming"; s.after(1.5, warden); st.left = 0; return; }
    st.left = 4 + st.wave * 3;
    const kinds = [["swarm", 1]];
    if (st.wave >= 2) kinds.push(["hunter", 0.35]);
    if (st.wave >= 3) kinds.push(["splitter", 0.3]);
    if (st.wave >= 4) kinds.push(["sniper", 0.25]);
    const make = { swarm: (at) => { for (let i = 0; i < 5; i++) swarm([at[0] + g.rand(-2, 2), at[1] + g.rand(-2, 2)]); }, hunter, splitter, sniper };
    const cost = { swarm: 5, hunter: 1, splitter: 1, sniper: 1 };
    const t = s.every(Math.max(0.6, 1.6 - st.wave * 0.08), () => {
      if (st.left <= 0) { t.cancel(); return; }
      const total = kinds.reduce((a, k) => a + k[1], 0);
      let roll = g.rand(0, total), kind = "swarm";
      for (const [k, w] of kinds) { if ((roll -= w) <= 0) { kind = k; break; } }
      st.left -= cost[kind];
      spawnAt(make[kind]);
    });
  }
  s.every(0.5, () => {
    if (st.dead || st.left > 0 || s.count("enemy") > 0 || st.boss || st.waiting) return;
    st.waiting = true;
    if (st.cleared >= 0) {
      const bonus = 500 * st.wave;
      st.score += bonus;
      if (!demo) s.ui.banner(`WAVE ${st.wave} CLEAR`, { sub: `+${bonus}`, color: C.energy, time: 1.2 });
      sound.win();
    }
    s.after(st.wave > 0 ? 2.2 : 0.8, () => { st.waiting = false; startWave(); });
    st.cleared = (st.cleared ?? -1) + 1;
  });
}

g.scene("title", (s) => arena(s, true));   // the attract mode: the computer plays behind the title card
g.scene("play", (s) => arena(s, false));
g.start("play");
