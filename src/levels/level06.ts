import { LightState, type Dir } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 820, height: 640 };
const X = 410;
const Y = 320;
const I = crossing('C', X, Y, ['N', 'S', 'E', 'W'], { h: 2, v: 1 });

/** Avenue leg (2 lanes per direction); lane 0 = curb, 1 = inner. */
const av = (dir: Dir, lane = 0): Leg => ({ dir, road: Y, lane, lanes: 2 });
const st = (dir: Dir): Leg => ({ dir, road: X });

/** Level 6 — Two-Lane Avenue: a wide avenue with buses crossing a narrow street. */
export const level06 = defineLevel({
  id: 6,
  key: 'two-lane-avenue',
  name: 'Two-Lane Avenue',
  description: 'Two lanes each way and city buses. Left turns go from the inner lane.',
  ru: {
    name: 'Широкий проспект',
    description: 'По две полосы в каждую сторону и автобусы. Налево — из левой полосы.',
    hint: 'Автобусы длинные и медленно разгоняются — дайте им время освободить перекрёсток.',
  },
  hint: 'Buses are long and slow to pick up speed — give them time to clear the junction.',
  world,
  seed: 6606,
  roads: [hRoad('avenue', Y, { lanes: 2 }), vRoad('street', X)],
  intersections: [I],
  lights: [
    light('L_W', I, 'E', LightState.GREEN),
    light('L_E', I, 'W', LightState.RED),
    light('L_N', I, 'S', LightState.RED),
    light('L_S', I, 'N', LightState.RED),
  ],
  routes: [
    route('we0', 'W', 'E', [av('E', 0)], world),
    route('we1', 'W', 'E', [av('E', 1)], world),
    route('ws', 'W', 'S', [av('E', 0), st('S')], world),
    route('wn', 'W', 'N', [av('E', 1), st('N')], world),
    route('ew0', 'E', 'W', [av('W', 0)], world),
    route('ew1', 'E', 'W', [av('W', 1)], world),
    route('en', 'E', 'N', [av('W', 0), st('N')], world),
    route('es', 'E', 'S', [av('W', 1), st('S')], world),
    route('ns', 'N', 'S', [st('S')], world),
    route('nw', 'N', 'W', [st('S'), av('W', 0)], world),
    route('ne', 'N', 'E', [st('S'), av('E', 1)], world),
    route('sn', 'S', 'N', [st('N')], world),
    route('se', 'S', 'E', [st('N'), av('E', 0)], world),
    route('sw', 'S', 'W', [st('N'), av('W', 1)], world),
  ],
  flows: [
    {
      spawnId: 'W',
      routes: [{ id: 'we0', weight: 3 }, { id: 'we1', weight: 3 }, { id: 'ws', weight: 1 }, { id: 'wn', weight: 1 }],
      count: 11,
      startDelay: 0.3,
      interval: [1.4, 2.4],
      mix: { bus: 1.6 },
    },
    {
      spawnId: 'E',
      routes: [{ id: 'ew0', weight: 3 }, { id: 'ew1', weight: 3 }, { id: 'en', weight: 1 }, { id: 'es', weight: 1 }],
      count: 11,
      startDelay: 1.0,
      interval: [1.4, 2.4],
      mix: { bus: 1.6 },
    },
    { spawnId: 'N', routes: [{ id: 'ns', weight: 2 }, { id: 'nw', weight: 1 }, { id: 'ne', weight: 1 }], count: 6, startDelay: 1.6, interval: [2.6, 3.8] },
    { spawnId: 'S', routes: [{ id: 'sn', weight: 2 }, { id: 'se', weight: 1 }, { id: 'sw', weight: 1 }], count: 6, startDelay: 2.4, interval: [2.6, 3.8] },
  ],
  goal: { carsToPass: 34 },
  stars: { parTime: 75, avgWait: 7, maxWait: 20, score: 5200 },
});
