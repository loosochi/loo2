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

export type CarKind = 'compact' | 'sedan' | 'hatch' | 'sport' | 'taxi';
export type HeavyKind = 'bus' | 'truck';
export type EmergencyKind = 'ambulance' | 'police' | 'fire';
export type VehicleKind = CarKind | HeavyKind | EmergencyKind;

export type Lang = 'en' | 'ru';
/** Text in every supported language. */
export type LocalizedText = Record<Lang, string>;

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
  /** Travel heading in radians (overrides `dir`; used by free-form road networks). */
  angle?: number;
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
  /** Junctions where this route has no right of way: yield inside circle (x, y, r). */
  yields?: { x: number; y: number; r: number }[];
  /** Network routes: nodes passed, in order (used by analytics). */
  nodes?: string[];
  /** Network routes: edges travelled, in order. */
  edges?: string[];
  /**
   * Free (slip-lane) right turn: not controlled by any traffic light. Cars yield at the
   * conflict zones on this route instead of stopping at a signal.
   */
  free?: boolean;
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
  /** Relative weights per vehicle kind (defaults: cars only). */
  mix?: Partial<Record<VehicleKind, number>>;
}

/** A vehicle scheduled at a fixed time (used for emergency vehicles). */
export interface SpecialDef {
  at: number;
  spawnId: string;
  routeId: string;
  kind: VehicleKind;
}

export type TutorialWait =
  | { type: 'tap' }
  | { type: 'light'; id: string; state: LightState }
  | { type: 'passed'; count: number }
  | { type: 'time'; seconds: number };

export interface TutorialStep {
  text: LocalizedText;
  /** Light to point at. */
  target?: string;
  /** Condition to continue. */
  wait: TutorialWait;
  /** Freeze traffic while this step is shown. */
  freeze?: boolean;
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
  /** Russian texts (English is the default in name/description/hint). */
  ru?: { name: string; description: string; hint?: string };
  specials?: SpecialDef[];
  tutorial?: TutorialStep[];
  /** Custom level made in the editor. */
  custom?: boolean;
  /** 2 = level built from an editable road network (see `network`). Absent = classic level. */
  schemaVersion?: number;
  /** Editable road network (schema 2 levels). */
  network?: NetworkData;
  /** Build budget in dollars (schema 2 levels). */
  budget?: number;
  /** Build restrictions (schema 2 levels). */
  rules?: BuildRules;
  /** Level tasks; all must be met to win (schema 2 levels). */
  objectives?: Objective[];
}

// ---------------------------------------------------------------- road network (schema 2)

/** Intersection right-of-way when a junction has no traffic lights. */
export type NodePriority = 'auto' | 'allway' | [string, string];

export interface NetNode {
  id: string;
  x: number;
  y: number;
  /** Right of way at an unsignalled junction: auto (straightest wide road), all-way yield, or a main road pair. */
  priority?: NodePriority;
}

export interface NetEdge {
  id: string;
  a: string;
  b: string;
  /** Lanes travelling a→b. */
  f: number;
  /** Lanes travelling b→a. */
  bk: number;
  /** Part of the level's fixed infrastructure: cannot be deleted or changed. */
  locked?: boolean;
}

/** A traffic light controlling traffic that arrives at `node` via `edge`. */
export interface NetLight {
  node: string;
  edge: string;
  locked?: boolean;
  initial?: LightState;
}

export interface NetSpawn {
  id: string;
  node: string;
  count: number;
  startDelay: number;
  interval: [number, number];
  mix?: Partial<Record<VehicleKind, number>>;
  /** Allowed destinations (exit ids). Default: every reachable exit. */
  to?: string[];
}

export interface NetExit {
  id: string;
  node: string;
  /** Optional cap on how many vehicles this exit accepts (for objectives / info). */
  capacity?: number;
}

export interface NetSpecial {
  at: number;
  spawn: string;
  exit: string;
  kind: VehicleKind;
}

export interface NetworkData {
  nodes: NetNode[];
  edges: NetEdge[];
  lights: NetLight[];
  spawns: NetSpawn[];
  exits: NetExit[];
  specials?: NetSpecial[];
  decor?: DecorDef[];
  nextId: number;
}

export type BuildTool = 'road' | 'delete' | 'light' | 'lane' | 'direction' | 'intersection' | 'spawn' | 'exit' | 'inspect' | 'decor';

export interface BuildRules {
  /** Tools the player may use (default: all game tools). */
  allowed?: BuildTool[];
  maxRoadLength?: number;
  maxRoadCount?: number;
  maxTrafficLights?: number;
}

export type ObjectiveType =
  | 'PASS_CARS'
  | 'PASS_CARS_WITHOUT_CRASH'
  | 'MAX_WAIT_TIME'
  | 'MAX_QUEUE_LENGTH'
  | 'BUDGET_LIMIT'
  | 'BUILD_LIMIT'
  | 'EMERGENCY_PRIORITY'
  | 'TIME_LIMIT';

export interface Objective {
  type: ObjectiveType;
  value: number;
}

export type ObjectiveStatus = 'pending' | 'done' | 'failed';

export interface ObjectiveState extends Objective {
  status: ObjectiveStatus;
  /** Current measured value shown in the HUD. */
  current: number;
}

export type GameOutcome = 'win' | 'crash' | 'timeout' | 'failed';

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
  starBreakdown: StarCheck[];
  objectives?: ObjectiveState[];
  /** Money spent on construction (network levels). */
  spent?: number;
}

export type StarCheckId = 'complete' | 'par' | 'avgWait' | 'maxWait' | 'score';

export interface StarCheck {
  id: StarCheckId;
  /** Threshold shown in the label (seconds or points). */
  value: number;
  earned: boolean;
}
