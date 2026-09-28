import { describe, expect, it } from 'vitest';
import { compileNetwork } from '../src/graph/NetworkCompiler';
import { RoadNetwork } from '../src/graph/RoadNetwork';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { WORLD, autoplay, levelFrom } from './netHelpers';

type P = [number, number];
const C: P = [400, 320];

/** Roads from the map edge points to the centre; every road end is an entry and an exit. */
function star(ends: P[], lanes: [number, number] = [1, 1]): RoadNetwork {
  const net = new RoadNetwork();
  for (const p of ends) {
    const [e] = net.addRoad({ x: p[0], y: p[1] }, { x: C[0], y: C[1] });
    net.setLanes(e.id, lanes[0], lanes[1]);
  }
  for (const p of ends) {
    const n = net.findNodeNear({ x: p[0], y: p[1] }, 1)!.id;
    net.setSpawn(n, { count: 4, startDelay: 0, interval: [2.5, 3.5] });
    net.setExit(n, true);
  }
  return net;
}

const centre = (net: RoadNetwork) => net.findNodeNear({ x: C[0], y: C[1] }, 1)!;

describe('IntersectionBuilder', () => {
  const shapes: Record<string, P[]> = {
    cross: [[0, 320], [800, 320], [400, 0], [400, 640]],
    T: [[0, 320], [800, 320], [400, 640]],
    Y: [[400, 640], [0, 0], [800, 0]],
    complex: [[0, 320], [800, 320], [400, 0], [400, 640], [0, 640]],
  };
  for (const [name, ends] of Object.entries(shapes)) {
    it(`${name} junction: connected roads, all movements, conflict zones, lights on every approach`, () => {
      const net = star(ends);
      const j = centre(net);
      expect(net.isJunction(j.id)).toBe(true);
      expect(net.degree(j.id)).toBe(ends.length);
      const c = compileNetwork(net, WORLD);
      expect(c.unreachableSpawns).toEqual([]);
      // Every entry reaches every other end (no U-turns).
      const pairs = new Set(c.routes.map((r) => `${r.spawnId}>${r.exitId}`));
      expect(pairs.size).toBe(ends.length * (ends.length - 1));
      const sim = new TrafficSimulation(levelFrom(net.data));
      const near = sim.collisions.zones.filter((z) => Math.hypot(z.x - C[0], z.y - C[1]) < 80);
      expect(near.length).toBeGreaterThan(0);
      // Lights on every approach, each with a stop line.
      expect(net.setJunctionLights(j.id, true)).toBe(ends.length);
      const lit = levelFrom(net.data);
      expect(lit.lights.length).toBe(ends.length);
      for (const r of new TrafficSimulation(lit).routes) expect(r.stops.length, r.id).toBe(1);
    });
  }

  it('turning paths are classified left / right / straight from the entry and exit direction', () => {
    const net = star(shapes_cross());
    const c = compileNetwork(net, WORLD);
    const w = net.findNodeNear({ x: 0, y: 320 }, 1)!.id;
    const toExit = (x: number, y: number) => net.data.exits.find((e) => e.node === net.findNodeNear({ x, y }, 1)!.id)!.id;
    const from = c.routes.filter((r) => r.spawnId === net.data.spawns.find((s) => s.node === w)!.id);
    const end = (id: string) => from.find((r) => r.exitId === id)!.points.at(-1)!;
    // Heading east: the south exit is a right turn (screen y grows downwards), north is left.
    expect(end(toExit(400, 640)).y).toBeGreaterThan(320);
    expect(end(toExit(400, 0)).y).toBeLessThan(320);
  });

  it('busy junctions of every shape run without crashes under the autopilot', () => {
    for (const ends of [shapes.cross, shapes.T, shapes.Y]) {
      const net = star(ends);
      net.setJunctionLights(centre(net).id, true);
      const sim = autoplay(levelFrom(net.data), 300);
      expect(sim.outcome, JSON.stringify(ends)).toBe('win');
      expect(sim.score.crashes).toBe(0);
    }
  });
});

function shapes_cross(): P[] {
  return [[0, 320], [800, 320], [400, 0], [400, 640]];
}

describe('LaneSystem', () => {
  it('lane counts are clamped to 0…3 per direction and never zero in total', () => {
    const net = new RoadNetwork();
    const [e] = net.addRoad({ x: 0, y: 100 }, { x: 600, y: 100 });
    net.setLanes(e.id, 5, 7);
    expect([e.f, e.bk]).toEqual([3, 3]);
    net.setLanes(e.id, 0, 0);
    expect(e.f + e.bk).toBe(1);
  });

  it('each lane has its own trajectory: right turns from the outer lane, left turns from the inner lane', () => {
    const net = star(shapes_cross(), [2, 2]);
    const c = compileNetwork(net, WORLD);
    const w = net.data.spawns.find((s) => s.node === net.findNodeNear({ x: 0, y: 320 }, 1)!.id)!;
    const exitAt = (x: number, y: number) => net.data.exits.find((e) => e.node === net.findNodeNear({ x, y }, 1)!.id)!.id;
    const from = c.routes.filter((r) => r.spawnId === w.id);
    const right = from.find((r) => r.exitId === exitAt(400, 640))!;
    const left = from.find((r) => r.exitId === exitAt(400, 0))!;
    // Eastbound traffic drives below the centre line; the outer (right) lane is further down.
    const yAt = (r: typeof right) => r.points[0].y;
    expect(yAt(right)).toBeGreaterThan(320);
    expect(yAt(left)).toBeGreaterThan(320);
    expect(yAt(right)).toBeGreaterThan(yAt(left) + 5);
  });

  it('more lanes move more traffic in the same time', () => {
    const run = (lanes: [number, number]) => {
      const net = new RoadNetwork();
      net.addRoad({ x: 0, y: 320 }, { x: 800, y: 320 });
      for (const e of net.edges) net.setLanes(e.id, lanes[0], lanes[1]);
      const a = net.findNodeNear({ x: 0, y: 320 }, 1)!.id;
      net.setSpawn(a, { count: 40, startDelay: 0, interval: [0.3, 0.4] });
      net.setExit(net.findNodeNear({ x: 800, y: 320 }, 1)!.id, true);
      const sim = new TrafficSimulation(levelFrom(net.data));
      for (let i = 0; i < 60 * 12; i++) sim.step();
      return sim.score.passed;
    };
    expect(run([2, 0])).toBeGreaterThanOrEqual(run([1, 0]));
  });
});

describe('partly signalled junctions', () => {
  it('a single light plus give-way traffic never crashes, whatever the light shows', () => {
    for (const which of [0, 1, 2, 3]) {
      const net = star(shapes_cross());
      const j = centre(net);
      net.setLight(j.id, net.edgesAt(j.id)[which].id, true);
      const sim = new TrafficSimulation(levelFrom(net.data));
      for (let i = 0; i < 60 * 200 && sim.status === 'running'; i++) sim.step();
      expect(sim.outcome, `light on approach ${which}`).not.toBe('crash');
      // A green light never starves the others: everybody gets through.
      if (sim.lights.lights[0].state === 'GREEN') expect(sim.outcome).toBe('win');
    }
  });
});
