import { DRIVING } from '../config/balanceConfig';
import type { Vehicle } from '../entities/Vehicle';
import type { Vec2 } from '../types';
import { obbOverlap } from '../utils/geometry';
import type { RouteZone, RuntimeRoute } from './RouteNetwork';

/**
 * A region where two or more routes cross or merge.
 * Vehicles on conflicting routes must not occupy it at the same time.
 */
export interface ConflictZone {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Ids of all routes passing through the zone. */
  routes: Set<string>;
  /** Unordered route pairs ("a|b") that conflict inside this zone. */
  conflicts: Set<string>;
  /** Vehicle ids currently inside the zone (updated every tick). */
  vehicles: Set<number>;
  /** True when vehicles from conflicting routes are inside / about to enter together. */
  danger: boolean;
}

export interface CrashInfo {
  a: Vehicle;
  b: Vehicle;
  x: number;
  y: number;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Distance under which two route centre lines are considered to overlap. */
const NEAR_DIST = 12;
/** Only the first part of a merge (shared lane afterwards) is a conflict. */
const MAX_ZONE_RUN = 36;
const ZONE_MARGIN = 8;
const MERGE_DIST = 4;

export class CollisionSystem {
  zones: ConflictZone[] = [];

  /** Detect crossing and merge points between routes that start from different spawn points. */
  /**
   * `sameSpawnConflicts`: also look for conflicts between routes from the same entry after
   * their shared first stretch (routes of a road network can split and cross again later).
   */
  buildZones(routes: RuntimeRoute[], sameSpawnConflicts = false): void {
    type Raw = { x: number; y: number; radius: number; a: string; b: string };
    const raw: Raw[] = [];
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const A = routes[i];
        const B = routes[j];
        const same = A.spawnId === B.spawnId;
        if (same && !sameSpawnConflicts) continue; // same lane at the start: handled by car-following
        for (const run of nearRuns(A, B, same)) {
          raw.push({ ...run, a: A.id, b: B.id });
        }
      }
    }

    // Merge nearby raw zones into shared zones.
    const zones: ConflictZone[] = [];
    for (const r of raw) {
      let target = zones.find((z) => Math.hypot(z.x - r.x, z.y - r.y) < MERGE_DIST);
      if (!target) {
        target = {
          id: `Z${zones.length + 1}`,
          x: r.x,
          y: r.y,
          radius: r.radius,
          routes: new Set(),
          conflicts: new Set(),
          vehicles: new Set(),
          danger: false,
        };
        zones.push(target);
      } else {
        const d = Math.hypot(target.x - r.x, target.y - r.y);
        target.radius = Math.max(target.radius, d + r.radius);
      }
      target.routes.add(r.a);
      target.routes.add(r.b);
      target.conflicts.add(pairKey(r.a, r.b));
    }
    this.zones = zones;

    // Record, for every route, where it enters and leaves each zone it passes through.
    for (const route of routes) {
      route.zones = [];
      for (const z of zones) {
        if (!z.routes.has(route.id)) continue;
        const entry = zoneInterval(route, z);
        if (entry) route.zones.push(entry);
      }
      route.zones.sort((p, q) => p.sEnter - q.sEnter);
    }
  }

  routesConflict(zone: ConflictZone, a: string, b: string): boolean {
    return a !== b && zone.conflicts.has(pairKey(a, b));
  }

  /** Refresh which vehicles are inside which zone and flag dangerous situations. */
  updateOccupancy(vehicles: readonly Vehicle[]): void {
    for (const z of this.zones) {
      z.vehicles.clear();
      z.danger = false;
    }
    for (const v of vehicles) {
      for (const rz of v.route.zones) {
        if (v.front >= rz.sEnter && v.rear <= rz.sExit) rz.zone.vehicles.add(v.id);
      }
    }
    let byId: Map<number, Vehicle> | null = null;
    for (const z of this.zones) {
      if (z.vehicles.size === 0) continue;
      byId ??= new Map(vehicles.map((v) => [v.id, v]));
      for (const v of vehicles) {
        const rz = v.route.zones.find((e) => e.zone === z);
        if (!rz) continue;
        for (const id of z.vehicles) {
          if (id === v.id) continue;
          const other = byId.get(id);
          if (!other || !this.routesConflict(z, v.route.id, other.route.id)) continue;
          if (z.vehicles.has(v.id) || this.arrivesSoon(v, rz, 1.0)) z.danger = true;
        }
      }
    }
  }

  /** Is `v` expected to enter the zone within `horizon` seconds (and not stopping before it)? */
  private arrivesSoon(v: Vehicle, rz: RouteZone, horizon: number): boolean {
    const d = rz.sEnter - v.front;
    if (d < 0) return v.rear <= rz.sExit;
    // Committed to this zone (decided to go, maybe still standing): it is coming.
    if (v.committedZones.has(rz.zone.id)) return true;
    // A car stopped only to let crossing traffic clear (caution) will go again at once.
    if (v.stopTarget !== null && v.stopTarget <= rz.sEnter + 1 && !v.cautious) return false;
    if (d < 6 || (d < 14 && v.stopTarget === null)) return true;
    // A queued car (not stopping for anything itself) may move off at any moment.
    return d / Math.max(v.speed, v.stopTarget === null ? 8 : 0.5) < horizon;
  }

  /**
   * Safe-passage check before entering a zone: no vehicle on a conflicting route is inside
   * it or about to enter it without stopping.
   */
  isZoneClear(
    v: Vehicle,
    rz: RouteZone,
    vehicles: readonly Vehicle[],
    horizon: number = DRIVING.zoneSafetyHorizon,
    asYielder = false,
  ): boolean {
    for (const o of vehicles) {
      if (o === v || !this.routesConflict(rz.zone, v.route.id, o.route.id)) continue;
      const orz = o.route.zones.find((e) => e.zone === rz.zone);
      if (!orz) continue;
      // Already inside the zone or committed to it: never clear.
      if ((o.front >= orz.sEnter && o.rear <= orz.sExit) || o.committedZones.has(rz.zone.id)) return false;
      // Two cars both giving way: emergency vehicles first, then whoever entered the map first.
      if (asYielder && o.yielding && o.stopTarget !== null && o.stopTarget - o.front < 10) {
        const oFirst = (o.emergency && !v.emergency) || (o.emergency === v.emergency && o.id < v.id);
        if (oFirst) return false;
        continue;
      }
      if (this.arrivesSoon(o, orz, horizon)) return false;
    }
    return true;
  }

  /** Physical crash detection: oriented-rectangle overlap (SAT), valid on straights and in curves. */
  detectCrash(vehicles: readonly Vehicle[]): CrashInfo | null {
    const tol = DRIVING.collisionTolerance;
    for (let i = 0; i < vehicles.length; i++) {
      const a = vehicles[i];
      for (let j = i + 1; j < vehicles.length; j++) {
        const b = vehicles[j];
        const reach = (a.length + b.length) / 2;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (obbOverlap(a.obb(tol), b.obb(tol))) {
          return { a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
      }
    }
    return null;
  }
}

/** Find contiguous stretches where route A runs within NEAR_DIST of route B. */
function nearRuns(A: RuntimeRoute, B: RuntimeRoute, skipShared = false): { x: number; y: number; radius: number }[] {
  const out: { x: number; y: number; radius: number }[] = [];
  const pa = A.path.points;
  const pb = B.path.points;
  const near2 = NEAR_DIST * NEAR_DIST;
  let runStart = -1;
  const flush = (end: number) => {
    const startS = runStart * A.path.step;
    const endS = Math.min(end * A.path.step, startS + MAX_ZONE_RUN);
    const mid = A.path.pointAt((startS + endS) / 2);
    out.push({ x: mid.x, y: mid.y, radius: (endS - startS) / 2 + ZONE_MARGIN });
  };
  for (let i = 0; i < pa.length; i++) {
    const p = pa[i];
    let near = false;
    for (let k = 0; k < pb.length; k++) {
      const q = pb[k];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy < near2) {
        near = true;
        break;
      }
    }
    if (near && runStart < 0) runStart = i;
    if (!near && runStart >= 0) {
      // A shared start (same entry lane) is car-following, not a conflict.
      if (!(skipShared && runStart === 0)) flush(i - 1);
      runStart = -1;
    }
  }
  if (runStart >= 0 && !(skipShared && runStart === 0)) flush(pa.length - 1);
  return out;
}

function zoneInterval(route: RuntimeRoute, z: ConflictZone): RouteZone | null {
  const pts = route.path.points;
  const r2 = z.radius * z.radius;
  let first = -1;
  let last = -1;
  for (let i = 0; i < pts.length; i++) {
    const p: Vec2 = pts[i];
    if ((p.x - z.x) ** 2 + (p.y - z.y) ** 2 <= r2) {
      if (first < 0) first = i;
      last = i;
    } else if (first >= 0) break;
  }
  if (first < 0) return null;
  return { zone: z, sEnter: first * route.path.step, sExit: last * route.path.step };
}
