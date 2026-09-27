/**
 * Wall-clock frame timer. Phaser smooths/clamps its frame delta (e.g. while the tab is not
 * focused), which would slow the simulation down on low frame rates; this measures real time.
 */
export class FrameClock {
  private last = -1;

  constructor(private readonly maxMs = 100) {}

  /** Milliseconds since the previous call (clamped), 0 on the first call. */
  tick(): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const d = this.last < 0 ? 0 : now - this.last;
    this.last = now;
    return Math.max(0, Math.min(this.maxMs, d));
  }

  reset(): void {
    this.last = -1;
  }
}
