import { buildNetworkLevel } from '../src/graph/NetworkCompiler';
import { RoadNetwork } from '../src/graph/RoadNetwork';
import { AutoPilot } from '../src/systems/AutoPilot';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import type { LevelDef, NetworkData, Objective } from '../src/types';

export const WORLD = { width: 800, height: 640 };

/** A plus-shaped crossing at (400, 320) with entries W, N and exits E, S. */
export function crossNetwork(opts: { lights?: boolean; count?: number } = {}): RoadNetwork {
  const net = new RoadNetwork();
  net.addRoad({ x: 0, y: 320 }, { x: 800, y: 320 });
  net.addRoad({ x: 400, y: 0 }, { x: 400, y: 640 });
  const at = (x: number, y: number) => net.findNodeNear({ x, y }, 1)!.id;
  const count = opts.count ?? 6;
  net.setSpawn(at(0, 320), { count, startDelay: 0, interval: [2, 3] });
  net.setSpawn(at(400, 0), { count, startDelay: 1, interval: [2, 3] });
  net.setExit(at(800, 320), true);
  net.setExit(at(400, 640), true);
  if (opts.lights) net.setJunctionLights(at(400, 320), true);
  return net;
}

export function levelFrom(data: NetworkData, objectives: Objective[] = [], extra: Partial<Parameters<typeof buildNetworkLevel>[0]> = {}): LevelDef {
  const total = data.spawns.reduce((s, x) => s + x.count, 0);
  return buildNetworkLevel({
    id: 900,
    key: 'test-net',
    name: 'Test network',
    description: '',
    world: WORLD,
    seed: 5,
    network: data,
    budget: 10000,
    objectives: objectives.length ? objectives : [{ type: 'PASS_CARS', value: total }],
    stars: { parTime: 60, avgWait: 5, maxWait: 20, score: 1000 },
    decorDensity: 0,
    ...extra,
  });
}

export function autoplay(level: LevelDef, seconds = 400): TrafficSimulation {
  const sim = new TrafficSimulation(level);
  const pilot = new AutoPilot(sim);
  for (let i = 0; i < seconds * 60 && sim.status === 'running'; i++) {
    pilot.update(1 / 60);
    sim.step();
  }
  return sim;
}
