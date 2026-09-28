/**
 * Editable road graph: nodes (junctions, bends, road ends) connected by straight edges with
 * lanes in each direction, plus traffic lights, spawn points and exits.
 * Pure data + geometry, no Phaser; serialisable as NetworkData.
 */
import type { NetEdge, NetExit, NetLight, NetNode, NetSpawn, NetworkData, Vec2 } from '../types';

export const MAX_LANES = 3;

export interface Traversal {
  edge: NetEdge;
  from: NetNode;
  to: NetNode;
  /** Lanes available in this travel direction. */
  lanes: number;
}

export function emptyNetwork(): NetworkData {
  return { nodes: [], edges: [], lights: [], spawns: [], exits: [], specials: [], decor: [], nextId: 1 };
}

export const cloneNetwork = (d: NetworkData): NetworkData => JSON.parse(JSON.stringify(d)) as NetworkData;

/** Intersection of segments p1p2 and p3p4 (strict interior of both), or null. */
export function segmentIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2, eps = 1e-6): { x: number; y: number; t: number; u: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, t, u };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}

export class RoadNetwork {
  readonly data: NetworkData;
  /** Incremented on every change; used to invalidate cached routes. */
  version = 0;

  constructor(data: NetworkData = emptyNetwork()) {
    this.data = data;
    this.data.specials ??= [];
    this.data.decor ??= [];
  }

  clone(): RoadNetwork {
    return new RoadNetwork(cloneNetwork(this.data));
  }

  /** Replace all content (used by undo/redo). */
  restore(snapshot: NetworkData): void {
    const copy = cloneNetwork(snapshot);
    Object.assign(this.data, copy);
    this.touch();
  }

  touch(): void {
    this.version++;
  }

  private newId(prefix: string): string {
    return `${prefix}${this.data.nextId++}`;
  }

  // ------------------------------------------------------------------ queries

  get nodes(): readonly NetNode[] {
    return this.data.nodes;
  }

  get edges(): readonly NetEdge[] {
    return this.data.edges;
  }

  node(id: string): NetNode | undefined {
    return this.data.nodes.find((n) => n.id === id);
  }

  edge(id: string): NetEdge | undefined {
    return this.data.edges.find((e) => e.id === id);
  }

  edgesAt(nodeId: string): NetEdge[] {
    return this.data.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  }

  degree(nodeId: string): number {
    return this.edgesAt(nodeId).length;
  }

  other(e: NetEdge, nodeId: string): string {
    return e.a === nodeId ? e.b : e.a;
  }

  length(e: NetEdge): number {
    const a = this.node(e.a)!;
    const b = this.node(e.b)!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** Lanes of `e` that arrive at `nodeId`. */
  lanesInto(e: NetEdge, nodeId: string): number {
    return e.b === nodeId ? e.f : e.a === nodeId ? e.bk : 0;
  }

  /** Lanes of `e` that leave `nodeId`. */
  lanesOutOf(e: NetEdge, nodeId: string): number {
    return e.a === nodeId ? e.f : e.b === nodeId ? e.bk : 0;
  }

  /** Possible moves leaving a node. */
  outgoing(nodeId: string): Traversal[] {
    const from = this.node(nodeId)!;
    const out: Traversal[] = [];
    for (const e of this.edgesAt(nodeId)) {
      const lanes = this.lanesOutOf(e, nodeId);
      if (lanes > 0) out.push({ edge: e, from, to: this.node(this.other(e, nodeId))!, lanes });
    }
    return out;
  }

  isJunction(nodeId: string): boolean {
    return this.degree(nodeId) >= 3;
  }

  spawnAt(nodeId: string): NetSpawn | undefined {
    return this.data.spawns.find((s) => s.node === nodeId);
  }

  exitAt(nodeId: string): NetExit | undefined {
    return this.data.exits.find((s) => s.node === nodeId);
  }

  lightAt(nodeId: string, edgeId: string): NetLight | undefined {
    return this.data.lights.find((l) => l.node === nodeId && l.edge === edgeId);
  }

  findNodeNear(p: Vec2, dist: number): NetNode | undefined {
    let best: NetNode | undefined;
    let bd = dist;
    for (const n of this.data.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  findEdgeNear(p: Vec2, dist: number): { edge: NetEdge; t: number; point: Vec2; d: number } | undefined {
    let best: { edge: NetEdge; t: number; point: Vec2; d: number } | undefined;
    for (const e of this.data.edges) {
      const a = this.node(e.a)!;
      const b = this.node(e.b)!;
      const r = distToSegment(p, a, b);
      if (r.d <= dist && (!best || r.d < best.d)) {
        best = { edge: e, t: r.t, point: { x: a.x + (b.x - a.x) * r.t, y: a.y + (b.y - a.y) * r.t }, d: r.d };
      }
    }
    return best;
  }

  roadCount(): number {
    return this.data.edges.length;
  }

  totalLength(): number {
    return this.data.edges.reduce((s, e) => s + this.length(e), 0);
  }

  // ------------------------------------------------------------------ mutations

  addNode(x: number, y: number): NetNode {
    const n: NetNode = { id: this.newId('n'), x, y };
    this.data.nodes.push(n);
    this.touch();
    return n;
  }

  addEdge(a: string, b: string, f = 1, bk = 1, locked?: boolean): NetEdge {
    const e: NetEdge = { id: this.newId('e'), a, b, f, bk };
    if (locked) e.locked = true;
    this.data.edges.push(e);
    this.touch();
    return e;
  }

  /**
   * Split an edge at a point, creating a node there. Lanes and locks are kept; a light on the
   * old edge stays with the half that reaches its node.
   */
  splitEdge(edgeId: string, p: Vec2): NetNode {
    const e = this.edge(edgeId)!;
    const n = this.addNode(p.x, p.y);
    const second: NetEdge = { id: this.newId('e'), a: n.id, b: e.b, f: e.f, bk: e.bk };
    if (e.locked) second.locked = true;
    const oldB = e.b;
    e.b = n.id;
    this.data.edges.push(second);
    for (const l of this.data.lights) if (l.edge === e.id && l.node === oldB) l.edge = second.id;
    this.touch();
    return n;
  }

  /** Node at `p`: an existing node, a split of an edge passing through it, or a new node. */
  nodeAt(p: Vec2, snap = 1): NetNode {
    const existing = this.findNodeNear(p, snap);
    if (existing) return existing;
    const on = this.findEdgeNear(p, snap);
    if (on) return this.splitEdge(on.edge.id, on.point);
    return this.addNode(p.x, p.y);
  }

  /**
   * Add a straight road between two points. Crossings with existing roads become junctions
   * automatically. Returns the created edges.
   */
  addRoad(p: Vec2, q: Vec2, f = 1, bk = 1): NetEdge[] {
    const start = this.nodeAt(p);
    const end = this.nodeAt(q);
    // Collect crossings with existing edges along the new segment.
    const hits: { t: number; node: NetNode }[] = [];
    for (const e of [...this.data.edges]) {
      if (e.a === start.id || e.b === start.id || e.a === end.id || e.b === end.id) continue;
      const a = this.node(e.a)!;
      const b = this.node(e.b)!;
      const x = segmentIntersection(start, end, a, b);
      if (x) hits.push({ t: x.t, node: this.splitEdge(e.id, x) });
    }
    // Existing nodes lying exactly on the new segment are joined too.
    for (const n of this.data.nodes) {
      if (n === start || n === end || hits.some((h) => h.node === n)) continue;
      const r = distToSegment(n, start, end);
      if (r.d < 0.5 && r.t > 0 && r.t < 1) hits.push({ t: r.t, node: n });
    }
    hits.sort((a, b) => a.t - b.t);
    const chain = [start, ...hits.map((h) => h.node), end];
    const created: NetEdge[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      if (chain[i].id === chain[i + 1].id) continue;
      const dup = this.data.edges.find(
        (e) => (e.a === chain[i].id && e.b === chain[i + 1].id) || (e.b === chain[i].id && e.a === chain[i + 1].id),
      );
      if (dup) continue;
      created.push(this.addEdge(chain[i].id, chain[i + 1].id, f, bk));
    }
    return created;
  }

  /** Remove an edge; orphaned nodes and lights go with it. Straight pass-through nodes are merged. */
  removeEdge(edgeId: string): void {
    const e = this.edge(edgeId);
    if (!e) return;
    this.data.edges = this.data.edges.filter((x) => x.id !== edgeId);
    this.data.lights = this.data.lights.filter((l) => l.edge !== edgeId);
    for (const nid of [e.a, e.b]) this.cleanupNode(nid);
    this.touch();
  }

  /** Drop a node without roads (unless it is a spawn/exit) and merge collinear 2-way nodes. */
  private cleanupNode(nodeId: string): void {
    const deg = this.degree(nodeId);
    const special = this.spawnAt(nodeId) || this.exitAt(nodeId);
    if (deg === 0 && !special) {
      this.data.nodes = this.data.nodes.filter((n) => n.id !== nodeId);
      this.data.lights = this.data.lights.filter((l) => l.node !== nodeId);
      return;
    }
    if (deg === 2 && !special) this.mergeIfStraight(nodeId);
  }

  private mergeIfStraight(nodeId: string): void {
    const [e1, e2] = this.edgesAt(nodeId);
    if (!e1 || !e2 || e1.locked !== e2.locked) return;
    const n = this.node(nodeId)!;
    const p = this.node(this.other(e1, nodeId))!;
    const q = this.node(this.other(e2, nodeId))!;
    const cross = (n.x - p.x) * (q.y - n.y) - (n.y - p.y) * (q.x - n.x);
    const dot = (n.x - p.x) * (q.x - n.x) + (n.y - p.y) * (q.y - n.y);
    if (Math.abs(cross) > 1e-6 || dot <= 0) return;
    // Lanes in p→q direction must agree on both halves.
    const fwd1 = e1.b === nodeId ? e1.f : e1.bk;
    const back1 = e1.b === nodeId ? e1.bk : e1.f;
    const fwd2 = e2.a === nodeId ? e2.f : e2.bk;
    const back2 = e2.a === nodeId ? e2.bk : e2.f;
    if (fwd1 !== fwd2 || back1 !== back2) return;
    if (this.data.lights.some((l) => l.node === nodeId)) return;
    this.data.edges = this.data.edges.filter((x) => x !== e1 && x !== e2);
    const merged: NetEdge = { id: e1.id, a: p.id, b: q.id, f: fwd1, bk: back1 };
    if (e1.locked) merged.locked = true;
    this.data.edges.push(merged);
    for (const l of this.data.lights) if (l.edge === e2.id) l.edge = e1.id;
    this.data.nodes = this.data.nodes.filter((x) => x.id !== nodeId);
  }

  setLanes(edgeId: string, f: number, bk: number): void {
    const e = this.edge(edgeId);
    if (!e) return;
    e.f = Math.max(0, Math.min(MAX_LANES, f));
    e.bk = Math.max(0, Math.min(MAX_LANES, bk));
    if (e.f + e.bk === 0) e.f = 1;
    // Lights need incoming lanes.
    this.data.lights = this.data.lights.filter((l) => l.edge !== edgeId || this.lanesInto(e, l.node) > 0);
    this.touch();
  }

  /** TWO_WAY → ONE_WAY a→b → ONE_WAY b→a → TWO_WAY, keeping the total lane count. */
  cycleDirection(edgeId: string): 'two' | 'ab' | 'ba' {
    const e = this.edge(edgeId)!;
    const total = e.f + e.bk;
    let mode: 'two' | 'ab' | 'ba';
    if (e.f > 0 && e.bk > 0) {
      this.setLanes(edgeId, Math.min(MAX_LANES, total), 0);
      mode = 'ab';
    } else if (e.bk === 0) {
      this.setLanes(edgeId, 0, Math.min(MAX_LANES, total));
      mode = 'ba';
    } else {
      this.setLanes(edgeId, Math.max(1, Math.ceil(total / 2)), Math.max(1, Math.floor(total / 2)));
      mode = 'two';
    }
    return mode;
  }

  directionOf(e: NetEdge): 'two' | 'ab' | 'ba' {
    return e.f > 0 && e.bk > 0 ? 'two' : e.bk === 0 ? 'ab' : 'ba';
  }

  setLight(nodeId: string, edgeId: string, on: boolean): void {
    this.data.lights = this.data.lights.filter((l) => !(l.node === nodeId && l.edge === edgeId));
    if (on) this.data.lights.push({ node: nodeId, edge: edgeId });
    this.touch();
  }

  /** Put lights on every incoming approach of a junction (or remove them all). */
  setJunctionLights(nodeId: string, on: boolean): number {
    let n = 0;
    for (const e of this.edgesAt(nodeId)) {
      if (this.lanesInto(e, nodeId) === 0) continue;
      const has = !!this.lightAt(nodeId, e.id);
      if (has !== on) {
        this.setLight(nodeId, e.id, on);
        n++;
      }
    }
    return n;
  }

  setSpawn(nodeId: string, spawn: Omit<NetSpawn, 'id' | 'node'> | null): NetSpawn | null {
    this.data.spawns = this.data.spawns.filter((s) => s.node !== nodeId);
    let created: NetSpawn | null = null;
    if (spawn) {
      created = { id: this.newId('S'), node: nodeId, ...spawn };
      this.data.spawns.push(created);
    }
    this.touch();
    return created;
  }

  setExit(nodeId: string, on: boolean): NetExit | null {
    this.data.exits = this.data.exits.filter((s) => s.node !== nodeId);
    let created: NetExit | null = null;
    if (on) {
      created = { id: this.newId('X'), node: nodeId };
      this.data.exits.push(created);
    }
    this.touch();
    return created;
  }

  /** Move a spawn or exit to another road end. */
  moveEndpoint(fromNode: string, toNode: string): boolean {
    const s = this.spawnAt(fromNode);
    const x = this.exitAt(fromNode);
    if ((!s && !x) || this.spawnAt(toNode) || this.exitAt(toNode)) return false;
    if (s) s.node = toNode;
    if (x) x.node = toNode;
    this.cleanupNode(fromNode);
    this.touch();
    return true;
  }

  /** Cycle a junction's right of way: auto → each road pair → all-way yield → auto. */
  cyclePriority(nodeId: string): void {
    const n = this.node(nodeId)!;
    const es = this.edgesAt(nodeId).map((e) => e.id);
    const pairs: [string, string][] = [];
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) pairs.push([es[i], es[j]]);
    const options: NonNullable<NetNode['priority']>[] = ['auto', ...pairs, 'allway'];
    const cur = JSON.stringify(n.priority ?? 'auto');
    const idx = options.findIndex((o) => JSON.stringify(o) === cur);
    n.priority = options[(idx + 1) % options.length];
    this.touch();
  }
}
