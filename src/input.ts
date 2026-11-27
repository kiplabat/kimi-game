// One mapping for keys, mouse, touch and gamepads.
// Games ask for actions ("fire", "jump", "alt", "pause") and a move vector;
// the engine decides where they come from.

import { len } from "./math";

export type Vec2 = { x: number; y: number };
export type Scheme = "keys" | "arrows" | "wasd" | "mouse" | "stick" | "twin" | "platformer" | "none";

const DEFAULT_BINDINGS: Record<string, string[]> = {
  up: ["ArrowUp", "KeyW", "pad:12"],
  down: ["ArrowDown", "KeyS", "pad:13"],
  left: ["ArrowLeft", "KeyA", "pad:14"],
  right: ["ArrowRight", "KeyD", "pad:15"],
  fire: ["KeyJ", "KeyZ", "mouse:0", "pad:7", "pad:2", "touch:fire"],
  jump: ["Space", "KeyK", "KeyX", "pad:0", "touch:jump"],
  alt: ["ShiftLeft", "ShiftRight", "KeyL", "KeyC", "KeyE", "mouse:2", "pad:1", "pad:4", "pad:5", "touch:alt"],
  pause: ["KeyP", "Escape", "pad:9"],
};
const ALIASES: Record<string, string> = {
  dash: "jump", action: "jump", boost: "jump",
  special: "alt", bomb: "alt", slow: "alt", shield: "alt",
  shoot: "fire", attack: "fire",
  start: "pause", menu: "pause",
};
const SCHEME_KEYS: Record<string, string[]> = {
  arrows: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  wasd: ["KeyW", "KeyS", "KeyA", "KeyD"],
};
const DEAD = 0.22;

export class Input {
  readonly bindings: Record<string, string[]> = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  /** Actions the game has asked about; touch buttons are shown only for these. */
  readonly used = new Set<string>();
  /** The last kind of device used: "keys", "pad" or "touch". */
  using: "keys" | "pad" | "touch" = "keys";
  /** Pointer in canvas CSS pixels, plus world position (filled by the renderer). */
  pointer = { x: 0, y: 0, down: false, inside: false, moved: false, world: { x: 0, y: 0 } as Vec2 };
  private lookAcc = { x: 0, y: 0 };
  private wheelAcc = 0;

  private keys = new Set<string>();
  private edgeDown = new Set<string>();
  private edgeUp = new Set<string>();
  private pads: (Gamepad | null)[] = [];
  private padPrev: boolean[][] = [];
  private touch = {
    on: false,
    move: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
    aim: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
    buttons: new Set<string>(),
  };
  private touchEl?: HTMLElement;
  private anyHandlers: (() => void)[] = [];
  wantsAimStick = false;
  /** Mouse look without pointer lock (when a page or frame refuses the lock). */
  freeLook = false;

  constructor(private root: HTMLElement) {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.edgeDown.add(e.code);
      this.using = "keys";
      this.fireAny();
    });
    addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      this.edgeUp.add(e.code);
    });
    addEventListener("blur", () => this.keys.clear());
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    root.addEventListener("wheel", (e) => { this.wheelAcc += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement || this.freeLook) { this.lookAcc.x += e.movementX; this.lookAcc.y += e.movementY; }
    });
    root.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = root.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.inside = true;
      this.pointer.moved = true;
      if (this.using === "touch") this.using = "keys";
    });
    // mousedown/mouseup (not pointer events): a second button pressed while another is held
    // (click to shoot while holding right-click to aim) sends no new pointerdown.
    root.addEventListener("mousedown", (e) => {
      if ((e as any).sourceCapabilities?.firesTouchEvents) return;
      const code = "mouse:" + e.button;
      this.keys.add(code);
      this.edgeDown.add(code);
      this.pointer.down = true;
      this.using = "keys";
      this.fireAny();
    });
    addEventListener("mouseup", (e) => {
      const code = "mouse:" + e.button;
      this.keys.delete(code);
      this.edgeUp.add(code);
      if (e.buttons === 0) this.pointer.down = false;
    });
    root.addEventListener("touchstart", (e) => this.onTouch(e, "start"), { passive: false });
    root.addEventListener("touchmove", (e) => this.onTouch(e, "move"), { passive: false });
    root.addEventListener("touchend", (e) => this.onTouch(e, "end"), { passive: false });
    root.addEventListener("touchcancel", (e) => this.onTouch(e, "end"), { passive: false });
  }

  /** Called once for any key, click, tap or pad button (used for "press to start"). */
  onAny(fn: () => void) {
    this.anyHandlers.push(fn);
    return () => (this.anyHandlers = this.anyHandlers.filter((f) => f !== fn));
  }
  private fireAny() {
    for (const f of [...this.anyHandlers]) f();
  }

  /** Bind extra keys to an action: input.bind("bomb", ["KeyB", "pad:3"]). With { replace: true } the old keys go. */
  bind(action: string, codes: string[], o: { replace?: boolean } = {}) {
    const a = ALIASES[action] ?? action;
    this.bindings[a] = o.replace ? [...codes] : [...(this.bindings[a] ?? []), ...codes];
  }

  /** Lock the mouse to the game (needs a click or key press first). */
  lockPointer() {
    if (document.pointerLockElement || this.touch.on) return;
    try { const r = (this.root.querySelector("canvas") ?? this.root).requestPointerLock?.() as any; r?.catch?.(() => {}); } catch {}
  }
  get locked() { return !!document.pointerLockElement; }
  /** Mouse movement since the last call (pixels), plus the right stick and the touch aim stick scaled to match. */
  look(dt = 1 / 60): Vec2 {
    let x = this.lookAcc.x, y = this.lookAcc.y;
    this.lookAcc.x = this.lookAcc.y = 0;
    const p = this.pads[0];
    if (p) {
      const ax = p.axes[2] ?? 0, ay = p.axes[3] ?? 0;
      if (len(ax, ay) > DEAD) { x += ax * Math.abs(ax) * 900 * dt; y += ay * Math.abs(ay) * 650 * dt; }
    }
    if (this.touch.aim.id >= 0) {
      x += ((this.touch.aim.x - this.touch.aim.ox) / 50) * 700 * dt;
      y += ((this.touch.aim.y - this.touch.aim.oy) / 50) * 500 * dt;
    }
    return { x, y };
  }
  /** Mouse wheel steps since the last call (+1 down, -1 up). */
  wheel(): number { const w = this.wheelAcc; this.wheelAcc = 0; return w; }

  private resolve(action: string) {
    const a = ALIASES[action] ?? action;
    this.used.add(a);
    let codes = this.bindings[a] ?? [];
    // Space fires in games that never ask for "jump".
    if (a === "fire" && !this.used.has("jump")) codes = [...codes, "Space"];
    return { a, codes };
  }

  private codeDown(code: string): boolean {
    if (code.startsWith("pad:")) {
      const b = +code.slice(4);
      return this.pads.some((p) => !!p && !!p.buttons[b]?.pressed);
    }
    if (code.startsWith("touch:")) return this.touch.buttons.has(code.slice(6));
    return this.keys.has(code);
  }
  private codeEdge(code: string, which: "down" | "up"): boolean {
    if (code.startsWith("pad:")) {
      const b = +code.slice(4);
      return this.pads.some((p, i) => {
        if (!p) return false;
        const now = !!p.buttons[b]?.pressed;
        const was = !!this.padPrev[i]?.[b];
        return which === "down" ? now && !was : !now && was;
      });
    }
    const set = which === "down" ? this.edgeDown : this.edgeUp;
    return set.has(code);
  }

  /** Is the action held? Twin-stick aim past halfway also counts as "fire". */
  down(action: string): boolean {
    const { a, codes } = this.resolve(action);
    if (codes.some((c) => this.codeDown(c))) return true;
    if (a === "fire" && this.wantsAimStick) {
      const s = this.rightStick();
      if (s && len(s.x, s.y) > 0.5) return true;
    }
    return false;
  }
  /** Did the action start this step? */
  pressed(action: string): boolean {
    const { codes } = this.resolve(action);
    return codes.some((c) => this.codeEdge(c, "down"));
  }
  released(action: string): boolean {
    const { codes } = this.resolve(action);
    return codes.some((c) => this.codeEdge(c, "up"));
  }

  /** Movement vector (length ≤ 1) from keys, pad left stick, or touch stick. */
  move(scheme: Scheme = "keys", player = 0): Vec2 {
    let x = 0, y = 0;
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    const useArrows = scheme !== "wasd";
    const useWasd = scheme !== "arrows";
    if (useArrows) { x += k("ArrowRight") - k("ArrowLeft"); y += k("ArrowDown") - k("ArrowUp"); }
    if (useWasd) { x += k("KeyD") - k("KeyA"); y += k("KeyS") - k("KeyW"); }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    const p = this.pads[player];
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (len(ax, ay) > DEAD) { x = ax; y = ay; }
      if (p.buttons[12]?.pressed) y = -1;
      if (p.buttons[13]?.pressed) y = 1;
      if (p.buttons[14]?.pressed) x = -1;
      if (p.buttons[15]?.pressed) x = 1;
    }
    if (player === 0 && this.touch.move.id >= 0) {
      const t = this.touch.move;
      const dx = (t.x - t.ox) / 50, dy = (t.y - t.oy) / 50;
      const l = len(dx, dy);
      if (l > 0.15) { x = dx / Math.max(1, l); y = dy / Math.max(1, l); }
    }
    const l = len(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  /** Right stick (pad or touch), or null when centred. */
  rightStick(player = 0): Vec2 | null {
    const p = this.pads[player];
    if (p) {
      const ax = p.axes[2] ?? 0, ay = p.axes[3] ?? 0;
      if (len(ax, ay) > DEAD) return { x: ax, y: ay };
    }
    if (player === 0 && this.touch.aim.id >= 0) {
      const t = this.touch.aim;
      const dx = (t.x - t.ox) / 50, dy = (t.y - t.oy) / 50;
      const l = len(dx, dy);
      if (l > 0.2) return { x: dx / Math.max(1, l), y: dy / Math.max(1, l) };
    }
    return null;
  }

  get isTouch() {
    return this.touch.on;
  }
  padCount() {
    return this.pads.filter(Boolean).length;
  }

  /** Gamepad rumble when the browser supports it. */
  vibrate(ms = 120, strength = 0.6) {
    for (const p of this.pads) {
      const act = (p as any)?.vibrationActuator;
      try {
        act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 });
      } catch {}
    }
    if (this.touch.on) try { navigator.vibrate?.(Math.min(ms, 60)); } catch {}
  }

  /** Called by the loop before each fixed step. */
  beginStep() {
    const list = (navigator.getGamepads?.() ?? []) as (Gamepad | null)[];
    this.pads = Array.from(list).filter((p) => p && p.connected).slice(0, 4) as Gamepad[];
    for (const p of this.pads) {
      if (!p) continue;
      if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5)) {
        if (this.using !== "pad") this.using = "pad";
        if (p.buttons.some((b, i) => b.pressed && !this.padPrev[this.pads.indexOf(p)]?.[i])) this.fireAny();
      }
    }
  }
  /** Called by the loop after each fixed step: clears edges. */
  endStep() {
    this.edgeDown.clear();
    this.edgeUp.clear();
    this.padPrev = this.pads.map((p) => (p ? p.buttons.map((b) => b.pressed) : []));
  }

  /** What is bound, for the report. */
  describe() {
    return {
      using: this.using,
      pads: this.padCount(),
      touch: this.touch.on,
      used: [...this.used],
      bound: Object.fromEntries([...this.used].map((a) => [a, this.bindings[a] ?? []])),
    };
  }

  // ---------- touch ----------
  private onTouch(e: TouchEvent, kind: "start" | "move" | "end") {
    e.preventDefault();
    if (!this.touch.on) {
      this.touch.on = true;
      this.buildTouchUi();
    }
    this.using = "touch";
    const r = this.root.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      const target = (t.target as HTMLElement)?.closest?.("[data-kg-btn]") as HTMLElement | null;
      if (kind === "start") {
        this.fireAny();
        if (target) {
          const name = target.dataset.kgBtn!;
          this.touch.buttons.add(name);
          this.edgeDown.add("touch:" + name);
          target.dataset.id = String(t.identifier);
          target.classList.add("on");
          continue;
        }
        const left = x < r.width / 2;
        const stick = left ? this.touch.move : this.wantsAimStick ? this.touch.aim : null;
        if (stick && stick.id < 0) Object.assign(stick, { id: t.identifier, ox: x, oy: y, x, y });
        if (!stick && !left) { this.pointer.x = x; this.pointer.y = y; }
      } else if (kind === "move") {
        for (const s of [this.touch.move, this.touch.aim]) if (s.id === t.identifier) { s.x = x; s.y = y; }
      } else {
        for (const s of [this.touch.move, this.touch.aim]) if (s.id === t.identifier) s.id = -1;
        this.root.querySelectorAll<HTMLElement>("[data-kg-btn]").forEach((b) => {
          if (b.dataset.id === String(t.identifier)) {
            this.touch.buttons.delete(b.dataset.kgBtn!);
            this.edgeUp.add("touch:" + b.dataset.kgBtn);
            b.classList.remove("on");
            b.dataset.id = "";
          }
        });
      }
    }
    this.drawSticks();
  }

  private buildTouchUi() {
    const el = document.createElement("div");
    el.className = "kg-touch";
    this.root.appendChild(el);
    this.touchEl = el;
    this.refreshTouchButtons();
  }
  /** Show buttons only for actions the game uses. */
  refreshTouchButtons() {
    if (!this.touchEl) return;
    const want = ["fire", "jump", "alt"].filter((a) => this.used.has(a) && !(a === "fire" && this.wantsAimStick));
    const label: Record<string, string> = { fire: "●", jump: "▲", alt: "◆" };
    const html =
      `<div class="kg-stick l"><i></i></div><div class="kg-stick r"><i></i></div>` +
      `<div class="kg-btns">${want.map((a) => `<button data-kg-btn="${a}">${label[a]}<small>${a}</small></button>`).join("")}</div>` +
      `<button class="kg-tpause" data-kg-btn="pause">II</button>`;
    if (this.touchEl.dataset.k !== want.join()) {
      this.touchEl.innerHTML = html;
      this.touchEl.dataset.k = want.join();
    }
  }
  private drawSticks() {
    if (!this.touchEl) return;
    const sticks: [string, any][] = [["l", this.touch.move], ["r", this.touch.aim]];
    for (const [c, s] of sticks) {
      const el = this.touchEl.querySelector<HTMLElement>(".kg-stick." + c);
      if (!el) continue;
      el.style.display = s.id >= 0 ? "block" : "none";
      el.style.left = s.ox - 50 + "px";
      el.style.top = s.oy - 50 + "px";
      const dx = Math.max(-40, Math.min(40, s.x - s.ox)), dy = Math.max(-40, Math.min(40, s.y - s.oy));
      (el.firstElementChild as HTMLElement).style.transform = `translate(${dx}px,${dy}px)`;
    }
  }
}

export const SCHEME_NAMES = SCHEME_KEYS;
