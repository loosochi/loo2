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
  weight: number;
}

export const VEHICLE_SPECS: VehicleSpec[] = [
  { kind: 'compact', length: 20, width: 12, maxSpeed: [72, 80], accel: 52, brake: 80, weight: 3 },
  { kind: 'sedan', length: 24, width: 13, maxSpeed: [76, 86], accel: 46, brake: 76, weight: 4 },
  { kind: 'hatch', length: 21, width: 12.5, maxSpeed: [70, 78], accel: 50, brake: 80, weight: 3 },
  { kind: 'sport', length: 23, width: 12.5, maxSpeed: [86, 96], accel: 62, brake: 90, weight: 1 },
];

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
} as const;
