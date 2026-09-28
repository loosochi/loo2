/** Construction budget. `Infinity` = unlimited (level editor). */
export class BudgetSystem {
  spent = 0;

  constructor(readonly initial: number) {}

  get unlimited(): boolean {
    return !Number.isFinite(this.initial);
  }

  get remaining(): number {
    return this.initial - this.spent;
  }

  canAfford(cost: number): boolean {
    return cost <= 0 || this.unlimited || cost <= this.remaining + 1e-9;
  }

  /** Charge `cost`; returns false (and charges nothing) when it is not affordable. */
  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.spent += Math.max(0, cost);
    return true;
  }
}
