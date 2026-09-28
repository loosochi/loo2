import { LightState, type Dir } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 800, height: 700 };
const X = 400;
const Y = 350;
const I = crossing('C', X, Y, ['N', 'S', 'E', 'W'], { h: 2, v: 1 });

const av = (dir: Dir, lane = 0): Leg => ({ dir, road: Y, lane, lanes: 2 });
const st = (dir: Dir): Leg => ({ dir, road: X });

/** Level 8 — Sirens: emergency vehicles need a clear path; every second they wait costs points. */
export const level08 = defineLevel({
  id: 8,
  key: 'sirens',
  name: 'Sirens',
  description: 'Ambulances, police and fire engines are on call. Give them a green wave.',
  ru: {
    name: 'Сирены',
    description: 'На вызовах скорая, полиция и пожарные. Дайте им зелёную волну.',
    hint: 'Спецтранспорт появляется с мигалками. Каждая секунда его ожидания — штраф.',
  },
  hint: 'Emergency vehicles arrive with flashing lights. Every second they wait is a penalty.',
  world,
  seed: 8808,
  roads: [hRoad('avenue', Y, { lanes: 2 }), vRoad('street', X)],
  intersections: [I],
  lights: [
    light('L_W', I, 'E', LightState.GREEN),
    light('L_E', I, 'W', LightState.GREEN),
    light('L_N', I, 'S', LightState.RED),
    light('L_S', I, 'N', LightState.RED),
  ],
  routes: [
    route('we0', 'W', 'E', [av('E', 0)], world),
    route('we1', 'W', 'E', [av('E', 1)], world),
    route('ws', 'W', 'S', [av('E', 0), st('S')], world),
    route('ew0', 'E', 'W', [av('W', 0)], world),
    route('ew1', 'E', 'W', [av('W', 1)], world),
    route('en', 'E', 'N', [av('W', 0), st('N')], world),
    route('ns', 'N', 'S', [st('S')], world),
    route('nw', 'N', 'W', [st('S'), av('W', 0)], world),
    route('ne', 'N', 'E', [st('S'), av('E', 1)], world),
    route('sn', 'S', 'N', [st('N')], world),
    route('se', 'S', 'E', [st('N'), av('E', 0)], world),
    route('sw', 'S', 'W', [st('N'), av('W', 1)], world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'we0', weight: 3 }, { id: 'we1', weight: 3 }, { id: 'ws', weight: 1 }], count: 10, startDelay: 0.4, interval: [1.5, 2.6], mix: { bus: 1 } },
    { spawnId: 'E', routes: [{ id: 'ew0', weight: 3 }, { id: 'ew1', weight: 3 }, { id: 'en', weight: 1 }], count: 10, startDelay: 1.0, interval: [1.5, 2.6], mix: { bus: 1 } },
    { spawnId: 'N', routes: [{ id: 'ns', weight: 2 }, { id: 'nw', weight: 1 }, { id: 'ne', weight: 1 }], count: 6, startDelay: 1.5, interval: [2.6, 3.8] },
    { spawnId: 'S', routes: [{ id: 'sn', weight: 2 }, { id: 'se', weight: 1 }, { id: 'sw', weight: 1 }], count: 6, startDelay: 2.2, interval: [2.6, 3.8] },
  ],
  specials: [
    { at: 10, spawnId: 'N', routeId: 'ns', kind: 'ambulance' },
    { at: 24, spawnId: 'W', routeId: 'we1', kind: 'police' },
    { at: 38, spawnId: 'S', routeId: 'sn', kind: 'fire' },
    { at: 52, spawnId: 'E', routeId: 'ew1', kind: 'ambulance' },
  ],
  goal: { carsToPass: 36, timeLimit: 150 },
  stars: { parTime: 58, avgWait: 5, maxWait: 16, score: 5600 },
});
