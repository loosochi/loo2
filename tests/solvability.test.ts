import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/levelRegistry';
import { AutoPilot } from '../src/systems/AutoPilot';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';

describe('every level is winnable', () => {
  for (const level of LEVELS) {
    it(`level ${level.id} "${level.name}" can be won by an adaptive controller`, () => {
      const sim = new TrafficSimulation(level);
      const pilot = new AutoPilot(sim);
      const limit = (level.goal.timeLimit ?? 400) * 60;
      for (let i = 0; i < limit && sim.status === 'running'; i++) {
        pilot.update(1 / 60);
        sim.step();
      }
      console.log(level.name, sim.outcome, sim.time.toFixed(1), sim.result?.score, sim.result?.stars, 'avgW', sim.result?.avgWait.toFixed(2), 'maxW', sim.result?.maxWait.toFixed(1), 'phases', JSON.stringify(pilot.phases));
      expect(sim.outcome).toBe('win');
      expect(sim.result?.crashes).toBe(0);
    });
  }
});
