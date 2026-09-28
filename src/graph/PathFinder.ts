/**
 * A* over the road graph. States are (node, edge we arrived by) so U-turns back along the same
 * road are excluded. Results are cached per graph version.
 */
import type { NetEdge } from '../types';
import type { RoadNetwork, Traversal } from './RoadNetwork';

/** Extra cost for turning (keeps routes on straight roads when lengths are similar). */
const TURN_PENALTY = 30;

export interface PathResult {
  traversals: Traversal[];
  length: number;
  /** Nodes expanded (for the debug overlay). */
  expanded: number;
}

function turnCost(prev: Traversal | null, next: Traversal): number {
  if (!prev) return 0;
  const ux = prev.to.x - prev.from.x;
  const uy = prev.to.y - prev.from.y;
  const vx = next.to.x - next.from.x;
  const vy = next.to.y - next.from.y;
  const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
  return cos > 0.95 ? 0 : TURN_PENALTY;
}

export class PathFinder {
  private cache = new Map<string, PathResult | null>();
  private cacheVersion = -1;
  /** Total milliseconds spent searching (debug overlay). */
  lastSearchMs = 0;

  constructor(private readonly net: RoadNetwork) {}

  /** Shortest route from node `from` to node `to`, or null when unreachable. */
  find(from: string, to: string): PathResult | null {
    if (this.cacheVersion !== this.net.version) {
      this.cache.clear();
      this.cacheVersion = this.net.version;
    }
    const key = `${from}>${to}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const res = this.search(from, to);
    this.lastSearchMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    this.cache.set(key, res);
    return res;
  }

  private search(from: string, to: string): PathResult | null {
    const goal = this.net.node(to);
    const start = this.net.node(from);
    if (!goal || !start || from === to) return null;
    const h = (id: string) => {
      const n = this.net.node(id)!;
      return Math.hypot(n.x - goal.x, n.y - goal.y);
    };
    type State = { node: string; via: NetEdge | null; g: number; f: number; prev: State | null; trav: Traversal | null };
    const open: State[] = [{ node: from, via: null, g: 0, f: h(from), prev: null, trav: null }];
    const best = new Map<string, number>();
    const key = (s: { node: string; via: NetEdge | null }) => `${s.node}|${s.via?.id ?? ''}`;
    best.set(key(open[0]), 0);
    let expanded = 0;
    // Bounded: each (node, edge) state is expanded at most once per improvement; hard cap guards bugs.
    const cap = (this.net.nodes.length + 1) * (this.net.edges.length + 1) * 4 + 100;
    while (open.length && expanded < cap) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if ((best.get(key(cur)) ?? Infinity) < cur.g) continue;
      expanded++;
      if (cur.node === to) {
        const trav: Traversal[] = [];
        for (let s: State | null = cur; s && s.trav; s = s.prev) trav.unshift(s.trav);
        return { traversals: trav, length: cur.g, expanded };
      }
      for (const t of this.net.outgoing(cur.node)) {
        if (cur.via && t.edge.id === cur.via.id) continue; // no U-turn on the same road
        const g = cur.g + this.net.length(t.edge) + turnCost(cur.trav, t);
        const st = { node: t.to.id, via: t.edge };
        if (g >= (best.get(key(st)) ?? Infinity)) continue;
        best.set(key(st), g);
        open.push({ ...st, g, f: g + h(t.to.id), prev: cur, trav: t });
      }
    }
    return null;
  }
}
