import { LightState, type Dir } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 700, height: 700 };
const X = 350;
const Y = 350;
const I = crossing('C1', X, Y);

const h = (dir: Dir): Leg => ({ dir, road: Y });
const v = (dir: Dir): Leg => ({ dir, road: X });

/** Level 3 — City Traffic: a full four-way junction with left and right turns. */
export const level03 = defineLevel({
  id: 3,
  key: 'city-traffic',
  name: 'City Traffic',
  description: 'Four directions, turning cars and plenty of conflicts.',
  world,
  seed: 3303,
  roads: [hRoad('ew', Y), vRoad('ns', X)],
  intersections: [I],
  lights: [
    light('L_W', I, 'E', LightState.GREEN),
    light('L_E', I, 'W', LightState.RED),
    light('L_N', I, 'S', LightState.RED),
    light('L_S', I, 'N', LightState.RED),
  ],
  routes: [
    route('we', 'W', 'E', [h('E')], world),
    route('ws', 'W', 'S', [h('E'), v('S')], world),
    route('wn', 'W', 'N', [h('E'), v('N')], world),
    route('ew', 'E', 'W', [h('W')], world),
    route('en', 'E', 'N', [h('W'), v('N')], world),
    route('es', 'E', 'S', [h('W'), v('S')], world),
    route('ns', 'N', 'S', [v('S')], world),
    route('nw', 'N', 'W', [v('S'), h('W')], world),
    route('ne', 'N', 'E', [v('S'), h('E')], world),
    route('sn', 'S', 'N', [v('N')], world),
    route('se', 'S', 'E', [v('N'), h('E')], world),
    route('sw', 'S', 'W', [v('N'), h('W')], world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'we', weight: 3 }, { id: 'ws', weight: 1 }, { id: 'wn', weight: 1 }], count: 7, startDelay: 0.4, interval: [2.2, 3.4] },
    { spawnId: 'E', routes: [{ id: 'ew', weight: 3 }, { id: 'en', weight: 1 }, { id: 'es', weight: 1 }], count: 7, startDelay: 1.3, interval: [2.2, 3.4] },
    { spawnId: 'N', routes: [{ id: 'ns', weight: 3 }, { id: 'nw', weight: 1 }, { id: 'ne', weight: 1 }], count: 7, startDelay: 0.9, interval: [2.4, 3.6] },
    { spawnId: 'S', routes: [{ id: 'sn', weight: 3 }, { id: 'se', weight: 1 }, { id: 'sw', weight: 1 }], count: 7, startDelay: 2.0, interval: [2.4, 3.6] },
  ],
  goal: { carsToPass: 28 },
  stars: { parTime: 60, avgWait: 6, maxWait: 16, score: 3500 },
  hint: 'Watch the left-turners: they cut across oncoming traffic.',
  ru: {
    name: 'Городской трафик',
    description: 'Четыре направления, повороты и множество конфликтов.',
    hint: 'Следите за левым поворотом: он пересекает встречный поток.',
  },
});
