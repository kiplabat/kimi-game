// The game's interface, drawn over the 3D view as DOM: crosshair, hit markers, the sniper scope,
// ammo and weapon slots, health and armour, a rotating minimap, heat stars, the mission, a kill
// feed, damage direction, the speedometer, prompts, the loading screen, the menu and settings.

import { WEAPONS, SLOTS } from "./weapons.js";
import { HALF, N, PITCH, roadCentre, USE } from "./layout.js";

const CSS = `
.nc{position:absolute;inset:0;pointer-events:none;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f4f1ea;--u:clamp(11px,1.45vmin,17px);font-size:var(--u);text-shadow:0 1px 3px rgba(0,0,0,.75)}
.nc *{box-sizing:border-box}
.nc-x{position:absolute;left:50%;top:50%;width:0;height:0}
.nc-x i{position:absolute;background:#fff;box-shadow:0 0 2px #000}
.nc-x .t,.nc-x .b{width:2px;height:8px;left:-1px}.nc-x .l,.nc-x .r{height:2px;width:8px;top:-1px}
.nc-x .d{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
.nc-hm{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px;opacity:0;transition:opacity .15s}
.nc-hm:before,.nc-hm:after{content:"";position:absolute;left:12px;top:0;width:2px;height:26px;background:currentColor;transform:rotate(45deg);box-shadow:0 0 3px #000}
.nc-hm:after{transform:rotate(-45deg)}
.nc-scope{position:absolute;inset:0;display:none;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 33vmin,rgba(0,0,0,.6) 33.4vmin,#000 34vmin)}
.nc-scope:before,.nc-scope:after{content:"";position:absolute;background:rgba(0,0,0,.85)}
.nc-scope:before{left:0;right:0;top:50%;height:1px}.nc-scope:after{top:0;bottom:0;left:50%;width:1px}
.nc-scope b{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#e33}
.nc-br{position:absolute;right:2.2em;bottom:2em;text-align:right}
.nc-ammo{font-size:2.6em;font-weight:800;letter-spacing:.02em;font-variant-numeric:tabular-nums}
.nc-ammo small{font-size:.45em;opacity:.7;font-weight:600}
.nc-wname{font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:.85em;opacity:.9}
.nc-slots{display:flex;gap:.35em;justify-content:flex-end;margin-top:.6em}
.nc-slots span{min-width:2.1em;padding:.25em .4em;border-radius:.35em;background:rgba(10,12,18,.55);border:1px solid rgba(255,255,255,.12);font-size:.78em;text-align:center;opacity:.45}
.nc-slots span.own{opacity:.85}.nc-slots span.on{opacity:1;border-color:#ffc24b;color:#ffc24b}
.nc-bl{position:absolute;left:2em;bottom:1.8em}
.nc-map{width:13.5em;height:13.5em;border-radius:50%;overflow:hidden;border:2px solid rgba(255,255,255,.25);box-shadow:0 6px 24px rgba(0,0,0,.5);background:#1b1d1f;position:relative}
.nc-map canvas{width:100%;height:100%;display:block}
.nc-bars{width:13.5em;margin-top:.6em;display:grid;gap:.3em}
.nc-bar{height:.55em;border-radius:1em;background:rgba(255,255,255,.14);overflow:hidden}
.nc-bar i{display:block;height:100%;transition:width .15s}
.nc-cash{position:absolute;right:2.2em;top:1.6em;text-align:right}
.nc-cash b{font-size:1.9em;font-weight:800;color:#8bf59a;font-variant-numeric:tabular-nums}
.nc-heat{font-size:1.5em;letter-spacing:.1em;margin-top:.15em}
.nc-heat i{font-style:normal;opacity:.18}.nc-heat i.on{opacity:1;color:#ffd24b;text-shadow:0 0 8px #ff9b1a}
.nc-heat.flash i.on{animation:nc-blink .5s steps(2) infinite}
@keyframes nc-blink{50%{color:#4b8bff;text-shadow:0 0 8px #2b6bff}}
.nc-time{opacity:.75;margin-top:.2em;letter-spacing:.1em}
.nc-obj{position:absolute;left:2em;top:1.6em;max-width:34em}
.nc-obj h4{margin:0;font-size:.8em;letter-spacing:.22em;text-transform:uppercase;color:#ffc24b}
.nc-obj p{margin:.25em 0 0;font-size:1.15em;font-weight:600}
.nc-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);padding:.45em 1em;border-radius:2em;background:rgba(10,12,18,.65);font-weight:600;display:none}
.nc-note{position:absolute;left:50%;top:18%;transform:translateX(-50%);text-align:center}
.nc-note div{animation:nc-in .4s ease-out both}
.nc-note h2{margin:0;font-size:2.6em;font-weight:900;letter-spacing:.1em;color:#ffc24b}
.nc-note p{margin:.2em 0;font-size:1.1em;letter-spacing:.2em;text-transform:uppercase}
@keyframes nc-in{from{opacity:0;transform:scale(1.3)}}
.nc-feed{position:absolute;right:2.2em;top:8.5em;display:grid;gap:.3em;justify-items:end}
.nc-feed div{padding:.25em .6em;border-radius:.3em;background:rgba(10,12,18,.5);font-size:.85em;animation:nc-in .25s both}
.nc-dmg{position:absolute;left:50%;top:50%;width:0;height:0}
.nc-dmg i{position:absolute;left:-7em;top:-7em;width:14em;height:14em;border-radius:50%;border:4px solid transparent;border-top-color:rgba(255,40,40,.85);opacity:0;transition:opacity .6s}
.nc-speed{position:absolute;right:2.2em;bottom:9.5em;text-align:right;display:none}
.nc-speed b{font-size:2.6em;font-weight:800;font-variant-numeric:tabular-nums}
.nc-down{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(ellipse,rgba(60,0,0,.25),rgba(0,0,0,.7))}
.nc-down h1{margin:0;font-size:5em;font-weight:900;letter-spacing:.15em;color:#e8e0d0}
.nc-down p{letter-spacing:.25em;text-transform:uppercase;opacity:.85}
.nc-screen{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(180deg,rgba(4,6,12,.2),rgba(4,6,12,.85));text-align:center}
.nc-screen.load{background:#07080c}
.nc-logo{font-size:clamp(42px,9vmin,110px);font-weight:900;letter-spacing:.06em;line-height:.95;margin:0;background:linear-gradient(180deg,#fff 30%,#ffc24b);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 30px rgba(255,170,40,.35))}
.nc-tag{letter-spacing:.45em;text-transform:uppercase;opacity:.75;margin:.6em 0 2.2em;font-size:.95em}
.nc-menu{display:grid;gap:.6em;min-width:18em}
.nc-menu button{pointer-events:auto;font:inherit;font-size:1.05em;font-weight:700;letter-spacing:.2em;text-transform:uppercase;padding:.85em 1.4em;border-radius:.5em;border:1px solid rgba(255,255,255,.2);background:rgba(18,20,28,.7);color:#fff;cursor:pointer;transition:background .15s,border-color .15s}
.nc-menu button:hover,.nc-menu button:focus-visible{background:rgba(255,194,75,.18);border-color:#ffc24b;outline:none}
.nc-help{margin-top:2em;display:grid;grid-template-columns:repeat(2,minmax(0,auto));gap:.35em 2.2em;text-align:left;font-size:.9em;opacity:.85}
.nc-help kbd{display:inline-block;min-width:1.7em;padding:.05em .4em;margin-right:.3em;border-radius:.3em;background:rgba(255,255,255,.14);font:600 .85em ui-monospace,monospace;text-align:center}
.nc-loadbar{width:min(60vw,26em);height:4px;border-radius:4px;background:rgba(255,255,255,.12);margin-top:2em;overflow:hidden}
.nc-loadbar i{display:block;height:100%;width:0;background:#ffc24b;transition:width .2s}
.nc-set{display:grid;grid-template-columns:auto 14em;gap:.9em 1.4em;align-items:center;text-align:left;margin-bottom:1.6em}
.nc-set label{letter-spacing:.12em;text-transform:uppercase;font-size:.85em;opacity:.85}
.nc-set select,.nc-set input{pointer-events:auto;font:inherit;padding:.45em;border-radius:.35em;background:#14161d;color:#fff;border:1px solid rgba(255,255,255,.2)}
@media (max-width:700px){.nc-help{grid-template-columns:1fr}.nc-map,.nc-bars{width:9.5em}.nc-map{height:9.5em}}
`;

export class HUD {
  constructor(root) {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    const el = (this.el = document.createElement("div"));
    el.className = "nc";
    el.innerHTML = `
      <div class="nc-scope"><b></b></div>
      <div class="nc-x"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="d"></i></div>
      <div class="nc-hm"></div>
      <div class="nc-dmg"></div>
      <div class="nc-obj"><h4></h4><p></p></div>
      <div class="nc-cash"><b>$0</b><div class="nc-heat"></div><div class="nc-time"></div></div>
      <div class="nc-feed"></div>
      <div class="nc-note"></div>
      <div class="nc-prompt"></div>
      <div class="nc-speed"><b>0</b> km/h</div>
      <div class="nc-br"><div class="nc-wname"></div><div class="nc-ammo"></div><div class="nc-slots"></div></div>
      <div class="nc-bl"><div class="nc-map"><canvas width="256" height="256"></canvas></div>
        <div class="nc-bars"><div class="nc-bar"><i style="background:#5ee07a;width:100%"></i></div><div class="nc-bar"><i style="background:#4aa8ff;width:0"></i></div></div></div>
      <div class="nc-down"><h1>DOWN</h1><p>back at the safehouse in a moment</p></div>`;
    root.appendChild(el);
    // menus and the loading screen live in their own layer (the HUD fades out in menus)
    this.screens = document.createElement("div");
    this.screens.className = "nc";
    root.appendChild(this.screens);
    const q = (s) => el.querySelector(s);
    this.x = q(".nc-x"); this.hm = q(".nc-hm"); this.scope = q(".nc-scope"); this.dmg = q(".nc-dmg");
    this.objH = q(".nc-obj h4"); this.objP = q(".nc-obj p"); this.cash = q(".nc-cash b"); this.heatEl = q(".nc-heat"); this.timeEl = q(".nc-time");
    this.feed = q(".nc-feed"); this.note = q(".nc-note"); this.promptEl = q(".nc-prompt"); this.speedEl = q(".nc-speed"); this.speedB = q(".nc-speed b");
    this.wname = q(".nc-wname"); this.ammo = q(".nc-ammo"); this.slots = q(".nc-slots");
    this.map = q(".nc-map canvas"); this.mctx = this.map.getContext("2d");
    const bars = el.querySelectorAll(".nc-bar i"); this.hp = bars[0]; this.ar = bars[1];
    this.down = q(".nc-down");
    this.mapT = 0;
    this.shown = {};
    this.root = root;
  }

  // ---------- screens ----------
  loading(pct, text) {
    if (!this.loadEl) {
      this.loadEl = document.createElement("div");
      this.loadEl.className = "nc-screen load";
      this.loadEl.innerHTML = `<h1 class="nc-logo">SUNDOWN CITY</h1><div class="nc-tag">loading the city</div><div class="nc-loadbar"><i></i></div>`;
      this.screens.appendChild(this.loadEl);
    }
    this.loadEl.querySelector("i").style.width = Math.round(pct * 100) + "%";
    if (text) this.loadEl.querySelector(".nc-tag").textContent = text;
    if (pct >= 1) { this.loadEl.remove(); this.loadEl = null; }
  }
  menu(o) {
    this.closeMenu();
    const m = document.createElement("div");
    m.className = "nc-screen";
    m.innerHTML = `<h1 class="nc-logo">SUNDOWN CITY</h1><div class="nc-tag">a kimi/game open world</div>
      <div class="nc-menu">${o.items.map((it, i) => `<button data-i="${i}">${it.label}</button>`).join("")}</div>
      <div class="nc-help">${HELP.map(([k, v]) => `<div>${k.split(" ").map((x) => `<kbd>${x}</kbd>`).join("")} ${v}</div>`).join("")}</div>`;
    m.querySelectorAll("button").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); o.items[+b.dataset.i].go(); }));
    this.screens.appendChild(m);
    this.menuEl = m;
    m.querySelector("button")?.focus();
  }
  closeMenu() { this.menuEl?.remove(); this.menuEl = null; }
  settings(cur, onChange, onClose) {
    this.closeMenu();
    const m = document.createElement("div");
    m.className = "nc-screen";
    m.innerHTML = `<h2 style="letter-spacing:.3em;font-weight:800;margin:0 0 1.2em">SETTINGS</h2>
      <div class="nc-set">
        <label for="s-q">Graphics</label><select id="s-q"><option value="auto">Auto (adapts)</option><option value="0">Low</option><option value="1">Medium</option><option value="2">High</option><option value="3">Ultra</option></select>
        <label for="s-s">Mouse sensitivity</label><input id="s-s" type="range" min="0.6" max="4" step="0.1">
        <label for="s-v">Volume</label><input id="s-v" type="range" min="0" max="1" step="0.05">
        <label for="s-i">Invert look</label><select id="s-i"><option value="0">No</option><option value="1">Yes</option></select>
        <label for="s-d">Difficulty</label><select id="s-d"><option value="0.75">Relaxed</option><option value="1">Normal</option><option value="1.35">Hard</option></select>
      </div>
      <div class="nc-menu"><button>Back</button></div>`;
    const $ = (id) => m.querySelector(id);
    $("#s-q").value = cur.quality; $("#s-s").value = cur.sens; $("#s-v").value = cur.volume; $("#s-i").value = cur.invert ? "1" : "0"; $("#s-d").value = String(cur.difficulty);
    const read = () => onChange({ quality: $("#s-q").value, sens: +$("#s-s").value, volume: +$("#s-v").value, invert: $("#s-i").value === "1", difficulty: +$("#s-d").value });
    m.querySelectorAll("select,input").forEach((x) => x.addEventListener("input", read));
    m.querySelector("button").addEventListener("click", (ev) => { ev.stopPropagation(); onClose(); });
    this.screens.appendChild(m);
    this.menuEl = m;
  }

  // ---------- moments ----------
  notify(title, sub, time = 3) {
    const d = document.createElement("div");
    d.innerHTML = `<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}`;
    this.note.innerHTML = "";
    this.note.appendChild(d);
    clearTimeout(this.noteT);
    this.noteT = setTimeout(() => d.remove(), time * 1000);
  }
  killFeed(text, color = "#fff") {
    const d = document.createElement("div");
    d.textContent = text; d.style.color = color;
    this.feed.prepend(d);
    while (this.feed.childElementCount > 5) this.feed.lastElementChild.remove();
    setTimeout(() => d.remove(), 5000);
  }
  hitmark(kill) {
    this.hm.style.color = kill ? "#ff4040" : "#fff";
    this.hm.style.transition = "none"; this.hm.style.opacity = "1";
    requestAnimationFrame(() => { this.hm.style.transition = "opacity .25s"; this.hm.style.opacity = "0"; });
  }
  damageFrom(dir, yaw) {
    if (!dir) return;
    const i = document.createElement("i");
    const ang = Math.atan2(dir[1], dir[0]) - yaw; // 0 = ahead
    i.style.transform = `rotate(${(ang * 180) / Math.PI + 90}deg)`;
    this.dmg.appendChild(i);
    requestAnimationFrame(() => { i.style.opacity = "1"; setTimeout(() => { i.style.opacity = "0"; }, 500); });
    setTimeout(() => i.remove(), 1300);
  }
  set objective([title, text]) { this.objH.textContent = title ?? ""; this.objP.textContent = text ?? ""; }

  // ---------- every frame ----------
  update(dt, st) {
    const p = st.player;
    const def = WEAPONS[p.weapon];
    const a = p.ammo[p.weapon];
    const scoped = p.scoped && !p.vehicle;
    this.scope.style.display = scoped ? "block" : "none";
    const showX = !scoped && !p.dead && (!p.vehicle || p.aiming);
    this.x.style.display = showX ? "block" : "none";
    if (showX) {
      const gap = 4 + (p.aiming ? def.aimSpread ?? 0.01 : def.spread ?? 0.02) * 260 + p.bloom * 300 + (Math.hypot(p.e.vx, p.e.vz) > 0.5 ? 6 : 0);
      const [t, b, l, r] = this.x.children;
      t.style.top = -(gap + 8) + "px"; b.style.top = gap + "px"; l.style.left = -(gap + 8) + "px"; r.style.left = gap + "px";
    }
    const set = (k, v, f) => { if (this.shown[k] !== v) { this.shown[k] = v; f(v); } };
    set("w", p.reloadT > 0 ? def.name + " · reloading" : def.name, (v) => (this.wname.textContent = v));
    set("a", def.projectile === "rocket" ? `${a.mag}<small> / ${a.reserve}</small>` : `${a.mag}<small> / ${a.reserve}</small>`, (v) => (this.ammo.innerHTML = v));
    const sl = SLOTS.map((k, i) => `${k}:${p.owned.has(k)}:${p.weapon === k}:${i}`).join() + p.ammo.grenade.mag + p.ammo.grenade.reserve;
    set("s", sl, () => {
      this.slots.innerHTML = SLOTS.map((k, i) => {
        const own = p.owned.has(k);
        const label = k === "grenade" ? `G ${p.ammo.grenade.mag + p.ammo.grenade.reserve}` : `${i + 1} ${WEAPONS[k].name.split(" ").pop().slice(0, 6)}`;
        return `<span class="${own ? "own" : ""} ${p.weapon === k ? "on" : ""}">${label}</span>`;
      }).join("");
    });
    this.hp.style.width = Math.max(0, (p.e.hp / p.e.maxHp) * 100) + "%";
    this.ar.style.width = Math.max(0, p.armor) + "%";
    set("cash", p.cash, (v) => (this.cash.textContent = "$" + v.toLocaleString("en-US")));
    set("heat", st.heat + (st.seen ? "s" : ""), () => {
      this.heatEl.innerHTML = [1, 2, 3, 4, 5].map((k) => `<i class="${k <= st.heat ? "on" : ""}">★</i>`).join("");
      this.heatEl.classList.toggle("flash", st.seen && st.heat > 0);
    });
    set("time", st.time, (v) => (this.timeEl.textContent = v));
    const pr = p.promptText();
    set("pr", pr ?? "", (v) => { this.promptEl.style.display = v ? "block" : "none"; this.promptEl.textContent = v; });
    if (p.vehicle) { this.speedEl.style.display = "block"; this.speedB.textContent = Math.round(Math.abs(p.vehicle.speed) * 3.6); }
    else this.speedEl.style.display = "none";
    this.down.style.display = p.dead ? "flex" : "none";
    this.el.style.opacity = st.hide ? "0" : "1";
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 1 / 20; this.drawMap(st); }
  }

  // ---------- minimap ----------
  buildMap(world) {
    const S = 1024, k = S / 680;
    const c = document.createElement("canvas"); c.width = c.height = S;
    const x = c.getContext("2d");
    const P = (v) => (v + 340) * k;
    x.fillStyle = "#3b3a2f"; x.fillRect(0, 0, S, S);
    x.fillStyle = "#2c2e33";
    for (let i = 0; i <= N; i++) {
      const r = roadCentre(i);
      x.fillRect(P(r - 7), P(-HALF - 7), 14 * k, (HALF * 2 + 14) * k);
      x.fillRect(P(-HALF - 7), P(r - 7), (HALF * 2 + 14) * k, 14 * k);
    }
    const colors = { [USE.park]: "#3d6b33", [USE.plaza]: "#8a7a62", [USE.compound]: "#55534c", [USE.garage]: "#6c6c6c" };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const u = world.plan.use[i][j];
      const x0 = roadCentre(i) + 7, z0 = roadCentre(j) + 7;
      x.fillStyle = "#77746c"; x.fillRect(P(x0), P(z0), (PITCH - 14) * k, (PITCH - 14) * k); // sidewalks
      x.fillStyle = colors[u] ?? "#4a4840"; x.fillRect(P(x0 + 4), P(z0 + 4), (PITCH - 22) * k, (PITCH - 22) * k);
    }
    for (const b of world.colliders) {
      if (b.y1 - b.y0 < 2.5 || b.y0 > 1) continue;
      x.fillStyle = b.e.has("building") ? "#9b968a" : "#86826f";
      x.fillRect(P(b.x0), P(b.z0), Math.max(1, (b.x1 - b.x0) * k), Math.max(1, (b.z1 - b.z0) * k));
    }
    this.mapImg = c; this.mapK = k;
  }
  drawMap(st) {
    const c = this.mctx, W = 256, p = st.player;
    if (!this.mapImg) return;
    const scale = p.vehicle ? 0.9 : 1.6; // pixels per metre on the minimap
    const k = this.mapK;
    c.save();
    c.fillStyle = "#1b1d1f"; c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    c.rotate(-st.yaw - Math.PI / 2);
    c.scale(scale / k, scale / k);
    c.translate(-(p.e.x + 340) * k, -(p.e.z + 340) * k);
    c.drawImage(this.mapImg, 0, 0);
    c.restore();
    // blips (in map space, rotated)
    const toMap = (wx, wz) => {
      const dx = (wx - p.e.x) * scale, dz = (wz - p.e.z) * scale;
      const a = -st.yaw - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      return [W / 2 + dx * ca - dz * sa, W / 2 + dx * sa + dz * ca];
    };
    const clampEdge = ([x, y]) => {
      const dx = x - W / 2, dy = y - W / 2, d = Math.hypot(dx, dy), R = W / 2 - 10;
      return d > R ? [W / 2 + (dx / d) * R, W / 2 + (dy / d) * R, true] : [x, y, false];
    };
    for (const b of st.blips) {
      const [x, y, edge] = b.keep ? clampEdge(toMap(b.x, b.z)) : [...toMap(b.x, b.z), false];
      if (!b.keep && Math.hypot(x - W / 2, y - W / 2) > W / 2) continue;
      c.fillStyle = b.color;
      c.strokeStyle = "rgba(0,0,0,.7)"; c.lineWidth = 2;
      c.beginPath();
      if (b.icon === "mission") { c.arc(x, y, edge ? 6 : 8, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = "#000"; c.font = "bold 10px sans-serif"; c.textAlign = "center"; c.fillText("!", x, y + 3.5); }
      else if (b.icon === "home") { c.rect(x - 6, y - 6, 12, 12); c.fill(); c.stroke(); c.fillStyle = "#000"; c.font = "bold 9px sans-serif"; c.textAlign = "center"; c.fillText("S", x, y + 3); }
      else { c.arc(x, y, b.size ?? 4, 0, Math.PI * 2); c.fill(); c.stroke(); }
    }
    // the player: an arrow pointing where the camera faces
    c.save(); c.translate(W / 2, W / 2);
    const rel = (p.vehicle ? p.vehicle.e.rot : p.e.rot) - st.yaw;
    c.rotate(rel);
    c.fillStyle = "#fff"; c.strokeStyle = "#000"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // north
    const [nx, ny] = clampEdge(toMap(p.e.x, p.e.z - 1000));
    c.fillStyle = "#fff"; c.font = "bold 12px sans-serif"; c.textAlign = "center"; c.fillText("N", nx, ny + 4);
  }
}

export const HELP = [
  ["W A S D", "move · drive"], ["Mouse", "look · aim"], ["Click", "shoot"], ["Right-click", "aim · scope"],
  ["Shift", "sprint"], ["Space", "jump · handbrake"], ["C", "crouch"], ["R", "reload"],
  ["1 … 6", "weapons (or scroll)"], ["G", "throw a grenade"], ["F", "car, bike, locker"], ["Esc", "pause · settings"],
];
