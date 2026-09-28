/**
 * Level objectives (schema 2 levels). "Goal" objectives (PASS_CARS…) must be completed; the
 * others are constraints that fail the level as soon as they are broken.
 */
import { DRIVING } from '../config/balanceConfig';
import type { Objective, ObjectiveState } from '../types';
import type { TrafficSimulation } from './TrafficSimulation';

/** A queue must stay over the limit this long before MAX_QUEUE_LENGTH fails. */
const QUEUE_GRACE = 3;

export interface BuildStats {
  spent: number;
  builds: number;
}

export class ObjectiveTracker {
  readonly states: ObjectiveState[];
  private queueOver = 0;

  constructor(objectives: readonly Objective[]) {
    this.states = objectives.map((o) => ({ ...o, status: 'pending', current: 0 }));
  }

  get failed(): ObjectiveState | undefined {
    return this.states.find((s) => s.status === 'failed');
  }

  /** Longest queue of stopped vehicles waiting at one light or one give-way point. */
  static longestQueue(sim: TrafficSimulation): number {
    const counts = new Map<string, number>();
    for (const v of sim.vehicles) {
      if (v.speed >= DRIVING.waitingSpeed || v.age < DRIVING.spawnTime) continue;
      const stop = v.route.stops[v.nextStop];
      // One queue per lane: light (or give-way point / entry) + starting lane of the route.
      const lane = v.route.id.split('#')[1] ?? '';
      const at = stop ? stop.light.id : v.stopTarget !== null ? `y:${v.route.id}:${Math.round(v.stopTarget / 20)}` : `r:${v.route.spawnId}`;
      const k = `${at}|${lane}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Math.max(0, ...counts.values());
  }

  update(sim: TrafficSimulation, build: BuildStats, dt: number): void {
    for (const s of this.states) {
      if (s.status !== 'pending') continue;
      switch (s.type) {
        case 'PASS_CARS':
        case 'PASS_CARS_WITHOUT_CRASH':
          s.current = sim.score.passed;
          if (s.type === 'PASS_CARS_WITHOUT_CRASH' && sim.score.crashes > 0) s.status = 'failed';
          else if (s.current >= s.value) s.status = 'done';
          break;
        case 'MAX_WAIT_TIME': {
          let w = sim.score.maxWait;
          for (const v of sim.vehicles) w = Math.max(w, v.waitTime);
          s.current = w;
          if (w > s.value) s.status = 'failed';
          break;
        }
        case 'MAX_QUEUE_LENGTH': {
          const q = ObjectiveTracker.longestQueue(sim);
          s.current = q;
          this.queueOver = q > s.value ? this.queueOver + dt : 0;
          if (this.queueOver > QUEUE_GRACE) s.status = 'failed';
          break;
        }
        case 'BUDGET_LIMIT':
          s.current = build.spent;
          if (build.spent > s.value) s.status = 'failed';
          break;
        case 'BUILD_LIMIT':
          s.current = build.builds;
          if (build.builds > s.value) s.status = 'failed';
          break;
        case 'EMERGENCY_PRIORITY': {
          let w = 0;
          for (const v of sim.vehicles) if (v.emergency) w = Math.max(w, v.waitTime);
          s.current = Math.max(s.current, w);
          if (s.current > s.value) s.status = 'failed';
          break;
        }
        case 'TIME_LIMIT':
          s.current = sim.time;
          if (sim.time > s.value) s.status = 'failed';
          break;
      }
    }
  }

  /** Called on a win: constraints that held are completed. */
  complete(): void {
    for (const s of this.states) if (s.status === 'pending') s.status = 'done';
  }
}
