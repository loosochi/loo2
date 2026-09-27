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
}

export function buildRuntimeRoutes(defs: RouteDef[]): RuntimeRoute[] {
  return defs.map((def) => ({
    id: def.id,
    def,
    spawnId: def.spawnId,
    exitId: def.exitId,
    path: new Path(def.points),
    stops: [],
    zones: [],
  }));
}
