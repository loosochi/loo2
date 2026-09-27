import { describe, expect, it } from 'vitest';
import { SCORE } from '../src/config/balanceConfig';
import { ScoreSystem } from '../src/systems/ScoreSystem';

const criteria = { parTime: 60, avgWait: 3, maxWait: 10, score: 1000 };

describe('ScoreSystem', () => {
  it('awards points for every car that exits', () => {
    const s = new ScoreSystem();
    s.onVehicleExit(1);
    s.onVehicleExit(3);
    expect(s.passed).toBe(2);
    expect(s.liveScore).toBe(2 * SCORE.perCar);
    expect(s.avgWait).toBe(2);
    expect(s.maxWait).toBe(3);
  });

  it('applies long-wait and queue penalties', () => {
    const s = new ScoreSystem();
    for (let i = 0; i < 5; i++) s.onVehicleExit(0);
    s.addLongWait(10);
    s.addQueueBlocked(5);
    expect(s.liveScore).toBe(Math.round(5 * SCORE.perCar - 10 * SCORE.longWaitPenaltyPerSecond - 5 * SCORE.queuePenaltyPerSecond));
  });

  it('adds time, wait and no-crash bonuses on a win', () => {
    const s = new ScoreSystem();
    for (let i = 0; i < 10; i++) s.onVehicleExit(1);
    const final = s.finalScore('win', 40, criteria);
    const expected = 10 * SCORE.perCar + 20 * SCORE.timeBonusPerSecond + 2 * SCORE.waitBonusPerSecond + SCORE.noCrashBonus;
    expect(final).toBe(Math.round(expected));
  });

  it('penalises crashes and never goes negative', () => {
    const s = new ScoreSystem();
    s.onVehicleExit(0);
    s.onCrash();
    expect(s.finalScore('crash', 10, criteria)).toBe(0);
  });

  it('computes 0–5 stars from objective criteria', () => {
    const perfect = new ScoreSystem();
    for (let i = 0; i < 10; i++) perfect.onVehicleExit(1);
    const r = perfect.buildResult(1, 'win', 30, 10, criteria);
    expect(r.stars).toBe(5);
    expect(r.starBreakdown.every((b) => b.earned)).toBe(true);

    const slow = new ScoreSystem();
    for (let i = 0; i < 3; i++) slow.onVehicleExit(12);
    const r2 = slow.buildResult(1, 'win', 120, 3, criteria);
    expect(r2.stars).toBe(1); // only "level complete"

    const lost = new ScoreSystem();
    lost.onCrash();
    expect(lost.buildResult(1, 'crash', 5, 3, criteria).stars).toBe(0);
  });
});
