/**
 * Turns a drag gesture (start → end) into road segments: snapping to existing junctions and
 * roads, to the build grid, straight roads in 8 directions, otherwise an L-shaped road with a turn.
 */
import { BUILD } from '../config/balanceConfig';
import type { RoadNetwork } from '../graph/RoadNetwork';
import type { Vec2 } from '../types';

export type SnapKind = 'node' | 'road' | 'grid' | 'free';

export interface SnappedPoint extends Vec2 {
  kind: SnapKind;
}

export interface BuildSettings {
  gridSize: number;
  snapToGrid: boolean;
  snapDistance: number;
}

export const defaultBuildSettings = (): BuildSettings => ({
  gridSize: BUILD.gridSize,
  snapToGrid: true,
  snapDistance: BUILD.roadSnapDistance,
});

export function snapPoint(net: RoadNetwork, p: Vec2, s: BuildSettings, world: { width: number; height: number }): SnappedPoint {
  const node = net.findNodeNear(p, s.snapDistance);
  if (node) return { x: node.x, y: node.y, kind: 'node' };
  const g = s.snapToGrid ? { x: Math.round(p.x / s.gridSize) * s.gridSize, y: Math.round(p.y / s.gridSize) * s.gridSize } : { ...p };
  const onRoad = net.findEdgeNear(g, s.snapDistance) ?? net.findEdgeNear(p, s.snapDistance);
  if (onRoad) return { x: onRoad.point.x, y: onRoad.point.y, kind: 'road' };
  const x = Math.max(0, Math.min(world.width, g.x));
  const y = Math.max(0, Math.min(world.height, g.y));
  return { x, y, kind: s.snapToGrid ? 'grid' : 'free' };
}

/** Allowed straight directions: every 45°. */
function aligned(a: Vec2, b: Vec2): boolean {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const k = Math.round(ang / (Math.PI / 4));
  return Math.abs(ang - k * (Math.PI / 4)) < 0.2;
}

/** Polyline for a road from a to b (2 points straight, 3 points with one turn). */
export function roadPolyline(a: Vec2, b: Vec2): Vec2[] {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return [a];
  if (aligned(a, b)) return [a, b];
  const corner = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [a, corner, b];
}

export const polylineLength = (pts: Vec2[]): number => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
};
