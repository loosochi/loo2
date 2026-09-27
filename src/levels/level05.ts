import { LightState, type Dir } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 1000, height: 700 };
const Y = 350;
const XA = 330;
const XB = 690;
const A = crossing('A', XA, Y);
const B = crossing('B', XB, Y);

const main = (dir: Dir): Leg => ({ dir, road: Y });
const a = (dir: Dir): Leg => ({ dir, road: XA });
const b = (dir: Dir): Leg => ({ dir, road: XB });

/** Level 5 — Rush Hour: two full four-way junctions, six entries, heavy traffic. */
export const level05 = defineLevel({
  id: 5,
  key: 'rush-hour',
  name: 'Rush Hour',
  description: 'Everyone wants to get home at once. Keep the city moving.',
  world,
  seed: 5505,
  roads: [hRoad('avenue', Y), vRoad('a', XA), vRoad('b', XB)],
  intersections: [A, B],
  lights: [
    light('A_W', A, 'E', LightState.GREEN),
    light('A_E', A, 'W', LightState.RED),
    light('A_N', A, 'S', LightState.RED),
    light('A_S', A, 'N', LightState.RED),
    light('B_W', B, 'E', LightState.GREEN),
    light('B_E', B, 'W', LightState.RED),
    light('B_N', B, 'S', LightState.RED),
    light('B_S', B, 'N', LightState.RED),
  ],
  routes: [
    route('w_e', 'W', 'E', [main('E')], world),
    route('w_an', 'W', 'NA', [main('E'), a('N')], world),
    route('w_bs', 'W', 'SB', [main('E'), b('S')], world),
    route('e_w', 'E', 'W', [main('W')], world),
    route('e_bs', 'E', 'SB', [main('W'), b('S')], world),
    route('e_an', 'E', 'NA', [main('W'), a('N')], world),
    route('na_s', 'NA', 'SA', [a('S')], world),
    route('na_e', 'NA', 'E', [a('S'), main('E')], world),
    route('sa_n', 'SA', 'NA', [a('N')], world),
    route('sa_e', 'SA', 'E', [a('N'), main('E')], world),
    route('nb_s', 'NB', 'SB', [b('S')], world),
    route('nb_w', 'NB', 'W', [b('S'), main('W')], world),
    route('sb_n', 'SB', 'NB', [b('N')], world),
    route('sb_w', 'SB', 'W', [b('N'), main('W')], world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'w_e', weight: 4 }, { id: 'w_an', weight: 1 }, { id: 'w_bs', weight: 1 }], count: 9, startDelay: 0.3, interval: [1.6, 2.6] },
    { spawnId: 'E', routes: [{ id: 'e_w', weight: 4 }, { id: 'e_bs', weight: 1 }, { id: 'e_an', weight: 1 }], count: 9, startDelay: 0.9, interval: [1.6, 2.6] },
    { spawnId: 'NA', routes: [{ id: 'na_s', weight: 2 }, { id: 'na_e', weight: 1 }], count: 5, startDelay: 1.4, interval: [2.6, 4.0] },
    { spawnId: 'SA', routes: [{ id: 'sa_n', weight: 2 }, { id: 'sa_e', weight: 1 }], count: 5, startDelay: 2.4, interval: [2.6, 4.0] },
    { spawnId: 'NB', routes: [{ id: 'nb_s', weight: 2 }, { id: 'nb_w', weight: 1 }], count: 5, startDelay: 1.9, interval: [2.6, 4.0] },
    { spawnId: 'SB', routes: [{ id: 'sb_n', weight: 2 }, { id: 'sb_w', weight: 1 }], count: 5, startDelay: 3.0, interval: [2.6, 4.0] },
  ],
  goal: { carsToPass: 38, timeLimit: 180 },
  stars: { parTime: 100, avgWait: 14, maxWait: 35, score: 4200 },
  hint: 'Rush hour! Six entries, eight lights, three minutes.',
});
