import { LightState, type LightDef } from '../types';

/**
 * Traffic light state machine.
 *
 *  - RED:    cars stop at the stop line.
 *  - GREEN:  the whole flow may pass; stays green until the player acts.
 *  - YELLOW: exactly one car may pass, then the light returns to RED automatically.
 *
 * Player controls: tap toggles RED ⇄ GREEN (YELLOW → GREEN), hold sets YELLOW.
 */
export class TrafficLight {
  readonly id: string;
  readonly def: LightDef;
  state: LightState;
  /** Vehicle currently holding the single yellow pass. */
  reservedBy: number | null = null;
  /** Simulation time of last change (for animations). */
  changedAt = 0;
  /** Number of switches made (stats). */
  switches = 0;

  private readonly initial: LightState;

  constructor(def: LightDef) {
    this.id = def.id;
    this.def = def;
    this.initial = def.initial ?? LightState.RED;
    this.state = this.initial;
  }

  reset(): void {
    this.state = this.initial;
    this.reservedBy = null;
    this.changedAt = 0;
    this.switches = 0;
  }

  setState(next: LightState, time: number): boolean {
    if (next === this.state) return false;
    this.state = next;
    this.reservedBy = null;
    this.changedAt = time;
    this.switches++;
    return true;
  }

  /** Tap action. Returns the new state. */
  toggle(time: number): LightState {
    this.setState(this.state === LightState.GREEN ? LightState.RED : LightState.GREEN, time);
    return this.state;
  }

  /** Hold action: let exactly one more car through. */
  setYellow(time: number): LightState {
    this.setState(LightState.YELLOW, time);
    return this.state;
  }

  /** Can this vehicle claim the single yellow pass? */
  canReserve(vehicleId: number): boolean {
    return this.state === LightState.YELLOW && (this.reservedBy === null || this.reservedBy === vehicleId);
  }

  reserve(vehicleId: number): boolean {
    if (!this.canReserve(vehicleId)) return false;
    this.reservedBy = vehicleId;
    return true;
  }

  /**
   * Called when a vehicle's front crosses this light's stop line.
   * On YELLOW the pass is consumed and the light turns RED. Returns true if the light changed.
   */
  notifyPassed(vehicleId: number, time: number): boolean {
    if (this.state !== LightState.YELLOW) return false;
    if (this.reservedBy !== null && this.reservedBy !== vehicleId) return false;
    return this.setState(LightState.RED, time);
  }
}
