import { SCORE } from '../config/balanceConfig';
import type { GameOutcome, LevelResult, StarCriteria } from '../types';

export interface ScoreSnapshot {
  score: number;
  passed: number;
  crashes: number;
  avgWait: number;
  maxWait: number;
}

/**
 * Scoring rules (values in balanceConfig.SCORE):
 *  + per car that reaches an exit
 *  + time bonus for finishing under par, wait bonus for a low average wait, no-crash bonus
 *  − crash penalty, long-wait penalty (per car-second over threshold), queue penalty (blocked spawn)
 *
 * Stars (max 5, only on a win): 1 for finishing, +1 under par time, +1 low average wait,
 * +1 nobody waited too long, +1 score threshold reached.
 */
export class ScoreSystem {
  passed = 0;
  crashes = 0;
  private totalExitWait = 0;
  private maxWaitSeen = 0;
  private penalties = 0;
  longWaitSeconds = 0;
  queueSeconds = 0;

  reset(): void {
    this.passed = 0;
    this.crashes = 0;
    this.totalExitWait = 0;
    this.maxWaitSeen = 0;
    this.penalties = 0;
    this.longWaitSeconds = 0;
    this.queueSeconds = 0;
  }

  onVehicleExit(waitTime: number): void {
    this.passed++;
    this.totalExitWait += waitTime;
    this.trackWait(waitTime);
  }

  trackWait(waitTime: number): void {
    if (waitTime > this.maxWaitSeen) this.maxWaitSeen = waitTime;
  }

  onCrash(): void {
    this.crashes++;
  }

  /** A car has been waiting longer than the threshold for `dt` more seconds. */
  addLongWait(dt: number): void {
    this.longWaitSeconds += dt;
    this.penalties += SCORE.longWaitPenaltyPerSecond * dt;
  }

  /** A spawn point was blocked by a queue for `dt` seconds. */
  addQueueBlocked(dt: number): void {
    this.queueSeconds += dt;
    this.penalties += SCORE.queuePenaltyPerSecond * dt;
  }

  get avgWait(): number {
    return this.passed > 0 ? this.totalExitWait / this.passed : 0;
  }

  get maxWait(): number {
    return this.maxWaitSeen;
  }

  /** Score shown live during play. */
  get liveScore(): number {
    return Math.max(0, Math.round(this.passed * SCORE.perCar - this.penalties - this.crashes * SCORE.crashPenalty));
  }

  snapshot(): ScoreSnapshot {
    return { score: this.liveScore, passed: this.passed, crashes: this.crashes, avgWait: this.avgWait, maxWait: this.maxWait };
  }

  finalScore(outcome: GameOutcome, time: number, criteria: StarCriteria): number {
    let score = this.passed * SCORE.perCar - this.penalties - this.crashes * SCORE.crashPenalty;
    if (outcome === 'win') {
      score += Math.max(0, criteria.parTime - time) * SCORE.timeBonusPerSecond;
      score += Math.max(0, criteria.avgWait - this.avgWait) * SCORE.waitBonusPerSecond;
      if (this.crashes === 0) score += SCORE.noCrashBonus;
    }
    return Math.max(0, Math.round(score));
  }

  starBreakdown(outcome: GameOutcome, time: number, score: number, c: StarCriteria): { label: string; earned: boolean }[] {
    const win = outcome === 'win';
    return [
      { label: 'Level complete', earned: win },
      { label: `Finish under ${Math.round(c.parTime)}s`, earned: win && time <= c.parTime },
      { label: `Avg wait ≤ ${c.avgWait.toFixed(1)}s`, earned: win && this.avgWait <= c.avgWait },
      { label: `No car waits > ${Math.round(c.maxWait)}s`, earned: win && this.maxWait <= c.maxWait },
      { label: `Score ≥ ${c.score}`, earned: win && score >= c.score },
    ];
  }

  buildResult(levelId: number, outcome: GameOutcome, time: number, totalCars: number, criteria: StarCriteria): LevelResult {
    const score = this.finalScore(outcome, time, criteria);
    const starBreakdown = this.starBreakdown(outcome, time, score, criteria);
    return {
      levelId,
      outcome,
      score,
      stars: starBreakdown.filter((s) => s.earned).length,
      passed: this.passed,
      totalCars,
      time,
      avgWait: this.avgWait,
      maxWait: this.maxWait,
      crashes: this.crashes,
      starBreakdown,
    };
  }
}
