import { LightState } from '../types';
import type { TrafficSimulation } from './TrafficSimulation';

type Mode = 'green' | 'clear';

/**
 * A simple adaptive signal controller. It groups non-conflicting lights into phases and cycles
 * through the phases that have demand, with an all-red clearance interval between them.
 * Used by the menu background demo and by the automated "every level is winnable" tests.
 */
export class AutoPilot {
  readonly phases: string[][];
  private readonly conflicts = new Map<string, Set<string>>();
  private phase = 0;
  private mode: Mode = 'green';
  private timer = 0;

  constructor(
    private readonly sim: TrafficSimulation,
    private readonly opts = { minGreen: 3, maxGreen: 11, minClear: 0.6 },
  ) {
    this.buildConflicts();
    this.phases = this.buildPhases();
    this.phase = this.pickInitialPhase();
    this.apply(this.phases[this.phase]);
  }

  /** Lights that must never be green together. */
  lightConflicts(id: string): ReadonlySet<string> {
    return this.conflicts.get(id) ?? new Set();
  }

  private buildConflicts(): void {
    const ids = this.sim.lights.lights.map((l) => l.id);
    for (const id of ids) this.conflicts.set(id, new Set());
    // zone id -> list of [routeId, lightId] that enter the zone after passing that light
    const zoneUsers = new Map<string, { route: string; light: string }[]>();
    for (const r of this.sim.routes) {
      for (const rz of r.zones) {
        let controlling: string | null = null;
        for (const st of r.stops) if (st.s < rz.sExit) controlling = st.light.id;
        if (!controlling) continue;
        const list = zoneUsers.get(rz.zone.id) ?? [];
        list.push({ route: r.id, light: controlling });
        zoneUsers.set(rz.zone.id, list);
      }
    }
    for (const z of this.sim.collisions.zones) {
      const users = zoneUsers.get(z.id) ?? [];
      for (const u1 of users) {
        for (const u2 of users) {
          if (u1.light === u2.light) continue;
          if (this.sim.collisions.routesConflict(z, u1.route, u2.route)) {
            this.conflicts.get(u1.light)!.add(u2.light);
            this.conflicts.get(u2.light)!.add(u1.light);
          }
        }
      }
    }
  }

  private buildPhases(): string[][] {
    const ids = this.sim.lights.lights.map((l) => l.id);
    const phases: string[][] = [];
    const covered = new Set<string>();
    for (const seed of ids) {
      if (covered.has(seed)) continue;
      const phase = [seed];
      for (const other of ids) {
        if (other === seed) continue;
        if (phase.every((p) => !this.conflicts.get(p)!.has(other))) phase.push(other);
      }
      phase.forEach((p) => covered.add(p));
      phases.push(phase);
    }
    return phases;
  }

  private pickInitialPhase(): number {
    const green = new Set(this.sim.lights.lights.filter((l) => l.state === LightState.GREEN).map((l) => l.id));
    let best = 0;
    let bestScore = -1;
    this.phases.forEach((p, i) => {
      const score = p.filter((id) => green.has(id)).length;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  private demand(lightId: string): number {
    let n = 0;
    for (const v of this.sim.vehicles) {
      const st = v.route.stops[v.nextStop];
      if (st && st.light.id === lightId && st.s - v.front < 220) n++;
    }
    return n;
  }

  private phaseDemand(i: number): number {
    return this.phases[i].reduce((s, id) => s + this.demand(id), 0);
  }

  /**
   * True when switching phase `i` to green is safe: no car that already passed its stop line
   * is still inside (or heading into) a zone that phase `i` traffic will cross.
   */
  private phaseClear(i: number): boolean {
    const green = new Set(this.phases[i]);
    const zones = this.sim.collisions;
    for (const r of this.sim.routes) {
      for (const st of r.stops) {
        if (!green.has(st.light.id)) continue;
        for (const rz of r.zones) {
          if (rz.sExit <= st.s || rz.sEnter > st.s + 120) continue;
          for (const o of this.sim.vehicles) {
            if (!zones.routesConflict(rz.zone, r.id, o.route.id)) continue;
            const orz = o.route.zones.find((z) => z.zone === rz.zone);
            if (!orz) continue;
            // Yielding (free-turn) cars only count once they are committed to the zone.
            let controlling = o.route.def.free ? orz.sEnter - 2 : -Infinity;
            for (const ost of o.route.stops) if (ost.s < orz.sExit) controlling = ost.s;
            if (o.front >= controlling - 1 && o.rear <= orz.sExit + 2) return false;
          }
        }
      }
    }
    return true;
  }

  private apply(greenIds: string[]): void {
    const set = new Set(greenIds);
    for (const l of this.sim.lights.lights) {
      this.sim.lights.set(l.id, set.has(l.id) ? LightState.GREEN : LightState.RED, this.sim.time, 'auto');
    }
  }

  /** Call once per simulation step. */
  update(dt: number): void {
    if (this.sim.status !== 'running') return;
    this.timer += dt;
    if (this.mode === 'green') {
      const cur = this.phaseDemand(this.phase);
      let next = -1;
      for (let k = 1; k <= this.phases.length; k++) {
        const i = (this.phase + k) % this.phases.length;
        if (i !== this.phase && this.phaseDemand(i) > 0) {
          next = i;
          break;
        }
      }
      const wantSwitch = next >= 0 && ((this.timer > this.opts.minGreen && cur === 0) || this.timer > this.opts.maxGreen);
      if (wantSwitch) {
        const keep = new Set(this.phases[next]);
        this.apply(this.phases[this.phase].filter((id) => keep.has(id)));
        this.phase = next;
        this.mode = 'clear';
        this.timer = 0;
      }
    } else if (this.timer > this.opts.minClear) {
      // Prefer the planned phase; if it stays blocked, fall back to any other clear phase with demand.
      const order = [this.phase, ...this.phases.map((_, k) => k).filter((k) => k !== this.phase)];
      for (const i of order) {
        if (i !== this.phase && (this.timer < 4 || this.phaseDemand(i) === 0)) continue;
        if (!this.phaseClear(i)) continue;
        this.phase = i;
        this.apply(this.phases[i]);
        this.mode = 'green';
        this.timer = 0;
        break;
      }
    }
  }
}
