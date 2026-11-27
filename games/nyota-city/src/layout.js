// The city plan: an 8 × 8 grid of blocks between roads, each block given a use.
// Everything else (ground shader, buildings, traffic, nav grid) reads from here.

import { rng } from "kimi/game";

export const PITCH = 72;          // road centre to road centre
export const N = 8;               // blocks per side
export const HALF = (N * PITCH) / 2;  // 288: the city spans -288..288
export const ROAD = 7;            // half road width
export const WALK = 11;           // road centre to the inner edge of the sidewalk
export const LOT = PITCH - 2 * WALK;  // 50: buildable width inside a block
export const LANE = 3.5;          // lane offset from the road centre (traffic keeps left, as in Kenya)

export const roadCentre = (i) => -HALF + i * PITCH;
/** Block index of a coordinate (0..N-1), or -1 on the outer edge. */
export const blockOf = (v) => {
  const i = Math.floor((v + HALF) / PITCH);
  return i >= 0 && i < N ? i : -1;
};
/** Centre of a block. */
export const blockCentre = (i) => roadCentre(i) + PITCH / 2;

// block uses: 0 towers, 1 mid-rise, 2 park, 3 plaza, 4 compound, 5 shop row, 6 garage, 7 gang tower, 8 low-rise
export const USE = { towers: 0, midrise: 1, park: 2, plaza: 3, compound: 4, shops: 5, garage: 6, gangTower: 7, lowrise: 8 };

/** Key places the missions use. */
export const PLACES = {
  safehouse: [3, 3],   // shop row with the player's safehouse
  plaza: [4, 4],       // open square for battles
  garage: [4, 3],      // parking structure with a roof for the sniper mission
  compound: [6, 5],    // Kivuli gang warehouse
  gangTower: [1, 6],   // Kivuli's tower
  market: [2, 4],      // shop row: the market
};

export function makePlan(seed = 2026) {
  const r = rng(seed);
  const use = [];
  for (let i = 0; i < N; i++) {
    use.push([]);
    for (let j = 0; j < N; j++) {
      // denser towers in the middle, low-rise and parks toward the edges
      const d = Math.max(Math.abs(i - 3.5), Math.abs(j - 3.5));
      let u;
      const x = r.next();
      if (d < 1.6) u = x < 0.55 ? USE.towers : x < 0.85 ? USE.midrise : USE.shops;
      else if (d < 2.6) u = x < 0.2 ? USE.towers : x < 0.55 ? USE.midrise : x < 0.7 ? USE.park : x < 0.85 ? USE.shops : USE.compound;
      else u = x < 0.3 ? USE.lowrise : x < 0.5 ? USE.park : x < 0.7 ? USE.compound : x < 0.85 ? USE.midrise : USE.shops;
      use[i].push(u);
    }
  }
  const set = (k, u) => (use[PLACES[k][0]][PLACES[k][1]] = u);
  set("safehouse", USE.shops);
  set("plaza", USE.plaza);
  set("garage", USE.garage);
  set("compound", USE.compound);
  set("gangTower", USE.gangTower);
  set("market", USE.shops);
  use[2][2] = USE.park;
  use[5][5] = USE.park;
  return { use, seed };
}

/** A small hash for stable per-thing variety. */
export function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
