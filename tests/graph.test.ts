import { describe, expect, it } from 'vitest';
import { compileNetwork, classifyTurn, mainPair } from '../src/graph/NetworkCompiler';
import { PathFinder } from '../src/graph/PathFinder';
import { RoadNetwork } from '../src/graph/RoadNetwork';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { wrapAngle } from '../src/utils/math';
import { autoplay, crossNetwork, levelFrom, WORLD } from './netHelpers';

describe('RoadGraph', () => {
  it('crossing roads create a junction node automatically', () => {
    const net = crossNetwork();
    const junction = net.findNodeNear({ x: 400, y: 320 }, 1)!;
    expect(junction).toBeDefined();
    expect(net.degree(junction.id)).toBe(4);
    expect(net.edges.length).toBe(4);
  });

  it('a road ending on another road splits it into a T junction', () => {
    const net = new RoadNetwork();
    net.addRoad({ x: 0, y: 200 }, { x: 600, y: 200 });
    net.addRoad({ x: 300, y: 200 }, { x: 300, y: 500 });
    const t = net.findNodeNear({ x: 300, y: 200 }, 1)!;
    expect(net.degree(t.id)).toBe(3);
  });

  it('removing a road cleans up orphan nodes and re-merges straight joints', () => {
    const net = new RoadNetwork();
    net.addRoad({ x: 0, y: 200 }, { x: 600, y: 200 });
    const [side] = net.addRoad({ x: 300, y: 200 }, { x: 300, y: 500 });
    expect(net.edges.length).toBe(3);
    net.removeEdge(side.id);
    expect(net.edges.length).toBe(1); // the split main road is whole again
    expect(net.nodes.length).toBe(2);
  });

  it('direction cycles two-way → one-way → other way → two-way', () => {
    const net = new RoadNetwork();
    const [e] = net.addRoad({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(net.directionOf(e)).toBe('two');
    net.cycleDirection(e.id);
    expect([e.f, e.bk]).toEqual([2, 0]);
    net.cycleDirection(e.id);
    expect([e.f, e.bk]).toEqual([0, 2]);
    net.cycleDirection(e.id);
    expect([e.f, e.bk]).toEqual([1, 1]);
  });
});

describe('PathFinder', () => {
  it('finds the shortest route and respects one-way roads', () => {
    const net = crossNetwork();
    const pf = new PathFinder(net);
    const w = net.findNodeNear({ x: 0, y: 320 }, 1)!.id;
    const e = net.findNodeNear({ x: 800, y: 320 }, 1)!.id;
    const r = pf.find(w, e)!;
    expect(r.traversals.length).toBe(2);
    // Make the east half one-way westbound: no route any more, and no endless search.
    const east = net.edges.find((x) => x.a === e || x.b === e)!;
    const toEast = east.a === e ? 'bk' : 'f';
    net.setLanes(east.id, toEast === 'f' ? 0 : 2, toEast === 'f' ? 2 : 0);
    expect(pf.find(w, e)).toBeNull();
  });

  it('recomputes after the graph changes (cache invalidated by version)', () => {
    const net = new RoadNetwork();
    net.addRoad({ x: 0, y: 100 }, { x: 400, y: 100 });
    net.addRoad({ x: 0, y: 400 }, { x: 400, y: 400 });
    const a = net.findNodeNear({ x: 0, y: 100 }, 1)!.id;
    const b = net.findNodeNear({ x: 400, y: 400 }, 1)!.id;
    const pf = new PathFinder(net);
    expect(pf.find(a, b)).toBeNull(); // disconnected
    net.addRoad({ x: 200, y: 100 }, { x: 200, y: 400 });
    const r = pf.find(a, b);
    expect(r).not.toBeNull();
    expect(r!.traversals.map((t) => classifyTurn(t, undefined))).toContain('end');
  });
});

describe('NetworkCompiler', () => {
  it('builds lane-level routes with smooth turns for every spawn → exit pair', () => {
    const net = crossNetwork({ lights: true });
    const c = compileNetwork(net, WORLD);
    expect(c.unreachableSpawns).toEqual([]);
    expect(c.lights.length).toBe(4);
    const pairs = new Set(c.routes.map((r) => `${r.spawnId}>${r.exitId}`));
    expect(pairs.size).toBe(4); // W→E, W→S, N→E, N→S
    const sim = new TrafficSimulation(levelFrom(net.data));
    for (const r of sim.routes) {
      let maxStep = 0;
      for (let i = 1; i < r.path.headings.length; i++) maxStep = Math.max(maxStep, Math.abs(wrapAngle(r.path.headings[i] - r.path.headings[i - 1])));
      expect(maxStep, r.id).toBeLessThan(0.3);
      expect(r.stops.length, r.id).toBe(1); // bound to its junction light
    }
  });

  it('reports spawns that cannot reach any exit', () => {
    const net = crossNetwork();
    const n = net.findNodeNear({ x: 400, y: 0 }, 1)!.id;
    const e = net.edgesAt(n)[0];
    net.setLanes(e.id, e.a === n ? 0 : 2, e.a === n ? 2 : 0); // only towards the spawn
    const c = compileNetwork(net, WORLD);
    expect(c.unreachableSpawns.length).toBe(1);
  });

  it('picks the straight wide road as the main road of an unsignalled junction', () => {
    const net = new RoadNetwork();
    net.addRoad({ x: 0, y: 200 }, { x: 600, y: 200 });
    net.addRoad({ x: 300, y: 200 }, { x: 300, y: 500 });
    const t = net.findNodeNear({ x: 300, y: 200 }, 1)!;
    const main = mainPair(net, t)!;
    for (const id of main) {
      const e = net.edge(id)!;
      expect(net.node(e.a)!.y === 200 && net.node(e.b)!.y === 200).toBe(true);
    }
  });
});

describe('road networks in the simulation', () => {
  it('a signalled crossing is won by the autopilot without crashes', () => {
    const sim = autoplay(levelFrom(crossNetwork({ lights: true }).data));
    expect(sim.outcome).toBe('win');
    expect(sim.result!.crashes).toBe(0);
  });

  it('an unsignalled crossing works by right of way (no crashes, everyone gets through)', () => {
    const sim = autoplay(levelFrom(crossNetwork({ lights: false }).data));
    expect(sim.outcome).toBe('win');
    expect(sim.result!.crashes).toBe(0);
  });

  it('an all-way-yield crossing with busy traffic does not deadlock', () => {
    const net = crossNetwork({ count: 10 });
    net.node(net.findNodeNear({ x: 400, y: 320 }, 1)!.id)!.priority = 'allway';
    net.touch();
    const sim = autoplay(levelFrom(net.data));
    expect(sim.outcome).toBe('win');
    expect(sim.result!.crashes).toBe(0);
  });

  it('vehicles use a newly built road after the network is swapped mid-level', () => {
    const net = new RoadNetwork();
    net.addRoad({ x: 0, y: 320 }, { x: 800, y: 320 });
    const w = net.findNodeNear({ x: 0, y: 320 }, 1)!.id;
    net.setSpawn(w, { count: 8, startDelay: 0, interval: [2, 2] });
    net.setExit(net.findNodeNear({ x: 800, y: 320 }, 1)!.id, true);
    const sim = new TrafficSimulation(levelFrom(net.data, [{ type: 'PASS_CARS', value: 8 }]));
    for (let i = 0; i < 60 * 5; i++) sim.step();
    const before = sim.vehicles.length;
    expect(before).toBeGreaterThan(0);
    // Build a road to a new exit in the south and swap the network in.
    net.addRoad({ x: 400, y: 320 }, { x: 400, y: 640 });
    net.setExit(net.findNodeNear({ x: 400, y: 640 }, 1)!.id, true);
    sim.applyNetwork(levelFrom(net.data, [{ type: 'PASS_CARS', value: 8 }]));
    expect(sim.vehicles.length).toBe(before); // nobody was removed
    const exits = new Set<string>();
    sim.on({ exit: (v) => exits.add(v.route.exitId) });
    for (let i = 0; i < 60 * 60 && sim.status === 'running'; i++) sim.step();
    expect(sim.outcome).toBe('win');
    expect(exits.size).toBe(2); // new vehicles used the new road as well
  });
});
