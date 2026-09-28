import { DRIVING, ROAD, VEHICLE_SPECS, specOf, type VehicleSpec } from '../config/balanceConfig';
import { paletteFor } from '../config/theme';
import { Vehicle } from '../entities/Vehicle';
import type { FlowDef, SpecialDef } from '../types';
import { SeededRandom } from '../utils/math';
import type { RuntimeRoute } from './RouteNetwork';

/** A vehicle decided on but not yet placed (its entry may be blocked by a queue). */
interface Pending {
  route: RuntimeRoute;
  spec: VehicleSpec;
  maxSpeed: number;
  color: number;
}

interface FlowState {
  def: FlowDef;
  remaining: number;
  nextTime: number;
  blocked: boolean;
  pending: Pending | null;
  weights: { spec: VehicleSpec; weight: number }[];
}

/**
 * Emits vehicles for each flow on a deterministic (seeded) schedule, plus scheduled special
 * vehicles (emergency services) at fixed times.
 */
export class VehicleSpawner {
  private flows: FlowState[] = [];
  private specials: { def: SpecialDef; done: boolean; blocked: boolean }[] = [];
  private rng: SeededRandom;
  private nextId = 1;
  private readonly routesById: Map<string, RuntimeRoute>;

  constructor(
    private readonly defs: FlowDef[],
    routes: RuntimeRoute[],
    private readonly seed: number,
    private readonly specialDefs: SpecialDef[] = [],
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
    for (const sp of specialDefs) {
      const route = this.routesById.get(sp.routeId);
      if (!route) throw new Error(`Special vehicle references unknown route "${sp.routeId}"`);
    }
    this.reset();
  }

  reset(): void {
    this.rng = new SeededRandom(this.seed);
    this.nextId = 1;
    this.flows = this.defs.map((def) => ({
      def,
      remaining: def.count,
      nextTime: def.startDelay,
      blocked: false,
      pending: null,
      weights: VEHICLE_SPECS.map((spec) => ({ spec, weight: def.mix?.[spec.kind] ?? spec.weight })).filter((w) => w.weight > 0),
    }));
    this.specials = [...this.specialDefs].sort((a, b) => a.at - b.at).map((def) => ({ def, done: false, blocked: false }));
  }

  get totalCars(): number {
    return this.defs.reduce((s, f) => s + f.count, 0) + this.specialDefs.length;
  }

  get remaining(): number {
    return this.flows.reduce((s, f) => s + f.remaining, 0) + this.specials.filter((s) => !s.done).length;
  }

  /** Number of entries currently unable to spawn because they are occupied. */
  get blockedCount(): number {
    return this.flows.filter((f) => f.blocked).length + this.specials.filter((s) => s.blocked).length;
  }

  /**
   * Free distance from a route's start to the rear of the nearest vehicle in the same lane.
   * Vehicles in adjacent lanes do not block.
   */
  private freeSpace(route: RuntimeRoute, vehicles: readonly Vehicle[]): number {
    const p0 = route.path.points[0];
    const h = route.path.headings[0];
    const dx = Math.cos(h);
    const dy = Math.sin(h);
    let nearest = Infinity;
    for (const v of vehicles) {
      const rx = v.x - p0.x;
      const ry = v.y - p0.y;
      const along = rx * dx + ry * dy;
      const lateral = Math.abs(rx * -dy + ry * dx);
      if (lateral > ROAD.laneWidth / 2 || along < -v.length) continue;
      nearest = Math.min(nearest, along - v.length / 2);
    }
    return nearest;
  }

  private place(p: Pending, vehicles: readonly Vehicle[]): Vehicle | null {
    const free = this.freeSpace(p.route, vehicles);
    const need = Math.max(DRIVING.spawnClearance - 11, 0) + p.spec.length / 2;
    if (free < need) return null;
    // Enter at a speed that allows stopping behind whatever is ahead.
    const room = Math.max(0, free - p.spec.length / 2 - DRIVING.minGap);
    const speed = Math.min(p.maxSpeed * 0.85, p.route.path.speedLimitAt(0), Math.sqrt(2 * p.spec.brake * room));
    return new Vehicle({ id: this.nextId++, spec: p.spec, maxSpeed: p.maxSpeed, color: p.color, route: p.route, speed });
  }

  /** Spawn due vehicles. `vehicles` is used to check that the entry is clear. */
  update(time: number, vehicles: readonly Vehicle[]): Vehicle[] {
    const spawned: Vehicle[] = [];
    const all = () => (spawned.length ? [...vehicles, ...spawned] : vehicles);

    for (const s of this.specials) {
      s.blocked = false;
      if (s.done || time < s.def.at) continue;
      const spec = specOf(s.def.kind);
      const route = this.routesById.get(s.def.routeId)!;
      const v = this.place({ route, spec, maxSpeed: (spec.maxSpeed[0] + spec.maxSpeed[1]) / 2, color: paletteFor(spec.kind)[0] }, all());
      if (!v) {
        s.blocked = true;
        continue;
      }
      s.done = true;
      spawned.push(v);
    }

    for (const f of this.flows) {
      f.blocked = false;
      if (f.remaining <= 0 || time < f.nextTime) continue;
      if (!f.pending) {
        const route = this.routesById.get(this.rng.pickWeighted(f.def.routes).id)!;
        const spec = this.rng.pickWeighted(f.weights).spec;
        const maxSpeed = this.rng.range(spec.maxSpeed[0], spec.maxSpeed[1]);
        const palette = paletteFor(spec.kind);
        const color = palette[this.rng.int(0, palette.length - 1)];
        f.pending = { route, spec, maxSpeed, color };
      }
      const v = this.place(f.pending, all());
      if (!v) {
        f.blocked = true;
        continue;
      }
      spawned.push(v);
      f.remaining--;
      f.pending = null;
      f.nextTime = time + this.rng.range(f.def.interval[0], f.def.interval[1]);
    }
    return spawned;
  }
}
