// High scores and small settings. Uses KimiLM's kimi.storage when present,
// then localStorage, then memory (each wrapped: any of them can be missing).

const mem: Record<string, unknown> = {};

function kimi(): any {
  return (globalThis as any).kimi;
}

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const k = kimi();
    if (k?.storage?.get) {
      const v = await Promise.race([
        Promise.resolve(k.storage.get(key)),
        new Promise((r) => setTimeout(() => r(undefined), 800)),
      ]);
      if (v !== undefined && v !== null) return v as T;
    }
  } catch {}
  try {
    const raw = localStorage.getItem("kimi-game:" + key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return (mem[key] as T) ?? fallback;
}

export async function save(key: string, value: unknown) {
  mem[key] = value;
  try {
    const k = kimi();
    if (k?.storage?.set) await Promise.resolve(k.storage.set(key, value));
  } catch {}
  try {
    localStorage.setItem("kimi-game:" + key, JSON.stringify(value));
  } catch {}
}

export type HighScore = { score: number; at: string; note?: string };

/** Adds a score to the top-5 list; returns the list and the new entry's rank (or -1). */
export async function addHighScore(game: string, score: number, note?: string) {
  const key = "hi:" + game;
  const list = await load<HighScore[]>(key, []);
  const entry: HighScore = { score: Math.round(score), at: new Date().toISOString().slice(0, 10), note };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 5);
  await save(key, top);
  return { list: top, rank: top.indexOf(entry) };
}

export async function highScores(game: string) {
  return load<HighScore[]>("hi:" + game, []);
}
