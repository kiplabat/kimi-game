// The game: loop with a fixed step, scenes, title/pause/over flow, high scores,
// slow motion and hit-stop, and the report that tells a builder what is happening.

import { Scene } from "./scene";
import { Input } from "./input";
import { UI } from "./ui";
import { sound } from "./sound";
import { rng, type Rng } from "./math";
import { Render2D, type Renderer, type Bounds } from "./renderer";
import { Render3D } from "./render3d";
import { addHighScore, highScores } from "./storage";

export const VERSION = "0.3.0";
const STEP = 1 / 60;

export interface GameOpts {
  title?: string;
  /** A line under the title. */
  sub?: string;
  /** How-to-play lines on the title and pause cards. Use [Key] for key caps. */
  howto?: string[];
  mode?: "2d" | "3d";
  /** 2D: the screen in world pixels (letterboxed to fit). Default [800, 600]. */
  size?: [number, number];
  /** 2D: a world larger than the screen (the camera follows). 3D: a rectangle [width, depth] centred on 0. */
  world?: [number, number];
  /** 3D: a round arena of this radius centred on 0 (default 30). */
  arena?: number;
  background?: string;
  /** 2D backdrops. */
  backdrop?: "stars" | "grid" | "none";
  /** 3D look: neon, night, day, dusk, space. */
  /** "custom": no sky, lights, fog or floor: the game brings its own. */
  preset?: "neon" | "night" | "day" | "dusk" | "space" | "custom";
  quality?: "auto" | "low" | "medium" | "high";
  /** Adaptive quality: false to keep it fixed, or the frame times (ms) that lower or raise it. */
  adaptive?: boolean | { lowerAbove?: number; raiseBelow?: number; minScale?: number };
  /** 3D mouse look: a click locks the pointer; unlocking it (Esc) pauses the game. Read deltas with g.input.look(). */
  lockPointer?: boolean;
  bloom?: boolean;
  floor?: boolean;
  /** 3D: height of the plane the mouse aims on. */
  aimHeight?: number;
  /** Interface colour. */
  accent?: string;
  seed?: number;
  /** Element or selector to put the game in (default: the whole page). */
  parent?: HTMLElement | string;
  /** Show the title card first (default true). */
  titleScreen?: boolean;
  /** Show the engine report overlay from the start (F3 toggles it). */
  report?: boolean;
}

type GameState = "boot" | "title" | "play" | "paused" | "over";

export class Game {
  readonly opts: GameOpts;
  readonly mode: "2d" | "3d";
  readonly size: [number, number];
  readonly root: HTMLElement;
  readonly input: Input;
  readonly ui: UI;
  readonly renderer: Renderer;
  readonly bounds: Bounds;
  readonly sound = sound;
  current: Scene | null = null;
  state: GameState = "boot";
  /** Game time in seconds (scaled by slow motion). */
  time = 0;
  timeScale = 1;
  frameMs = 16.7;
  fps = 60;
  private r: Rng;
  private scenes = new Map<string, (s: Scene, params: any) => void>();
  private playName = "play";
  private playParams: any;
  private titleShown = false;
  private acc = 0;
  private last = 0;
  private frozen = 0;
  private slow = { target: 1, left: 0 };
  private errors: string[] = [];
  private notes: string[] = [];
  private listeners = new Map<string, ((d?: any) => void)[]>();
  private reportOn = false;
  private reportT = 0;
  private postT = 0;
  private collWin: number[] = [];
  private stepMs = 0;
  /** Random numbers from the game's seed: rand(), rand(b), rand(a, b). */
  rand: Rng["rand"];
  int: Rng["int"];
  pick: Rng["pick"];
  chance: Rng["chance"];

  constructor(opts: GameOpts = {}) {
    this.opts = opts;
    this.mode = opts.mode ?? "2d";
    this.size = opts.size ?? [800, 600];
    this.r = rng(opts.seed ?? (Date.now() >>> 0));
    this.rand = this.r.rand;
    this.int = this.r.int;
    this.pick = this.r.pick;
    this.chance = this.r.chance;

    // root element
    const parent = typeof opts.parent === "string" ? document.querySelector<HTMLElement>(opts.parent) : opts.parent;
    this.root = document.createElement("div");
    this.root.className = "kg-root";
    if (parent) {
      this.root.style.cssText = "width:100%;height:100%";
      parent.appendChild(this.root);
    } else {
      document.documentElement.style.cssText += ";height:100%;background:#000";
      document.body.style.cssText += ";margin:0;height:100%;overflow:hidden;background:#000";
      this.root.style.cssText = "position:fixed;inset:0";
      document.body.appendChild(this.root);
    }
    if (opts.accent) this.root.style.setProperty("--kg-accent", opts.accent);
    if (opts.title) document.title = opts.title;

    // world bounds
    if (this.mode === "2d") {
      const [w, h] = opts.world ?? this.size;
      this.bounds = { kind: "rect", x0: 0, y0: 0, x1: w, y1: h };
    } else if (opts.world) {
      const [w, d] = opts.world;
      this.bounds = { kind: "rect", x0: -w / 2, y0: -d / 2, x1: w / 2, y1: d / 2 };
    } else this.bounds = { kind: "circle", cx: 0, cy: 0, r: opts.arena ?? 30 };

    this.input = new Input(this.root);
    this.ui = new UI(this.root);
    this.renderer = this.mode === "3d" ? new Render3D(this) : new Render2D(this);
    this.input.onAny(() => sound.unlock());
    if (opts.lockPointer) {
      this.input.onAny(() => { if (this.state === "play") this.input.lockPointer(); });
      document.addEventListener("pointerlockchange", () => {
        if (!document.pointerLockElement && this.state === "play") this.pause();
      });
    }
    this.reportOn = !!opts.report;

    addEventListener("keydown", (e) => {
      if (e.code === "KeyM" && !e.repeat) { const m = sound.mute(); this.ui.popup(this.root.clientWidth / 2, 60, m ? "sound off" : "sound on"); }
      if ((e.code === "F3" || e.code === "Backquote") && !e.repeat) { e.preventDefault(); this.reportOn = !this.reportOn; if (!this.reportOn) this.ui.report(null); }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "play") this.pause(); });
    addEventListener("error", (e) => this._error(e.error ?? e.message));
    addEventListener("unhandledrejection", (e) => this._error(e.reason));
    new ResizeObserver(() => this.renderer.resize()).observe(this.root);

    (globalThis as any).__kimiGame = { game: this, report: () => this.report(), version: VERSION };
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  }

  // ---------- scenes ----------
  /** Define a scene: g.scene("play", (s) => { … }). A "title" scene runs behind the title card. */
  scene(name: string, setup: (s: Scene, params: any) => void) {
    this.scenes.set(name, setup);
    return this;
  }
  /** Start a scene. The first start shows the title card unless titleScreen is false. */
  start(name = "play", params?: any) {
    if (name !== "title") { this.playName = name; this.playParams = params; }
    if (!this.titleShown && this.opts.titleScreen !== false) {
      this.titleShown = true;
      this.showTitle();
      return;
    }
    this.titleShown = true;
    this.run(name, params);
  }
  /** Restart the last played scene. */
  restart() { this.run(this.playName, this.playParams); }

  private run(name: string, params?: any) {
    const setup = this.scenes.get(name);
    if (!setup) { this._error(new Error(`no scene called "${name}"`)); return; }
    if (this.current) {
      this.current._end();
      for (const e of this.current.entities) this.renderer.detach(e);
    }
    this.renderer.clear();
    this.ui.clear();
    this.ui.hideCard();
    this.timeScale = 1;
    this.slow = { target: 1, left: 0 };
    this.frozen = 0;
    sound.muffle(0);
    const s = new Scene(this, name, params);
    this.current = s;
    this.state = name === "title" ? "title" : "play";
    if (this.opts.lockPointer && name !== "title") this.input.lockPointer();
    try { setup(s, params ?? {}); } catch (err) { this._error(err); }
    this.input.refreshTouchButtons();
    this.emit("start", name);
  }

  private async showTitle() {
    if (this.scenes.has("title")) this.run("title");
    else { this.current = null; this.state = "title"; }
    this.state = "title";
    const o = this.opts;
    const hs = await highScores(o.title ?? "game");
    const how = (o.howto ?? this.defaultHowto()).map((l) => `<li>${keycaps(l)}</li>`).join("");
    const best = hs.length ? `<table class="kg-hs">${hs.slice(0, 3).map((h, i) => `<tr><td>${i + 1}</td><td>${h.score.toLocaleString("en-US")}</td><td>${h.at}</td></tr>`).join("")}</table>` : "";
    this.ui.showCard(
      `<h1>${o.title ?? "Kimi Game"}</h1><h3>${o.sub ?? "made with kimi/game"}</h3><ul>${how}</ul>${best}` +
        `<div class="kg-go">${this.input.isTouch ? "Tap" : "Press any key"} to start</div>` +
        `<div class="kg-small">P pause · M sound · F3 engine report</div>`,
      this.scenes.has("title"),
    );
    setTimeout(() => {
      const off = this.input.onAny(() => {
        if (this.state !== "title") return;
        off();
        sound.click();
        this.run(this.playName, this.playParams);
      });
    }, 350);
  }
  private defaultHowto() {
    return ["Move: [W][A][S][D] or arrows · stick · touch", "Pause: [P] or [Esc]"];
  }

  // ---------- flow ----------
  /** End the round: shows the score, saves high scores, any key restarts. */
  async over(o: { score?: number; title?: string; message?: string; win?: boolean } = {}) {
    if (this.state !== "play") return;
    this.state = "over";
    this.slowmo(0.25, 1e9);
    sound.muffle(0.6);
    o.win ? sound.win() : sound.over();
    this.emit("over", o);
    const score = Math.round(o.score ?? 0);
    const { list, rank } = await addHighScore(this.opts.title ?? "game", score, o.message);
    await new Promise((r) => setTimeout(r, 700));
    if (this.state !== "over") return;
    const rows = list.map((h, i) => `<tr class="${i === rank ? "me" : ""}"><td>${i + 1}</td><td>${h.score.toLocaleString("en-US")}</td><td>${h.at}</td></tr>`).join("");
    this.ui.showCard(
      `<h1>${o.title ?? (o.win ? "You win" : "Game over")}</h1>` +
        (o.message ? `<h3>${o.message}</h3>` : `<h3>&nbsp;</h3>`) +
        `<div class="kg-big">${score.toLocaleString("en-US")}</div>` +
        (rank === 0 && list.length > 1 ? `<div class="kg-new">NEW BEST</div><br>` : "") +
        `<table class="kg-hs">${rows}</table>` +
        `<div class="kg-go">${this.input.isTouch ? "Tap" : "Press any key"} to play again</div>`,
    );
    setTimeout(() => {
      const off = this.input.onAny(() => {
        if (this.state !== "over") return;
        off();
        sound.click();
        this.restart();
      });
    }, 600);
  }

  pause() {
    if (this.state !== "play") return;
    this.state = "paused";
    if (document.pointerLockElement) document.exitPointerLock?.();
    sound.muffle(0.9);
    const how = (this.opts.howto ?? this.defaultHowto()).map((l) => `<li>${keycaps(l)}</li>`).join("");
    this.ui.showCard(`<h1>Paused</h1><h3>${this.opts.title ?? ""}</h3><ul>${how}</ul><div class="kg-go">[P] to resume</div>`.replace("[P]", this.input.isTouch ? "Tap" : "P"));
    const off = this.input.onAny(() => {
      // touch: any tap resumes; with pointer lock a click resumes (it is the gesture the lock needs)
      if (this.input.isTouch || (this.opts.lockPointer && this.input.pointer.down)) { off(); this.resume(); }
    });
    this.emit("pause");
  }
  resume() {
    if (this.state !== "paused") return;
    this.state = "play";
    if (this.opts.lockPointer) this.input.lockPointer();
    this.ui.hideCard();
    sound.muffle(this.timeScale < 1 ? 0.7 : 0);
    this.last = performance.now();
    this.emit("resume");
  }

  /** Slow motion: g.slowmo(0.3, 2) runs the world at 30 % for 2 s. Unscaled entities keep full speed. */
  slowmo(scale: number, seconds: number) {
    this.slow = { target: scale, left: seconds };
  }
  /** Hit-stop: freeze everything for a moment (0.03–0.12 s feels good). */
  freeze(seconds = 0.06) { this.frozen = Math.max(this.frozen, seconds); }
  /** Flash the screen. */
  flash(color = "#fff", strength = 0.45) { this.ui.flash(color, strength); }

  on(ev: "start" | "over" | "pause" | "resume", fn: (d?: any) => void) {
    const l = this.listeners.get(ev) ?? [];
    l.push(fn);
    this.listeners.set(ev, l);
    return this;
  }
  private emit(ev: string, d?: any) { for (const f of this.listeners.get(ev) ?? []) try { f(d); } catch (err) { this._error(err); } }

  /** three.js objects for anything the engine does not do (3D only). */
  get three() {
    const r = this.renderer as Render3D;
    return r.is3d
      ? {
          THREE: r.THREE, scene: r.scene, camera: r.cam, renderer: r.renderer, pulse: (v?: number) => r.pulse(v),
          /** Replace the final draw (your own composer and passes). */
          setPipeline: (fn: ((dt: number) => void) | null) => r.setPipeline(fn),
          /** fn(level 0..3) now and whenever quality changes. */
          onQuality: (fn: (q: number) => void) => r.onQuality(fn),
          setQuality: (q: number) => r.setQuality(q),
          get quality() { return r.level; },
          /** Many copies of one thing in one draw, culled per copy: trees, lamps, crates. */
          instances: (geometry: any, material: any, o?: { shadow?: boolean; far?: number; near?: number }) => r.instances(geometry, material, o),
          /** Merge the static meshes under a group: one mesh per material per ground cell. */
          bake: (root: any, o?: { cell?: number; skip?: (m: any) => boolean }) => r.bake(root, o),
          /** Redraw shadows every n frames (0: by quality); refreshShadows() after a big change. */
          shadowEvery: (n: number) => r.shadowEvery(n),
          refreshShadows: () => r.refreshShadows(),
          /** fn(scale 0.5..1) now and when the adaptive resolution changes (for your own pipeline). */
          onScale: (fn: (s: number) => void) => r.onScale(fn),
          get scale() { return r.renderScale; },
          /** Pixel ratio a quality level uses before the scale. */
          pixelRatio: (q?: number) => r.basePixelRatio(q),
          /** Hide entity meshes beyond this distance from the camera (0: never; per entity: { cull: m }). */
          get cullDistance() { return r.cullDistance; },
          set cullDistance(v: number) { r.cullDistance = v; },
        }
      : null;
  }
  /** The 2D canvas context (2D only). */
  get ctx() { return (this.renderer as Render2D).ctx ?? null; }
  get width() { return this.mode === "2d" ? this.size[0] : this.root.clientWidth; }
  get height() { return this.mode === "2d" ? this.size[1] : this.root.clientHeight; }

  // ---------- loop ----------
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.max(0, (now - this.last) / 1000);
    const realDt = Math.min(0.1, rawDt); // the simulation never steps more than 0.1 s at once
    this.last = now;
    // frame time is measured unclamped (up to 2 s), so a slow machine shows its real numbers
    if (rawDt > 0 && rawDt < 2) {
      this.frameMs = this.frameMs * 0.92 + rawDt * 1000 * 0.08;
      this.fps = 1000 / this.frameMs;
    }
    const running = this.state === "play" || this.state === "title" || this.state === "over";
    // slow motion easing
    if (this.slow.left > 0) {
      this.slow.left -= realDt;
      this.timeScale += (this.slow.target - this.timeScale) * Math.min(1, realDt * 10);
    } else this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 4);
    if (Math.abs(1 - this.timeScale) < 0.01 && this.slow.left <= 0) this.timeScale = 1;
    this.renderer.updatePointer();

    let alpha = 1;
    const t0 = performance.now();
    if (running && this.current) {
      if (this.frozen > 0) {
        this.frozen -= realDt;
      } else {
        this.acc += realDt;
        let steps = 0;
        while (this.acc >= STEP && steps < 5) {
          this.input.beginStep();
          if (this.state === "play" && this.input.pressed("pause")) { this.input.endStep(); this.pause(); break; }
          const dt = STEP * this.timeScale;
          this.time += dt;
          this.current.step(dt, STEP);
          this.input.endStep();
          this.acc -= STEP;
          steps++;
        }
        if (steps === 5) this.acc = 0;
        alpha = this.acc / STEP;
      }
    } else {
      this.input.beginStep();
      if (this.state === "paused" && this.input.pressed("pause")) this.resume();
      this.input.endStep();
    }
    this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
    if (this.current && this.current.collisions) {
      this.collWin.push(now, this.current.collisions);
      this.current.collisions = 0;
      if (this.collWin.length > 400) this.collWin.splice(0, 200);
    }
    try {
      this.renderer.render(alpha, this.state === "paused" ? 0 : realDt * (this.frozen > 0 ? 0 : this.timeScale));
    } catch (err) { this._error(err); }

    // report
    this.reportT -= realDt;
    if (this.reportOn && this.reportT <= 0) { this.reportT = 0.25; this.ui.report(formatReport(this.report())); }
    this.postT -= realDt;
    if (this.postT <= 0) {
      this.postT = 2;
      const r = this.report();
      try { if (parent !== window) parent.postMessage({ type: "kimi-game:report", report: r }, "*"); } catch {}
      try { (globalThis as any).kimi?.report?.(r); } catch {}
    }
  }

  // ---------- report ----------
  /** What the engine knows right now: scenes, entities by tag (and whether they moved), collisions, frame time, input, warnings. */
  report() {
    const s = this.current;
    const tags: Record<string, { count: number; moved: number }> = {};
    let total = 0;
    let player: any = null;
    if (s) {
      for (const e of s.entities) {
        if (!e.alive) continue;
        total++;
        for (const t of e.tags) {
          const r = (tags[t] ??= { count: 0, moved: 0 });
          r.count++;
          if (e.moved) r.moved++;
        }
        if (e.opts.controls && !player) player = { tags: [...e.tags], moved: e.moved, everHit: !!e.data._everHit, hp: e.hp };
      }
    }
    // collisions in the last second
    let coll = 0;
    const keep: number[] = [];
    for (let i = 0; i < this.collWin.length; i += 2) if (performance.now() - this.collWin[i] < 1000) { keep.push(this.collWin[i], this.collWin[i + 1]); coll += this.collWin[i + 1]; }
    this.collWin = keep;
    const warnings: string[] = [];
    if (s && s.time > 3) {
      for (const [t, r] of Object.entries(tags)) {
        const movers = s.entities.filter((e) => e.alive && e.tags.has(t) && (e._ai.length || e.speed > 0 || e.opts.controls));
        if (movers.length >= 2 && r.moved === 0) warnings.push(`${r.count} ${t}, none moved`);
      }
      if (player && !player.moved && s.time > 6 && this.state === "play") warnings.push("the player never moved");
      if (player && !player.everHit && s.time > 12 && this.state === "play") warnings.push("the player never collided with anything");
      if (this.frameMs > 33) warnings.push(`frame time ${this.frameMs.toFixed(0)} ms`);
      if (total === 0) warnings.push("the scene is empty");
    }
    if (this.errors.length) warnings.push(`${this.errors.length} error(s)`);
    return {
      engine: `kimi/game@${VERSION}`,
      title: this.opts.title ?? "",
      mode: this.mode,
      state: this.state,
      scene: s?.name ?? null,
      sceneTime: s ? +s.time.toFixed(1) : 0,
      fps: Math.round(this.fps),
      frameMs: +this.frameMs.toFixed(1),
      stepMs: +this.stepMs.toFixed(2),
      timeScale: +this.timeScale.toFixed(2),
      entities: total,
      tags,
      player,
      collisionsPerSec: coll,
      input: this.input.describe(),
      ui: this.ui.describe(),
      render: this.renderer.describe(),
      sound: { state: sound.state, muted: sound.muted },
      warnings,
      notes: this.notes.slice(-5),
      errors: this.errors.slice(-5),
    };
  }

  _error(err: unknown) {
    const msg = err instanceof Error ? `${err.message}${err.stack ? " @ " + (err.stack.split("\n")[1] ?? "").trim() : ""}` : String(err);
    if (this.errors[this.errors.length - 1] === msg) return;
    this.errors.push(msg);
    if (this.errors.length > 20) this.errors.shift();
    console.error("[kimi/game]", err);
  }
  _note(msg: string) {
    this.notes.push(msg);
    if (this.notes.length > 20) this.notes.shift();
  }
}

function keycaps(s: string) {
  return s.replace(/\[([^\]]+)\]/g, "<kbd>$1</kbd>");
}

function formatReport(r: ReturnType<Game["report"]>) {
  const tagLines = Object.entries(r.tags).sort((a, b) => b[1].count - a[1].count).slice(0, 10)
    .map(([t, v]) => `  ${t.padEnd(10)} ${String(v.count).padStart(4)}  moved ${v.moved}`).join("\n");
  const rd = r.render as any;
  return [
    `${r.engine}  ${r.mode}  ${r.state}`,
    `scene ${r.scene}  t=${r.sceneTime}s  ×${r.timeScale}`,
    `fps ${r.fps}  frame ${r.frameMs}ms  step ${r.stepMs}ms` + ((r.render as any).submitMs !== undefined ? `\ndraw (cpu) ${(r.render as any).submitMs}ms  gpu ${(r.render as any).gpuMs ?? "n/a"}${(r.render as any).gpuMs !== null ? "ms" : ""}` : ""),
    rd.renderer + (rd.quality !== undefined ? `  q${rd.quality} ×${rd.scale}${rd.bloom ? " bloom" : ""}${rd.shadows ? ` shadows ${rd.shadowsPerSec}/s` : ""}` : ""),
    rd.drawCalls !== undefined ? `draw calls ${rd.drawCalls}  tris ${rd.triangles}` : "",
    rd.instances !== undefined ? `instances ${rd.instances}  culled ${rd.culled}` : "",
    `particles ${rd.particles}  collisions/s ${r.collisionsPerSec}`,
    `entities ${r.entities}`,
    tagLines,
    `input ${r.input.using}  pads ${r.input.pads}  uses ${r.input.used.join(",")}`,
    r.warnings.length ? `warnings:\n  ${r.warnings.join("\n  ")}` : "warnings: none",
    r.errors.length ? `errors:\n  ${r.errors.join("\n  ")}` : "",
  ].filter(Boolean).join("\n");
}

/** Make a game: const g = game({ title: "Space Dodge", mode: "2d" }). */
export function game(opts: GameOpts = {}) {
  return new Game(opts);
}
