import { describe, expect, it } from 'vitest';
import { TrafficAnalytics, loadLevel } from '../src/analytics/TrafficAnalytics';
import { BudgetSystem } from '../src/building/BudgetSystem';
import { BuildManager, roadCost } from '../src/building/BuildManager';
import { checkGeometry } from '../src/building/BuildValidator';
import { roadPolyline, snapPoint, defaultBuildSettings } from '../src/building/RoadBuilder';
import { BUILD_COSTS } from '../src/config/balanceConfig';
import { validateNetwork } from '../src/editor/LevelValidator';
import { RoadNetwork } from '../src/graph/RoadNetwork';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { LightState } from '../src/types';
import { crossNetwork, levelFrom, WORLD } from './netHelpers';

function tNetwork(): RoadNetwork {
  const net = new RoadNetwork();
  net.addRoad({ x: 0, y: 320 }, { x: 800, y: 320 });
  net.setSpawn(net.findNodeNear({ x: 0, y: 320 }, 1)!.id, { count: 6, startDelay: 0, interval: [2, 3] });
  net.setExit(net.findNodeNear({ x: 800, y: 320 }, 1)!.id, true);
  return net;
}

const manager = (net: RoadNetwork, budget = 10000) => new BuildManager(net.data, budget, {}, WORLD);

describe('RoadBuilder', () => {
  it('snaps to nodes, roads and the grid', () => {
    const net = tNetwork();
    const s = defaultBuildSettings();
    expect(snapPoint(net, { x: 12, y: 330 }, s, WORLD)).toMatchObject({ x: 0, y: 320, kind: 'node' });
    expect(snapPoint(net, { x: 402, y: 335 }, s, WORLD)).toMatchObject({ x: 400, y: 320, kind: 'road' });
    expect(snapPoint(net, { x: 207, y: 118 }, s, WORLD)).toMatchObject({ x: 200, y: 120, kind: 'grid' });
  });

  it('builds straight roads in 8 directions and L-shaped roads otherwise', () => {
    expect(roadPolyline({ x: 0, y: 0 }, { x: 200, y: 0 }).length).toBe(2);
    expect(roadPolyline({ x: 0, y: 0 }, { x: 120, y: 120 }).length).toBe(2);
    expect(roadPolyline({ x: 0, y: 0 }, { x: 200, y: 80 })).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 80 }]);
  });
});

describe('BuildManager', () => {
  it('connects a new road to the existing network and charges the budget', () => {
    const m = manager(tNetwork());
    const plan = m.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 });
    expect(plan.valid).toBe(true);
    expect(plan.cost).toBe(roadCost(320));
    const r = m.buildRoad(plan);
    expect(r.ok).toBe(true);
    expect(m.budget.spent).toBe(plan.cost);
    const junction = m.net.findNodeNear({ x: 400, y: 320 }, 1)!;
    expect(m.net.degree(junction.id)).toBe(3); // joined into a T junction
  });

  it('refuses invalid geometry: too short, too close to a junction, outside the map', () => {
    const m = manager(tNetwork());
    expect(m.planRoad({ x: 400, y: 320 }, { x: 400, y: 360 }).reason).toBe('build.tooShort');
    m.buildRoad(m.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 }));
    expect(m.planRoad({ x: 440, y: 320 }, { x: 440, y: 640 }).reason).toBe('build.tooClose');
    expect(m.planRoad({ x: 600, y: 320 }, { x: 600, y: 900 }).valid).toBe(true); // clamped to the map edge
  });

  it('refuses a build it cannot afford and respects limits', () => {
    const m = new BuildManager(tNetwork().data, 500, { maxRoadCount: 1 }, WORLD);
    const plan = m.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 });
    expect(plan.valid).toBe(false);
    expect(plan.reason).toBe('build.noMoney');
    const rich = new BuildManager(tNetwork().data, 99999, { maxRoadCount: 1 }, WORLD);
    expect(rich.buildRoad(rich.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 })).ok).toBe(true);
    expect(rich.planRoad({ x: 200, y: 320 }, { x: 200, y: 0 }).reason).toBe('build.limitRoads');
  });

  it('traffic lights, lanes, direction and junction priority cost money and follow the rules', () => {
    const m = manager(crossNetwork());
    const j = m.net.findNodeNear({ x: 400, y: 320 }, 1)!.id;
    const approach = m.pickApproach({ x: 330, y: 340 })!;
    expect(approach.node).toBe(j);
    expect(m.toggleLight(approach.node, approach.edge)).toEqual({ ok: true, cost: BUILD_COSTS.trafficLight });
    const e = m.net.edgesAt(j)[0];
    expect(m.cycleLanes(e.id, { x: 0, y: 0 }).ok).toBe(true);
    expect(m.net.edge(e.id)!.f + m.net.edge(e.id)!.bk).toBe(3);
    expect(m.cycleDirection(e.id).ok).toBe(true);
    expect(m.cyclePriority(j)).toEqual({ ok: true, cost: BUILD_COSTS.intersection });
    expect(m.budget.spent).toBe(BUILD_COSTS.trafficLight + BUILD_COSTS.lane + BUILD_COSTS.intersection);
    // A tool the level does not allow.
    const locked = new BuildManager(crossNetwork().data, 5000, { allowed: ['road'] }, WORLD);
    expect(locked.toggleLight(approach.node, approach.edge)).toEqual({ ok: false, reason: 'build.toolLocked' });
  });

  it('cannot delete locked roads or roads that are in use', () => {
    const net = tNetwork();
    net.data.edges[0].locked = true;
    const m = manager(net);
    expect(m.deleteRoad(net.data.edges[0].id)).toEqual({ ok: false, reason: 'build.locked' });
    m.buildRoad(m.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 }));
    const side = m.net.edges.find((e) => !e.locked)!;
    m.edgeInUse = (id) => id === side.id;
    expect(m.deleteRoad(side.id)).toEqual({ ok: false, reason: 'build.inUse' });
    m.edgeInUse = () => false;
    expect(m.deleteRoad(side.id).ok).toBe(true);
    expect(m.net.edges.length).toBe(1);
  });
});

describe('CommandHistory (undo / redo)', () => {
  it('undoes and redoes road building, deleting, direction, lights and lanes, restoring money', () => {
    const m = manager(tNetwork());
    const start = JSON.stringify(m.net.data);
    m.buildRoad(m.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 }));
    const afterRoad = JSON.stringify(m.net.data);
    const spent = m.budget.spent;
    const j = m.net.findNodeNear({ x: 400, y: 320 }, 1)!.id;
    const approach = m.net.edgesAt(j).find((e) => m.net.lanesInto(e, j) > 0)!;
    m.toggleLight(j, approach.id);
    m.cycleDirection(m.net.edgesAt(j)[0].id);
    expect(m.history.canUndo).toBe(true);
    m.undo();
    m.undo();
    expect(JSON.stringify(m.net.data)).toBe(afterRoad);
    expect(m.budget.spent).toBe(spent);
    m.undo();
    expect(JSON.stringify(m.net.data)).toBe(start);
    expect(m.budget.spent).toBe(0);
    expect(m.redo()).toBe(true);
    expect(JSON.stringify(m.net.data)).toBe(afterRoad);
    // A new action clears the redo stack.
    m.cycleLanes(m.net.edges[0].id, { x: 100, y: 400 });
    expect(m.history.canRedo).toBe(false);
  });

  it('a failed command leaves no trace', () => {
    const m = new BuildManager(tNetwork().data, 100, {}, WORLD);
    const before = JSON.stringify(m.net.data);
    expect(m.buildRoad(m.planRoad({ x: 400, y: 320 }, { x: 400, y: 640 })).ok).toBe(false);
    expect(JSON.stringify(m.net.data)).toBe(before);
    expect(m.history.canUndo).toBe(false);
  });
});

describe('BudgetSystem', () => {
  it('never goes below zero; unlimited budgets always afford', () => {
    const b = new BudgetSystem(1000);
    expect(b.spend(600)).toBe(true);
    expect(b.spend(600)).toBe(false);
    expect(b.remaining).toBe(400);
    expect(new BudgetSystem(Infinity).canAfford(1e9)).toBe(true);
  });
});

describe('LevelValidator', () => {
  it('accepts a complete level and reports clear problems otherwise', () => {
    expect(validateNetwork(crossNetwork().data, WORLD, 1000).ok).toBe(true);
    const noExit = crossNetwork();
    noExit.data.exits = [];
    expect(validateNetwork(noExit.data, WORLD).issues.map((i) => i.key)).toContain('val.noExit');
    const broken = tNetwork();
    broken.cycleDirection(broken.edges[0].id);
    broken.cycleDirection(broken.edges[0].id); // now one-way towards the spawn
    const rep = validateNetwork(broken.data, WORLD);
    expect(rep.ok).toBe(false);
    expect(rep.issues.map((i) => i.key)).toContain('val.spawnNoRoute');
    expect(validateNetwork(crossNetwork().data, WORLD, -5).issues.map((i) => i.key)).toContain('val.budget');
  });

  it('geometry check rejects cramped junctions', () => {
    const net = new RoadNetwork();
    net.addRoad({ x: 0, y: 300 }, { x: 800, y: 300 });
    net.addRoad({ x: 300, y: 0 }, { x: 300, y: 600 });
    net.addRoad({ x: 330, y: 0 }, { x: 330, y: 600 });
    expect(checkGeometry(net, WORLD)).toBe('build.tooClose');
  });
});

describe('TrafficAnalytics', () => {
  it('measures load, speed, flow and junction throughput', () => {
    const net = crossNetwork({ lights: true, count: 10 });
    // Hold every approach at red (new lights otherwise start with one axis green).
    for (const l of net.data.lights) l.initial = LightState.RED;
    const sim = new TrafficSimulation(levelFrom(net.data));
    const an = new TrafficAnalytics(sim, net);
    for (let i = 0; i < 60 * 25; i++) {
      sim.step();
      if (i % 10 === 0) an.update();
    }
    const j = net.findNodeNear({ x: 400, y: 320 }, 1)!.id;
    const west = net.edgesAt(j).find((e) => net.node(net.other(e, j))!.x === 0)!;
    const es = an.edge(west.id)!;
    expect(es.perMinute).toBeGreaterThan(0);
    expect(es.utilization).toBeGreaterThanOrEqual(0);
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(es.level);
    const ns = an.node(j)!;
    expect(ns.conflictPoints).toBeGreaterThan(0);
    // Every light is red: nobody passes, queues build up.
    expect(ns.passes).toBe(0);
    const lights = sim.lights.lights.map((l) => an.light(l.id)!);
    expect(Math.max(...lights.map((l) => l.queue))).toBeGreaterThan(2);
    expect(an.global().vehicles).toBe(sim.vehicles.length);
    expect(loadLevel(0.1)).toBe('LOW');
    expect(loadLevel(0.9)).toBe('CRITICAL');
  });
});

describe('Default light phase', () => {
  it('starts new lights with one axis green and the crossing axis red', () => {
    const net = crossNetwork({ lights: true, count: 4 });
    const lvl = levelFrom(net.data);
    const states = lvl.lights.map((l) => l.initial);
    expect(states.filter((s) => s === LightState.GREEN).length).toBe(2);
    expect(states.filter((s) => s === LightState.RED).length).toBe(2);
  });
});
