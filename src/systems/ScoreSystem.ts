import { SCORE } from '../config/balanceConfig';
import type { GameOutcome, LevelResult, StarCheck, StarCriteria } from '../types';

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
  emergencyWaitSeconds = 0;
  private exitPoints = 0;

  reset(): void {
    this.passed = 0;
    this.crashes = 0;
    this.totalExitWait = 0;
    this.maxWaitSeen = 0;
    this.penalties = 0;
    this.longWaitSeconds = 0;
    this.queueSeconds = 0;
    this.emergencyWaitSeconds = 0;
    this.exitPoints = 0;
  }

  /** A vehicle reached an exit; `points` depends on its kind (buses and emergencies are worth more). */
  onVehicleExit(waitTime: number, points: number = SCORE.perCar): void {
    this.passed++;
    this.exitPoints += points;
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

  /** An emergency vehicle stood still for `dt` more seconds. */
  addEmergencyWait(dt: number): void {
    this.emergencyWaitSeconds += dt;
    this.penalties += SCORE.emergencyWaitPenaltyPerSecond * dt;
  }

  get avgWait(): number {
    return this.passed > 0 ? this.totalExitWait / this.passed : 0;
  }

  get maxWait(): number {
    return this.maxWaitSeen;
  }

  /** Score shown live during play. */
  get liveScore(): number {
    return Math.max(0, Math.round(this.exitPoints - this.penalties - this.crashes * SCORE.crashPenalty));
  }

  snapshot(): ScoreSnapshot {
    return { score: this.liveScore, passed: this.passed, crashes: this.crashes, avgWait: this.avgWait, maxWait: this.maxWait };
  }

  /** `bonus` is added on a win (e.g. unspent build budget). */
  finalScore(outcome: GameOutcome, time: number, criteria: StarCriteria, bonus = 0): number {
    let score = this.exitPoints - this.penalties - this.crashes * SCORE.crashPenalty;
    if (outcome === 'win') {
      score += bonus;
      score += Math.max(0, criteria.parTime - time) * SCORE.timeBonusPerSecond;
      score += Math.max(0, criteria.avgWait - this.avgWait) * SCORE.waitBonusPerSecond;
      if (this.crashes === 0) score += SCORE.noCrashBonus;
    }
    return Math.max(0, Math.round(score));
  }

  starBreakdown(outcome: GameOutcome, time: number, score: number, c: StarCriteria): StarCheck[] {
    const win = outcome === 'win';
    return [
      { id: 'complete', value: 0, earned: win },
      { id: 'par', value: Math.round(c.parTime), earned: win && time <= c.parTime },
      { id: 'avgWait', value: c.avgWait, earned: win && this.avgWait <= c.avgWait },
      { id: 'maxWait', value: Math.round(c.maxWait), earned: win && this.maxWait <= c.maxWait },
      { id: 'score', value: c.score, earned: win && score >= c.score },
    ];
  }

  buildResult(levelId: number, outcome: GameOutcome, time: number, totalCars: number, criteria: StarCriteria, bonus = 0): LevelResult {
    const score = this.finalScore(outcome, time, criteria, bonus);
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
