import { TrafficLight } from '../entities/TrafficLight';
import { LightState, type LightDef } from '../types';
import { dirAngle } from '../utils/geometry';
import { wrapAngle } from '../utils/math';
import type { RuntimeRoute } from './RouteNetwork';

export type LightAction = 'toggle' | 'yellow' | 'set';

export interface LightChange {
  id: string;
  state: LightState;
  cause: 'player' | 'auto';
}

/** Distance tolerance when binding a route to a stop line. */
const BIND_TOLERANCE = 8;

/** Owns all traffic lights, binds their stop lines to routes and applies player actions. */
export class TrafficLightSystem {
  readonly lights: TrafficLight[];
  private readonly byId = new Map<string, TrafficLight>();
  private listeners: ((c: LightChange) => void)[] = [];

  constructor(defs: LightDef[]) {
    this.lights = defs.map((d) => new TrafficLight(d));
    for (const l of this.lights) this.byId.set(l.id, l);
  }

  get(id: string): TrafficLight | undefined {
    return this.byId.get(id);
  }

  onChange(fn: (c: LightChange) => void): void {
    this.listeners.push(fn);
  }

  clearListeners(): void {
    this.listeners = [];
  }

  reset(): void {
    for (const l of this.lights) l.reset();
  }

  /**
   * Attach stop lines to every route that crosses them in the light's direction.
   * A route may have several stops (e.g. passing through two intersections).
   */
  bindRoutes(routes: RuntimeRoute[]): void {
    for (const r of routes) {
      const stops: { light: TrafficLight; s: number }[] = [];
      for (const light of this.lights) {
        const { s, distance } = r.path.project(light.def.stop);
        if (distance > BIND_TOLERANCE) continue;
        const heading = r.path.headingAt(s);
        if (Math.abs(wrapAngle(heading - dirAngle(light.def.dir))) > 0.35) continue;
        stops.push({ light, s });
      }
      stops.sort((a, b) => a.s - b.s);
      r.stops = stops.map((st, index) => ({ index, light: st.light, s: st.s }));
    }
  }

  toggle(id: string, time: number): LightState | null {
    const l = this.byId.get(id);
    if (!l) return null;
    l.toggle(time);
    this.emit({ id, state: l.state, cause: 'player' });
    return l.state;
  }

  setYellow(id: string, time: number): LightState | null {
    const l = this.byId.get(id);
    if (!l) return null;
    if (l.state === LightState.YELLOW) return l.state;
    l.setYellow(time);
    this.emit({ id, state: l.state, cause: 'player' });
    return l.state;
  }

  set(id: string, state: LightState, time: number, cause: 'player' | 'auto' = 'player'): void {
    const l = this.byId.get(id);
    if (!l) return;
    if (l.setState(state, time)) this.emit({ id, state, cause });
  }

  /** A vehicle crossed a stop line; consumes a yellow pass if applicable. */
  vehiclePassed(light: TrafficLight, vehicleId: number, time: number): void {
    if (light.notifyPassed(vehicleId, time)) this.emit({ id: light.id, state: light.state, cause: 'auto' });
  }

  private emit(c: LightChange): void {
    for (const fn of this.listeners) fn(c);
  }
}
