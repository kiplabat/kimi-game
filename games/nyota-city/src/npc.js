// The people of Nyota City and the computer's fighters.
//  civilians: walk the sidewalks, stop, chat, flee from gunfire, carjacked drivers run.
//  gang (Kivuli) and police: perceive (sight cone, line of sight, hearing), then
//    patrol → investigate → engage (take cover, peek and shoot, advance, flank, throw grenades,
//    fall back when hurt) → search; they also fight each other.

import * as THREE from "three";
import { ai } from "kimi/game";
import { Person, LOOKS, civilianLook } from "./characters.js";
import { WEAPONS } from "./weapons.js";

const HOSTILE = { gang: ["player", "police"], police: ["gang"], civ: [] };
const _o = new THREE.Vector3(), _d = new THREE.Vector3();

export class NPC {
  constructor(ctx, role, x, z, o = {}) {
    this.ctx = ctx;
    this.role = role;
    this.team = role === "civ" ? "civ" : role;
    const look = o.look ?? (role === "civ" ? civilianLook(ctx.g) : role === "police" ? LOOKS.police : o.boss ? LOOKS.gangBoss : LOOKS.gang);
    this.person = new Person(look);
    this.weapon = o.weapon ? WEAPONS[o.weapon] : null;
    this.person.setWeapon(this.weapon?.model ?? null);
    const y = ctx.world.groundAt(x, z, o.y ?? 0) + 0.9;
    this.e = ctx.g.current.add({
      at: [x, y, z], radius: 0.38, capsule: [0.38, 1.8], height: 0.9, mesh: this.person.group,
      tags: ["person", "npc", this.team], solid: ["wall", "prop", "vehicle", "person"], hp: o.hp ?? (role === "civ" ? 40 : o.boss ? 420 : 100), face: "none",
      speed: role === "civ" ? 1.4 : 3.2,
    });
    this.e.data.npc = this;
    this.e.data.team = this.team;
    this.e.data.armor = o.armor ?? (role === "police" ? 30 : o.boss ? 150 : 0);
    this.e.data.onHurt = (n, from) => this.onHurt(n, from);
    this.e.on("die", () => this.onDie());
    this.state = role === "civ" ? "walk" : o.state ?? "patrol";
    this.home = [x, z];
    this.post = o.post ?? null;      // a place to guard
    this.target = null;
    this.lastSeen = null;
    this.seeT = 0;                   // how long the target has been in sight (reaction)
    this.thinkT = Math.random() * 0.3;
    this.decideT = 0;
    this.path = null;
    this.goal = null;
    this.ammo = this.weapon?.mag ?? 0;
    this.burst = 0;
    this.fireT = 0;
    this.crouch = false;
    this.grenades = o.grenades ?? (role === "gang" && Math.random() < 0.35 ? 1 : 0);
    this.accuracy = o.accuracy ?? (role === "police" ? 0.75 : o.boss ? 0.9 : 0.6);
    this.loop = o.loop ?? null;
    this.loopI = 0;
    this.pauseT = 0;
    this.morale = 1;
    this.mission = o.mission ?? null;
    this.alertAll = o.alert ?? false;
    this.deadT = 0;
    this.faceRot = o.rot ?? Math.random() * 6.28;
    this.e.rot = this.e.orot = this.faceRot;
  }

  get alive() { return this.e.alive; }
  get p() { return [this.e.x, this.e.z]; }
  eye(out = _o) { return out.set(this.e.x, this.e.y + 0.7, this.e.z); }

  onHurt(n, from) {
    this.person.flinch = 1;
    if (from && from !== this.e && this.team !== "civ") {
      if (!this.target || !this.target.alive) this.target = from;
      this.lastSeen = [from.x, from.z];
      if (this.state === "patrol" || this.state === "idle" || this.state === "investigate") this.state = "engage";
    }
    if (this.team === "civ") { this.state = "flee"; this.fleeFrom = from ? [from.x, from.z] : this.p; }
    this.morale -= n / 200;
  }
  onDie() {
    this.deadT = 0;
    this.e.solid = false;
    this.e.opts.solid = false;
    this.e.untag("person");
    this.ctx.onNpcDeath?.(this);
    if (this.e.data.knock) { this.knock = this.e.data.knock; }
    this.person.deadDir = Math.random() < 0.5 ? 1 : -1;
    this.ctx.fx.bloodPool([this.e.x, 0, this.e.z]);
  }

  hostileTo(e) {
    const t = e.data.team;
    if (this.team === "police" && t === "player") return this.ctx.heat.stars > 0;
    return (HOSTILE[this.team] ?? []).includes(t);
  }

  /** Can I see that entity (cone, range, walls)? */
  sees(e, range = 75) {
    const dx = e.x - this.e.x, dz = e.z - this.e.z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    const engaged = this.state === "engage" || this.state === "cover" || this.alertAll;
    if (!engaged && d > 6) {
      const ang = Math.atan2(dz, dx) - this.e.rot;
      if (Math.cos(ang) < 0.25) return false; // ~150° view cone
    }
    // indoors you can't see far outside and the other way round (dark interiors)
    const eye = [this.e.x, this.e.y + 0.7, this.e.z];
    const tgtY = e.data.crouch ? e.y + 0.1 : e.y + 0.45;
    if (this.ctx.combat.clear(eye, [e.x, tgtY, e.z], [this.e, e])) return true;
    return this.ctx.combat.clear(eye, [e.x, e.y + 0.75, e.z], [this.e, e]);
  }

  pickTarget() {
    const s = this.ctx.g.current;
    let best = null, bd = 1e9;
    for (const e of s.within("person", this.p, 80)) {
      if (e === this.e || !this.hostileTo(e) || e.data.hidden) continue;
      const d = Math.hypot(e.x - this.e.x, e.z - this.e.z) + (e.data.team === "player" ? -8 : 0);
      if (d < bd && this.sees(e)) { bd = d; best = e; }
    }
    // a player inside a vehicle is a target too (the vehicle carries their entity)
    return best;
  }

  /** A gunshot or explosion: civilians flee, fighters come to look. */
  hear(p, from) {
    if (!this.alive) return;
    if (this.team === "civ") {
      if (this.state !== "flee") { this.state = "flee"; this.fleeFrom = [p[0], p[2]]; this.e.speed = 5.5; this.ctx.audio && Math.random() < 0.3 && this.ctx.scream?.(this); }
      return;
    }
    if (from && from !== this.e && this.hostileTo(from) && (this.state === "patrol" || this.state === "idle" || this.state === "walk")) {
      this.state = "investigate";
      this.goal = [p[0] + (Math.random() - 0.5) * 6, p[2] + (Math.random() - 0.5) * 6];
      this.path = null;
      this.investigateT = 12;
    }
  }

  moveTo(goal, speed, dt) {
    const e = this.e, w = this.ctx.world;
    if (!goal) { ai.steerToward(e, [0, 0], dt, 20); return true; }
    const d = Math.hypot(goal[0] - e.x, goal[1] - e.z);
    if (d < 0.8) { ai.steerToward(e, [0, 0], dt, 20); this.path = null; return true; }
    // follow a path when a straight line is blocked
    let tgt = goal;
    if (!w.clearLine([e.x, e.z], goal)) {
      if (!this.path || this.pathGoal !== goal || (this.repathT -= dt) < 0) {
        this.path = w.path([e.x, e.z], goal, 3000);
        this.pathGoal = goal;
        this.repathT = 2.5;
      }
      if (this.path?.length) {
        while (this.path.length > 1 && Math.hypot(this.path[0][0] - e.x, this.path[0][1] - e.z) < 1.2) this.path.shift();
        tgt = this.path[0];
      }
    }
    const dx = tgt[0] - e.x, dz = tgt[1] - e.z, l = Math.hypot(dx, dz) || 1;
    let vx = (dx / l) * speed, vz = (dz / l) * speed;
    const sep = ai.separate(e, this.ctx.g.current, "person", 1.2, 0.8);
    vx += sep[0] * 0.5; vz += sep[1] * 0.5;
    ai.steerToward(e, [vx, vz], dt, 18);
    return false;
  }

  /** A cover spot between me and the threat, not too close, not too far. */
  findCover(threat) {
    const w = this.ctx.world;
    let best = null, bs = -1e9;
    for (const c of w.covers) {
      const dSelf = Math.hypot(c[0] - this.e.x, c[1] - this.e.z);
      if (dSelf > 22) continue;
      const dThreat = Math.hypot(c[0] - threat[0], c[1] - threat[1]);
      if (dThreat < 7 || dThreat > 45) continue;
      // the obstacle must be between the spot and the threat: its outward normal points away from the threat
      const tx = threat[0] - c[0], tz = threat[1] - c[1];
      if (c[2] * tx + c[3] * tz > -0.3 * Math.hypot(tx, tz)) continue;
      if (!w.navFree(...w.navCell(c[0], c[1]))) continue;
      if ((this.ctx.coverTaken.get(c) ?? this) !== this) continue;
      const score = -dSelf * 1.2 - Math.abs(dThreat - 18) * 0.5 + Math.random() * 3;
      if (score > bs) { bs = score; best = c; }
    }
    return best;
  }

  shootAt(target, dt) {
    const def = this.weapon;
    if (!def) return;
    this.fireT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo = def.mag; return; }
    if (this.ammo <= 0) { this.reloadT = def.reload * 1.3; this.ctx.audio.reload?.(def.id); return; }
    if (this.fireT > 0) return;
    if (this.burst <= 0) { this.burst = def.auto ? 3 + Math.floor(Math.random() * 4) : 1; this.fireT = 0.6 + Math.random() * 1.1; return; }
    this.burst--;
    this.fireT = 60 / def.rpm * (def.auto ? 1 : 1.6 + Math.random());
    this.ammo--;
    const muzzle = this.person.muzzleWorld(new THREE.Vector3());
    const eye = this.eye(new THREE.Vector3());
    // aim at the chest, lead a moving target a little, miss more when far or when they move
    const d = Math.hypot(target.x - this.e.x, target.z - this.e.z);
    const tv = Math.hypot(target.vx, target.vz);
    const aimY = target.y + (target.data.crouch ? 0.1 : 0.4);
    _d.set(target.x + target.vx * 0.15 - eye.x, aimY - eye.y, target.z + target.vz * 0.15 - eye.z).normalize();
    const miss = (0.012 + d * 0.0009 + tv * 0.006 + (this.e.speedNow > 1 ? 0.02 : 0)) / this.accuracy * (target.data.team === "player" ? this.ctx.difficulty : 1);
    this.person.recoil = 1;
    // shots at the player hurt less than the player's own (an action game, not a simulation)
    const dmgScale = target.data.team === "player" ? 0.5 * this.ctx.difficulty : 1;
    this.ctx.combat.fire(this.e, def, eye, _d, muzzle, { spread: miss + def.spread * 0.5, ignore: [], dmgScale });
  }

  update(dt) {
    const e = this.e;
    if (!e.alive) {
      // the engine has removed the entity; the body stays where it fell for a while
      this.deadT += dt;
      const gr = this.person.group;
      if (!gr.parent && this.deadT < 30) { this.ctx.g.three.scene.add(gr); gr.position.set(e.x, e.y, e.z); gr.rotation.set(0, -e.rot, 0); }
      if (this.knock) { gr.position.x += this.knock[0] * dt; gr.position.z += this.knock[2] * dt; this.knock[0] *= 0.9; this.knock[2] *= 0.9; }
      if (this.deadT < 2) this.person.animate(dt, { dead: true });
      if (this.deadT > 30) gr.removeFromParent();
      return;
    }
    const s = this.ctx.g.current;
    // height and knock-back
    const gy = this.ctx.world.groundAt(e.x, e.z, e.y - 0.9);
    if (e.data.knock) { e.vx += e.data.knock[0]; e.vz += e.data.knock[2]; e.data.knock = null; }
    e.y += ((gy + 0.9) - e.y) * Math.min(1, dt * 12);

    this.thinkT -= dt;
    if (this.thinkT <= 0 && this.team !== "civ") {
      this.thinkT = 0.25 + Math.random() * 0.1;
      const t = this.pickTarget();
      if (t) {
        if (this.target !== t) this.seeT = 0;
        this.target = t;
        this.lastSeen = [t.x, t.z];
        this.visible = true;
        if (this.state !== "engage" && this.state !== "cover") { this.state = "engage"; this.decideT = 0; this.ctx.onSpotted?.(this, t); }
      } else this.visible = false;
    }
    if (this.visible) this.seeT += dt;

    let speed = 0, aim = false, sprint = false;
    const tgt = this.target?.alive ? this.target : null;
    if (this.target && !tgt) { this.target = null; this.state = this.team === "civ" ? "walk" : "search"; this.searchT = 6; }

    switch (this.state) {
      case "walk": { // civilians on the sidewalk loop
        if (this.pauseT > 0) { this.pauseT -= dt; this.moveTo(null, 0, dt); break; }
        const loop = this.loop;
        if (!loop) { this.moveTo(null, 0, dt); break; }
        const g = loop[this.loopI];
        if (this.moveTo(g, e.speed, dt)) { this.loopI = (this.loopI + (this.dir ?? 1) + 4) % 4; if (Math.random() < 0.3) this.pauseT = 2 + Math.random() * 5; }
        speed = e.speed;
        break;
      }
      case "flee": {
        const away = this.fleeFrom ?? this.p;
        const dx = e.x - away[0], dz = e.z - away[1], l = Math.hypot(dx, dz) || 1;
        this.fleeGoal ??= [e.x + (dx / l) * 40, e.z + (dz / l) * 40];
        if (this.moveTo(this.fleeGoal, 5.5, dt) || (this.fleeT = (this.fleeT ?? 0) + dt) > 14) { this.state = "cower"; this.cowerT = 8; this.fleeT = 0; this.fleeGoal = null; }
        speed = 5.5; sprint = true;
        break;
      }
      case "cower": {
        this.moveTo(null, 0, dt);
        this.crouch = true;
        this.cowerT -= dt;
        if (this.cowerT <= 0) { this.crouch = false; this.state = "walk"; this.e.speed = 1.4; }
        break;
      }
      case "idle":
      case "patrol": {
        if (this.post) {
          this.patrolT = (this.patrolT ?? 0) - dt;
          if (!this.goal || this.patrolT <= 0) { this.goal = [this.post[0] + (Math.random() - 0.5) * 10, this.post[1] + (Math.random() - 0.5) * 10]; this.patrolT = 6 + Math.random() * 8; }
          if (!this.moveTo(this.goal, 1.3, dt)) speed = 1.3;
        } else this.moveTo(null, 0, dt);
        break;
      }
      case "investigate": {
        this.investigateT -= dt;
        aim = true;
        if (this.moveTo(this.goal, 2.6, dt) || this.investigateT <= 0) { this.state = "patrol"; this.goal = null; }
        else speed = 2.6;
        break;
      }
      case "search": {
        this.searchT -= dt;
        aim = true;
        if (this.lastSeen && !this.moveTo(this.lastSeen, 2.8, dt)) speed = 2.8;
        if (this.searchT <= 0) { this.state = "patrol"; this.lastSeen = null; }
        break;
      }
      case "engage":
      case "cover": {
        if (!tgt) { this.state = "search"; this.searchT = 8; break; }
        aim = true;
        const d = Math.hypot(tgt.x - e.x, tgt.z - e.z);
        this.decideT -= dt;
        if (this.decideT <= 0) {
          this.decideT = 2.5 + Math.random() * 3;
          this.ctx.coverTaken.delete(this.cover);
          this.cover = null;
          const hurt = e.hp < e.maxHp * 0.4 || this.morale < 0.4;
          const roll = Math.random();
          if ((hurt || roll < 0.55) && (this.cover = this.findCover([tgt.x, tgt.z]))) {
            this.ctx.coverTaken.set(this.cover, this);
            this.goal = [this.cover[0], this.cover[1]];
            this.state = "cover";
          } else if (d > 26 || (!this.visible && this.lastSeen)) {
            // close in (or flank toward where they were seen)
            const side = Math.random() < 0.5 ? 1 : -1;
            const ang = Math.atan2(tgt.z - e.z, tgt.x - e.x) + side * 0.6;
            this.goal = [tgt.x - Math.cos(ang) * 14, tgt.z - Math.sin(ang) * 14];
            this.state = "engage";
          } else {
            // strafe
            const ang = Math.atan2(tgt.z - e.z, tgt.x - e.x) + (Math.random() < 0.5 ? 1.57 : -1.57);
            this.goal = [e.x + Math.cos(ang) * 4, e.z + Math.sin(ang) * 4];
            this.state = "engage";
          }
          // a grenade at someone hiding
          if (this.grenades > 0 && d > 10 && d < 30 && !this.visible && this.lastSeen && Math.random() < 0.5) {
            this.grenades--;
            const from = this.eye(new THREE.Vector3());
            const dx = this.lastSeen[0] - e.x, dz = this.lastSeen[1] - e.z, l = Math.hypot(dx, dz);
            const dir = new THREE.Vector3(dx / l, Math.min(0.9, 0.25 + l / 60), dz / l).normalize();
            const def = { ...WEAPONS.grenade };
            this.ctx.combat.launch(e, def, from, dir.multiplyScalar(Math.min(1.25, l / 18)));
            this.ctx.say?.(this, "grenade");
          }
        }
        const arrived = this.moveTo(this.goal, this.state === "cover" && !this.cover ? 3 : 3.6, dt);
        if (!arrived) { speed = 3.6; sprint = d > 20; }
        // at cover: crouch, then peek and shoot
        if (this.state === "cover" && arrived) {
          this.peekT = (this.peekT ?? 0) - dt;
          if (this.peekT <= 0) { this.peeking = !this.peeking; this.peekT = this.peeking ? 1.2 + Math.random() * 1.6 : 0.8 + Math.random() * 1.4; }
          this.crouch = !this.peeking;
        } else this.crouch = false;
        if (this.visible && this.seeT > 0.45 && (!this.crouch || this.state !== "cover")) this.shootAt(tgt, dt);
        break;
      }
    }

    // face the target when fighting, otherwise where we go
    const moving = Math.hypot(e.vx, e.vz);
    if (aim && tgt) this.faceRot = Math.atan2(tgt.z - e.z, tgt.x - e.x);
    else if (moving > 0.3) this.faceRot = Math.atan2(e.vz, e.vx);
    let df = this.faceRot - e.rot; df = Math.atan2(Math.sin(df), Math.cos(df));
    e.rot += df * Math.min(1, dt * 10);
    e.data.crouch = this.crouch;
    // animation
    const fwdV = (e.vx * Math.cos(e.rot) + e.vz * Math.sin(e.rot)) / Math.max(0.1, moving);
    const sideV = (-e.vx * Math.sin(e.rot) + e.vz * Math.cos(e.rot)) / Math.max(0.1, moving);
    let pitch = 0;
    if (aim && tgt) pitch = Math.atan2(tgt.y - e.y, Math.hypot(tgt.x - e.x, tgt.z - e.z));
    this.person.animate(dt, { speed: moving, fwd: fwdV, side: sideV, aim: aim && !!this.weapon, pitch, crouch: this.crouch, sprint });
    void speed; void s;
  }
}
