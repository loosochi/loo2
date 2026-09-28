/**
 * Static drawing of an editable road network (any angle, per-direction lanes): sidewalks,
 * asphalt, junction areas, lane markings, one-way arrows, give-way lines, entry/exit markers.
 */
import type Phaser from 'phaser';
import { ROAD } from '../config/balanceConfig';
import { COLORS } from '../config/theme';
import { LW, frame, halfWidth, nodeRadius, onBoundary } from '../graph/geometry';
import { classifyTurn, mainPair } from '../graph/NetworkCompiler';
import type { RoadNetwork } from '../graph/RoadNetwork';
import type { NetEdge, Vec2 } from '../types';

type G = Phaser.GameObjects.Graphics;
const EXTEND = 700;

function quad(g: G, a: Vec2, b: Vec2, n: Vec2, h: number): void {
  g.fillPoints(
    [
      { x: a.x + n.x * h, y: a.y + n.y * h },
      { x: b.x + n.x * h, y: b.y + n.y * h },
      { x: b.x - n.x * h, y: b.y - n.y * h },
      { x: a.x - n.x * h, y: a.y - n.y * h },
    ] as Phaser.Types.Math.Vector2Like[],
    true,
  );
}

/** Edge end points, extended off the map for roads that leave it. */
function ends(net: RoadNetwork, e: NetEdge, world: { width: number; height: number }): { a: Vec2; b: Vec2; u: Vec2; n: Vec2; len: number } {
  const A = net.node(e.a)!;
  const B = net.node(e.b)!;
  const f = frame(A, B);
  const a = { x: A.x, y: A.y };
  const b = { x: B.x, y: B.y };
  if (net.degree(A.id) === 1 && onBoundary(A, world)) {
    a.x -= f.u.x * EXTEND;
    a.y -= f.u.y * EXTEND;
  }
  if (net.degree(B.id) === 1 && onBoundary(B, world)) {
    b.x += f.u.x * EXTEND;
    b.y += f.u.y * EXTEND;
  }
  return { a, b, u: f.u, n: f.n, len: f.len };
}

function dashed(g: G, p: Vec2, u: Vec2, from: number, to: number, dash: number, gap: number, width: number, color: number, alpha = 1): void {
  g.lineStyle(width, color, alpha);
  for (let t = from; t < to; t += dash + gap) {
    const t2 = Math.min(to, t + dash);
    g.lineBetween(p.x + u.x * t, p.y + u.y * t, p.x + u.x * t2, p.y + u.y * t2);
  }
}

function solid(g: G, p: Vec2, u: Vec2, from: number, to: number, width: number, color: number, alpha = 1): void {
  if (to <= from) return;
  g.lineStyle(width, color, alpha);
  g.lineBetween(p.x + u.x * from, p.y + u.y * from, p.x + u.x * to, p.y + u.y * to);
}

function arrow(g: G, c: Vec2, u: Vec2, size: number, color: number, alpha: number): void {
  const n = { x: -u.y, y: u.x };
  g.fillStyle(color, alpha);
  g.fillTriangle(
    c.x + u.x * size,
    c.y + u.y * size,
    c.x - u.x * size * 0.2 + n.x * size * 0.6,
    c.y - u.y * size * 0.2 + n.y * size * 0.6,
    c.x - u.x * size * 0.2 - n.x * size * 0.6,
    c.y - u.y * size * 0.2 - n.y * size * 0.6,
  );
  g.fillRect(0, 0, 0, 0);
  g.lineStyle(size * 0.35, color, alpha);
  g.lineBetween(c.x - u.x * size * 1.1, c.y - u.y * size * 1.1, c.x, c.y);
}

/** Pavement (curbs, sidewalks, asphalt, junction areas) into `g`. */
export function paintNetworkRoads(g: G, net: RoadNetwork, world: { width: number; height: number }): void {
  const sw = ROAD.sidewalk;
  const layer = (pad: number, color: number, withNodes: boolean) => {
    g.fillStyle(color, 1);
    for (const e of net.edges) {
      const x = ends(net, e, world);
      quad(g, x.a, x.b, x.n, halfWidth(e) + pad);
    }
    if (!withNodes) return;
    for (const n of net.nodes) {
      const deg = net.degree(n.id);
      if (deg === 0) continue;
      const r = nodeRadius(net, n);
      if (r > 0) g.fillCircle(n.x, n.y, r + pad);
      else if (deg === 1 && !onBoundary(n, world)) g.fillCircle(n.x, n.y, halfWidth(net.edgesAt(n.id)[0]) + pad);
      else if (deg === 2) g.fillCircle(n.x, n.y, Math.max(...net.edgesAt(n.id).map(halfWidth)) + pad);
    }
  };
  layer(sw + 1.5, COLORS.curb, true);
  layer(sw, COLORS.sidewalk, true);
  layer(0, COLORS.asphalt, true);
  g.fillStyle(COLORS.asphaltLight, 1);
  for (const n of net.nodes) if (net.isJunction(n.id)) g.fillCircle(n.x, n.y, nodeRadius(net, n) - 2);
}

/** Lane markings, arrows, give-way lines and entry/exit markers into `g`. */
export function paintNetworkMarkings(g: G, net: RoadNetwork, world: { width: number; height: number }): void {
  for (const e of net.edges) {
    const A = net.node(e.a)!;
    const B = net.node(e.b)!;
    const x = ends(net, e, world);
    const rA = nodeRadius(net, A);
    const rB = nodeRadius(net, B);
    const ext = (n: typeof A) => (net.degree(n.id) === 1 && onBoundary(n, world) ? EXTEND : 0);
    const t0 = rA - ext(A) + (rA > 0 ? 4 : 0);
    const t1 = x.len + ext(B) - (rB > 0 ? rB + 4 : 0);
    const W = halfWidth(e) * 2;
    const at = (off: number) => ({ x: A.x + x.n.x * off, y: A.y + x.n.y * off });
    // Edge lines.
    solid(g, at(W / 2 - 3), x.u, t0, t1, 1.6, COLORS.lane, 0.55);
    solid(g, at(-W / 2 + 3), x.u, t0, t1, 1.6, COLORS.lane, 0.55);
    // Divider between the two directions.
    if (e.f > 0 && e.bk > 0) {
      const d = ((e.bk - e.f) / 2) * LW;
      if (e.f + e.bk > 2) {
        solid(g, at(d - 2.2), x.u, t0, t1, 2, COLORS.center, 0.95);
        solid(g, at(d + 2.2), x.u, t0, t1, 2, COLORS.center, 0.95);
      } else dashed(g, at(d), x.u, t0, t1, 16, 12, 2.4, COLORS.center, 0.95);
    }
    for (let k = 1; k < e.f; k++) dashed(g, at(W / 2 - k * LW), x.u, t0, t1, 16, 12, 2, COLORS.lane, 0.85);
    for (let k = 1; k < e.bk; k++) dashed(g, at(-(W / 2 - k * LW)), x.u, t0, t1, 16, 12, 2, COLORS.lane, 0.85);
    // One-way arrows on every lane.
    if (e.f === 0 || e.bk === 0) {
      const fwd = e.bk === 0;
      const u = fwd ? x.u : { x: -x.u.x, y: -x.u.y };
      const lanes = fwd ? e.f : e.bk;
      const lo = Math.max(t0, 0) + 30;
      const hi = Math.min(t1, x.len) - 30;
      for (let t = lo; t <= hi; t += 140) {
        for (let k = 0; k < lanes; k++) {
          const off = (fwd ? 1 : -1) * (W / 2 - (k + 0.5) * LW);
          const c = { x: A.x + x.u.x * t + x.n.x * off, y: A.y + x.u.y * t + x.n.y * off };
          arrow(g, c, u, 8, 0xffffff, 0.75);
        }
      }
    }
  }
  // Give-way lines at unsignalled approaches without right of way.
  for (const n of net.nodes) {
    if (!net.isJunction(n.id)) continue;
    const hasLights = net.data.lights.some((l) => l.node === n.id);
    const mp = hasLights ? null : mainPair(net, n);
    for (const e of net.edgesAt(n.id)) {
      const lanesIn = net.lanesInto(e, n.id);
      if (lanesIn === 0 || net.lightAt(n.id, e.id)) continue;
      if (mp && mp.includes(e.id)) continue;
      const from = net.node(net.other(e, n.id))!;
      const f = frame(from, n);
      const W = halfWidth(e) * 2;
      const r = nodeRadius(net, n) + 3;
      g.fillStyle(0xffffff, 0.95);
      for (let off = W / 2 - lanesIn * LW + 4; off < W / 2 - 3; off += 7) {
        const c = { x: n.x - f.u.x * r + f.n.x * off, y: n.y - f.u.y * r + f.n.y * off };
        g.fillTriangle(
          c.x - f.u.x * 5 + f.n.x * 2.8,
          c.y - f.u.y * 5 + f.n.y * 2.8,
          c.x - f.u.x * 5 - f.n.x * 2.8,
          c.y - f.u.y * 5 - f.n.y * 2.8,
          c.x + f.u.x,
          c.y + f.u.y,
        );
      }
    }
  }
  paintEndpoints(g, net, world);
}

/** Cyan chevrons for entries, white for exits; ringed markers for road ends inside the map. */
export function paintEndpoints(g: G, net: RoadNetwork, world: { width: number; height: number }): void {
  const mark = (nodeId: string, color: number, inbound: boolean) => {
    const n = net.node(nodeId);
    const e = n && net.edgesAt(nodeId)[0];
    if (!n || !e) return;
    const o = net.node(net.other(e, nodeId))!;
    const f = frame(n, o); // pointing into the map
    const u = inbound ? f.u : { x: -f.u.x, y: -f.u.y };
    const c = { x: Math.max(16, Math.min(world.width - 16, n.x)), y: Math.max(16, Math.min(world.height - 16, n.y)) };
    const inside = !onBoundary(n, world);
    if (inside) {
      g.lineStyle(3, color, 0.9);
      g.strokeCircle(n.x, n.y, halfWidth(e) + 6);
    }
    for (let k = 0; k < 3; k++) {
      const p = { x: c.x + f.u.x * (k * 10 + (inside ? 0 : 6)), y: c.y + f.u.y * (k * 10 + (inside ? 0 : 6)) };
      const nn = { x: -u.y, y: u.x };
      g.lineStyle(3, color, 0.4 + k * 0.25);
      g.beginPath();
      g.moveTo(p.x - u.x * 4 + nn.x * 6, p.y - u.y * 4 + nn.y * 6);
      g.lineTo(p.x + u.x * 3, p.y + u.y * 3);
      g.lineTo(p.x - u.x * 4 - nn.x * 6, p.y - u.y * 4 - nn.y * 6);
      g.strokePath();
    }
  };
  for (const s of net.data.spawns) mark(s.node, COLORS.accent, true);
  for (const x of net.data.exits) mark(x.node, 0xffffff, false);
}

/** Is this movement (arriving via `inEdge`, leaving via `outEdge`) on the main road? (debug/inspector) */
export function isMainMovement(net: RoadNetwork, nodeId: string, inEdge: string, outEdge: string): boolean {
  const n = net.node(nodeId)!;
  const mp = mainPair(net, n);
  if (!mp) return false;
  const tin = { edge: net.edge(inEdge)!, from: net.node(net.other(net.edge(inEdge)!, nodeId))!, to: n, lanes: 1 };
  const tout = { edge: net.edge(outEdge)!, from: n, to: net.node(net.other(net.edge(outEdge)!, nodeId))!, lanes: 1 };
  void classifyTurn(tin, tout);
  return mp.includes(inEdge) && mp.includes(outEdge);
}
