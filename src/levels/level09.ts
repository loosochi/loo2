import { LightState, type Dir } from '../types';
import { crossing, defineLevel, freeRight, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 1040, height: 680 };
const Y = 340;
const XA = 330;
const XB = 710;
const A = crossing('A', XA, Y, ['N', 'S', 'E', 'W'], { h: 2, v: 1 });
const B = crossing('B', XB, Y, ['N', 'S', 'E', 'W'], { h: 2, v: 1 });

const av = (dir: Dir, lane = 0): Leg => ({ dir, road: Y, lane, lanes: 2 });
const a = (dir: Dir): Leg => ({ dir, road: XA });
const b = (dir: Dir): Leg => ({ dir, road: XB });

/** Level 9 — Grand Boulevard: everything at once on a two-junction boulevard. */
export const level09 = defineLevel({
  id: 9,
  key: 'grand-boulevard',
  name: 'Grand Boulevard',
  description: 'Two junctions, slip lanes, buses, trucks and emergency calls.',
  ru: {
    name: 'Большой бульвар',
    description: 'Два перекрёстка, съезды, автобусы, грузовики и экстренные вызовы.',
    hint: 'Финальный экзамен. Держите бульвар в движении и пропускайте спецтранспорт.',
  },
  hint: 'The final exam. Keep the boulevard moving and let emergency vehicles through.',
  world,
  seed: 9909,
  roads: [hRoad('boulevard', Y, { lanes: 2 }), vRoad('a', XA), vRoad('b', XB)],
  intersections: [A, B],
  lights: [
    light('A_W', A, 'E', LightState.GREEN),
    light('A_E', A, 'W', LightState.GREEN),
    light('A_N', A, 'S', LightState.RED, 24),
    light('A_S', A, 'N', LightState.RED),
    light('B_W', B, 'E', LightState.GREEN),
    light('B_E', B, 'W', LightState.GREEN),
    light('B_N', B, 'S', LightState.RED),
    light('B_S', B, 'N', LightState.RED, 24),
  ],
  routes: [
    route('w_e0', 'W', 'E', [av('E', 0)], world),
    route('w_e1', 'W', 'E', [av('E', 1)], world),
    route('w_bs', 'W', 'SB', [av('E', 0), b('S')], world),
    route('e_w0', 'E', 'W', [av('W', 0)], world),
    route('e_w1', 'E', 'W', [av('W', 1)], world),
    route('e_an', 'E', 'NA', [av('W', 0), a('N')], world),
    route('na_s', 'NA', 'SA', [a('S')], world),
    freeRight('na_w', 'NA', 'W', a('S'), av('W', 0), world),
    route('sa_n', 'SA', 'NA', [a('N')], world),
    route('sa_e', 'SA', 'E', [a('N'), av('E', 0)], world),
    route('nb_s', 'NB', 'SB', [b('S')], world),
    route('nb_w', 'NB', 'W', [b('S'), av('W', 0)], world),
    route('sb_n', 'SB', 'NB', [b('N')], world),
    freeRight('sb_e', 'SB', 'E', b('N'), av('E', 0), world),
  ],
  flows: [
    {
      spawnId: 'W',
      routes: [{ id: 'w_e0', weight: 3 }, { id: 'w_e1', weight: 3 }, { id: 'w_bs', weight: 1 }],
      count: 14,
      startDelay: 0.3,
      interval: [1.2, 2.0],
      mix: { bus: 1.2, truck: 1 },
    },
    {
      spawnId: 'E',
      routes: [{ id: 'e_w0', weight: 3 }, { id: 'e_w1', weight: 3 }, { id: 'e_an', weight: 1 }],
      count: 14,
      startDelay: 0.9,
      interval: [1.2, 2.0],
      mix: { bus: 1.2, truck: 1 },
    },
    { spawnId: 'NA', routes: [{ id: 'na_s', weight: 2 }, { id: 'na_w', weight: 1 }], count: 6, startDelay: 1.4, interval: [2.4, 3.6] },
    { spawnId: 'SA', routes: [{ id: 'sa_n', weight: 2 }, { id: 'sa_e', weight: 1 }], count: 6, startDelay: 2.4, interval: [2.4, 3.6] },
    { spawnId: 'NB', routes: [{ id: 'nb_s', weight: 2 }, { id: 'nb_w', weight: 1 }], count: 6, startDelay: 1.9, interval: [2.4, 3.6] },
    { spawnId: 'SB', routes: [{ id: 'sb_n', weight: 2 }, { id: 'sb_e', weight: 1 }], count: 6, startDelay: 3.0, interval: [2.4, 3.6] },
  ],
  specials: [
    { at: 18, spawnId: 'NA', routeId: 'na_s', kind: 'ambulance' },
    { at: 40, spawnId: 'E', routeId: 'e_w1', kind: 'fire' },
    { at: 62, spawnId: 'SB', routeId: 'sb_n', kind: 'police' },
  ],
  goal: { carsToPass: 55, timeLimit: 200 },
  stars: { parTime: 64, avgWait: 4.5, maxWait: 18, score: 8200 },
});
