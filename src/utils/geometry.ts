import type { Dir, Vec2 } from '../types';

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function dirVector(d: Dir): Vec2 {
  switch (d) {
    case 'N':
      return { x: 0, y: -1 };
    case 'S':
      return { x: 0, y: 1 };
    case 'E':
      return { x: 1, y: 0 };
    case 'W':
      return { x: -1, y: 0 };
  }
}

export function dirAngle(d: Dir): number {
  const v = dirVector(d);
  return Math.atan2(v.y, v.x);
}

/** Quadratic Bézier point. */
export function quadBezier(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

/** Oriented bounding box: centre, heading angle, half length (along heading) and half width. */
export interface OBB {
  x: number;
  y: number;
  angle: number;
  halfL: number;
  halfW: number;
}

export function obbCorners(b: OBB): Vec2[] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const lx = c * b.halfL;
  const ly = s * b.halfL;
  const wx = -s * b.halfW;
  const wy = c * b.halfW;
  return [
    { x: b.x + lx + wx, y: b.y + ly + wy },
    { x: b.x + lx - wx, y: b.y + ly - wy },
    { x: b.x - lx - wx, y: b.y - ly - wy },
    { x: b.x - lx + wx, y: b.y - ly + wy },
  ];
}

function projectOnto(corners: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Separating Axis Theorem test for two oriented rectangles. Works at any rotation (turns included). */
export function obbOverlap(a: OBB, b: OBB): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes: Vec2[] = [
    { x: Math.cos(a.angle), y: Math.sin(a.angle) },
    { x: -Math.sin(a.angle), y: Math.cos(a.angle) },
    { x: Math.cos(b.angle), y: Math.sin(b.angle) },
    { x: -Math.sin(b.angle), y: Math.cos(b.angle) },
  ];
  for (const axis of axes) {
    const [amin, amax] = projectOnto(ca, axis);
    const [bmin, bmax] = projectOnto(cb, axis);
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

/** Distance from point p to segment ab. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}
