import { DRIVING, ROAD } from '../config/balanceConfig';
import type { Vec2, WaypointDef } from '../types';
import { cross, dist, normalize, quadBezier, sub } from '../utils/geometry';
import { wrapAngle } from '../utils/math';

/** Comfortable deceleration used to build the curve speed profile. */
const PROFILE_DECEL = 60;
const BEZIER_SEGMENTS = 20;

/**
 * A drivable path: waypoints with rounded (quadratic Bézier) corners, resampled at a
 * uniform arc-length step so that `index = s / step`. Stores heading, curvature and a
 * speed profile (max speed at each point that still allows braking for upcoming curves).
 */
export class Path {
  readonly points: Vec2[];
  readonly headings: number[];
  readonly curvature: number[];
  readonly speedLimit: number[];
  readonly length: number;
  readonly step: number;

  constructor(waypoints: WaypointDef[], step: number = ROAD.pathStep) {
    if (waypoints.length < 2) throw new Error('A path needs at least two waypoints');
    this.step = step;
    const raw = buildRoundedPolyline(waypoints);
    this.points = resample(raw, step);
    this.length = (this.points.length - 1) * step;
    const n = this.points.length;

    this.headings = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.points[Math.min(i, n - 2)];
      const b = this.points[Math.min(i + 1, n - 1)];
      this.headings[i] = Math.atan2(b.y - a.y, b.x - a.x);
    }

    const rawCurv = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      rawCurv[i] = Math.abs(wrapAngle(this.headings[i] - this.headings[i - 1])) / step;
    }
    // Conservative smoothing: max over a small window.
    this.curvature = rawCurv.map((_, i) => {
      let m = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) m = Math.max(m, rawCurv[k]);
      return m;
    });

    const vlim = this.curvature.map((k) => (k > 1e-4 ? Math.sqrt(DRIVING.lateralAccel / k) : Infinity));
    this.speedLimit = new Array(n);
    this.speedLimit[n - 1] = vlim[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      const next = this.speedLimit[i + 1];
      const reach = Number.isFinite(next) ? Math.sqrt(next * next + 2 * PROFILE_DECEL * step) : Infinity;
      this.speedLimit[i] = Math.min(vlim[i], reach);
    }
  }

  indexAt(s: number): number {
    const i = Math.round(s / this.step);
    return i < 0 ? 0 : i >= this.points.length ? this.points.length - 1 : i;
  }

  /** Interpolated position at arc length s. Writes into `out` to avoid allocations. */
  pointAt(s: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const f = Math.max(0, Math.min(this.length, s)) / this.step;
    const i = Math.min(Math.floor(f), this.points.length - 2);
    const t = f - i;
    const a = this.points[i];
    const b = this.points[i + 1];
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    if (s > this.length) {
      // Extrapolate straight past the end so exiting cars never stall.
      const h = this.headings[this.points.length - 1];
      out.x += Math.cos(h) * (s - this.length);
      out.y += Math.sin(h) * (s - this.length);
    }
    return out;
  }

  headingAt(s: number): number {
    const f = Math.max(0, Math.min(this.length, s)) / this.step;
    const i = Math.min(Math.floor(f), this.points.length - 2);
    const t = f - i;
    const h0 = this.headings[i];
    const h1 = this.headings[i + 1];
    return h0 + wrapAngle(h1 - h0) * t;
  }

  curvatureAt(s: number): number {
    return this.curvature[this.indexAt(s)];
  }

  speedLimitAt(s: number): number {
    return this.speedLimit[this.indexAt(s)];
  }

  /**
   * Closest point on the path to `p`, searching only the arc range [sMin, sMax].
   * Returns squared distance to keep the hot loop cheap.
   */
  closestInRange(p: Vec2, sMin: number, sMax: number): { s: number; distSq: number } {
    const i0 = Math.max(0, Math.floor(sMin / this.step));
    const i1 = Math.min(this.points.length - 1, Math.ceil(sMax / this.step));
    let best = Infinity;
    let bestI = i0;
    for (let i = i0; i <= i1; i++) {
      const q = this.points[i];
      const d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    return { s: bestI * this.step, distSq: best };
  }

  /** Arc length of the point nearest to p over the whole path. */
  project(p: Vec2): { s: number; distance: number } {
    const r = this.closestInRange(p, 0, this.length);
    return { s: r.s, distance: Math.sqrt(r.distSq) };
  }
}

/** Turn direction at a corner: +1 right turn (clockwise on screen), -1 left turn, 0 straight. */
export function turnSign(prev: Vec2, corner: Vec2, next: Vec2): number {
  const c = cross(normalize(sub(corner, prev)), normalize(sub(next, corner)));
  if (Math.abs(c) < 1e-3) return 0;
  return c > 0 ? 1 : -1;
}

function buildRoundedPolyline(wps: WaypointDef[]): Vec2[] {
  const out: Vec2[] = [{ x: wps[0].x, y: wps[0].y }];
  for (let i = 1; i < wps.length - 1; i++) {
    const prev = wps[i - 1];
    const c = wps[i];
    const next = wps[i + 1];
    const sign = turnSign(prev, c, next);
    if (sign === 0) {
      out.push({ x: c.x, y: c.y });
      continue;
    }
    const d1 = normalize(sub(c, prev));
    const d2 = normalize(sub(next, c));
    const wanted = c.r ?? (sign > 0 ? ROAD.rightTurnRadius : ROAD.leftTurnRadius);
    const r = Math.min(wanted, dist(prev, c) * 0.48, dist(c, next) * 0.48);
    const a = { x: c.x - d1.x * r, y: c.y - d1.y * r };
    const b = { x: c.x + d2.x * r, y: c.y + d2.y * r };
    out.push(a);
    for (let k = 1; k < BEZIER_SEGMENTS; k++) out.push(quadBezier(a, c, b, k / BEZIER_SEGMENTS));
    out.push(b);
  }
  const last = wps[wps.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

function resample(poly: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [{ ...poly[0] }];
  let carry = 0; // distance travelled since last emitted sample
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const segLen = dist(a, b);
    if (segLen < 1e-9) continue;
    let d = step - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += step;
    }
    carry = segLen - (d - step);
  }
  const last = poly[poly.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push({ ...last });
  return out;
}
