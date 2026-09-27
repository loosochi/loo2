import { DRIVING, VEHICLE_SPECS } from '../config/balanceConfig';
import { CAR_COLORS } from '../config/theme';
import { Vehicle } from '../entities/Vehicle';
import type { FlowDef } from '../types';
import { SeededRandom } from '../utils/math';
import type { RuntimeRoute } from './RouteNetwork';

interface FlowState {
  def: FlowDef;
  remaining: number;
  nextTime: number;
  blocked: boolean;
  /** Route chosen for the next car (kept while the entry is blocked). */
  pending: string | null;
}

/** Emits vehicles for each flow on a deterministic (seeded) schedule. */
export class VehicleSpawner {
  private flows: FlowState[] = [];
  private rng: SeededRandom;
  private nextId = 1;
  private readonly routesById: Map<string, RuntimeRoute>;

  constructor(
    private readonly defs: FlowDef[],
    routes: RuntimeRoute[],
    private readonly seed: number,
  ) {
    this.routesById = new Map(routes.map((r) => [r.id, r]));
    this.rng = new SeededRandom(seed);
    for (const f of defs) {
      for (const r of f.routes) {
        const route = this.routesById.get(r.id);
        if (!route) throw new Error(`Flow references unknown route "${r.id}"`);
        if (route.spawnId !== f.spawnId) throw new Error(`Route "${r.id}" does not start at spawn "${f.spawnId}"`);
      }
    }
    this.reset();
  }

  reset(): void {
    this.rng = new SeededRandom(this.seed);
    this.nextId = 1;
    this.flows = this.defs.map((def) => ({ def, remaining: def.count, nextTime: def.startDelay, blocked: false, pending: null }));
  }

  get totalCars(): number {
    return this.defs.reduce((s, f) => s + f.count, 0);
  }

  get remaining(): number {
    return this.flows.reduce((s, f) => s + f.remaining, 0);
  }

  /** Number of flows currently unable to spawn because their entry is occupied. */
  get blockedCount(): number {
    return this.flows.filter((f) => f.blocked).length;
  }

  /** Spawn due vehicles. `vehicles` is used to check that the entry is clear. */
  update(time: number, vehicles: readonly Vehicle[]): Vehicle[] {
    const spawned: Vehicle[] = [];
    for (const f of this.flows) {
      f.blocked = false;
      if (f.remaining <= 0 || time < f.nextTime) continue;
      f.pending ??= this.rng.pickWeighted(f.def.routes).id;
      const route = this.routesById.get(f.pending)!;
      const start = route.path.points[0];
      let nearest = Infinity;
      for (const v of [...vehicles, ...spawned]) {
        const d = Math.hypot(v.x - start.x, v.y - start.y) - v.length / 2;
        if (d < nearest) nearest = d;
      }
      if (nearest < DRIVING.spawnClearance) {
        f.blocked = true;
        continue;
      }
      const spec = this.rng.pickWeighted(VEHICLE_SPECS);
      const maxSpeed = this.rng.range(spec.maxSpeed[0], spec.maxSpeed[1]);
      const color = CAR_COLORS[this.rng.int(0, CAR_COLORS.length - 1)];
      // Enter at a speed that allows stopping behind whatever is ahead.
      const room = Math.max(0, nearest - spec.length / 2 - DRIVING.minGap);
      const speed = Math.min(maxSpeed * 0.85, route.path.speedLimitAt(0), Math.sqrt(2 * spec.brake * room));
      const v = new Vehicle({ id: this.nextId++, spec, maxSpeed, color, route, speed });
      spawned.push(v);
      f.remaining--;
      f.pending = null;
      f.nextTime = time + this.rng.range(f.def.interval[0], f.def.interval[1]);
    }
    return spawned;
  }
}
