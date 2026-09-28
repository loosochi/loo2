import type { TutorialStep } from '../types';
import type { TrafficSimulation } from './TrafficSimulation';

/**
 * Drives a scripted tutorial: shows one step at a time and advances when the step's
 * condition is met (a tap, a light reaching a state, cars passing, or time).
 */
export class TutorialController {
  private index = 0;
  private stepTime = 0;
  private passedAtStart = 0;
  /** Light states seen since the current step started ("id:STATE"). */
  private readonly seen = new Set<string>();

  constructor(
    readonly steps: readonly TutorialStep[],
    private readonly sim: TrafficSimulation,
  ) {
    sim.lights.onChange((c) => this.seen.add(`${c.id}:${c.state}`));
    this.begin();
  }

  get current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  get stepNumber(): number {
    return this.index + 1;
  }

  get done(): boolean {
    return this.index >= this.steps.length;
  }

  /** Traffic is frozen while a "read this" step is shown. */
  get frozen(): boolean {
    return this.current?.freeze === true;
  }

  private begin(): void {
    this.stepTime = 0;
    this.passedAtStart = this.sim.score.passed;
    this.seen.clear();
  }

  private next(): void {
    this.index++;
    this.begin();
  }

  /** The player tapped the tutorial panel. */
  tap(): void {
    if (this.current?.wait.type === 'tap') this.next();
  }

  /** Call every frame with real elapsed seconds. Returns true when the step changed. */
  update(dt: number): boolean {
    const step = this.current;
    if (!step) return false;
    this.stepTime += dt;
    const w = step.wait;
    let met = false;
    switch (w.type) {
      case 'tap':
        break;
      case 'light': {
        const l = this.sim.lights.get(w.id);
        met = l?.state === w.state || this.seen.has(`${w.id}:${w.state}`);
        break;
      }
      case 'passed':
        met = this.sim.score.passed - this.passedAtStart >= w.count;
        break;
      case 'time':
        met = this.stepTime >= w.seconds;
        break;
    }
    if (met) this.next();
    return met;
  }
}
