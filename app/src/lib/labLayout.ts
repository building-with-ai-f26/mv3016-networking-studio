// Pure layout helpers for the Industry Lab mind map.
// Article positions are stored as OFFSETS from their industry hub, so hubs can move
// (e.g. when industry priorities change) without scattering user-placed articles.
import type { Article, LabNodePosition } from '../types';

export const HUB_SIZE = { w: 210, h: 76 };
export const ARTICLE_SIZE = { w: 220, h: 100 };
const CLUSTER_GAP = 230;

/** Candidate offsets around a hub, nearest first. */
const SLOTS: Array<[number, number]> = [
  [-245, -130],
  [235, -130],
  [-245, 106],
  [235, 106],
  [-5, -245],
  [-5, 196],
  [-485, -12],
  [475, -12],
  [-485, -245],
  [475, -245],
  [-485, 222],
  [475, 222],
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

interface Bounds {
  left: number; // extent to the left of the hub origin
  right: number;
  top: number;
  bottom: number;
}

function clusterBounds(offsets: Offset[]): Bounds {
  let left = 0, top = 0, right = HUB_SIZE.w, bottom = HUB_SIZE.h;
  for (const o of offsets) {
    left = Math.max(left, -o.x);
    top = Math.max(top, -o.y);
    right = Math.max(right, o.x + ARTICLE_SIZE.w);
    bottom = Math.max(bottom, o.y + ARTICLE_SIZE.h);
  }
  return { left, right, top, bottom };
}

/**
 * Hub positions in a roomy 2-column grid (2×2 for four industries), spaced by each
 * cluster's real size so clusters never overlap, even after nodes are dragged outward.
 */
export function packClusters(clusters: Offset[][]): Offset[] {
  const b = clusters.map(clusterBounds);
  const col = (c: number) => b.filter((_, i) => i % 2 === c);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const col1X = max(col(0).map((x) => x.right)) + CLUSTER_GAP + max(col(1).map((x) => x.left));
  const rows = Math.ceil(b.length / 2);
  const rowY: number[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = b.slice(r * 2, r * 2 + 2);
    if (r === 0) rowY.push(0);
    else {
      const prev = b.slice((r - 1) * 2, (r - 1) * 2 + 2);
      rowY.push(rowY[r - 1] + max(prev.map((x) => x.bottom)) + CLUSTER_GAP + max(inRow.map((x) => x.top)));
    }
  }
  return b.map((_, i) => ({ x: i % 2 === 0 ? 0 : col1X, y: rowY[Math.floor(i / 2)] }));
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
