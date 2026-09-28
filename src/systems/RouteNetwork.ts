import type { TrafficLight } from '../entities/TrafficLight';
import type { RouteDef } from '../types';
import { Path } from './PathSystem';
import type { ConflictZone } from './CollisionSystem';

/** A stop line on a route, controlled by a traffic light. */
export interface RouteStop {
  index: number;
  light: TrafficLight;
  /** Arc position of the stop line on the route. */
  s: number;
}

/** A conflict zone as seen from one route. */
export interface RouteZone {
  zone: ConflictZone;
  sEnter: number;
  sExit: number;
}

export interface RuntimeRoute {
  id: string;
  def: RouteDef;
  spawnId: string;
  exitId: string;
  path: Path;
  stops: RouteStop[];
  zones: RouteZone[];
  /** Free routes: arc position where the slip lane leaves the through lane (else Infinity). */
  slipStart: number;
}

/** Zones at or after this point of a free route are handled by yielding, not by signals. */
export function isYieldZone(r: RuntimeRoute, rz: RouteZone): boolean {
  return r.def.free === true && rz.sEnter >= r.slipStart - 8;
}

export function buildRuntimeRoutes(defs: RouteDef[]): RuntimeRoute[] {
  return defs.map((def) => {
    const path = new Path(def.points);
    let slipStart = Infinity;
    if (def.free) {
      const i = path.curvature.findIndex((k) => k > 1e-3);
      slipStart = i >= 0 ? i * path.step : 0;
    }
    return { id: def.id, def, spawnId: def.spawnId, exitId: def.exitId, path, stops: [], zones: [], slipStart };
  });
}
