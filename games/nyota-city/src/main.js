// NYOTA CITY — an open-world third-person action game made with kimi/game on three.js.
// Everything (city, people, cars, weapons, sound) is made in code; it runs offline.

import * as THREE from "three";
import { game, load, save } from "kimi/game";
import { makePlan } from "./layout.js";
import { World } from "./world.js";
import { SkySystem } from "./sky.js";
import { Pipeline } from "./render.js";
import { FX } from "./fx.js";
import { Audio } from "./audio.js";
import { Combat, WEAPONS } from "./weapons.js";
import { Vehicles } from "./vehicles.js";
import { NPC } from "./npc.js";
import { Player } from "./player.js";
import { HUD } from "./hud.js";
import { Missions, Heat, Population, Pickups, policeSpawnPoint } from "./missions.js";
import { Person, LOOKS } from "./characters.js";

const SAVE_KEY = "nyota-city:save";
const SET_KEY = "nyota-city:settings";
// settings and saves go through the engine's storage: KimiLM's kimi.storage inside KimiLM, the browser's otherwise
let settings = { quality: "auto", sens: 1.6, volume: 0.8, invert: false, difficulty: 1 };
const params = new URLSearchParams(location.search);

const g = game({
  title: "NYOTA CITY", mode: "3d", preset: "custom", bloom: false, floor: false, world: [700, 700],
  titleScreen: false, adaptive: settings.quality === "auto" ? { lowerAbove: 30, raiseBelow: 13 } : false,
  quality: settings.quality === "auto" ? "auto" : ["low", "medium", "high", "high"][+settings.quality],
  howto: ["Move [W][A][S][D] · look with the mouse · [Click] shoot · [Right-click] aim", "[Shift] sprint · [Space] jump / handbrake · [C] crouch · [R] reload", "[1]–[6] weapons · [G] grenade · [F] cars, bodas, locker", "[Esc] pause and settings"],
});
const inp = g.input;
inp.bind("fire", ["mouse:0", "pad:7"], { replace: true });
inp.bind("aim", ["mouse:2", "pad:6"]);
inp.bind("jump", ["Space", "pad:0"], { replace: true });
inp.bind("sprint", ["ShiftLeft", "ShiftRight", "pad:10"]);
inp.bind("crouch", ["KeyC", "ControlLeft", "pad:11"]);
inp.bind("reload", ["KeyR", "pad:2"]);
inp.bind("interact", ["KeyF", "KeyE", "pad:3"]);
inp.bind("grenade", ["KeyG", "pad:5"]);
inp.bind("next", ["pad:15"]); inp.bind("prev", ["pad:14", "pad:4"]); inp.bind("swap", ["KeyQ"]);
for (let k = 1; k <= 6; k++) inp.bind("w" + k, ["Digit" + k]);
inp.wantsAimStick = true;

g.scene("play", (s) => {
  s.camera.manual();
  const hud = new HUD(g.root);
  hud.loading(0.05, "pouring the roads");
  const t = g.three;
  const ctx = {
    g, hud, audio: new Audio(), npcs: [], coverTaken: new Map(), difficulty: settings.difficulty, ready: false, inMenu: true,
  };
  window.__nyota = ctx;
  // build after the loading screen has painted
  s.after(0.05, () => {
    const sky = new SkySystem(t.scene, t.renderer);
    ctx.sky = sky;
    if (params.has("hour")) sky.hour = +params.get("hour");
    const pipe = new Pipeline(g, sky);
    ctx.pipe = pipe;
    ctx.world = new World(g, s, makePlan(2026), sky);
    sky.hills = ctx.world.hills;
    hud.buildMap(ctx.world);
    ctx.fx = new FX(g, s);
    ctx.vehicles = new Vehicles(ctx);
    ctx.combat = new Combat(ctx);
    ctx.pickups = new Pickups(ctx);
    const sh = ctx.world.spots.safehouse;
    ctx.player = new Player(ctx, sh.door[0], sh.door[1] - 3);
    ctx.player.yaw = Math.PI / 2; // facing the shop
    ctx.missions = new Missions(ctx);
    ctx.heat = new Heat(ctx);
    ctx.population = new Population(ctx);
    wire(ctx);
    // street pickups: armour and health that come back after a while
    ctx.world.pickupSpots.forEach((p, i) => ctx.pickups.spawn(["armor", "health", "ammo"][i % 3], p[0], p[1], { respawn: 120 }));
    lights(ctx);
    applySettings(ctx);
    ctx.ready = true;
    hud.loading(1);
    ctx.saved = null;
    Promise.all([load(SAVE_KEY, null), load(SET_KEY, {})]).then(([sv, st]) => {
      ctx.saved = sv;
      settings = { ...settings, ...(st ?? {}) };
      applySettings(ctx);
      mainMenu(ctx);
    });
    if (params.has("autostart")) setTimeout(() => startGame(ctx, false), 300);
  });

  s.on("tick", (dt) => {
    if (!ctx.ready) return;
    const { player } = ctx;
    ctx.combat.update(dt);
    if (!ctx.inMenu) player.update(dt);
    else player.person.animate(dt, { speed: 0, fwd: 1, side: 0 });
    ctx.vehicles.update(dt, player.vehicle);
    const px = player.e.x, pz = player.e.z;
    for (const n of ctx.npcs) {
      // far civilians think less often
      if (n.role === "civ" && n.alive && Math.hypot(n.e.x - px, n.e.z - pz) > 90 && Math.random() < 0.5) continue;
      n.update(dt);
    }
    if (!ctx.inMenu) { ctx.missions.update(dt); ctx.heat.update(dt); }
    ctx.population.update(dt);
    ctx.pickups.update(dt, player);
    if (player.dead && player.deadT > 4.2 && !ctx.respawning) respawn(ctx);
  });
});

// ---------------------------------------------------------------------------
function wire(ctx) {
  const { g, hud } = ctx;
  const heatObj = ctx.heat;

  ctx.noise = (p, r, source) => {
    for (const n of ctx.npcs) if (n.alive && Math.hypot(n.e.x - p[0], n.e.z - p[2]) < r) n.hear(p, source);
    if (source === ctx.player.e && heatObj.stars === 0) {
      const cop = ctx.npcs.find((n) => n.alive && n.team === "police" && Math.hypot(n.e.x - p[0], n.e.z - p[2]) < 45);
      if (cop) heatObj.add(1, "shots fired near police");
    }
  };
  ctx.whiz = (from, dir, dist, shooter) => {
    if (shooter !== ctx.player.e) return;
    for (const n of ctx.npcs) {
      if (!n.alive) continue;
      const vx = n.e.x - from[0], vz = n.e.z - from[2];
      const t = vx * dir[0] + vz * dir[2];
      if (t < 0 || t > dist + 2) continue;
      const cx = from[0] + dir[0] * t - n.e.x, cz = from[2] + dir[2] * t - n.e.z;
      if (Math.hypot(cx, cz) < 3) n.hear([n.e.x, n.e.y, n.e.z], shooter);
    }
  };
  ctx.shake = (p, amount) => {
    const d = Math.hypot(p[0] - ctx.player.e.x, p[2] - ctx.player.e.z);
    ctx.player.shake = Math.max(ctx.player.shake ?? 0, amount * Math.max(0, 1 - d / 60));
  };
  ctx.onKill = (target, from, info) => {
    const n = target.data.npc;
    if (!n) return;
    const byPlayer = from === ctx.player.e;
    if (byPlayer) {
      const head = info?.head ? " · head shot" : "";
      if (n.team === "gang") {
        const pay = n.person.look === LOOKS.gangBoss ? 2000 : 100;
        ctx.player.cash += pay;
        hud.killFeed((pay > 100 ? "Kivuli is down" : "Kivuli member down") + head + ` · +${pay}`, "#ff8a6a");
      } else if (n.team === "police") { heatObj.add(1, "an officer is down"); hud.killFeed("officer down" + head, "#7fb2ff"); }
      else { heatObj.add(1, "a civilian was killed"); hud.killFeed("civilian killed", "#ff4d4d"); }
    }
    // drops
    if (n.team !== "civ") {
      const r = g.rand();
      const x = target.x + g.rand(-0.6, 0.6), z = target.z + g.rand(-0.6, 0.6);
      if (r < 0.3 && n.weapon) ctx.pickups.spawn(n.weapon.id, x, z, { amount: n.weapon.mag * 2, life: 60, y: target.y - 0.9 });
      else if (r < 0.55) ctx.pickups.spawn("ammo", x, z, { life: 60, y: target.y - 0.9 });
      else if (r < 0.68) ctx.pickups.spawn("armor", x, z, { life: 60, y: target.y - 0.9 });
    }
  };
  ctx.onVehicleWrecked = (v, from) => {
    if (from === ctx.player.e && v.type === "police") heatObj.add(1, "a police car destroyed");
    if (from === ctx.player.e) ctx.player.cash += v.type === "armored" ? 500 : 0;
  };
  ctx.onCarjack = (v, person) => {
    if (!person) return;
    const [fx, fz] = v.fwd;
    const n = new NPC(ctx, v.type === "police" ? "police" : "civ", v.x + fz * 2.2, v.z - fx * 2.2, { look: person.look, weapon: v.type === "police" ? "pistol" : null });
    n.state = v.type === "police" ? "engage" : "flee";
    n.fleeFrom = [v.x, v.z];
    ctx.npcs.push(n);
    if (v.type === "police") heatObj.add(2, "a police car stolen");
    else ctx.noise([v.x, 1, v.z], 15, ctx.player.e);
  };
  ctx.useLocker = () => {
    const p = ctx.player;
    if (!p.owned.has("rifle")) p.give("rifle", 120);
    for (const k of p.owned) { const d = WEAPONS[k]; p.ammo[k].reserve = Math.max(p.ammo[k].reserve, d.reserve); }
    if (!p.owned.has("grenade")) p.give("grenade", 3);
    else p.ammo.grenade.reserve = Math.max(p.ammo.grenade.reserve, 3);
    p.e.hp = p.e.maxHp;
    p.e.data.armor = Math.max(p.armor, 50);
    hud.killFeed("locker: ammo, health and armour · game saved", "#ffc24b");
    ctx.audio.reload("rifle");
    ctx.save();
  };
  ctx.onPlayerDown = () => {
    g.slowmo(0.3, 2.5);
    hud.killFeed("you went down", "#ff4d4d");
  };
  ctx.spawnPoliceCar = () => {
    const sp = policeSpawnPoint(ctx);
    if (!sp) return null;
    const p = ctx.player;
    const v = ctx.vehicles.spawn("police", sp[0], sp[1], Math.atan2(p.e.z - sp[1], p.e.x - sp[0]));
    v.seat(new Person(LOOKS.police));
    v.siren = true;
    v.ai = { mode: "chase", target: () => [p.e.x, p.e.z], speed: 22 + heatObj.stars * 2, stopAt: 16 };
    return v;
  };
  ctx.save = () => {
    const p = ctx.player;
    save(SAVE_KEY, { mission: ctx.missions.index, owned: [...p.owned], ammo: p.ammo, cash: p.cash, armor: p.armor, hour: ctx.sky.hour });
  };

  // pause → our own menu
  g.on("pause", () => {
    if (ctx.inMenu) return;
    g.ui.hideCard();
    pauseMenu(ctx);
  });
  g.on("resume", () => { if (!ctx.inMenu) hud.closeMenu(); });
  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement && g.state === "play" && !ctx.inMenu && !inp.isTouch) g.pause();
  });
  g.root.addEventListener("click", () => { if (!ctx.inMenu && g.state === "play" && !inp.freeLook) inp.lockPointer(); });
  // some embedded viewers refuse pointer lock: look with plain mouse movement instead
  document.addEventListener("pointerlockerror", () => {
    if (inp.freeLook) return;
    inp.freeLook = true;
    hud.killFeed("mouse look without capture: keep the cursor inside the window", "#bfe3ff");
  });
}

function startGame(ctx, cont) {
  const { player, hud } = ctx;
  ctx.inMenu = false;
  hud.closeMenu();
  ctx.audio.start();
  inp.lockPointer();
  let mission = 0;
  if (cont && ctx.saved) {
    const sv = ctx.saved;
    mission = sv.mission ?? 0;
    for (const k of sv.owned ?? []) player.owned.add(k);
    Object.assign(player.ammo, sv.ammo ?? {});
    player.cash = sv.cash ?? 0;
    player.e.data.armor = sv.armor ?? 0;
    if (sv.hour !== undefined) ctx.sky.hour = sv.hour;
    if (player.owned.has("rifle")) player.equip("rifle");
  }
  if (params.has("mission")) mission = +params.get("mission");
  ctx.missions.start(mission);
}

function respawn(ctx) {
  ctx.respawning = true;
  const { player, world, hud } = ctx;
  const sh = world.spots.safehouse;
  player.cash = Math.floor(player.cash * 0.9);
  ctx.heat.level = 0;
  player.respawn(sh.inside);
  hud.killFeed("back at the safehouse (−10 % cash)", "#ffc24b");
  ctx.respawning = false;
}

function mainMenu(ctx) {
  const items = [];
  if (ctx.saved) items.push({ label: "Continue", go: () => startGame(ctx, true) });
  items.push({ label: ctx.saved ? "New game" : "Play", go: () => startGame(ctx, false) });
  items.push({ label: "Settings", go: () => settingsMenu(ctx, () => mainMenu(ctx)) });
  items.push({ label: "Full screen", go: () => { document.documentElement.requestFullscreen?.().catch(() => {}); } });
  ctx.hud.menu({ items });
}
function pauseMenu(ctx) {
  ctx.hud.menu({ items: [
    { label: "Resume", go: () => { g.resume(); inp.lockPointer(); } },
    { label: "Settings", go: () => settingsMenu(ctx, () => pauseMenu(ctx)) },
    { label: "Save", go: () => { ctx.save(); ctx.hud.killFeed("game saved", "#ffc24b"); } },
    { label: "Full screen", go: () => { document.documentElement.requestFullscreen?.().catch(() => {}); } },
  ] });
}
function settingsMenu(ctx, back) {
  ctx.hud.settings(settings, (v) => { settings = { ...settings, ...v }; applySettings(ctx); save(SET_KEY, settings); }, back);
}
function applySettings(ctx) {
  const p = ctx.player;
  p.sens = 0.0015 * settings.sens;
  p.invertY = settings.invert;
  ctx.audio.volume = settings.volume;
  ctx.difficulty = settings.difficulty;
  if (settings.quality === "auto") g.opts.adaptive = { lowerAbove: 30, raiseBelow: 13 };
  else { g.opts.adaptive = false; g.three.setQuality(+settings.quality); }
}

// ---------------------------------------------------------------------------
// Per-frame: camera, light pools, effects, interface
// ---------------------------------------------------------------------------
function lights(ctx) {
  const scene = g.three.scene;
  const lamps = [], rooms = [];
  for (let k = 0; k < 6; k++) { const l = new THREE.PointLight(0xffc98a, 0, 18, 1.8); scene.add(l); lamps.push(l); }
  for (let k = 0; k < 4; k++) { const l = new THREE.PointLight(0xfff0d8, 0, 16, 1.6); scene.add(l); rooms.push(l); }
  const head = new THREE.SpotLight(0xfff2d0, 0, 60, 0.5, 0.5, 1.4);
  scene.add(head, head.target);
  let pickT = 0;
  const cam = g.three.camera;
  const menuCam = { a: 0.6 };
  ctx.pipe.beforeRender = (dt) => {
    const { player, sky, world, hud, fx } = ctx;
    const focus = new THREE.Vector3(player.e.x, 0, player.e.z);
    sky.update(g.state === "paused" ? 0 : dt, ctx.inMenu ? new THREE.Vector3(world.spots.plaza[0], 0, world.spots.plaza[1]) : focus);
    if (ctx.inMenu) {
      menuCam.a += dt * 0.04;
      const [px, pz] = world.spots.plaza;
      cam.position.set(px + Math.cos(menuCam.a) * 85, 34, pz + Math.sin(menuCam.a) * 85);
      cam.lookAt(px, 8, pz);
      cam.fov = 55; cam.updateProjectionMatrix();
      ctx.audio.setListener(cam.position.x, cam.position.y, cam.position.z, 0);
    } else player.camera(dt);
    fx.update(dt, g.time);
    // indoors, the sky's light and reflections don't reach (they ignore walls): dim them
    const room = world.indoors(cam.position.x, cam.position.z);
    const insideK = (ctx.insideK ??= 0);
    ctx.insideK = insideK + ((room && cam.position.y < room.h ? 1 : 0) - insideK) * Math.min(1, dt * 4);
    sky.hemi.intensity *= 1 - 0.7 * ctx.insideK;
    g.three.scene.environmentIntensity = (0.15 + 0.45 * (1 - sky.night)) * (1 - 0.75 * ctx.insideK);
    g.three.renderer.toneMappingExposure *= 1 - 0.25 * ctx.insideK;
    // pick which lamps and rooms get real lights
    pickT -= dt;
    if (pickT <= 0) {
      pickT = 0.4;
      const c = cam.position;
      const near = world.lampLights.map((p) => [p, (p[0] - c.x) ** 2 + (p[2] - c.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, lamps.length);
      near.forEach(([p], i) => lamps[i].position.set(p[0], p[1], p[2]));
      const rl = [];
      for (const r of world.interiors) {
        const d = Math.hypot((r.x0 + r.x1) / 2 - player.e.x, (r.z0 + r.z1) / 2 - player.e.z);
        if (d < 40) for (const l of r.lamps) rl.push([l, Math.hypot(l[0] - player.e.x, l[2] - player.e.z)]);
      }
      rl.sort((a, b) => a[1] - b[1]);
      rooms.forEach((l, i) => { const x = rl[i]; if (x) { l.position.set(x[0][0], x[0][1], x[0][2]); l.intensity = 2.6 + 2 * ctx.sky.night; } else l.intensity = 0; });
    }
    for (const l of lamps) l.intensity = sky.night * 22;
    const v = player.vehicle;
    if (v && sky.night > 0.25) {
      const [fx2, fz2] = v.fwd;
      head.position.set(v.x + fx2 * v.T.len * 0.5, v.groundY + 0.8, v.z + fz2 * v.T.len * 0.5);
      head.target.position.set(v.x + fx2 * 30, 0, v.z + fz2 * 30);
      head.intensity = 160 * sky.night;
    } else head.intensity = 0;
    // people far away are not drawn
    for (const n of ctx.npcs) if (n.alive) n.person.group.visible = Math.hypot(n.e.x - cam.position.x, n.e.z - cam.position.z) < 160;
    ctx.pipe.hurt = Math.max(player.hurtFlash * 0.8, player.e.hp < 30 ? 0.55 : 0);
    ctx.audio.update();
    const blips = [{ x: world.spots.safehouse.door[0], z: world.spots.safehouse.door[1], color: "#fff", icon: "home", keep: true }, ...ctx.missions.blips()];
    for (const n of ctx.npcs) {
      if (!n.alive || n.team === "civ") continue;
      if (n.state === "engage" || n.state === "cover" || ctx.missions.enemies.includes(n)) blips.push({ x: n.e.x, z: n.e.z, color: n.team === "police" ? "#4b8bff" : "#ff4040" });
    }
    for (const u of ctx.heat.units) blips.push({ x: u.x, z: u.z, color: "#4b8bff", size: 5 });
    hud.update(dt, { player, heat: ctx.heat.stars, seen: ctx.heat.seen, time: sky.timeText, yaw: ctx.inMenu ? menuCam.a : player.yaw, blips, hide: ctx.inMenu });
  };
}

g.start("play");
