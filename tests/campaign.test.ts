import { describe, expect, it } from 'vitest';
import { BuildManager } from '../src/building/BuildManager';
import { validateNetwork } from '../src/editor/LevelValidator';
import { recompileLevel } from '../src/graph/NetworkCompiler';
import { CAMPAIGN } from '../src/levels/campaign/levels';
import { AutoPilot } from '../src/systems/AutoPilot';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import type { LevelDef } from '../src/types';

function play(level: LevelDef, stats = { spent: 0, builds: 0 }): TrafficSimulation {
  const sim = new TrafficSimulation(level);
  sim.buildStats = stats;
  const pilot = new AutoPilot(sim);
  for (let i = 0; i < 400 * 60 && sim.status === 'running'; i++) {
    pilot.update(1 / 60);
    sim.step();
  }
  return sim;
}

describe('campaign 2.0: every level needs an infrastructure decision', () => {
  it('has ten levels with distinct mechanics (tools / objectives)', () => {
    expect(CAMPAIGN.length).toBe(10);
    const signatures = new Set(CAMPAIGN.map((c) => `${c.level.rules?.allowed?.join('+')}|${c.level.objectives!.map((o) => o.type).join('+')}`));
    expect(signatures.size).toBeGreaterThanOrEqual(7);
  });

  for (const c of CAMPAIGN) {
    it(`${c.level.id} ${c.level.name}: doing nothing fails, the reference solution wins`, () => {
      const L = c.level;
      const start = validateNetwork(L.network!, L.world, L.budget);
      if (start.ok) {
        const idle = play(L);
        expect(idle.outcome, 'idle outcome').not.toBe('win');
      } else {
        expect(start.issues.some((i) => i.key === 'val.spawnNoRoute' || i.key === 'val.exitNoRoute')).toBe(true);
      }
      const m = new BuildManager(L.network!, L.budget!, L.rules ?? {}, L.world);
      c.solve(m);
      expect(m.budget.spent).toBeLessThanOrEqual(L.budget!);
      const solved = recompileLevel(L, m.net.data);
      expect(validateNetwork(solved.network!, solved.world, solved.budget).ok).toBe(true);
      const sim = play(solved, { spent: m.budget.spent, builds: m.builds });
      expect(sim.outcome, JSON.stringify(sim.result?.objectives)).toBe('win');
      expect(sim.result!.crashes).toBe(0);
      expect(sim.result!.objectives!.every((o) => o.status === 'done')).toBe(true);
    }, 60000);
  }
});
