import { DRIVING, SCORE, SIM } from '../config/balanceConfig';
import { Vehicle } from '../entities/Vehicle';
import { LightState, VehicleState, type GameOutcome, type LevelDef, type LevelResult } from '../types';
import { CollisionSystem, type CrashInfo } from './CollisionSystem';
import { buildRuntimeRoutes, isYieldZone, type RouteStop, type RuntimeRoute } from './RouteNetwork';
import { ScoreSystem } from './ScoreSystem';
import { TrafficLightSystem, type LightChange } from './TrafficLightSystem';
import { VehicleSpawner } from './VehicleSpawner';

export type SimStatus = 'running' | 'won' | 'lost';

export interface SimEvents {
  spawn?: (v: Vehicle) => void;
  exit?: (v: Vehicle) => void;
  light?: (c: LightChange) => void;
  crash?: (c: CrashInfo) => void;
  end?: (r: LevelResult) => void;
}

/** A player action recorded with the tick it was applied on (for replays / determinism checks). */
export interface RecordedAction {
  tick: number;
  lightId: string;
  action: 'toggle' | 'yellow';
}

/** Stop lines further ahead than this are ignored for now. */
const STOP_SCAN = 170;
/** How far past a stop line to look for conflict zones belonging to that intersection. */
const ZONE_SCAN_AFTER_STOP = 110;
const CURVE_TURNING = 0.012;

/**
 * Deterministic, fixed-step traffic simulation (no rendering, no Phaser).
 * Owns vehicles, lights, spawner, collisions and scoring for one level.
 */
export class TrafficSimulation {
  readonly level: LevelDef;
  readonly routes: RuntimeRoute[];
  readonly lights: TrafficLightSystem;
  readonly collisions = new CollisionSystem();
  readonly score = new ScoreSystem();
  readonly spawner: VehicleSpawner;

  vehicles: Vehicle[] = [];
  time = 0;
  tick = 0;
  status: SimStatus = 'running';
  outcome: GameOutcome | null = null;
  result: LevelResult | null = null;
  crash: CrashInfo | null = null;
  readonly actions: RecordedAction[] = [];

  private events: SimEvents = {};
  private accumulator = 0;

  constructor(level: LevelDef) {
    this.level = level;
    this.routes = buildRuntimeRoutes(level.routes);
    this.lights = new TrafficLightSystem(level.lights);
    this.lights.bindRoutes(this.routes);
    this.collisions.buildZones(this.routes);
    this.spawner = new VehicleSpawner(level.flows, this.routes, level.seed, level.specials ?? []);
    this.lights.onChange((c) => this.events.light?.(c));
  }

  on(events: SimEvents): void {
    this.events = { ...this.events, ...events };
  }

  /** Restore the exact initial state of the level. */
  reset(): void {
    this.vehicles = [];
    this.time = 0;
    this.tick = 0;
    this.status = 'running';
    this.outcome = null;
    this.result = null;
    this.crash = null;
    this.accumulator = 0;
    this.actions.length = 0;
    this.lights.reset();
    this.spawner.reset();
    this.score.reset();
    this.collisions.updateOccupancy(this.vehicles);
  }

  get totalCars(): number {
    return this.spawner.totalCars;
  }

  get goal(): number {
    return this.level.goal.carsToPass;
  }

  /** Cars not yet through: still to spawn plus on the road. */
  get carsLeft(): number {
    return this.spawner.remaining + this.vehicles.length;
  }

  toggleLight(id: string): void {
    if (this.status !== 'running') return;
    this.actions.push({ tick: this.tick, lightId: id, action: 'toggle' });
    this.lights.toggle(id, this.time);
  }

  yellowLight(id: string): void {
    if (this.status !== 'running') return;
    this.actions.push({ tick: this.tick, lightId: id, action: 'yellow' });
    this.lights.setYellow(id, this.time);
  }

  /** Advance by real elapsed time using fixed steps. Returns steps taken. */
  advance(elapsed: number, maxSteps: number = SIM.maxStepsPerFrame): number {
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= SIM.dt && steps < maxSteps && this.status === 'running') {
      this.step();
      this.accumulator -= SIM.dt;
      steps++;
    }
    if (steps >= maxSteps) this.accumulator = 0; // drop time we can't catch up on
    return steps;
  }

  /** One fixed simulation step. */
  step(dt: number = SIM.dt): void {
    if (this.status !== 'running') return;

    for (const v of this.spawner.update(this.time, this.vehicles)) {
      v.syncPose();
      this.vehicles.push(v);
      this.events.spawn?.(v);
    }
    const blocked = this.spawner.blockedCount;
    if (blocked > 0) this.score.addQueueBlocked(dt * blocked);

    // 1. Decide accelerations from the current state (order independent).
    const accs = new Array<number>(this.vehicles.length);
    for (let i = 0; i < this.vehicles.length; i++) accs[i] = this.computeAcceleration(this.vehicles[i]);

    // 2. Integrate and handle stop line crossings / exits.
    const exited: Vehicle[] = [];
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const prevFront = v.front;
      v.integrate(dt, accs[i]);
      if (v.stopTarget !== null && v.front > v.stopTarget - DRIVING.stopLineGap) {
        // Never creep over a line we are stopping for.
        v.s = v.stopTarget - DRIVING.stopLineGap - v.length / 2;
        v.speed = 0;
      }
      this.handleStopCrossings(v, prevFront);
      v.syncPose();

      if (v.speed < DRIVING.waitingSpeed && v.age > DRIVING.spawnTime) {
        v.waitTime += dt;
        if (v.emergency) this.score.addEmergencyWait(dt);
        if (v.waitTime > SCORE.longWaitThreshold) this.score.addLongWait(dt);
        this.score.trackWait(v.waitTime);
      }
      if (v.s >= v.route.path.length) exited.push(v);
    }
    for (const v of exited) {
      this.vehicles.splice(this.vehicles.indexOf(v), 1);
      this.score.onVehicleExit(v.waitTime, v.points);
      this.events.exit?.(v);
    }

    this.collisions.updateOccupancy(this.vehicles);
    this.time += dt;
    this.tick++;

    const crash = this.collisions.detectCrash(this.vehicles);
    if (crash) {
      crash.a.state = VehicleState.CRASHED;
      crash.b.state = VehicleState.CRASHED;
      crash.a.speed = 0;
      crash.b.speed = 0;
      this.crash = crash;
      this.score.onCrash();
      this.events.crash?.(crash);
      this.finish('crash');
      return;
    }

    for (const v of this.vehicles) this.updateState(v);

    if (this.score.passed >= this.level.goal.carsToPass) this.finish('win');
    else if (this.level.goal.timeLimit !== undefined && this.time >= this.level.goal.timeLimit) this.finish('timeout');
  }

  private finish(outcome: GameOutcome): void {
    this.status = outcome === 'win' ? 'won' : 'lost';
    this.outcome = outcome;
    for (const v of this.vehicles) this.score.trackWait(v.waitTime);
    this.result = this.score.buildResult(this.level.id, outcome, this.time, this.totalCars, this.level.stars);
    this.events.end?.(this.result);
  }

  /** Find the nearest vehicle ahead in our lane (works across routes that share or merge lanes). */
  findLeader(v: Vehicle): { gap: number; speed: number } | null {
    const path = v.route.path;
    const range = DRIVING.lookahead + 30;
    const tol2 = DRIVING.laneTolerance * DRIVING.laneTolerance;
    const cosV = Math.cos(v.angle);
    const sinV = Math.sin(v.angle);
    let bestGap = Infinity;
    let bestSpeed = 0;
    for (const o of this.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x;
      const dy = o.y - v.y;
      if (dx * dx + dy * dy > range * range) continue;
      if (dx * cosV + dy * sinV < 0) continue; // behind us
      if (Math.cos(o.angle - v.angle) < 0.35) continue; // crossing or opposing traffic
      const proj = path.closestInRange(o, v.s, v.s + range);
      if (proj.distSq > tol2 || proj.s <= v.s) continue;
      const gap = proj.s - v.s - (v.length + o.length) / 2;
      if (gap < bestGap) {
        bestGap = gap;
        bestSpeed = o.crashed ? 0 : o.speed;
      }
    }
    return bestGap < Infinity ? { gap: bestGap, speed: bestSpeed } : null;
  }

  private computeAcceleration(v: Vehicle): number {
    if (v.crashed) return -v.emergencyBrake;
    const leader = this.findLeader(v);
    v.leaderGap = leader ? leader.gap : Infinity;
    v.leaderSpeed = leader ? leader.speed : 0;

    v.stopTarget = this.resolveStop(v, leader);

    let acc = v.freeAccel();
    if (leader) acc = Math.min(acc, v.followAccel(leader.gap, leader.speed, DRIVING.minGap));
    if (v.stopTarget !== null) {
      const gap = v.stopTarget - v.front - DRIVING.stopLineGap;
      acc = Math.min(acc, v.followAccel(gap, 0, 0.5));
    }
    return acc;
  }

  /**
   * Evaluate upcoming stop lines and return the arc position of the one this car must stop at,
   * or null when it may proceed.
   */
  private resolveStop(v: Vehicle, leader: { gap: number } | null): number | null {
    const atSignal = this.resolveSignals(v, leader);
    if (atSignal !== null || !v.route.def.free) return atSignal;
    return this.resolveYield(v);
  }

  private resolveSignals(v: Vehicle, leader: { gap: number } | null): number | null {
    const stops = v.route.stops;
    for (let i = v.nextStop; i < stops.length; i++) {
      const stop = stops[i];
      const dist = stop.s - v.front;
      if (dist > STOP_SCAN) return null;
      if (v.committed.has(i)) continue;
      const light = stop.light;
      const canStop = v.requiredDecel(dist - DRIVING.stopLineGap) <= v.emergencyBrake;

      if (light.state === LightState.GREEN) {
        // Cautious start: a car standing at the line does not launch into an occupied junction.
        if (v.speed < 2 && dist < 14 && !this.zonesClearAfter(v, stop)) return stop.s;
        continue;
      }

      if (light.state === LightState.YELLOW) {
        if (light.reservedBy === v.id) continue;
        const firstInLine = !leader || leader.gap > dist;
        if (light.reservedBy === null && firstInLine && (this.zonesClearAfter(v, stop) || !canStop)) {
          light.reserve(v.id);
          v.committed.add(i);
          continue;
        }
        if (!canStop) {
          v.committed.add(i);
          continue;
        }
        return stop.s;
      }

      // RED
      if (!canStop) {
        v.committed.add(i); // too close to stop safely — carries on through
        continue;
      }
      return stop.s;
    }
    return null;
  }

  /**
   * Free (slip-lane) turns have no signal: before each conflict zone the car checks that no
   * conflicting traffic is inside or arriving soon, otherwise it waits at the yield point.
   */
  private resolveYield(v: Vehicle): number | null {
    for (const rz of v.route.zones) {
      if (!isYieldZone(v.route, rz) || v.committedZones.has(rz.zone.id)) continue;
      const dist = rz.sEnter - v.front;
      if (dist < 0) {
        v.committedZones.add(rz.zone.id);
        continue;
      }
      if (dist > STOP_SCAN) return null;
      const clear = this.collisions.isZoneClear(v, rz, this.vehicles, DRIVING.yieldHorizon);
      if (clear) {
        if (dist < DRIVING.yieldCommit) v.committedZones.add(rz.zone.id);
        continue;
      }
      if (v.requiredDecel(dist - DRIVING.stopLineGap - 2) > v.emergencyBrake) {
        v.committedZones.add(rz.zone.id); // too late to stop
        continue;
      }
      return rz.sEnter - 2;
    }
    return null;
  }

  private zonesClearAfter(v: Vehicle, stop: RouteStop): boolean {
    for (const rz of v.route.zones) {
      if (rz.sExit <= stop.s || rz.sEnter > stop.s + ZONE_SCAN_AFTER_STOP) continue;
      if (!this.collisions.isZoneClear(v, rz, this.vehicles)) return false;
    }
    return true;
  }

  private handleStopCrossings(v: Vehicle, prevFront: number): void {
    const stops = v.route.stops;
    while (v.nextStop < stops.length) {
      const stop = stops[v.nextStop];
      if (v.front < stop.s) break;
      if (prevFront < stop.s) this.lights.vehiclePassed(stop.light, v.id, this.time);
      v.nextStop++;
    }
  }

  private updateState(v: Vehicle): void {
    if (v.crashed) return;
    const path = v.route.path;
    if (v.age < DRIVING.spawnTime) v.state = VehicleState.SPAWNING;
    else if (v.s > path.length - 50 && v.nextStop >= v.route.stops.length) v.state = VehicleState.EXITING;
    else if (v.speed < DRIVING.waitingSpeed * 0.5 && (v.stopTarget !== null || v.leaderGap < 20)) v.state = VehicleState.WAITING;
    else if (v.acc < -v.brake * 0.25) v.state = VehicleState.BRAKING;
    else if (path.curvatureAt(v.s) > CURVE_TURNING) v.state = VehicleState.TURNING;
    else if (v.stopTarget !== null || v.leaderGap < 45) v.state = VehicleState.APPROACHING;
    else v.state = VehicleState.MOVING;
  }
}
