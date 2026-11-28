// Weapons and combat: hitscan guns with spread, recoil and head shots; rockets and grenades as
// projectiles; explosions with splash damage; one place where damage is dealt and heard.

import * as THREE from "three";

export const WEAPONS = {
  pistol:  { id: "pistol", name: "Pistol", model: "pistol", slot: 1, dmg: 26, rpm: 330, auto: false, mag: 12, reserve: 72, spread: 0.014, aimSpread: 0.004, range: 80, kick: 0.018, reload: 1.15, headMul: 2.2 },
  rifle:   { id: "rifle", name: "Nyundo AR", model: "rifle", slot: 2, dmg: 21, rpm: 640, auto: true, mag: 30, reserve: 210, spread: 0.022, aimSpread: 0.006, range: 150, kick: 0.011, reload: 1.9, headMul: 2.2 },
  shotgun: { id: "shotgun", name: "Pump shotgun", model: "shotgun", slot: 3, dmg: 14, pellets: 9, rpm: 72, auto: false, mag: 6, reserve: 42, spread: 0.075, aimSpread: 0.055, range: 38, kick: 0.06, reload: 2.3, headMul: 1.6 },
  sniper:  { id: "sniper", name: "Mbali sniper", model: "sniper", slot: 4, dmg: 115, rpm: 42, auto: false, mag: 5, reserve: 30, spread: 0.05, aimSpread: 0.0003, range: 600, kick: 0.07, reload: 2.6, scope: 7, headMul: 3 },
  rocket:  { id: "rocket", name: "Rocket launcher", model: "rocket", slot: 5, rpm: 40, auto: false, mag: 1, reserve: 6, projectile: "rocket", speed: 58, splash: 7.5, dmg: 240, reload: 2.6, kick: 0.05 },
  grenade: { id: "grenade", name: "Grenades", model: "grenade", slot: 6, rpm: 70, auto: false, mag: 1, reserve: 5, projectile: "grenade", splash: 7.5, dmg: 190, reload: 0.6 },
};
export const SLOTS = ["pistol", "rifle", "shotgun", "sniper", "rocket", "grenade"];

const SOLID_TAGS = ["wall", "building", "prop"];
const _v = new THREE.Vector3();

export class Combat {
  constructor(ctx) {
    this.ctx = ctx; // { g, fx, audio, world, vehicles, onKill, noise }
    this.projectiles = [];
    const rocketMat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.5, metalness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8), toneMapped: false });
    this.makeRocket = () => {
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8).rotateZ(Math.PI / 2), rocketMat);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8).rotateZ(-Math.PI / 2), rocketMat); tip.position.x = 0.45;
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glow); fl.position.x = -0.4;
      m.add(body, tip, fl);
      return m;
    };
    this.makeGrenade = () => new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6 }));
  }

  /** Is a straight line between two points clear of walls, buildings and props? */
  clear(a, b, ignore) {
    const s = this.ctx.g.current;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    const hit = s.ray3(a, d, len, SOLID_TAGS, ignore);
    return !hit;
  }

  /**
   * Fire a hitscan weapon. origin/dir are where the shot is aimed from (the camera for the player);
   * muzzle is where tracers start. Returns the first hit of the first pellet.
   */
  fire(shooter, def, origin, dir, muzzle, o = {}) {
    const { g, fx, audio, vehicles } = this.ctx;
    const s = g.current;
    const pellets = def.pellets ?? 1;
    const spread = o.spread ?? def.spread;
    let first = null;
    audio.shot(def.id, [muzzle.x, muzzle.y, muzzle.z]);
    fx.muzzle(muzzle, dir, def.id === "shotgun" || def.id === "sniper");
    this.ctx.noise([muzzle.x, muzzle.y, muzzle.z], def.id === "sniper" ? 90 : 60, shooter);
    const ignore = [shooter, ...(o.ignore ?? [])];
    for (let k = 0; k < pellets; k++) {
      const d = jitter(dir, spread);
      const from = [origin.x, origin.y, origin.z], dv = [d.x, d.y, d.z];
      let hit = s.ray3(from, dv, def.range, [...SOLID_TAGS, "person"], ignore);
      // vehicles are oriented boxes: test them separately
      const vh = vehicles.ray(from, dv, hit ? hit.dist : def.range, o.ignoreVehicle);
      if (vh && (!hit || vh.dist < hit.dist)) hit = vh;
      // the ground
      if (d.y < -1e-4) {
        const tg = -origin.y / d.y;
        if (tg < (hit ? hit.dist : def.range)) hit = { ground: true, dist: tg, point: [origin.x + d.x * tg, 0.01, origin.z + d.z * tg], normal: [0, 1, 0] };
      }
      const end = hit ? hit.point : [origin.x + d.x * def.range, origin.y + d.y * def.range, origin.z + d.z * def.range];
      if (k === 0 || Math.random() < 0.3) {
        if (def.id !== "shotgun" || k < 3) s.beam([muzzle.x, muzzle.y, muzzle.z], end, { color: def.id === "sniper" ? "#bfe3ff" : "#ffcf7a", width: def.id === "sniper" ? 0.03 : 0.018, life: def.id === "sniper" ? 0.25 : 0.05 });
      }
      if (hit) {
        if (hit.vehicle) {
          hit.vehicle.damage(def.dmg * 0.5 * (o.dmgScale ?? 1), shooter);
          fx.impact(hit.point, hit.normal, "metal");
          audio.impact(hit.point, "metal");
        } else if (hit.entity?.has("person")) {
          const head = hit.part === "head";
          this.hurt(hit.entity, def.dmg * (o.dmgScale ?? 1) * (head ? def.headMul ?? 2 : 1), shooter, { head, dir: [d.x, d.y, d.z], weapon: def.id });
          fx.impact(hit.point, hit.normal, "flesh");
          audio.impact(hit.point, "flesh");
        } else {
          fx.impact(hit.point, hit.normal, hit.ground ? "ground" : "wall");
          if (k < 2) audio.impact(hit.point, "wall");
        }
        // bullets that pass close to someone make them flinch and take cover
        this.ctx.whiz?.(from, dv, hit.dist, shooter);
      }
      if (!first) first = hit;
    }
    return first;
  }

  /** Damage a person (armour soaks 60 % until it runs out). */
  hurt(target, amount, from, info = {}) {
    if (!target.alive || target.invuln > 0) return;
    const d = target.data;
    if (d.godMode) return;
    let a = amount;
    if (d.armor > 0) { const soak = Math.min(d.armor, a * 0.6); d.armor -= soak; a -= soak; }
    d.lastHitBy = from;
    d.lastHitInfo = info;
    if (d.manualHp) { // the player: never removed by the engine; dies and respawns
      target.hp -= a;
      d.onHurt?.(a, from, info);
      if (target.hp <= 0) d.onDeath?.(from, info);
      return;
    }
    target.damage(a, from);
    target.flashT = 0; // we show hits with a flinch, not a white flash
    d.onHurt?.(a, from, info);
    if (!target.alive) this.ctx.onKill?.(target, from, info);
  }

  /** Launch a projectile: rocket (straight) or grenade (thrown with an arc). */
  launch(owner, def, from, dir) {
    const { g, audio } = this.ctx;
    const s = g.current;
    const rocket = def.projectile === "rocket";
    const speed = rocket ? def.speed : 17;
    const vel = [dir.x * speed, dir.y * speed + (rocket ? 0 : 4.5), dir.z * speed];
    const mesh = rocket ? this.makeRocket() : this.makeGrenade();
    const e = s.add({ at: [from.x, from.y, from.z], vel, radius: 0.1, mesh, tags: ["projectile"], dies: rocket ? 6 : 10, face: "none" });
    e.rot = Math.atan2(dir.z, dir.x);
    e.data = { owner, def, fuse: rocket ? 99 : 2.4, rocket };
    if (!rocket) audio.thrown([from.x, from.y, from.z]);
    this.projectiles.push(e);
    return e;
  }

  update(dt) {
    const { g, fx, vehicles } = this.ctx;
    const s = g.current;
    for (const e of this.projectiles) {
      if (!e.alive) continue;
      const d = e.data;
      if (d.rocket) {
        // the engine already moved it this step; check the path it took
        const from = [e.ox, e.oy, e.oz], step = [e.x - e.ox, e.y - e.oy, e.z - e.oz];
        const len = Math.hypot(...step) || 0.001;
        let hit = s.ray3(from, step, len, [...SOLID_TAGS, "person"], [d.owner]);
        const vh = vehicles.ray(from, step, hit ? hit.dist : len, d.owner?.data?.vehicle);
        if (vh && (!hit || vh.dist < hit.dist)) hit = vh;
        const floor = this.ctx.world.groundAt(e.x, e.z, e.y + 0.5);
        if (e.y <= floor + 0.05) hit = { point: [e.x, floor + 0.05, e.z] };
        if (Math.random() < 0.9) fx.smoke.add([e.x, e.y, e.z], [0, 0.2, 0], 1.2, 0.35, 2.5, [0.7, 0.68, 0.65], 0.4);
        if (hit) { e.die("hit"); this.explode(hit.point, d.def, d.owner); }
      } else {
        // grenade: gravity, bounces off the ground and walls
        e.vy -= 20 * dt;
        const ground = this.ctx.world.groundAt(e.x, e.z, e.y);
        if (e.y < ground + 0.07 && e.vy < 0) { e.y = ground + 0.07; e.vy *= -0.35; e.vx *= 0.6; e.vz *= 0.6; }
        const step = [e.x - e.ox, e.y - e.oy, e.z - e.oz];
        const len = Math.hypot(...step);
        if (len > 1e-3) {
          const hit = s.ray3([e.ox, e.oy, e.oz], step, len + 0.08, SOLID_TAGS);
          if (hit) {
            const n = hit.normal;
            const vn = e.vx * n[0] + e.vy * n[1] + e.vz * n[2];
            e.vx -= 1.6 * vn * n[0]; e.vy -= 1.6 * vn * n[1]; e.vz -= 1.6 * vn * n[2];
            e.x = e.ox; e.y = e.oy; e.z = e.oz;
          }
        }
        d.fuse -= dt;
        if (d.fuse <= 0) { e.die("fuse"); this.explode([e.x, e.y + 0.2, e.z], d.def, d.owner); }
      }
    }
    this.projectiles = this.projectiles.filter((e) => e.alive);
  }

  explode(p, def, owner) {
    const { g, fx, audio, vehicles } = this.ctx;
    const s = g.current;
    fx.explosion(p, def.id === "rocket" ? 1 : 0.8);
    audio.explosion(p, 1);
    this.ctx.noise(p, 140, owner);
    this.ctx.shake?.(p, 1.2);
    const R = def.splash;
    for (const e of s.within("person", [p[0], p[2]], R)) {
      const dist = Math.hypot(e.x - p[0], e.y - p[1], e.z - p[2]);
      if (dist > R) continue;
      const k = 1 - dist / R;
      // walls shelter people from the blast
      if (!this.clear(p, [e.x, e.y + 0.4, e.z], [e])) continue;
      this.hurt(e, def.dmg * k * k + 15 * k, owner, { blast: true, dir: [e.x - p[0], 0.5, e.z - p[2]] });
      e.data.knock = [(e.x - p[0]) * k * 4, 5 * k, (e.z - p[2]) * k * 4];
    }
    vehicles.blast(p, R * 1.3, def.dmg, owner);
    // nearby projectiles go off too
    for (const q of this.projectiles) if (q.alive && Math.hypot(q.x - p[0], q.z - p[2]) < 3) q.data.fuse = Math.min(q.data.fuse, 0.05);
  }
}

/** A direction with random spread inside a cone. */
export function jitter(dir, spread) {
  if (!spread) return dir.clone();
  const u = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  const tmp = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const a = _v.crossVectors(dir, tmp).normalize();
  const b = new THREE.Vector3().crossVectors(dir, a).normalize();
  return dir.clone().addScaledVector(a, Math.cos(u) * r).addScaledVector(b, Math.sin(u) * r).normalize();
}
