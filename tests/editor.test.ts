import { describe, expect, it } from 'vitest';
import {
  addRoad,
  buildLevel,
  decodeLevel,
  defaultEditorLevel,
  encodeLevel,
  nearestRoad,
  removeRoad,
  toggleLanes,
  totalVehicles,
  validate,
  type EditorLevel,
} from '../src/editor/EditorModel';
import { AutoPilot } from '../src/systems/AutoPilot';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';

function play(m: EditorLevel) {
  const sim = new TrafficSimulation(buildLevel(m));
  const pilot = new AutoPilot(sim);
  for (let i = 0; i < 60 * 400 && sim.status === 'running'; i++) {
    pilot.update(1 / 60);
    sim.step();
  }
  return sim;
}

describe('level editor model', () => {
  it('enforces spacing, edges and the road limit', () => {
    const m = defaultEditorLevel();
    expect(addRoad(m, 'h', 400)).toBe('tooClose'); // 80 from the road at 320
    expect(addRoad(m, 'h', 40)).toBe('tooClose'); // too close to the edge
    expect(addRoad(m, 'h', 124)).toBeNull(); // snapped to 120
    expect(m.h.map((r) => r.at)).toEqual([120, 320]);
    expect(addRoad(m, 'h', 520)).toBeNull();
    expect(addRoad(m, 'h', 530)).toBe('maxRoads');
  });

  it('finds, toggles and removes roads', () => {
    const m = defaultEditorLevel();
    const hit = nearestRoad(m, 100, 330);
    expect(hit).toEqual({ axis: 'h', index: 0 });
    toggleLanes(m, 'h', 0);
    expect(m.h[0].lanes).toBe(2);
    removeRoad(m, 'h', 0);
    expect(validate(m)).toBe('needCrossing');
    removeRoad(m, 'v', 0);
    expect(validate(m)).toBe('needRoad');
  });

  it('share codes round-trip and reject garbage', () => {
    const m = defaultEditorLevel('Кольцо <b>');
    addRoad(m, 'v', 700);
    toggleLanes(m, 'h', 0);
    m.slips = true;
    m.buses = true;
    m.cars = 9;
    const back = decodeLevel(encodeLevel(m));
    expect(back).not.toBeNull();
    expect(back!.name).toBe('Кольцо b');
    expect(back!.vr.map((r) => r.at)).toEqual([450, 700]);
    expect(back!.h[0].lanes).toBe(2);
    expect(back!.slips && back!.buses).toBe(true);
    expect(back!.cars).toBe(9);
    expect(decodeLevel('hello')).toBeNull();
    expect(decodeLevel('TF1:!!!')).toBeNull();
  });

  it('builds a playable level: lights on every approach, routes everywhere', () => {
    const m = defaultEditorLevel();
    const level = buildLevel(m);
    expect(level.intersections.length).toBe(1);
    expect(level.lights.length).toBe(4);
    expect(level.goal.carsToPass).toBe(totalVehicles(m));
    const sim = new TrafficSimulation(level);
    for (const r of sim.routes) {
      if (!r.def.free) expect(r.stops.length, r.id).toBeGreaterThan(0);
    }
  });

  it('a default custom level is winnable', () => {
    const sim = play(defaultEditorLevel());
    expect(sim.outcome).toBe('win');
  });

  it('a busy grid with two-lane roads, slip lanes, buses and emergencies is winnable', () => {
    const m = defaultEditorLevel();
    m.h = [
      { at: 180, lanes: 2 },
      { at: 460, lanes: 1 },
    ];
    m.vr = [
      { at: 250, lanes: 1 },
      { at: 650, lanes: 2 },
    ];
    m.slips = true;
    m.buses = true;
    m.trucks = true;
    m.emergency = true;
    m.cars = 5;
    const sim = play(m);
    console.log('grid', sim.outcome, sim.time.toFixed(1), sim.result?.score, 'crashes', sim.result?.crashes, 'passed', sim.score.passed, '/', sim.goal);
    expect(sim.outcome).toBe('win');
  });
});
