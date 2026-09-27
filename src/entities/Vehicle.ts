import { DRIVING, type VehicleSpec } from '../config/balanceConfig';
import { VehicleState, type VehicleKind } from '../types';
import type { OBB } from '../utils/geometry';
import type { RuntimeRoute } from '../systems/RouteNetwork';

export interface VehicleInit {
  id: number;
  spec: VehicleSpec;
  maxSpeed: number;
  color: number;
  route: RuntimeRoute;
  speed: number;
}

/**
 * A car moving along a route. Longitudinal motion follows a simplified
 * Intelligent Driver Model (smooth acceleration, braking and car-following).
 */
export class Vehicle {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly color: number;
  readonly length: number;
  readonly width: number;
  readonly maxSpeed: number;
  readonly accel: number;
  readonly brake: number;
  readonly route: RuntimeRoute;

  /** Arc-length position of the vehicle centre along its route. */
  s = 0;
  speed: number;
  acc = 0;
  state: VehicleState = VehicleState.SPAWNING;
  /** Seconds spent (almost) stationary. */
  waitTime = 0;
  age = 0;
  /** Bumper-to-bumper distance to the car ahead (Infinity when none). */
  leaderGap = Infinity;
  leaderSpeed = 0;
  /** Arc position of the stop line the car is currently stopping for (null = none). */
  stopTarget: number | null = null;
  /** Index into route.stops of the next stop line not yet crossed. */
  nextStop = 0;
  /** Stops the car is committed to cross regardless of signal (cannot stop in time / yellow pass). */
  readonly committed = new Set<number>();

  x = 0;
  y = 0;
  angle = 0;

  constructor(init: VehicleInit) {
    this.id = init.id;
    this.kind = init.spec.kind;
    this.color = init.color;
    this.length = init.spec.length;
    this.width = init.spec.width;
    this.maxSpeed = init.maxSpeed;
    this.accel = init.spec.accel;
    this.brake = init.spec.brake;
    this.route = init.route;
    this.speed = init.speed;
    this.syncPose();
  }

  get front(): number {
    return this.s + this.length / 2;
  }

  get rear(): number {
    return this.s - this.length / 2;
  }

  get crashed(): boolean {
    return this.state === VehicleState.CRASHED;
  }

  get emergencyBrake(): number {
    return this.brake * DRIVING.emergencyFactor;
  }

  /** Desired speed at the current position (vehicle max limited by curve speed profile). */
  desiredSpeed(): number {
    return Math.min(this.maxSpeed, this.route.path.speedLimitAt(this.s));
  }

  /** Deceleration needed to stop exactly `distance` ahead. */
  requiredDecel(distance: number): number {
    if (distance <= 0.01) return this.speed > 0.1 ? Infinity : 0;
    return (this.speed * this.speed) / (2 * distance);
  }

  /** Free-road IDM acceleration term. */
  freeAccel(): number {
    const v0 = Math.max(1, this.desiredSpeed());
    return this.accel * (1 - Math.pow(this.speed / v0, DRIVING.delta));
  }

  /** IDM acceleration towards an obstacle `gap` ahead moving at `obstacleSpeed`. */
  followAccel(gap: number, obstacleSpeed: number, minGap: number): number {
    const v = this.speed;
    const dv = v - obstacleSpeed;
    const sStar = minGap + Math.max(0, v * DRIVING.headway + (v * dv) / (2 * Math.sqrt(this.accel * this.brake)));
    const g = Math.max(gap, 0.05);
    return this.freeAccel() - this.accel * (sStar / g) * (sStar / g);
  }

  /** Semi-implicit Euler integration with the acceleration clamped to physical limits. */
  integrate(dt: number, acc: number): void {
    const a = Math.max(-this.emergencyBrake, Math.min(this.accel, acc));
    this.acc = a;
    this.speed = Math.max(0, this.speed + a * dt);
    this.s += this.speed * dt;
    this.age += dt;
  }

  syncPose(): void {
    const p = this.route.path.pointAt(this.s);
    this.x = p.x;
    this.y = p.y;
    this.angle = this.route.path.headingAt(this.s);
  }

  obb(scale = 1): OBB {
    return { x: this.x, y: this.y, angle: this.angle, halfL: (this.length / 2) * scale, halfW: (this.width / 2) * scale };
  }
}
