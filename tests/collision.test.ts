import { describe, expect, it } from 'vitest';
import { VEHICLE_SPECS } from '../src/config/balanceConfig';
import { Vehicle } from '../src/entities/Vehicle';
import { level03 } from '../src/levels/level03';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { LightState } from '../src/types';
import { obbOverlap } from '../src/utils/geometry';
import { runFor, testLevel } from './helpers';

describe('oriented bounding box collision', () => {
  const car = (x: number, y: number, angle: number) => ({ x, y, angle, halfL: 11, halfW: 6 });

  it('detects overlap and separation on straight roads', () => {
    expect(obbOverlap(car(0, 0, 0), car(20, 0, 0))).toBe(true);
    expect(obbOverlap(car(0, 0, 0), car(23, 0, 0))).toBe(false);
    expect(obbOverlap(car(0, 0, 0), car(0, 13, 0))).toBe(false);
  });

  it('handles rotated cars (turns)', () => {
    // Perpendicular: side of one against the nose of the other.
    expect(obbOverlap(car(0, 0, 0), car(0, 15, Math.PI / 2))).toBe(true);
    expect(obbOverlap(car(0, 0, 0), car(0, 18, Math.PI / 2))).toBe(false);
    // Diagonal near-miss that an axis-aligned box test would report as a hit.
    expect(obbOverlap(car(0, 0, Math.PI / 4), car(14, -14, Math.PI / 4))).toBe(false);
    expect(obbOverlap(car(0, 0, Math.PI / 4), car(8, 8, Math.PI / 4))).toBe(true);
  });
});

describe('conflict zones and crashes', () => {
  it('builds a conflict zone where two routes cross', () => {
    const sim = new TrafficSimulation(testLevel({}));
    expect(sim.collisions.zones.length).toBe(1);
    const z = sim.collisions.zones[0];
    expect(z.routes.has('we') && z.routes.has('ns')).toBe(true);
    // W→E lane (y = 314) crosses the N→S lane (x = 286).
    expect(Math.hypot(z.x - 286, z.y - 314)).toBeLessThan(6);
    expect(sim.collisions.routesConflict(z, 'we', 'ns')).toBe(true);
  });

  it('registers a crash and stops the simulation when both conflicting lights are green', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.GREEN, nLight: LightState.GREEN }));
    let crashed = false;
    sim.on({ crash: () => (crashed = true) });
    runFor(sim, 30);
    expect(crashed).toBe(true);
    expect(sim.status).toBe('lost');
    expect(sim.outcome).toBe('crash');
    expect(sim.result?.crashes).toBe(1);
    expect(sim.result?.stars).toBe(0);
    const t = sim.time;
    sim.step();
    expect(sim.time).toBe(t); // frozen after the crash
  });

  it('no crash when the player alternates the lights', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.GREEN, nLight: LightState.RED }));
    // Alternate phases with an all-red clearance in between.
    for (let cycle = 0; cycle < 6 && sim.status === 'running'; cycle++) {
      runFor(sim, 5);
      sim.toggleLight(cycle % 2 === 0 ? 'LW' : 'LN');
      runFor(sim, 2);
      sim.toggleLight(cycle % 2 === 0 ? 'LN' : 'LW');
    }
    runFor(sim, 20);
    expect(sim.result?.crashes ?? 0).toBe(0);
    expect(sim.outcome).toBe('win');
  });

  it('detects crashes involving a turning car (inside the curve)', () => {
    const sim = new TrafficSimulation(testLevel({ withTurns: true }));
    const sw = sim.routes.find((r) => r.id === 'sw')!;
    const we = sim.routes.find((r) => r.id === 'we')!;
    // Middle of the left-turn curve: heading is diagonal there.
    let sCurve = 0;
    for (let s = 0; s < sw.path.length; s += 1) if (sw.path.curvatureAt(s) > sw.path.curvatureAt(sCurve)) sCurve = s;
    const spec = VEHICLE_SPECS[1];
    const turning = new Vehicle({ id: 1, spec, maxSpeed: 80, color: 0xff0000, route: sw, speed: 30 });
    turning.s = sCurve;
    turning.syncPose();
    expect(Math.abs(Math.sin(turning.angle * 2))).toBeGreaterThan(0.5); // clearly rotated
    const hit = new Vehicle({ id: 2, spec, maxSpeed: 80, color: 0x00ff00, route: sw, speed: 30 });
    hit.s = sCurve + spec.length * 0.6;
    hit.syncPose();
    expect(sim.collisions.detectCrash([turning, hit])).not.toBeNull();
    // A car on the parallel eastbound lane far from the curve is not a crash.
    const other = new Vehicle({ id: 3, spec, maxSpeed: 80, color: 0x0000ff, route: we, speed: 30 });
    other.s = 60;
    other.syncPose();
    expect(sim.collisions.detectCrash([turning, other])).toBeNull();
  });

  it('crash happens in the simulation when a left turn meets straight traffic on green', () => {
    const base = testLevel({ withTurns: true, north: null, west: { count: 4, interval: [1.5, 1.5] }, goal: 99 });
    const sim = new TrafficSimulation({
      ...base,
      flows: [...base.flows, { spawnId: 'S', routes: [{ id: 'sw', weight: 1 }], count: 4, startDelay: 0.3, interval: [1.5, 1.5] }],
    });
    runFor(sim, 30);
    expect(sim.outcome).toBe('crash');
    expect([sim.crash!.a.route.id, sim.crash!.b.route.id].sort()).toEqual(['sw', 'we']);
  });

  it('a car waiting at the line does not launch into an occupied conflict zone', () => {
    const sim = new TrafficSimulation(
      testLevel({ wLight: LightState.RED, nLight: LightState.GREEN, west: { count: 1 }, north: { count: 1, startDelay: 6 }, goal: 2 }),
    );
    const zone = sim.collisions.zones[0];
    // W car queues at the red light; the N car later drives into the junction on green.
    runFor(sim, 30, (s) => {
      const n = s.vehicles.find((v) => v.route.id === 'ns');
      if (n && zone.vehicles.has(n.id) && s.lights.get('LW')!.state === LightState.RED) s.toggleLight('LW');
      const w = s.vehicles.find((v) => v.route.id === 'we');
      if (w && n && zone.vehicles.has(n.id)) expect(w.front).toBeLessThan(w.route.stops[0].s + 0.5);
    });
    expect(sim.lights.get('LW')!.state).toBe(LightState.GREEN);
    expect(sim.result?.crashes ?? 0).toBe(0);
    expect(sim.outcome).toBe('win');
  });

  it('level 3 has conflict zones for its crossing and merging routes', () => {
    const sim = new TrafficSimulation(level03);
    expect(sim.collisions.zones.length).toBeGreaterThan(6);
    for (const z of sim.collisions.zones) expect(z.conflicts.size).toBeGreaterThan(0);
  });
});
