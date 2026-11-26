// Interface drawn over the game: score, lives, bars, timers, banners, popups and cards.
// Plain DOM so it stays sharp at any size and works the same in 2D and 3D.

export type Corner = "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right" | "center";

const CSS = `
.kg-root{position:relative;overflow:hidden;background:#000;user-select:none;-webkit-user-select:none;touch-action:none;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef3ff;--kg-accent:#3fd0e0;--kg-u:clamp(11px,1.6vmin,18px)}
.kg-root canvas{display:block;position:absolute;inset:0;margin:auto;outline:none}
.kg-hud{position:absolute;inset:0;pointer-events:none;font-size:var(--kg-u)}
.kg-slot{position:absolute;display:flex;flex-direction:column;gap:.5em;padding:1.1em 1.3em}
.kg-slot[data-at=top-left]{left:0;top:0;align-items:flex-start}
.kg-slot[data-at=top]{left:50%;top:0;transform:translateX(-50%);align-items:center}
.kg-slot[data-at=top-right]{right:0;top:0;align-items:flex-end}
.kg-slot[data-at=bottom-left]{left:0;bottom:0;align-items:flex-start}
.kg-slot[data-at=bottom]{left:50%;bottom:0;transform:translateX(-50%);align-items:center}
.kg-slot[data-at=bottom-right]{right:0;bottom:0;align-items:flex-end}
.kg-slot[data-at=center]{left:50%;top:50%;transform:translate(-50%,-50%);align-items:center}
.kg-item{font-variant-numeric:tabular-nums;text-shadow:0 1px 8px rgba(0,0,0,.6);line-height:1.1}
.kg-lbl{font-size:.72em;letter-spacing:.18em;text-transform:uppercase;opacity:.65;display:block;margin-bottom:.2em}
.kg-score b{font-size:2.1em;font-weight:800;letter-spacing:.02em;display:inline-block;transition:transform .12s}
.kg-score b.bump{transform:scale(1.18)}
.kg-text{font-size:1.1em;font-weight:600}
.kg-bar{width:var(--w,14em)}
.kg-bar .t{height:.62em;border-radius:1em;background:rgba(255,255,255,.12);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.kg-bar .f{height:100%;width:100%;border-radius:1em;background:var(--c,var(--kg-accent));transform-origin:left;transition:transform .15s;box-shadow:0 0 12px var(--c,var(--kg-accent))}
.kg-lives{font-size:1.3em;letter-spacing:.15em;color:var(--c,#ff5d7a)}
.kg-banner{position:absolute;left:0;right:0;top:34%;text-align:center;pointer-events:none;animation:kg-in .5s cubic-bezier(.2,1.4,.4,1) both}
.kg-banner h2{margin:0;font-size:calc(var(--kg-u)*3.4);font-weight:900;letter-spacing:.12em;color:var(--c,#fff);text-shadow:0 0 28px var(--c,var(--kg-accent))}
.kg-banner p{margin:.4em 0 0;font-size:calc(var(--kg-u)*1.1);letter-spacing:.3em;text-transform:uppercase;opacity:.8}
.kg-banner.out{animation:kg-out .4s ease-in both}
@keyframes kg-in{from{opacity:0;transform:scale(1.6)}to{opacity:1;transform:none}}
@keyframes kg-out{to{opacity:0;transform:translateY(-20px)}}
.kg-pop{position:absolute;font-weight:800;font-size:calc(var(--kg-u)*1.05);pointer-events:none;white-space:nowrap;transform:translate(-50%,-50%);text-shadow:0 0 10px currentColor;animation:kg-pop .9s ease-out forwards}
@keyframes kg-pop{0%{opacity:0;margin-top:0;scale:.6}15%{opacity:1;scale:1.15}100%{opacity:0;margin-top:-48px;scale:1}}
.kg-flash{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s}
.kg-vignette{position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 18vmin rgba(255,0,60,.0);transition:box-shadow .3s}
.kg-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;background:radial-gradient(ellipse at center,rgba(5,8,20,.55),rgba(5,8,20,.88));backdrop-filter:blur(3px);font-size:var(--kg-u);animation:kg-fade .35s both}
.kg-card.clear{background:linear-gradient(180deg,rgba(4,6,16,.0) 30%,rgba(4,6,16,.78));backdrop-filter:none}
@keyframes kg-fade{from{opacity:0}}
.kg-card .in{text-align:center;max-width:min(92vw,40em);padding:2em}
.kg-card h1{margin:0;font-size:calc(var(--kg-u)*4.2);font-weight:900;letter-spacing:.08em;line-height:1;background:linear-gradient(90deg,#fff,var(--kg-accent),#fff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 24px color-mix(in srgb,var(--kg-accent) 60%,transparent))}
.kg-card h3{margin:.5em 0 1.4em;font-weight:500;letter-spacing:.35em;text-transform:uppercase;opacity:.7;font-size:.95em}
.kg-card ul{list-style:none;padding:0;margin:0 0 1.6em;display:grid;gap:.45em;font-size:.98em;opacity:.9}
.kg-card li kbd{display:inline-block;min-width:1.6em;padding:.1em .45em;margin:0 .15em;border-radius:.35em;background:rgba(255,255,255,.12);box-shadow:inset 0 -2px 0 rgba(0,0,0,.35);font:600 .85em ui-monospace,monospace}
.kg-go{display:inline-block;padding:.75em 1.8em;border-radius:3em;border:1px solid color-mix(in srgb,var(--kg-accent) 70%,transparent);color:#fff;letter-spacing:.3em;font-weight:700;text-transform:uppercase;font-size:.95em;animation:kg-pulse 1.6s ease-in-out infinite;background:color-mix(in srgb,var(--kg-accent) 18%,transparent)}
@keyframes kg-pulse{50%{box-shadow:0 0 26px var(--kg-accent);transform:scale(1.04)}}
.kg-hs{margin:0 auto 1.4em;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:16em}
.kg-hs td{padding:.28em .8em;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}
.kg-hs td:last-child{text-align:right;opacity:.55}
.kg-hs tr.me td{color:var(--kg-accent);font-weight:800}
.kg-big{font-size:calc(var(--kg-u)*3);font-weight:900;margin:.1em 0 .3em}
.kg-new{color:#ffd166;letter-spacing:.3em;font-weight:800;animation:kg-pulse 1s infinite}
.kg-small{opacity:.55;font-size:.82em;margin-top:1.2em;letter-spacing:.05em}
.kg-report{position:absolute;right:.6em;top:4.5em;width:19em;max-height:70%;overflow:auto;background:rgba(4,8,18,.82);border:1px solid rgba(120,200,255,.25);border-radius:.6em;padding:.7em .8em;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#bfe9ff;pointer-events:none;white-space:pre}
.kg-touch{position:absolute;inset:0;pointer-events:none}
.kg-stick{position:absolute;width:100px;height:100px;border-radius:50%;border:2px solid rgba(255,255,255,.25);background:rgba(255,255,255,.05);display:none}
.kg-stick i{position:absolute;left:30px;top:30px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.35)}
.kg-btns{position:absolute;right:4vmin;bottom:5vmin;display:flex;gap:3vmin;pointer-events:auto}
.kg-btns button,.kg-tpause{pointer-events:auto;width:16vmin;height:16vmin;max-width:84px;max-height:84px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);color:#fff;font-size:22px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.kg-btns button small{font-size:9px;letter-spacing:.15em;text-transform:uppercase;opacity:.7}
.kg-btns button.on{background:rgba(255,255,255,.3)}
.kg-tpause{position:absolute;top:2vmin;left:50%;transform:translateX(-50%);width:40px;height:40px;font-size:13px}
`;

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface ScoreHandle { value: number; add(n: number): void; set(n: number): void; el: HTMLElement }
export interface TextHandle { set(t: string): void; el: HTMLElement }
export interface BarHandle { value: number; max: number; set(v: number, max?: number): void; show(v: boolean): void; el: HTMLElement }
export interface LivesHandle { value: number; set(n: number): void; lose(n?: number): number; el: HTMLElement }
export interface TimerHandle { value: number; running: boolean; set(s: number): void; el: HTMLElement }

export class UI {
  readonly hud: HTMLElement;
  readonly layer: HTMLElement;
  private slots: Record<string, HTMLElement> = {};
  private items: { kind: string; label?: string; get: () => unknown; el: HTMLElement }[] = [];
  private timers: { h: TimerHandle; dir: number; onEnd?: () => void; fmt: (s: number) => string; b: HTMLElement }[] = [];
  private flashEl: HTMLElement;
  private vignetteEl: HTMLElement;
  private card?: HTMLElement;
  private reportEl?: HTMLElement;

  constructor(private root: HTMLElement) {
    injectCss();
    this.layer = document.createElement("div");
    this.layer.className = "kg-hud";
    this.hud = document.createElement("div");
    this.hud.className = "kg-hud";
    this.flashEl = document.createElement("div");
    this.flashEl.className = "kg-flash";
    this.vignetteEl = document.createElement("div");
    this.vignetteEl.className = "kg-vignette";
    root.append(this.flashEl, this.vignetteEl, this.layer, this.hud);
  }

  private slot(at: Corner) {
    if (!this.slots[at]) {
      const s = document.createElement("div");
      s.className = "kg-slot";
      s.dataset.at = at;
      this.hud.appendChild(s);
      this.slots[at] = s;
    }
    return this.slots[at];
  }
  private item(at: Corner, cls: string, html: string) {
    const el = document.createElement("div");
    el.className = "kg-item " + cls;
    el.innerHTML = html;
    this.slot(at).appendChild(el);
    return el;
  }

  /** Remove everything the current scene made. */
  clear() {
    this.hud.innerHTML = "";
    this.layer.innerHTML = "";
    this.slots = {};
    this.items = [];
    this.timers = [];
    this.vignette(0);
  }

  score(o: { label?: string; at?: Corner; value?: number } = {}): ScoreHandle {
    const el = this.item(o.at ?? "top-left", "kg-score", `<span class="kg-lbl">${o.label ?? "Score"}</span><b>0</b>`);
    const b = el.querySelector("b")!;
    let shown = -1;
    const h: ScoreHandle = {
      value: o.value ?? 0,
      el,
      add(n) { h.set(h.value + n); },
      set(n) {
        h.value = n;
        const r = Math.round(n);
        if (r !== shown) {
          shown = r;
          b.textContent = r.toLocaleString("en-US");
          b.classList.add("bump");
          setTimeout(() => b.classList.remove("bump"), 90);
        }
      },
    };
    h.set(h.value);
    this.items.push({ kind: "score", label: o.label ?? "Score", get: () => h.value, el });
    return h;
  }

  text(o: { text?: string; at?: Corner; label?: string; color?: string } | string = {}): TextHandle {
    const opt = typeof o === "string" ? { text: o } : o;
    const el = this.item(opt.at ?? "top", "kg-text", (opt.label ? `<span class="kg-lbl">${opt.label}</span>` : "") + `<span></span>`);
    const span = el.lastElementChild as HTMLElement;
    if (opt.color) el.style.color = opt.color;
    const h: TextHandle = { el, set(t) { span.textContent = t; } };
    h.set(opt.text ?? "");
    this.items.push({ kind: "text", label: opt.label, get: () => span.textContent, el });
    return h;
  }

  bar(o: { label?: string; max?: number; value?: number; color?: string; at?: Corner; width?: string } = {}): BarHandle {
    const el = this.item(o.at ?? "top-left", "kg-bar", `<span class="kg-lbl">${o.label ?? ""}</span><div class="t"><div class="f"></div></div>`);
    if (o.color) el.style.setProperty("--c", o.color);
    if (o.width) el.style.setProperty("--w", o.width);
    if (!o.label) (el.firstElementChild as HTMLElement).style.display = "none";
    const f = el.querySelector<HTMLElement>(".f")!;
    const h: BarHandle = {
      value: o.value ?? o.max ?? 1,
      max: o.max ?? 1,
      el,
      set(v, max) {
        if (max !== undefined) h.max = max;
        h.value = Math.max(0, Math.min(h.max, v));
        f.style.transform = `scaleX(${h.max ? h.value / h.max : 0})`;
      },
      show(v) { el.style.display = v ? "" : "none"; },
    };
    h.set(h.value);
    this.items.push({ kind: "bar", label: o.label, get: () => `${Math.round(h.value)}/${h.max}`, el });
    return h;
  }

  lives(n = 3, o: { at?: Corner; icon?: string; color?: string; label?: string } = {}): LivesHandle {
    const el = this.item(o.at ?? "top-right", "kg-lives", "");
    if (o.color) el.style.setProperty("--c", o.color);
    const icon = o.icon ?? "♥";
    const h: LivesHandle = {
      value: n,
      el,
      set(v) { h.value = Math.max(0, v); el.innerHTML = (o.label ? `<span class="kg-lbl">${o.label}</span>` : "") + icon.repeat(h.value) + `<span style="opacity:.2">${icon.repeat(Math.max(0, n - h.value))}</span>`; },
      lose(k = 1) { h.set(h.value - k); return h.value; },
    };
    h.set(n);
    this.items.push({ kind: "lives", get: () => h.value, el });
    return h;
  }

  /** A countdown (from > 0) or a stopwatch (from = 0). Calls onEnd at zero. */
  timer(o: { from?: number; at?: Corner; label?: string; onEnd?: () => void } = {}): TimerHandle {
    const el = this.item(o.at ?? "top", "kg-score", `<span class="kg-lbl">${o.label ?? "Time"}</span><b></b>`);
    const b = el.querySelector("b")!;
    const fmt = (s: number) => {
      const t = Math.max(0, s);
      const m = Math.floor(t / 60), sec = Math.floor(t % 60);
      return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : t < 10 && (o.from ?? 0) > 0 ? t.toFixed(1) : String(sec);
    };
    const h: TimerHandle = { value: o.from ?? 0, running: true, el, set(s) { h.value = s; b.textContent = fmt(s); } };
    h.set(h.value);
    this.timers.push({ h, dir: (o.from ?? 0) > 0 ? -1 : 1, onEnd: o.onEnd, fmt, b });
    this.items.push({ kind: "timer", label: o.label, get: () => +h.value.toFixed(1), el });
    return h;
  }

  tick(dt: number) {
    for (const t of this.timers) {
      if (!t.h.running) continue;
      const before = t.h.value;
      t.h.set(t.h.value + t.dir * dt);
      if (t.dir < 0 && before > 0 && t.h.value <= 0) {
        t.h.set(0);
        t.h.running = false;
        t.onEnd?.();
      }
    }
  }

  /** Big centred words for a moment: ui.banner("WAVE 3", { sub: "incoming" }). */
  banner(title: string, o: { sub?: string; time?: number; color?: string } = {}) {
    const el = document.createElement("div");
    el.className = "kg-banner";
    el.innerHTML = `<h2>${title}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}`;
    if (o.color) el.style.setProperty("--c", o.color);
    this.layer.appendChild(el);
    const t = (o.time ?? 1.6) * 1000;
    setTimeout(() => el.classList.add("out"), t);
    setTimeout(() => el.remove(), t + 450);
  }

  /** Floating text at a screen position (CSS px). */
  popup(x: number, y: number, text: string, color = "#fff") {
    if (this.layer.childElementCount > 60) return;
    const el = document.createElement("div");
    el.className = "kg-pop";
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.color = color;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  flash(color = "#fff", strength = 0.5) {
    const f = this.flashEl;
    f.style.transition = "none";
    f.style.background = color;
    f.style.opacity = String(strength);
    requestAnimationFrame(() => {
      f.style.transition = "opacity .35s";
      f.style.opacity = "0";
    });
  }
  /** Red edges when hurt: 0..1. */
  vignette(v: number, color = "255,0,60") {
    this.vignetteEl.style.boxShadow = `inset 0 0 ${10 + v * 18}vmin rgba(${color},${(v * 0.55).toFixed(2)})`;
  }

  /** Centre card for title, pause and game over. */
  showCard(html: string, clear = false) {
    this.hideCard();
    const c = document.createElement("div");
    c.className = "kg-card" + (clear ? " clear" : "");
    c.innerHTML = `<div class="in">${html}</div>`;
    this.root.appendChild(c);
    this.card = c;
    return c;
  }
  hideCard() {
    this.card?.remove();
    this.card = undefined;
  }
  get cardOpen() {
    return !!this.card;
  }

  report(text: string | null) {
    if (text === null) {
      this.reportEl?.remove();
      this.reportEl = undefined;
      return;
    }
    if (!this.reportEl) {
      this.reportEl = document.createElement("div");
      this.reportEl.className = "kg-report";
      this.root.appendChild(this.reportEl);
    }
    this.reportEl.textContent = text;
  }

  describe() {
    return this.items.map((i) => ({ kind: i.kind, label: i.label, value: i.get() }));
  }
}
