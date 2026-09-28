import { TrafficLight } from '../entities/TrafficLight';
import { LightState, type LightDef } from '../types';
import { dirAngle, dirVector } from '../utils/geometry';
import { wrapAngle } from '../utils/math';
import type { RuntimeRoute } from './RouteNetwork';

export type LightAction = 'toggle' | 'yellow' | 'set';

export interface LightChange {
  id: string;
  state: LightState;
  cause: 'player' | 'auto';
}

/** Extra lateral tolerance when binding a route to a stop line. */
const BIND_TOLERANCE = 4;

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
      // Free (slip-lane) turns bypass the signals and yield instead.
      if (!r.def.free) {
        for (const light of this.lights) {
          const s = crossingOf(r, light.def);
          if (s !== null) stops.push({ light, s });
        }
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

/**
 * Arc position where a route crosses a light's stop line (a segment across all inbound lanes)
 * travelling in the light's direction, or null.
 */
function crossingOf(r: RuntimeRoute, def: LightDef): number | null {
  const d = dirVector(def.dir);
  const pts = r.path.points;
  const step = r.path.step;
  const want = dirAngle(def.dir);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = (pts[i].x - def.stop.x) * d.x + (pts[i].y - def.stop.y) * d.y;
    const b = (pts[i + 1].x - def.stop.x) * d.x + (pts[i + 1].y - def.stop.y) * d.y;
    if (a > 0 || b < 0) continue; // must go from before the line to after it
    const t = a === b ? 0 : -a / (b - a);
    const px = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
    const py = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
    const lateral = Math.abs((px - def.stop.x) * -d.y + (py - def.stop.y) * d.x);
    if (lateral > def.width / 2 + BIND_TOLERANCE) continue;
    if (Math.abs(wrapAngle(r.path.headings[i] - want)) > 0.35) continue;
    return (i + t) * step;
  }
  return null;
}
