import { describe, expect, it } from 'vitest';
import { DRIVING } from '../src/config/balanceConfig';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { LightState, VehicleState } from '../src/types';
import { runFor, testLevel } from './helpers';

describe('vehicle behaviour at lights', () => {
  it('stops before the stop line on RED and waits', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.RED, north: null, west: { count: 1 } }));
    const stop = sim.routes.find((r) => r.id === 'we')!.stops[0];
    let minSpeedSeen = Infinity;
    runFor(sim, 12, (s) => {
      const v = s.vehicles[0];
      if (v) {
        expect(v.front).toBeLessThanOrEqual(stop.s + 1e-6);
        minSpeedSeen = Math.min(minSpeedSeen, v.speed);
      }
    });
    const v = sim.vehicles[0];
    expect(v).toBeDefined();
    expect(v.speed).toBeLessThan(0.5);
    expect(stop.s - v.front).toBeLessThan(6);
    expect(v.state).toBe(VehicleState.WAITING);
    expect(v.waitTime).toBeGreaterThan(2);
    expect(sim.score.passed).toBe(0);
  });

  it('drives through on GREEN and reaches the exit', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.GREEN, north: null, west: { count: 1 } }));
    runFor(sim, 20);
    expect(sim.score.passed).toBe(1);
    expect(sim.status).toBe('won');
  });

  it('resumes after the light switches from RED to GREEN', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.RED, north: null, west: { count: 1 } }));
    runFor(sim, 10);
    expect(sim.vehicles[0].speed).toBeLessThan(0.5);
    sim.toggleLight('LW');
    runFor(sim, 1);
    expect(sim.vehicles[0].speed).toBeGreaterThan(5);
    runFor(sim, 15);
    expect(sim.score.passed).toBe(1);
  });

  it('accelerates smoothly (no instant speed changes)', () => {
    const sim = new TrafficSimulation(testLevel({ wLight: LightState.RED, north: null, west: { count: 1 } }));
    runFor(sim, 10);
    sim.toggleLight('LW');
    const v = sim.vehicles[0];
    let prev = v.speed;
    for (let i = 0; i < 120; i++) {
      sim.step();
      expect(v.speed - prev).toBeLessThanOrEqual(v.accel / 60 + 1e-9);
      prev = v.speed;
    }
  });

  it('YELLOW lets exactly one car through, then turns RED automatically', () => {
    const sim = new TrafficSimulation(
      testLevel({ wLight: LightState.RED, north: null, west: { count: 3, interval: [1.2, 1.2] }, goal: 3 }),
    );
    runFor(sim, 14); // queue of three builds up
    expect(sim.vehicles.length).toBe(3);
    sim.yellowLight('LW');
    runFor(sim, 20);
    expect(sim.lights.get('LW')!.state).toBe(LightState.RED);
    expect(sim.score.passed).toBe(1);
    expect(sim.vehicles.length).toBe(2);
    for (const v of sim.vehicles) expect(v.speed).toBeLessThan(0.5);
  });

  it('keeps a safe distance to the car in front', () => {
    const sim = new TrafficSimulation(
      testLevel({ wLight: LightState.RED, north: null, west: { count: 4, interval: [0.9, 0.9] }, goal: 4 }),
    );
    let minGap = Infinity;
    runFor(sim, 16, (s) => {
      for (const v of s.vehicles) if (v.leaderGap < minGap) minGap = v.leaderGap;
    });
    expect(sim.vehicles.length).toBe(4);
    expect(minGap).toBeGreaterThan(DRIVING.minGap * 0.6);
    // Queue is ordered and nobody overlaps.
    const sorted = [...sim.vehicles].sort((a, b) => b.s - a.s);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].rear - sorted[i].front).toBeGreaterThan(DRIVING.minGap * 0.6);
    }
    expect(sim.status).toBe('running');
  });
});
