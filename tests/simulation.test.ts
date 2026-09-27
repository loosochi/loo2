import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/levelRegistry';
import { level04 } from '../src/levels/level04';
import { Path } from '../src/systems/PathSystem';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { LightState } from '../src/types';
import { wrapAngle } from '../src/utils/math';
import { fingerprint, runFor, testLevel } from './helpers';

describe('win and lose conditions', () => {
  it('wins when the required number of cars has passed', () => {
    const sim = new TrafficSimulation(testLevel({ north: null, west: { count: 2 }, goal: 2 }));
    let ended = '';
    sim.on({ end: (r) => (ended = r.outcome) });
    runFor(sim, 30);
    expect(sim.status).toBe('won');
    expect(ended).toBe('win');
    expect(sim.result?.passed).toBe(2);
    expect(sim.result?.stars).toBeGreaterThanOrEqual(1);
  });

  it('loses when the time limit runs out', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.RED, north: null, timeLimit: 8 }));
    runFor(sim, 20);
    expect(sim.outcome).toBe('timeout');
    expect(sim.time).toBeCloseTo(8, 1);
  });
});

describe('restart and determinism', () => {
  it('reset() restores the exact initial state (no leftover cars or timers)', () => {
    const sim = new TrafficSimulation(level04);
    const initial = fingerprint(sim);
    runFor(sim, 12);
    sim.toggleLight('A_N');
    runFor(sim, 3);
    expect(sim.vehicles.length).toBeGreaterThan(0);
    sim.reset();
    expect(fingerprint(sim)).toBe(initial);
    expect(sim.vehicles.length).toBe(0);
    expect(sim.time).toBe(0);
    expect(sim.actions.length).toBe(0);
    // And the replay after reset is identical to a fresh simulation.
    const fresh = new TrafficSimulation(level04);
    runFor(sim, 10);
    runFor(fresh, 10);
    expect(fingerprint(sim)).toBe(fingerprint(fresh));
    const ids = sim.vehicles.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('same inputs give the same result (reproducible)', () => {
    const play = () => {
      const sim = new TrafficSimulation(LEVELS[2]);
      for (let i = 0; i < 60 * 40 && sim.status === 'running'; i++) {
        if (i === 300) sim.toggleLight('L_W');
        if (i === 420) sim.toggleLight('L_N');
        if (i === 900) sim.yellowLight('L_N');
        if (i === 1000) sim.toggleLight('L_E');
        sim.step();
      }
      return fingerprint(sim);
    };
    expect(play()).toBe(play());
  });

  it('is independent of the rendering frame rate', () => {
    const a = new TrafficSimulation(level04);
    const b = new TrafficSimulation(level04);
    // 60 fps vs irregular 20–45 fps frames covering the same wall-clock time.
    for (let i = 0; i < 600; i++) a.advance(1 / 60);
    const frames = [0.05, 0.022, 0.033, 0.045, 0.025];
    let t = 0;
    let k = 0;
    while (t + 1e-9 < 10) {
      const d = Math.min(frames[k++ % frames.length], 10 - t);
      b.advance(d);
      t += d;
    }
    b.advance(1e-6);
    expect(Math.abs(a.tick - b.tick)).toBeLessThanOrEqual(1);
    if (a.tick === b.tick) expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe('paths', () => {
  it('turns are smooth curves, not instant direction changes', () => {
    const p = new Path([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    let maxStep = 0;
    for (let i = 1; i < p.headings.length; i++) maxStep = Math.max(maxStep, Math.abs(wrapAngle(p.headings[i] - p.headings[i - 1])));
    expect(maxStep).toBeLessThan(0.25);
    expect(p.headingAt(0)).toBeCloseTo(0);
    expect(p.headingAt(p.length)).toBeCloseTo(Math.PI / 2);
    // Curve speed limit is lower than on the straight.
    expect(p.speedLimitAt(p.length / 2)).toBeLessThan(80);
    expect(p.speedLimitAt(0)).toBeGreaterThan(p.speedLimitAt(p.length / 2));
  });

  it('every level binds a stop line to every route and all routes are reachable', () => {
    for (const level of LEVELS) {
      const sim = new TrafficSimulation(level);
      for (const r of sim.routes) expect(r.stops.length, `${level.name}/${r.id}`).toBeGreaterThan(0);
      for (const f of level.flows) for (const r of f.routes) expect(sim.routes.some((x) => x.id === r.id)).toBe(true);
      expect(sim.totalCars).toBeGreaterThanOrEqual(level.goal.carsToPass);
    }
  });
});
