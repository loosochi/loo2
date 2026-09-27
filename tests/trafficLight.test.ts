import { describe, expect, it } from 'vitest';
import { TrafficLight } from '../src/entities/TrafficLight';
import { TrafficLightSystem } from '../src/systems/TrafficLightSystem';
import { LightState, type LightDef } from '../src/types';

const def: LightDef = { id: 'L', stop: { x: 0, y: 0 }, dir: 'E', width: 28, head: { x: 0, y: 0 }, initial: LightState.RED };

describe('TrafficLight', () => {
  it('starts in its initial state', () => {
    expect(new TrafficLight(def).state).toBe(LightState.RED);
    expect(new TrafficLight({ ...def, initial: LightState.GREEN }).state).toBe(LightState.GREEN);
  });

  it('tap toggles RED ⇄ GREEN and YELLOW → GREEN', () => {
    const l = new TrafficLight(def);
    expect(l.toggle(1)).toBe(LightState.GREEN);
    expect(l.toggle(2)).toBe(LightState.RED);
    l.setYellow(3);
    expect(l.state).toBe(LightState.YELLOW);
    expect(l.toggle(4)).toBe(LightState.GREEN);
    expect(l.switches).toBe(4);
  });

  it('yellow grants exactly one pass and then returns to red automatically', () => {
    const l = new TrafficLight(def);
    l.setYellow(0);
    expect(l.reserve(7)).toBe(true);
    expect(l.canReserve(8)).toBe(false); // second car must stop
    expect(l.notifyPassed(8, 1)).toBe(false); // someone else crossing doesn't consume the pass
    expect(l.notifyPassed(7, 1)).toBe(true);
    expect(l.state).toBe(LightState.RED);
    expect(l.reservedBy).toBeNull();
  });

  it('crossings on green or red do not change the light', () => {
    const l = new TrafficLight({ ...def, initial: LightState.GREEN });
    expect(l.notifyPassed(1, 0)).toBe(false);
    expect(l.state).toBe(LightState.GREEN);
  });

  it('reset restores the initial state', () => {
    const l = new TrafficLight(def);
    l.toggle(1);
    l.reset();
    expect(l.state).toBe(LightState.RED);
    expect(l.switches).toBe(0);
  });

  it('system emits change events with their cause', () => {
    const sys = new TrafficLightSystem([def]);
    const events: string[] = [];
    sys.onChange((c) => events.push(`${c.id}:${c.state}:${c.cause}`));
    sys.toggle('L', 0);
    sys.setYellow('L', 1);
    sys.vehiclePassed(sys.get('L')!, 3, 2);
    expect(events).toEqual(['L:GREEN:player', 'L:YELLOW:player', 'L:RED:auto']);
  });
});
