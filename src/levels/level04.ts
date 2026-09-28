import { LightState, type Dir } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 960, height: 600 };
const Y = 300;
const XA = 300;
const XB = 660;
const A = crossing('A', XA, Y);
const B = crossing('B', XB, Y);

const main = (dir: Dir): Leg => ({ dir, road: Y });
const a = (dir: Dir): Leg => ({ dir, road: XA });
const b = (dir: Dir): Leg => ({ dir, road: XB });

/** Level 4 — Double Crossing: two junctions in a row; queues between them matter. */
export const level04 = defineLevel({
  id: 4,
  key: 'double-crossing',
  name: 'Double Crossing',
  description: 'Two junctions share one avenue. Don’t let the queue block the box.',
  world,
  seed: 4404,
  roads: [hRoad('avenue', Y), vRoad('a', XA), vRoad('b', XB)],
  intersections: [A, B],
  lights: [
    light('A_W', A, 'E', LightState.GREEN),
    light('A_E', A, 'W', LightState.GREEN),
    light('A_N', A, 'S', LightState.RED),
    light('B_W', B, 'E', LightState.GREEN),
    light('B_E', B, 'W', LightState.GREEN),
    light('B_S', B, 'N', LightState.RED),
  ],
  routes: [
    route('w_e', 'W', 'E', [main('E')], world),
    route('w_bs', 'W', 'SB', [main('E'), b('S')], world),
    route('e_w', 'E', 'W', [main('W')], world),
    route('e_an', 'E', 'NA', [main('W'), a('N')], world),
    route('n_s', 'N', 'SA', [a('S')], world),
    route('n_ae', 'N', 'E', [a('S'), main('E')], world),
    route('s_n', 'S', 'NB', [b('N')], world),
    route('s_bw', 'S', 'W', [b('N'), main('W')], world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'w_e', weight: 3 }, { id: 'w_bs', weight: 1 }], count: 8, startDelay: 0.4, interval: [2.0, 3.2] },
    { spawnId: 'E', routes: [{ id: 'e_w', weight: 3 }, { id: 'e_an', weight: 1 }], count: 8, startDelay: 1.1, interval: [2.0, 3.2] },
    { spawnId: 'N', routes: [{ id: 'n_s', weight: 2 }, { id: 'n_ae', weight: 1 }], count: 7, startDelay: 1.5, interval: [2.4, 3.6] },
    { spawnId: 'S', routes: [{ id: 's_n', weight: 2 }, { id: 's_bw', weight: 1 }], count: 7, startDelay: 2.2, interval: [2.4, 3.6] },
  ],
  goal: { carsToPass: 30, timeLimit: 150 },
  stars: { parTime: 60, avgWait: 5, maxWait: 15, score: 4000 },
  hint: 'Cars turning onto the avenue must cross both junctions. Time limit: 2:30.',
  ru: {
    name: 'Двойной перекрёсток',
    description: 'Два перекрёстка на одном проспекте. Не дайте очереди заблокировать перекрёсток.',
    hint: 'Поворачивающие на проспект должны проехать оба перекрёстка. Лимит времени: 2:30.',
  },
});
