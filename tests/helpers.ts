import { crossing, defineLevel, hRoad, light, route, vRoad } from '../src/levels/builder';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { LightState, type FlowDef, type LevelDef } from '../src/types';

const world = { width: 600, height: 600 };
const X = 300;
const Y = 300;

/** A single crossing with a W→E flow and an N→S flow, configurable for tests. */
export function testLevel(opts: {
  west?: Partial<FlowDef>;
  north?: Partial<FlowDef> | null;
  wLight?: LightState;
  nLight?: LightState;
  goal?: number;
  timeLimit?: number;
  withTurns?: boolean;
}): LevelDef {
  const I = crossing('I', X, Y);
  const routes = [route('we', 'W', 'E', [{ dir: 'E', road: Y }], world), route('ns', 'N', 'S', [{ dir: 'S', road: X }], world)];
  if (opts.withTurns) {
    // Left turn from the south, crossing W→E traffic inside the junction.
    routes.push(route('sw', 'S', 'W', [{ dir: 'N', road: X }, { dir: 'W', road: Y }], world));
  }
  const flows: FlowDef[] = [
    { spawnId: 'W', routes: [{ id: 'we', weight: 1 }], count: 3, startDelay: 0, interval: [2, 2], ...opts.west },
  ];
  if (opts.north !== null) {
    flows.push({ spawnId: 'N', routes: [{ id: 'ns', weight: 1 }], count: 3, startDelay: 0, interval: [2, 2], ...opts.north });
  }
  const lights = [light('LW', I, 'E', opts.wLight ?? LightState.GREEN), light('LN', I, 'S', opts.nLight ?? LightState.RED)];
  if (opts.withTurns) lights.push(light('LS', I, 'N', LightState.GREEN));
  const total = flows.reduce((s, f) => s + f.count, 0);
  return defineLevel({
    id: 99,
    key: 'test',
    name: 'Test',
    description: 'test',
    world,
    seed: 42,
    roads: [hRoad('h', Y), vRoad('v', X)],
    intersections: [I],
    lights,
    routes,
    flows,
    goal: { carsToPass: opts.goal ?? total, timeLimit: opts.timeLimit },
    stars: { parTime: 30, avgWait: 2, maxWait: 6, score: 500 },
    decorDensity: 0,
  });
}

export function runFor(sim: TrafficSimulation, seconds: number, each?: (sim: TrafficSimulation) => void): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps && sim.status === 'running'; i++) {
    sim.step();
    each?.(sim);
  }
}

/** Serialisable fingerprint of the simulation state. */
export function fingerprint(sim: TrafficSimulation): string {
  return JSON.stringify({
    t: sim.time.toFixed(6),
    status: sim.status,
    passed: sim.score.passed,
    score: sim.score.liveScore,
    lights: sim.lights.lights.map((l) => l.state),
    cars: sim.vehicles.map((v) => [v.id, v.route.id, v.s.toFixed(6), v.speed.toFixed(6), v.state]),
  });
}
