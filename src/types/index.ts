/** Shared type definitions for Traffic Flow. */

export interface Vec2 {
  x: number;
  y: number;
}

/** Cardinal travel direction (screen coordinates: +x = east, +y = south). */
export type Dir = 'N' | 'S' | 'E' | 'W';

export enum LightState {
  RED = 'RED',
  YELLOW = 'YELLOW',
  GREEN = 'GREEN',
}

export enum VehicleState {
  SPAWNING = 'SPAWNING',
  MOVING = 'MOVING',
  APPROACHING = 'APPROACHING',
  BRAKING = 'BRAKING',
  WAITING = 'WAITING',
  TURNING = 'TURNING',
  EXITING = 'EXITING',
  CRASHED = 'CRASHED',
}

export type VehicleKind = 'compact' | 'sedan' | 'hatch' | 'sport';

/** A straight road segment used for rendering (axis aligned). */
export interface RoadDef {
  id: string;
  from: Vec2;
  to: Vec2;
  /** Lanes per direction. */
  lanes: number;
  /** One-way road (traffic only in from→to direction). */
  oneWay?: boolean;
}

export interface IntersectionDef {
  id: string;
  x: number;
  y: number;
  /** Half extents of the intersection box. */
  halfW: number;
  halfH: number;
  /** Which sides have a crosswalk. */
  crosswalks?: Dir[];
}

export interface LightDef {
  id: string;
  /** Centre of the stop line on the inbound lane(s). */
  stop: Vec2;
  /** Direction vehicles travel when crossing this stop line. */
  dir: Dir;
  /** Width of the stop line across inbound lanes. */
  width: number;
  /** Where the signal head is drawn (roadside). */
  head: Vec2;
  initial?: LightState;
}

/** A waypoint of a route. Interior waypoints are rounded into smooth curves. */
export interface WaypointDef {
  x: number;
  y: number;
  /** Optional explicit corner radius for this waypoint. */
  r?: number;
}

export interface RouteDef {
  id: string;
  spawnId: string;
  exitId: string;
  points: WaypointDef[];
}

export interface SpawnPointDef {
  id: string;
  x: number;
  y: number;
  dir: Dir;
}

export interface ExitPointDef {
  id: string;
  x: number;
  y: number;
  dir: Dir;
}

export interface FlowDef {
  spawnId: string;
  /** Route ids with relative weights. */
  routes: { id: string; weight: number }[];
  /** Number of cars this flow emits. */
  count: number;
  /** Seconds before the first car. */
  startDelay: number;
  /** Min/max seconds between consecutive cars. */
  interval: [number, number];
}

export interface DecorDef {
  type: 'tree' | 'building' | 'bush' | 'pond';
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  color?: number;
}

export interface StarCriteria {
  /** Level must be finished within this many seconds for the "fast" star. */
  parTime: number;
  /** Average wait (seconds per car) at or below this earns the "smooth" star. */
  avgWait: number;
  /** Longest single-vehicle wait at or below this earns the "patience" star. */
  maxWait: number;
  /** Final score at or above this earns the "score" star. */
  score: number;
}

export interface LevelDef {
  id: number;
  key: string;
  name: string;
  description: string;
  world: { width: number; height: number };
  seed: number;
  roads: RoadDef[];
  intersections: IntersectionDef[];
  lights: LightDef[];
  spawns: SpawnPointDef[];
  exits: ExitPointDef[];
  routes: RouteDef[];
  flows: FlowDef[];
  goal: {
    /** Cars that must reach an exit. */
    carsToPass: number;
    /** Optional time limit in seconds. */
    timeLimit?: number;
  };
  stars: StarCriteria;
  decor: DecorDef[];
  hint?: string;
}

export type GameOutcome = 'win' | 'crash' | 'timeout';

export interface LevelResult {
  levelId: number;
  outcome: GameOutcome;
  score: number;
  stars: number;
  passed: number;
  totalCars: number;
  time: number;
  avgWait: number;
  maxWait: number;
  crashes: number;
  starBreakdown: { label: string; earned: boolean }[];
}
