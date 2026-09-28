/**
 * Gameplay tuning. All distances are world units (1 lane = 28 units, a car ≈ 22 units long),
 * all speeds in units/second and accelerations in units/second².
 */
import type { VehicleKind } from '../types';

export const SIM = {
  /** Fixed simulation step (seconds). */
  dt: 1 / 60,
  /** Max simulation steps per rendered frame (prevents the spiral of death on slow devices). */
  maxStepsPerFrame: 6,
} as const;

export const ROAD = {
  laneWidth: 28,
  sidewalk: 12,
  /** Distance between the stop line and the intersection box edge. */
  stopLineOffset: 18,
  /** Default corner radius for right / left turns. */
  rightTurnRadius: 20,
  leftTurnRadius: 32,
  /** Resampling step for route polylines. */
  pathStep: 2,
} as const;

export interface VehicleSpec {
  kind: VehicleKind;
  length: number;
  width: number;
  maxSpeed: [number, number];
  accel: number;
  brake: number;
  /** Default spawn weight in a flow without an explicit mix (0 = only when asked for). */
  weight: number;
  /** Points when the vehicle reaches an exit. */
  points: number;
  emergency?: boolean;
  heavy?: boolean;
}

export const VEHICLE_SPECS: VehicleSpec[] = [
  { kind: 'compact', length: 20, width: 12, maxSpeed: [72, 80], accel: 52, brake: 80, weight: 3, points: 100 },
  { kind: 'sedan', length: 24, width: 13, maxSpeed: [76, 86], accel: 46, brake: 76, weight: 4, points: 100 },
  { kind: 'hatch', length: 21, width: 12.5, maxSpeed: [70, 78], accel: 50, brake: 80, weight: 3, points: 100 },
  { kind: 'sport', length: 23, width: 12.5, maxSpeed: [86, 96], accel: 62, brake: 90, weight: 1, points: 100 },
  // Heavy vehicles: long, slow to accelerate — they clog junctions if you are careless.
  { kind: 'bus', length: 46, width: 15, maxSpeed: [60, 66], accel: 26, brake: 60, weight: 0, points: 250, heavy: true },
  { kind: 'truck', length: 40, width: 15, maxSpeed: [62, 70], accel: 28, brake: 58, weight: 0, points: 150, heavy: true },
  // Emergency vehicles: give them a green wave — every second they wait costs points.
  { kind: 'ambulance', length: 27, width: 14, maxSpeed: [92, 100], accel: 60, brake: 90, weight: 0, points: 300, emergency: true },
  { kind: 'police', length: 24, width: 13, maxSpeed: [96, 104], accel: 66, brake: 92, weight: 0, points: 300, emergency: true },
  { kind: 'fire', length: 38, width: 15, maxSpeed: [84, 90], accel: 40, brake: 72, weight: 0, points: 300, emergency: true, heavy: true },
];

export const specOf = (kind: VehicleKind): VehicleSpec => VEHICLE_SPECS.find((v) => v.kind === kind)!;

export const DRIVING = {
  /** Emergency braking = brake × this factor. */
  emergencyFactor: 2.6,
  /** Desired time headway (s). */
  headway: 0.9,
  /** Minimum bumper-to-bumper gap to the car ahead. */
  minGap: 5,
  /** Gap kept to a stop line. */
  stopLineGap: 1,
  /** IDM acceleration exponent. */
  delta: 4,
  /** Lateral acceleration allowed in curves; sets curve speed = sqrt(latAccel * radius). */
  lateralAccel: 150,
  /** Distance vehicles scan ahead for leaders. */
  lookahead: 110,
  /** Lateral tolerance when deciding if another car is in our lane. */
  laneTolerance: 11,
  /** Speed below which a car counts as waiting. */
  waitingSpeed: 4,
  /** Seconds a spawned car fades in. */
  spawnTime: 0.5,
  /** Clearance required at a spawn point before the next car may appear. */
  spawnClearance: 34,
  /** Seconds to look ahead when checking that a conflict zone is safe to enter. */
  zoneSafetyHorizon: 1.8,
  /** OBB shrink factor used for crash detection (tolerance for near misses). */
  collisionTolerance: 0.88,
  /** Seconds of look-ahead a yielding (free-turn) car needs before merging. */
  yieldHorizon: 2.6,
  /** Distance before a conflict zone at which a yielding car commits to merging. */
  yieldCommit: 10,
} as const;

export const SCORE = {
  perCar: 100,
  /** Points per second finished under par time. */
  timeBonusPerSecond: 10,
  /** Points per second the average wait is below the level's target. */
  waitBonusPerSecond: 60,
  noCrashBonus: 500,
  crashPenalty: 1000,
  /** Cars waiting longer than this (seconds) start costing points. */
  longWaitThreshold: 15,
  longWaitPenaltyPerSecond: 4,
  /** Penalty per second a spawn point is blocked by a queue. */
  queuePenaltyPerSecond: 6,
  /** Penalty per second an emergency vehicle is standing still. */
  emergencyWaitPenaltyPerSecond: 30,
} as const;
