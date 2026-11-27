// The story (six missions against the Kivuli gang), markers, pickups, heat (the wanted level and
// the police response), and the city's population: civilians, traffic and parked cars.

import * as THREE from "three";
import { NPC } from "./npc.js";
import { WEAPONS } from "./weapons.js";
import { weaponModel, Person, LOOKS } from "./characters.js";
import { roadCentre, N } from "./layout.js";

// ---------------------------------------------------------------------------
// Markers and pickups
// ---------------------------------------------------------------------------
const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.4), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.8, 0.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

export class Marker {
  constructor(scene, x, z, y = 0, r = 2.2) {
    this.g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 40, 24, 1, true), beamMat);
    beam.position.y = 20;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 40).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.05;
    this.g.add(beam, ring);
    this.g.position.set(x, y, z);
    this.x = x; this.z = z; this.y = y; this.r = r;
    scene.add(this.g);
    this.ring = ring;
  }
  update(t) { this.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06); }
  near(px, pz, py = this.y, k = 1) { return Math.hypot(px - this.x, pz - this.z) < this.r * k && Math.abs(py - this.y) < 3; }
  remove() { this.g.removeFromParent(); }
}

const PICKUPS = {
  armor: { color: 0x4aa8ff, label: "armour +50" },
  health: { color: 0x5ee07a, label: "health +50" },
  ammo: { color: 0xffc24b, label: "ammo" },
};
export class Pickups {
  constructor(ctx) { this.ctx = ctx; this.list = []; }
  spawn(kind, x, z, o = {}) {
    const g = new THREE.Group();
    let mesh;
    if (WEAPONS[kind]) { mesh = weaponModel(WEAPONS[kind].model); mesh.scale.setScalar(1.6); }
    else {
      const c = PICKUPS[kind].color;
      mesh = new THREE.Mesh(kind === "armor" ? new THREE.BoxGeometry(0.42, 0.5, 0.18) : kind === "health" ? new THREE.BoxGeometry(0.42, 0.3, 0.3) : new THREE.BoxGeometry(0.45, 0.28, 0.28),
        new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.4 }));
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 0.6), transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }));
    ring.position.y = -0.48;
    g.add(mesh, ring);
    const y = this.ctx.world.groundAt(x, z, o.y ?? 0) + 0.55;
    g.position.set(x, y, z);
    this.ctx.g.three.scene.add(g);
    const p = { kind, g, mesh, x, z, y, amount: o.amount, life: o.life ?? Infinity, respawn: o.respawn ?? 0, home: [x, z], taken: false };
    this.list.push(p);
    return p;
  }
  update(dt, player) {
    const t = this.ctx.g.time;
    for (const p of this.list) {
      if (p.taken) {
        if (p.respawn > 0 && (p.respawnT -= dt) <= 0) { p.taken = false; p.g.visible = true; }
        continue;
      }
      p.life -= dt;
      p.mesh.rotation.y = t * 1.8;
      p.mesh.position.y = Math.sin(t * 2.5 + p.x) * 0.08;
      if (p.life <= 0) { p.g.removeFromParent(); p.taken = true; p.respawn = 0; continue; }
      if (!player.dead && !player.vehicle && Math.hypot(player.e.x - p.x, player.e.z - p.z) < 1.3 && Math.abs(player.e.y - 0.9 - (p.y - 0.55)) < 1.5) this.take(p, player);
    }
    this.list = this.list.filter((p) => !p.taken || p.respawn > 0);
  }
  take(p, player) {
    const hud = this.ctx.hud;
    if (p.kind === "armor") { if (player.armor >= 100) return; player.e.data.armor = Math.min(100, player.armor + 50); }
    else if (p.kind === "health") { if (player.e.hp >= player.e.maxHp) return; player.e.hp = Math.min(player.e.maxHp, player.e.hp + 50); }
    else if (p.kind === "ammo") { for (const k of player.owned) { const d = WEAPONS[k]; player.ammo[k].reserve = Math.min(d.reserve * 2, player.ammo[k].reserve + d.mag); } }
    else player.give(p.kind, p.amount);
    hud.killFeed("+ " + (WEAPONS[p.kind] ? WEAPONS[p.kind].name : PICKUPS[p.kind].label), "#ffc24b");
    this.ctx.audio.pickup();
    p.taken = true;
    p.g.visible = false;
    if (p.respawn > 0) p.respawnT = p.respawn; else p.g.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------
export class Missions {
  constructor(ctx) {
    this.ctx = ctx;
    this.index = 0;
    this.step = null;
    this.marker = null;
    this.enemies = [];
    this.list = this.define();
  }
  get current() { return this.list[this.index] ?? null; }

  start(index) {
    this.index = index;
    this.clear();
    this.enemies = []; // leftovers from earlier missions roam free and don't block this one
    const m = this.current;
    if (!m) { this.freeRoam(); return; }
    this.ctx.hud.notify(m.title.toUpperCase(), m.sub, 3.5);
    m.start();
  }
  clear() {
    this.marker?.remove(); this.marker = null;
    this.step = null;
  }
  markAt(x, z, y = 0, r = 2.2) { this.marker?.remove(); this.marker = new Marker(this.ctx.g.three.scene, x, z, y, r); return this.marker; }
  objective(text) { this.ctx.hud.objective = [this.current?.title ?? "Free roam", text]; }
  done(reward) {
    const m = this.current;
    this.clear();
    const p = this.ctx.player;
    p.cash += reward;
    this.ctx.hud.notify("MISSION PASSED", `${m.title} · +KSh ${reward.toLocaleString("en-KE")}`, 4);
    this.ctx.audio.pickup();
    this.ctx.save();
    this.ctx.g.current.after(4.5, () => this.start(this.index + 1));
  }
  /** Spawn a fighter for a mission. */
  gang(x, z, o = {}) {
    const n = new NPC(this.ctx, "gang", x, z, { weapon: o.weapon ?? this.ctx.g.pick(["pistol", "rifle", "rifle", "shotgun"]), post: o.post ?? [x, z], ...o });
    this.ctx.npcs.push(n);
    this.enemies.push(n);
    return n;
  }
  aliveEnemies() { return this.enemies.filter((n) => n.alive); }

  define() {
    const ctx = this.ctx, w = ctx.world;
    const P = () => ctx.player;
    const sh = w.spots.safehouse;
    return [
      {
        title: "Karibu Nyota", sub: "welcome home",
        start: () => {
          this.markAt(sh.inside[0], sh.inside[1]);
          this.objective("Get to your safehouse (the yellow light)");
          this.step = () => {
            if (this.marker?.near(P().e.x, P().e.z, 0, 1.3)) {
              this.markAt(sh.locker[0], sh.locker[1] + 1, 0, 1.2);
              this.objective("Open the locker [F] — a rifle is waiting");
              this.step = () => { if (P().owned.has("rifle")) this.done(500); };
            }
          };
        },
      },
      {
        title: "Boda Ride", sub: "the city is faster on two wheels",
        start: () => {
          const [x, z] = sh.garage;
          const boda = ctx.vehicles.spawn("boda", x + 2, z, Math.PI / 2);
          this.objective("Take the boda-boda outside the garage door [F]");
          this.markAt(boda.x, boda.z, 0, 1.6);
          const market = w.spots.market?.[1] ?? w.spots.plaza;
          this.step = () => {
            if (P().vehicle) {
              this.markAt(market[0], market[1] - 2, 0, 3);
              this.objective("Ride to the market");
              this.step = () => { if (this.marker.near(P().e.x, P().e.z, 0, 1.4)) this.done(1000); };
            }
          };
        },
      },
      {
        title: "The Warehouse", sub: "Kivuli's people are in the warehouse",
        start: () => {
          const c = w.spots.compound;
          this.markAt(c.gate[0], c.gate[1] - 6, 0, 3);
          this.objective("Drive to the Kivuli warehouse");
          this.step = () => {
            if (Math.hypot(P().e.x - c.gate[0], P().e.z - c.gate[1]) < 45) {
              this.clear();
              const [cx, cz] = c.center;
              const posts = [[cx - 8, cz - 10], [cx + 9, cz - 12], [cx, cz - 17], [cx - 15, cz - 3], [cx + 14, cz - 2], [cx - 6, cz + 12], [cx + 6, cz + 14], [cx, cz + 19], [cx - 11, cz + 18], [cx + 11, cz + 8]];
              posts.forEach((p, i) => this.gang(p[0], p[1], { grenades: i % 4 === 0 ? 2 : 0, weapon: i % 3 === 0 ? "shotgun" : i % 3 === 1 ? "rifle" : "pistol" }));
              this.objective("Clear the warehouse and its yard");
              this.step = () => {
                const left = this.aliveEnemies().length;
                this.objective(`Clear the warehouse — ${left} Kivuli left`);
                if (left === 0) {
                  ctx.pickups.spawn("sniper", cx + 2, cz + 12, { amount: 20 });
                  ctx.pickups.spawn("shotgun", cx - 2, cz + 12, { amount: 24 });
                  ctx.pickups.spawn("armor", cx, cz + 14);
                  this.done(3000);
                }
              };
            }
          };
        },
      },
      {
        title: "High Ground", sub: "lookouts in the plaza",
        start: () => {
          const g = w.spots.garage;
          if (!P().owned.has("sniper")) P().give("sniper", 20);
          this.markAt(g.roof[0], g.roof[1], 8, 2.5);
          this.objective("Climb the parking garage (ramp on the east side) to the roof");
          this.step = () => {
            if (this.marker.near(P().e.x, P().e.z, P().e.y - 0.9, 1.4)) {
              this.clear();
              const [px, pz] = w.spots.plaza;
              const spots = [[px - 14, pz - 12], [px + 12, pz - 15], [px - 18, pz + 6], [px + 16, pz + 10], [px - 4, pz + 18], [px + 3, pz - 20]];
              spots.forEach((s) => this.gang(s[0], s[1], { weapon: "rifle", state: "patrol", accuracy: 0.5 }));
              this.objective("Snipe the 6 lookouts in the plaza (right-click to scope)");
              this.step = () => {
                const left = this.aliveEnemies().length;
                if (left < 6) this.objective(`Lookouts left: ${left}`);
                if (left === 0) this.done(3000);
              };
              ctx.hud.killFeed("hold Shift to steady the scope", "#bfe3ff");
            }
          };
        },
      },
      {
        title: "Convoy", sub: "three armoured cars carry Kivuli's money",
        start: () => {
          const [lx, lz] = sh.garage;
          ctx.pickups.spawn("rocket", lx + 1, lz - 3, { amount: 6 });
          ctx.pickups.spawn("armor", lx + 1, lz + 3);
          this.markAt(lx + 1, lz - 3, 0, 1.4);
          this.objective("Pick up the rocket launcher by the safehouse garage");
          this.step = () => {
            if (P().owned.has("rocket")) {
              this.clear();
              // a loop around the middle of the city
              const r = [[2, 2], [6, 2], [6, 6], [2, 6]].map(([i, j]) => [roadCentre(i), roadCentre(j)]);
              const route = [];
              for (let k = 0; k < 4; k++) { const a = r[k], b = r[(k + 1) % 4]; for (let t = 0; t < 1; t += 0.25) route.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
              this.convoy = [];
              for (let k = 0; k < 3; k++) {
                const p = route[k * 2 % route.length];
                const v = ctx.vehicles.spawn("armored", p[0] - k * 9, p[1], 0);
                v.ai = { mode: "route", route, i: (k * 2 + 1) % route.length, speed: 13 };
                v.seat(new Person(LOOKS.gang));
                v.e.data.team = "gang";
                v.onDamage = () => {
                  // when hit, it stops and its guards get out to fight
                  if (v.unloaded) return;
                  v.unloaded = true;
                  v.ai = { mode: "chase", target: () => [P().e.x, P().e.z], speed: 18, stopAt: 18 };
                  ctx.g.current.after(1.5, () => {
                    for (let q = 0; q < 2; q++) { const [fx, fz] = v.fwd; this.gang(v.x - fz * (2 + q), v.z + fx * (2 + q), { weapon: "rifle", alert: true, state: "engage" }); }
                  });
                };
                this.convoy.push(v);
              }
              this.objective("Destroy the 3 armoured cars (rockets, or a lot of bullets)");
              this.step = () => {
                const left = this.convoy.filter((v) => !v.wrecked).length;
                this.objective(`Armoured cars left: ${left}`);
                const lead = this.convoy.find((v) => !v.wrecked);
                if (lead) { this.convoyBlip = [lead.x, lead.z]; }
                if (left === 0) { this.convoyBlip = null; this.done(5000); }
              };
            }
          };
        },
      },
      {
        title: "Kivuli's Tower", sub: "end it",
        start: () => {
          const t = w.spots.gangTower;
          this.markAt(t.court[0], t.court[1] - 10, 0, 3);
          this.objective("Go to Kivuli's tower");
          this.step = () => {
            if (Math.hypot(P().e.x - t.court[0], P().e.z - t.court[1]) < 50) {
              this.clear();
              const [cx, cz] = t.inside;
              const court = [[cx - 12, t.court[1]], [cx + 12, t.court[1]], [cx - 5, t.court[1] + 2], [cx + 5, t.court[1] + 2], [cx - 18, t.court[1] - 4], [cx + 18, t.court[1] - 4]];
              court.forEach((p, i) => this.gang(p[0], p[1], { weapon: i % 2 ? "rifle" : "shotgun", grenades: i === 0 ? 2 : 0 }));
              [[cx - 9, cz - 6], [cx + 9, cz - 6], [cx - 9, cz + 7], [cx + 9, cz + 7], [cx, cz + 4], [cx - 4, cz - 8]].forEach((p) => this.gang(p[0], p[1], { weapon: "rifle", armor: 50 }));
              this.boss = this.gang(cx, cz + 11, { boss: true, weapon: "rifle", grenades: 4, armor: 150, accuracy: 0.85 });
              this.objective("Take Kivuli's tower: the forecourt, the lobby, then Kivuli");
              this.step = () => {
                const left = this.aliveEnemies().length;
                this.objective(this.boss.alive ? `Kivuli's people left: ${left - 1} · Kivuli is in the lobby` : `Kivuli is down — ${left} left`);
                if (left === 0) {
                  this.done(10000);
                  ctx.g.current.after(1, () => ctx.hud.notify("NYOTA CITY IS YOURS", "free roam: the city keeps living", 6));
                }
              };
            }
          };
        },
      },
    ];
  }

  freeRoam() {
    this.objective("Free roam — Kivuli's leftovers still hold the compounds");
    this.ctx.hud.objective = ["Free roam", "Drive, fight, explore. Kivuli's leftovers turn up at the compounds."];
    this.roamT = 30;
  }

  update(dt) {
    this.marker?.update(this.ctx.g.time);
    this.step?.();
    // free roam: gang squads now and then at a compound
    if (!this.current && (this.roamT -= dt) <= 0) {
      this.roamT = 90;
      const c = this.ctx.g.pick(this.ctx.world.spots.compounds);
      if (this.aliveEnemies().length < 8) for (let k = 0; k < 4; k++) this.gang(c.yard[0] + this.ctx.g.rand(-8, 8), c.yard[1] + this.ctx.g.rand(-6, 6));
    }
  }

  blips() {
    const out = [];
    if (this.marker) out.push({ x: this.marker.x, z: this.marker.z, color: "#ffc24b", icon: "mission", keep: true });
    if (this.convoyBlip) out.push({ x: this.convoyBlip[0], z: this.convoyBlip[1], color: "#ffc24b", icon: "mission", keep: true });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Heat and the police
// ---------------------------------------------------------------------------
export class Heat {
  constructor(ctx) { this.ctx = ctx; this.level = 0; this.coolT = 0; this.spawnT = 0; this.seen = false; this.units = []; }
  add(n, why) {
    const before = this.level;
    this.level = Math.min(5, Math.max(this.level, 0) + n);
    if (Math.floor(this.level) > Math.floor(before)) this.ctx.hud.killFeed(`heat ${"★".repeat(Math.floor(this.level))} — ${why}`, "#ffd24b");
    this.coolT = 0;
  }
  get stars() { return Math.floor(this.level); }
  update(dt) {
    const ctx = this.ctx, p = ctx.player;
    const stars = this.stars;
    // are the police looking at the player?
    this.seen = ctx.npcs.some((n) => n.alive && n.team === "police" && n.target === p.e && n.visible);
    if (stars === 0) { ctx.audio.siren(false); this.units = this.units.filter((v) => v.e.alive); return; }
    if (this.seen) this.coolT = 0;
    else {
      this.coolT += dt;
      if (this.coolT > 10 + stars * 4) { this.level = Math.max(0, this.level - 1); this.coolT = 0; ctx.hud.killFeed(this.stars ? `heat down to ${"★".repeat(this.stars)}` : "you lost the police", "#8bf59a"); }
    }
    // send cars
    this.spawnT -= dt;
    this.units = this.units.filter((v) => v.e.alive && !v.wrecked);
    const cops = ctx.npcs.filter((n) => n.alive && n.team === "police").length;
    if (this.spawnT <= 0 && this.units.length < Math.min(4, stars) && cops < stars * 3) {
      this.spawnT = Math.max(5, 14 - stars * 2);
      const v = ctx.spawnPoliceCar();
      if (v) this.units.push(v);
    }
    // cars that arrive let their officers out
    for (const v of this.units) {
      if (v.ai?.arrived && !v.unloaded && Math.abs(v.speed) < 2) {
        v.unloaded = true;
        const [fx, fz] = v.fwd;
        const crew = stars >= 3 ? 3 : 2;
        for (let q = 0; q < crew; q++) {
          const n = new NPC(ctx, "police", v.x + -fz * (2.2 + q * 0.6) * (q % 2 ? -1 : 1), v.z + fx * (2.2 + q * 0.6) * (q % 2 ? -1 : 1), { weapon: stars >= 3 ? "rifle" : q === 0 ? "shotgun" : "pistol", alert: true, armor: stars >= 3 ? 60 : 20 });
          n.target = p.e; n.state = "engage";
          ctx.npcs.push(n);
        }
        v.unseat();
        v.ai = null;
      }
    }
    const near = this.units.find((v) => Math.hypot(v.x - p.e.x, v.z - p.e.z) < 150);
    ctx.audio.siren(!!near, near ? [near.x, 0, near.z] : null);
    ctx.audio.heat = stars;
  }
}

// ---------------------------------------------------------------------------
// Population: civilians, traffic, parked cars
// ---------------------------------------------------------------------------
export class Population {
  constructor(ctx) { this.ctx = ctx; this.civT = 0; this.carT = 0; this.civTarget = 22; this.parked = false; }
  outOfView(x, z) {
    const cam = this.ctx.g.three.camera;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const dx = x - cam.position.x, dz = z - cam.position.z, d = Math.hypot(dx, dz);
    return (dx * dir.x + dz * dir.z) / (d || 1) < 0.35 || d > 140;
  }
  update(dt) {
    const ctx = this.ctx, p = ctx.player, w = ctx.world, g = ctx.g;
    if (!this.parked) {
      this.parked = true;
      for (const [x, z, rot] of w.parking) ctx.vehicles.spawn(g.pick(["sedan", "sedan", "suv", "matatu"]), x + 2, z, rot);
    }
    this.civT -= dt;
    if (this.civT <= 0) {
      this.civT = 0.7;
      const civs = ctx.npcs.filter((n) => n.role === "civ" && n.alive);
      for (const c of civs) if (Math.hypot(c.e.x - p.e.x, c.e.z - p.e.z) > 170) { c.e.die("despawn"); c.despawned = true; c.person.group.removeFromParent(); }
      if (civs.length < this.civTarget) {
        // a sidewalk loop around a block near the player, and a point on it out of sight
        const loops = w.sidewalkLoops.filter((l) => Math.hypot((l[0][0] + l[2][0]) / 2 - p.e.x, (l[0][1] + l[2][1]) / 2 - p.e.z) < 140);
        const loop = loops.length ? g.pick(loops) : null;
        const a = g.int(0, 3), b = (a + 1) % 4, tt = g.rand();
        const spot = loop ? [loop[a][0] + (loop[b][0] - loop[a][0]) * tt, loop[a][1] + (loop[b][1] - loop[a][1]) * tt] : [1e9, 1e9];
        const ds = Math.hypot(spot[0] - p.e.x, spot[1] - p.e.z);
        if (loop && ds > 35 && ds < 140 && (this.outOfView(spot[0], spot[1]) || ds > 70)) {
          const n = new NPC(ctx, "civ", spot[0], spot[1], { loop });
          n.loopI = g.int(0, 3); n.dir = g.chance(0.5) ? 1 : -1;
          ctx.npcs.push(n);
        }
      }
    }
    this.carT -= dt;
    if (this.carT <= 0) {
      this.carT = 0.8;
      for (const v of ctx.vehicles.list) {
        if (v.npcDriver && v.driver && Math.hypot(v.x - p.e.x, v.z - p.e.z) > 240) v.remove();
      }
      const traffic = ctx.vehicles.list.filter((v) => v.npcDriver && v.driver).length;
      if (traffic < ctx.vehicles.trafficTarget) ctx.vehicles.spawnTraffic([p.e.x, p.e.z], 70, 200, (x, z) => !this.outOfView(x, z));
    }
    // drop the dead and the gone from the list now and then
    if (Math.random() < dt) ctx.npcs = ctx.npcs.filter((n) => n.alive || (n.deadT < 31 && !n.despawned));
  }
}

export function policeSpawnPoint(ctx) {
  const p = ctx.player, g = ctx.g;
  for (let k = 0; k < 20; k++) {
    const i = g.int(0, N), j = g.int(0, N);
    const x = roadCentre(i), z = roadCentre(j);
    const d = Math.hypot(x - p.e.x, z - p.e.z);
    if (d > 70 && d < 170 && ctx.population.outOfView(x, z)) return [x, z];
  }
  return null;
}
