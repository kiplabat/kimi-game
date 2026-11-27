// The player: third-person on foot (walk, sprint, crouch, jump, aim over the shoulder, a
// first-person scope on the sniper), six weapons, grenades, driving and riding with a chase camera
// and drive-by shooting, carjacking, health with armour, and coming back after going down.

import * as THREE from "three";
import { Person, LOOKS } from "./characters.js";
import { WEAPONS, SLOTS } from "./weapons.js";

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Vector3();

export class Player {
  constructor(ctx, x, z) {
    this.ctx = ctx;
    const g = ctx.g;
    this.person = new Person(LOOKS.player);
    this.e = g.current.add({ at: [x, 0.9, z], radius: 0.4, capsule: [0.4, 1.8], height: 0.9, mesh: this.person.group,
      tags: ["person", "player"], solid: ["wall", "prop", "vehicle", "person"], hp: 100, face: "none" });
    const d = this.e.data;
    d.team = "player"; d.isPlayer = true; d.manualHp = true; d.armor = 0;
    d.onHurt = (n, from, info) => this.onHurt(n, from, info);
    d.onDeath = (from) => this.die(from);
    this.yaw = 0; this.pitch = -0.08;
    this.vy = 0; this.onGround = true;
    this.crouch = false;
    this.owned = new Set(["pistol"]);
    this.ammo = Object.fromEntries(SLOTS.map((k) => [k, { mag: 0, reserve: 0 }]));
    this.ammo.pistol = { mag: 12, reserve: 48 };
    this.weapon = "pistol";
    this.lastWeapon = "pistol";
    this.person.setWeapon("pistol");
    this.fireT = 0; this.reloadT = 0; this.bloom = 0; this.switchT = 0;
    this.cash = 0;
    this.vehicle = null;
    this.seatPerson = null;
    this.camPos = new THREE.Vector3(x, 3, z + 5);
    this.camDist = 3.4;
    this.fov = 62;
    this.scoped = false;
    this.aiming = false;
    this.hurtT = 99; this.hurtFlash = 0;
    this.dead = false; this.deadT = 0;
    this.lastHitDir = null;
    this.stepT = 0;
    this.vehLookT = 0;
    this.sens = 0.0024;
    this.invertY = false;
  }

  get pos() { return [this.e.x, this.e.z]; }
  get def() { return WEAPONS[this.weapon]; }
  get armor() { return this.e.data.armor; }

  give(id, ammo) {
    const def = WEAPONS[id];
    const first = !this.owned.has(id);
    this.owned.add(id);
    const a = this.ammo[id];
    if (first) { a.mag = def.mag; a.reserve += Math.max(0, (ammo ?? def.reserve) - def.mag); }
    else a.reserve = Math.min(a.reserve + (ammo ?? def.mag * 2), def.reserve * 2);
    if (first && id !== "grenade") this.equip(id);
  }
  equip(id) {
    if (!this.owned.has(id) || id === this.weapon) return;
    if (id === "grenade") return; // grenades are thrown with G
    this.lastWeapon = this.weapon;
    this.weapon = id;
    this.reloadT = 0;
    this.switchT = 0.35;
    this.person.setWeapon(WEAPONS[id].model);
    this.ctx.audio.click();
  }
  cycle(dir) {
    const list = SLOTS.filter((k) => this.owned.has(k) && k !== "grenade");
    const i = list.indexOf(this.weapon);
    this.equip(list[(i + dir + list.length) % list.length]);
  }

  onHurt(n, from, info) {
    this.hurtT = 0;
    this.hurtFlash = Math.min(1, this.hurtFlash + n / 40);
    this.person.flinch = 1;
    if (from) this.lastHitDir = [from.x - this.e.x, from.z - this.e.z];
    this.ctx.g.input.vibrate(90, Math.min(1, n / 40));
    this.ctx.hud?.damageFrom(this.lastHitDir, this.yaw);
    void info;
  }
  die(from) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0;
    this.e.hp = 0;
    if (this.vehicle) this.exitVehicle(true);
    this.person.deadDir = 1;
    this.ctx.onPlayerDown?.(from);
  }
  respawn(at) {
    this.dead = false;
    this.e.hp = this.e.maxHp;
    this.e.data.armor = 0;
    this.e.x = this.e.ox = at[0]; this.e.z = this.e.oz = at[1]; this.e.y = this.e.oy = 0.9;
    this.e.vx = this.e.vz = 0;
    this.e.invuln = 2;
    this.person.dead = 0;
    this.hurtFlash = 0;
  }

  // ---------- vehicles ----------
  enterVehicle(v) {
    const g = this.ctx.g;
    if (v.driver && !v.driver.isPlayer) {
      // carjack: the driver gets out and runs
      const npcPerson = v.unseat();
      this.ctx.onCarjack?.(v, npcPerson);
    }
    this.vehicle = v;
    v.ai = null;
    v.siren = false;
    this.seatPerson = new Person(LOOKS.player);
    if (v.T.bike) this.seatPerson.look.hat = "helmet";
    this.seatPerson.setWeapon(null);
    v.seat(this.seatPerson);
    v.driver.isPlayer = true;
    v.driver.entity = this.e;
    this.e.visible = false;
    this.e.opts.solid = false;
    this.e.data.vehicle = v;
    this.e.tag("invehicle");
    this.crouch = false;
    this.ctx.audio.click();
    this.vehYaw = v.e.rot;
    void g;
  }
  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    const sp = Math.abs(v.speed);
    if (sp > 9 && !force) return; // too fast to jump out (unless thrown out)
    v.unseat();
    this.ctx.audio.engine(v.id, v.type, [v.x, 0, v.z], 0, false);
    const [fx, fz] = v.fwd;
    // out on the driver's side (right), or the left if that is blocked
    const side = v.T.bike ? 1.0 : v.T.wid / 2 + 0.7;
    let ex = v.x + -fz * side, ez = v.z + fx * side;
    const w = this.ctx.world;
    if (!w.navFree(...w.navCell(ex, ez))) { ex = v.x + fz * side; ez = v.z - fx * side; }
    this.e.x = this.e.ox = ex; this.e.z = this.e.oz = ez;
    this.e.y = this.e.oy = v.groundY + 0.9;
    this.e.vx = v.e.vx * 0.5; this.e.vz = v.e.vz * 0.5;
    this.e.visible = true;
    this.e.opts.solid = ["wall", "prop", "vehicle", "person"];
    this.e.data.vehicle = null;
    this.e.untag("invehicle");
    this.vehicle = null;
    this.yaw = v.e.rot;
  }

  // ---------- each step ----------
  update(dt) {
    const g = this.ctx.g, inp = g.input, e = this.e;
    if (this.dead) {
      this.deadT += dt;
      e.vx *= 0.9; e.vz *= 0.9;
      this.person.animate(dt, { dead: true });
      return;
    }
    this.hurtT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 0.8);
    if (this.hurtT > 6 && e.hp < 60) e.hp = Math.min(60, e.hp + 5 * dt); // a little regeneration
    // look
    const look = inp.look(dt);
    const zoom = this.scoped ? this.def.scope : this.aiming ? 1.4 : 1;
    const sens = this.sens / zoom;
    this.yaw += look.x * sens;
    this.pitch += (this.invertY ? look.y : -look.y) * sens;
    this.pitch = Math.max(-1.25, Math.min(1.1, this.pitch));
    if (Math.abs(look.x) + Math.abs(look.y) > 0.5) this.vehLookT = 2;
    this.vehLookT -= dt;

    if (inp.pressed("interact")) this.interact();
    if (this.vehicle) { this.drive(dt); return; }

    // on foot
    const mv = inp.move("keys");
    const sprint = inp.down("sprint") && mv.y < -0.2 && !this.aiming;
    if (inp.pressed("crouch")) this.crouch = !this.crouch;
    if (sprint) this.crouch = false;
    this.aiming = inp.down("aim") && this.switchT <= 0;
    this.scoped = this.aiming && !!this.def.scope;
    const speed = this.crouch ? 1.7 : sprint ? 6.8 : this.aiming ? 2.6 : 3.6;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const wx = cy * -mv.y + -sy * mv.x, wz = sy * -mv.y + cy * mv.x;
    const l = Math.hypot(wx, wz);
    const tx = l > 0.05 ? (wx / Math.max(1, l)) * speed : 0, tz = l > 0.05 ? (wz / Math.max(1, l)) * speed : 0;
    const acc = this.onGround ? 40 : 6;
    const dvx = tx - e.vx, dvz = tz - e.vz, dl = Math.hypot(dvx, dvz), mx = acc * dt;
    if (dl > mx) { e.vx += (dvx / dl) * mx; e.vz += (dvz / dl) * mx; } else { e.vx = tx; e.vz = tz; }
    if (e.data.knock) { e.vx += e.data.knock[0]; e.vz += e.data.knock[2]; this.vy = Math.max(this.vy, e.data.knock[1]); e.data.knock = null; }

    // height: jump, fall, stairs and ramps
    const feet = e.y - 0.9;
    const gy = this.ctx.world.groundAt(e.x, e.z, feet);
    if (inp.pressed("jump") && this.onGround && !this.crouch) { this.vy = 6.4; this.onGround = false; }
    if (feet > gy + 0.04 || this.vy > 0) {
      this.vy -= 22 * dt;
      e.y += this.vy * dt;
      this.onGround = false;
      if (e.y - 0.9 <= gy) {
        if (this.vy < -13) this.ctx.combat.hurt(e, (-this.vy - 13) * 9, null, { fall: true });
        e.y = gy + 0.9; this.vy = 0; this.onGround = true;
      }
    } else { e.y = gy + 0.9; this.vy = 0; this.onGround = true; }
    e.data.crouch = this.crouch;

    // facing: toward the camera when armed and aiming/firing/moving, else toward movement
    const armedFacing = this.aiming || inp.down("fire") || this.fireT > -0.6;
    const want = armedFacing ? this.yaw : l > 0.1 ? Math.atan2(e.vz, e.vx) : e.rot;
    let df = want - e.rot; df = Math.atan2(Math.sin(df), Math.cos(df));
    e.rot += df * Math.min(1, dt * (armedFacing ? 25 : 10));

    this.weapons(dt, sprint);

    // footsteps
    const sp = Math.hypot(e.vx, e.vz);
    this.stepT -= dt * sp;
    if (this.stepT <= 0 && this.onGround && sp > 0.5) { this.stepT = sprint ? 1.9 : 1.5; this.ctx.audio.step([e.x, e.y - 0.9, e.z], sprint); }
    const fwd = (e.vx * Math.cos(e.rot) + e.vz * Math.sin(e.rot)) / Math.max(0.1, sp);
    const side = (-e.vx * Math.sin(e.rot) + e.vz * Math.cos(e.rot)) / Math.max(0.1, sp);
    this.person.animate(dt, { speed: sp, fwd, side, aim: this.aiming || this.fireT > -0.6, pitch: this.pitch, crouch: this.crouch, sprint });
  }

  /** Where the crosshair points: from the camera into the world. */
  aimPoint(range = 600) {
    const s = this.ctx.g.current;
    const cam = this.ctx.g.three.camera;
    cam.getWorldDirection(_f);
    const from = [cam.position.x, cam.position.y, cam.position.z];
    // skip whatever is between the camera and the player
    const skip = Math.max(0, cam.position.distanceTo(_p.set(this.e.x, this.e.y + 0.6, this.e.z)) - 0.5);
    const start = [from[0] + _f.x * skip, from[1] + _f.y * skip, from[2] + _f.z * skip];
    const ign = [this.e];
    let hit = s.ray3(start, [_f.x, _f.y, _f.z], range, ["wall", "building", "prop", "person"], ign);
    const vh = this.ctx.vehicles.ray(start, [_f.x, _f.y, _f.z], hit ? hit.dist : range, this.vehicle);
    if (vh && (!hit || vh.dist < hit.dist)) hit = vh;
    let dist = hit ? hit.dist : range;
    if (_f.y < -1e-4) { const tg = -start[1] / _f.y; if (tg < dist) { dist = tg; hit = { ground: true }; } }
    return { point: new THREE.Vector3(start[0] + _f.x * dist, start[1] + _f.y * dist, start[2] + _f.z * dist), hit, dir: _f.clone() };
  }

  weapons(dt, sprint) {
    const inp = this.ctx.g.input;
    const def = this.def;
    const a = this.ammo[this.weapon];
    this.fireT -= dt;
    this.switchT -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    // switching
    for (let k = 1; k <= 6; k++) if (inp.pressed("w" + k)) this.equip(SLOTS[k - 1]);
    const wheel = inp.wheel();
    if (wheel) this.cycle(wheel > 0 ? 1 : -1);
    if (inp.pressed("next")) this.cycle(1);
    if (inp.pressed("prev")) this.cycle(-1);
    if (inp.pressed("swap")) this.equip(this.lastWeapon);
    // grenade
    if (inp.pressed("grenade") && this.owned.has("grenade") && this.ammo.grenade.reserve + this.ammo.grenade.mag > 0 && this.fireT <= 0) {
      const ag = this.ammo.grenade;
      if (ag.mag > 0) ag.mag--; else ag.reserve--;
      const cam = this.ctx.g.three.camera;
      cam.getWorldDirection(_f);
      const from = new THREE.Vector3(this.e.x, this.e.y + 0.7, this.e.z).addScaledVector(_f, 0.6);
      _f.y += 0.18;
      this.ctx.combat.launch(this.e, WEAPONS.grenade, from, _f.normalize());
      this.person.recoil = 1;
      this.fireT = 0.6;
    }
    // reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const n = Math.min(def.mag - a.mag, a.reserve); a.mag += n; a.reserve -= n; }
      return;
    }
    if ((inp.pressed("reload") && a.mag < def.mag && a.reserve > 0) || (a.mag === 0 && a.reserve > 0 && inp.pressed("fire"))) {
      this.reloadT = def.reload;
      this.ctx.audio.reload(def.id);
      return;
    }
    if (sprint || this.switchT > 0) return;
    const want = def.auto ? inp.down("fire") : inp.pressed("fire");
    if (!want || this.fireT > 0) return;
    if (a.mag <= 0) { if (inp.pressed("fire")) this.ctx.audio.click(); return; }
    a.mag--;
    this.fireT = 60 / def.rpm;
    const aim = this.aimPoint(def.range ?? 600);
    const muzzle = this.scoped ? this.ctx.g.three.camera.position.clone().add(_m.set(0, -0.15, 0)) : this.person.muzzleWorld(new THREE.Vector3());
    const dir = aim.point.clone().sub(muzzle).normalize();
    if (def.projectile) {
      this.ctx.combat.launch(this.e, def, muzzle.addScaledVector(dir, 0.3), dir);
      this.ctx.audio.shot("rocket", [muzzle.x, muzzle.y, muzzle.z]);
      this.ctx.fx.muzzle(muzzle, dir, true);
      this.ctx.fx.smoke.add([muzzle.x - dir.x, muzzle.y, muzzle.z - dir.z], [-dir.x * 3, 0.5, -dir.z * 3], 1.5, 0.8, 3, [0.7, 0.7, 0.7], 0.5);
    } else {
      const moving = Math.hypot(this.e.vx, this.e.vz) > 0.5;
      const spread = (this.aiming ? def.aimSpread : def.spread) * (moving ? 1.6 : 1) * (this.crouch ? 0.7 : 1) + this.bloom;
      const hit = this.ctx.combat.fire(this.e, def, muzzle, dir, muzzle, { spread, ignoreVehicle: this.vehicle, ignore: [] });
      if (hit?.entity?.has?.("person") || hit?.vehicle) this.ctx.hud?.hitmark(hit?.entity && !hit.entity.alive);
      this.bloom = Math.min(0.06, this.bloom + (def.auto ? 0.004 : 0.01));
    }
    // recoil
    const k = def.kick * (this.aiming ? 0.6 : 1) * (this.crouch ? 0.7 : 1);
    this.pitch += k * (0.8 + Math.random() * 0.4);
    this.yaw += (Math.random() - 0.5) * k * 0.8;
    this.person.recoil = 1;
    this.camKick = (this.camKick ?? 0) + k * 6;
    this.ctx.g.input.vibrate(40, Math.min(1, def.kick * 15));
  }

  drive(dt) {
    const v = this.vehicle, inp = this.ctx.g.input, e = this.e;
    const mv = inp.move("keys");
    const c = { throttle: -mv.y, steer: mv.x, brake: inp.down("jump") };
    v.drive(dt, c);
    e.x = v.x; e.z = v.z; e.y = v.groundY + 1.1;
    e.vx = v.e.vx; e.vz = v.e.vz;
    e.rot = v.e.rot;
    this.seatPerson.animate(dt, { speed: 0, ride: v.T.bike ? "bike" : "car", aim: this.aiming, pitch: this.pitch });
    this.ctx.audio.engine(v.id, v.type, [v.x, 0, v.z], Math.min(1, Math.abs(v.speed) / v.T.top * 1.3 + Math.max(0, c.throttle) * 0.15), true);
    if (!this.vehicle) return;
    // drive-by with a pistol or rifle while holding aim
    this.aiming = inp.down("aim") && (this.weapon === "pistol" || this.weapon === "rifle");
    this.scoped = false;
    if (this.aiming) {
      this.seatPerson.setWeapon(this.def.model);
      this.weaponsInCar(dt);
    } else this.seatPerson.setWeapon(null);
    if (v.wrecked) this.exitVehicle(true);
  }
  weaponsInCar(dt) {
    const inp = this.ctx.g.input, def = this.def, a = this.ammo[this.weapon];
    this.fireT -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const n = Math.min(def.mag - a.mag, a.reserve); a.mag += n; a.reserve -= n; } return; }
    if (a.mag === 0 && a.reserve > 0) { this.reloadT = def.reload; this.ctx.audio.reload(def.id); return; }
    const want = def.auto ? inp.down("fire") : inp.pressed("fire");
    if (!want || this.fireT > 0 || a.mag <= 0) return;
    a.mag--;
    this.fireT = 60 / def.rpm;
    const aim = this.aimPoint(def.range);
    const muzzle = this.seatPerson.muzzleWorld(new THREE.Vector3());
    const dir = aim.point.clone().sub(muzzle).normalize();
    const hit = this.ctx.combat.fire(this.e, def, muzzle, dir, muzzle, { spread: def.spread * 1.8, ignoreVehicle: this.vehicle, ignore: [] });
    if (hit?.entity?.has?.("person") || hit?.vehicle) this.ctx.hud?.hitmark(hit?.entity && !hit.entity.alive);
    this.pitch += def.kick * 0.8;
  }

  interact() {
    const w = this.ctx.world;
    if (this.vehicle) { this.exitVehicle(); return; }
    const sh = w.spots.safehouse;
    if (sh && Math.hypot(this.e.x - sh.locker[0], this.e.z - sh.locker[1]) < 2.6) { this.ctx.useLocker?.(); return; }
    const v = this.ctx.vehicles.nearest([this.e.x, this.e.z], 4, (v) => !v.wrecked);
    if (v) this.enterVehicle(v);
  }

  /** What the HUD shows as a prompt. */
  promptText() {
    if (this.dead) return null;
    if (this.vehicle) return Math.abs(this.vehicle.speed) > 9 ? null : "[F] get out";
    const sh = this.ctx.world.spots.safehouse;
    if (sh && Math.hypot(this.e.x - sh.locker[0], this.e.z - sh.locker[1]) < 2.6) return "[F] locker: ammo, health, save";
    const v = this.ctx.vehicles.nearest([this.e.x, this.e.z], 4, (v) => !v.wrecked);
    if (v) return v.driver ? `[F] take the ${v.type === "boda" ? "boda" : v.type}` : `[F] ${v.T.bike ? "ride" : "drive"} the ${v.type === "boda" ? "boda" : v.type}`;
    return null;
  }

  // ---------- the camera, every frame ----------
  camera(dt) {
    const cam = this.ctx.g.three.camera, e = this.e, s = this.ctx.g.current;
    const kick = (this.camKick ?? 0);
    this.camKick = kick * Math.exp(-dt * 14);
    this.shake = Math.max(0, (this.shake ?? 0) - dt * 1.8);
    const sh = this.shake * this.shake;
    let pivot, dist, shoulder, fov;
    const yaw = this.yaw, pitch = this.pitch;
    if (this.vehicle) {
      const v = this.vehicle;
      // the camera swings behind the vehicle unless you looked around just now
      if (this.vehLookT <= 0 && Math.abs(v.speed) > 2) {
        let d = (v.e.rot + (v.speed < -1 ? Math.PI : 0)) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.5);
        this.pitch += (-0.18 - this.pitch) * Math.min(1, dt * 2);
      }
      pivot = _p.set(v.x, v.groundY + v.T.hgt + 0.5, v.z);
      dist = v.T.bike ? 4.6 : v.type === "matatu" ? 9.5 : 7;
      shoulder = 0;
      fov = 64 + Math.min(14, Math.abs(v.speed) * 0.35);
    } else {
      pivot = _p.set(e.x, e.y + (this.crouch ? 0.25 : 0.65), e.z);
      const sprint = this.ctx.g.input.down("sprint") && Math.hypot(e.vx, e.vz) > 4;
      dist = this.aiming ? 2.1 : sprint ? 3.9 : 3.3;
      shoulder = this.aiming ? 0.72 : 0.5;
      fov = this.aiming ? 46 : sprint ? 68 : 62;
      if (this.dead) { dist = 6; shoulder = 0; }
    }
    const cp = Math.cos(pitch), f = _f.set(Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp);
    const r = _r.set(-Math.sin(yaw), 0, Math.cos(yaw));
    if (this.scoped && !this.vehicle) {
      // first person through the scope, with a little sway
      const sway = this.ctx.g.input.down("sprint") ? 0.15 : 1;
      const t = this.ctx.g.time;
      const eye = new THREE.Vector3(e.x, e.y + (this.crouch ? 0.35 : 0.72), e.z);
      cam.position.copy(eye);
      const sf = f.clone();
      sf.x += Math.sin(t * 1.3) * 0.0016 * sway; sf.y += Math.sin(t * 1.9) * 0.0012 * sway;
      cam.lookAt(eye.add(sf));
      cam.fov = 55 / this.def.scope;
      this.person.group.visible = false;
      this.camPos.copy(cam.position);
    } else {
      this.person.group.visible = !this.vehicle;
      const want = pivot.clone().addScaledVector(f, -dist).addScaledVector(r, shoulder);
      // don't put the camera inside walls
      const from = pivot.clone().addScaledVector(r, shoulder * 0.5);
      const dir = want.clone().sub(from);
      const len = dir.length();
      const hit = s.ray3([from.x, from.y, from.z], [dir.x, dir.y, dir.z], len + 0.3, ["wall", "building"]);
      if (hit) want.copy(from).addScaledVector(dir.normalize(), Math.max(0.3, hit.dist - 0.35));
      const ground = this.ctx.world.groundAt(want.x, want.z, want.y) + 0.3;
      if (want.y < ground) want.y = ground;
      this.camPos.lerp(want, this.vehicle ? Math.min(1, dt * 10) : 1);
      cam.position.copy(this.camPos);
      cam.position.x += (Math.random() - 0.5) * sh * 0.6; cam.position.y += (Math.random() - 0.5) * sh * 0.5;
      cam.lookAt(this.camPos.clone().add(f));
      cam.rotateX(kick * 0.02);
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 10);
    }
    cam.updateProjectionMatrix();
    this.ctx.audio.setListener(cam.position.x, cam.position.y, cam.position.z, yaw);
  }
}
