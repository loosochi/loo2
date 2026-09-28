/** Lane and junction geometry shared by the network compiler, renderer and build tools. */
import { ROAD } from '../config/balanceConfig';
import type { NetEdge, NetNode, Vec2 } from '../types';
import type { RoadNetwork } from './RoadNetwork';

export const LW = ROAD.laneWidth;
/** Gap between a junction's edge and a stop line. */
export const STOP_GAP = 8;

export const halfWidth = (e: NetEdge): number => ((e.f + e.bk) * LW) / 2;

/** Unit direction from node p to node q and its right-hand normal (screen coordinates). */
export function frame(p: Vec2, q: Vec2): { u: Vec2; n: Vec2; len: number } {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const u = { x: dx / len, y: dy / len };
  return { u, n: { x: -u.y, y: u.x }, len };
}

/**
 * Offset (towards the right of the travel direction) of lane `k` (0 = curb lane) for a road whose
 * total width is `width`. Lanes of each direction sit on that direction's right-hand side.
 */
export const laneOffset = (k: number, width: number): number => width / 2 - (k + 0.5) * LW;

/** Is the junction a bend between two roads (not straight)? */
function isBend(net: RoadNetwork, n: NetNode): boolean {
  const es = net.edgesAt(n.id);
  if (es.length !== 2) return false;
  const a = net.node(net.other(es[0], n.id))!;
  const b = net.node(net.other(es[1], n.id))!;
  const f1 = frame(a, n);
  const f2 = frame(n, b);
  return f1.u.x * f2.u.x + f1.u.y * f2.u.y < 0.985;
}

/** Radius of the paved junction area around a node (0 for plain road ends / straight joints). */
export function nodeRadius(net: RoadNetwork, n: NetNode): number {
  const es = net.edgesAt(n.id);
  if (es.length === 0) return 0;
  const maxHalf = Math.max(...es.map(halfWidth));
  if (es.length >= 3) return maxHalf + 10;
  if (isBend(net, n)) return maxHalf;
  return 0;
}

export function onBoundary(p: Vec2, world: { width: number; height: number }, eps = 1): boolean {
  return p.x <= eps || p.y <= eps || p.x >= world.width - eps || p.y >= world.height - eps;
}

/** Intersection of lines p+u·a and q+v·b; null when (nearly) parallel. */
export function lineIntersection(p: Vec2, u: Vec2, q: Vec2, v: Vec2): { point: Vec2; a: number; b: number } | null {
  const d = u.x * v.y - u.y * v.x;
  if (Math.abs(d) < 1e-6) return null;
  const wx = q.x - p.x;
  const wy = q.y - p.y;
  const a = (wx * v.y - wy * v.x) / d;
  const b = (wx * u.y - wy * u.x) / d;
  return { point: { x: p.x + u.x * a, y: p.y + u.y * a }, a, b };
}
