// Pure layout helpers for the Industry Lab mind map.
// Article positions are stored as OFFSETS from their industry hub, so hubs can move
// (e.g. when industry priorities change) without scattering user-placed articles.
import type { Article, LabNodePosition } from '../types';

export const HUB_SIZE = { w: 210, h: 76 };
export const ARTICLE_SIZE = { w: 220, h: 100 };
const CLUSTER_GAP = { x: 1450, y: 820 };

/** Candidate offsets around a hub, nearest first. */
const SLOTS: Array<[number, number]> = [
  [-260, -150],
  [250, -150],
  [-260, 120],
  [250, 120],
  [-5, -250],
  [-5, 220],
  [-520, -15],
  [510, -15],
  [-520, -280],
  [510, -280],
  [-520, 250],
  [510, 250],
];

export interface Offset {
  x: number;
  y: number;
}

function collides(a: Offset, b: Offset): boolean {
  return Math.abs(a.x - b.x) < ARTICLE_SIZE.w + 16 && Math.abs(a.y - b.y) < ARTICLE_SIZE.h + 14;
}

function hitsHub(a: Offset): boolean {
  return a.x < HUB_SIZE.w + 12 && a.x + ARTICLE_SIZE.w > -12 && a.y < HUB_SIZE.h + 12 && a.y + ARTICLE_SIZE.h > -12;
}

/** First default slot that does not overlap the hub or any taken position. */
export function findFreeSlot(taken: Offset[]): Offset {
  for (const [x, y] of SLOTS) {
    const c = { x, y };
    if (!taken.some((t) => collides(c, t))) return c;
  }
  // Overflow: stack rows further below the cluster.
  for (let row = 0; row < 50; row++) {
    for (const x of [-260, -5, 250]) {
      const c = { x, y: 360 + row * (ARTICLE_SIZE.h + 30) };
      if (!taken.some((t) => collides(c, t)) && !hitsHub(c)) return c;
    }
  }
  return { x: 0, y: 360 };
}

/** Lay out one industry cluster: stored offsets win; the rest fill free slots in order. */
export function layoutCluster(articleIds: string[], stored: Record<string, LabNodePosition>): Record<string, Offset> {
  const out: Record<string, Offset> = {};
  for (const id of articleIds) {
    const p = stored[id];
    if (p) out[id] = { x: p.x, y: p.y };
  }
  for (const id of articleIds) {
    if (out[id]) continue;
    out[id] = findFreeSlot(Object.values(out));
  }
  return out;
}

/** Hub positions in a roomy 2-column grid (2×2 for four industries). */
export function hubPosition(index: number): Offset {
  return { x: (index % 2) * CLUSTER_GAP.x, y: Math.floor(index / 2) * CLUSTER_GAP.y };
}

/** Saved articles grouped by industry, newest first within each group. */
export function groupByIndustry(articles: Article[], industryOrder: string[]): Array<{ industry: string; articles: Article[] }> {
  const groups = new Map<string, Article[]>();
  for (const a of articles) {
    const list = groups.get(a.industry) ?? [];
    list.push(a);
    groups.set(a.industry, list);
  }
  const rank = (ind: string) => {
    const i = industryOrder.indexOf(ind);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([industry, list]) => ({ industry, articles: [...list].sort((x, y) => y.date.localeCompare(x.date)) }));
}
