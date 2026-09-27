import { LightState } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad } from './builder';

const world = { width: 720, height: 560 };
const Y = 240;
const X = 360;
const I = crossing('T1', X, Y, ['W', 'E', 'S']);

/** Level 2 — Busy Road: a T-junction with three approaches and turning traffic. */
export const level02 = defineLevel({
  id: 2,
  key: 'busy-road',
  name: 'Busy Road',
  description: 'A side street joins a busy avenue. Turning cars need a gap.',
  world,
  seed: 2202,
  roads: [hRoad('avenue', Y), vRoad('side', X, Y, 5000)],
  intersections: [I],
  lights: [
    light('L_W', I, 'E', LightState.GREEN),
    light('L_E', I, 'W', LightState.GREEN),
    light('L_S', I, 'N', LightState.RED),
  ],
  routes: [
    route('we', 'W', 'E', [{ dir: 'E', road: Y }], world),
    route('ew', 'E', 'W', [{ dir: 'W', road: Y }], world),
    route('sw', 'S', 'W', [{ dir: 'N', road: X }, { dir: 'W', road: Y }], world),
    route('se', 'S', 'E', [{ dir: 'N', road: X }, { dir: 'E', road: Y }], world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'we', weight: 1 }], count: 7, startDelay: 0.4, interval: [2.0, 3.2] },
    { spawnId: 'E', routes: [{ id: 'ew', weight: 1 }], count: 7, startDelay: 1.2, interval: [2.0, 3.2] },
    {
      spawnId: 'S',
      routes: [
        { id: 'sw', weight: 1 },
        { id: 'se', weight: 1 },
      ],
      count: 6,
      startDelay: 1.0,
      interval: [2.4, 3.6],
    },
  ],
  goal: { carsToPass: 20 },
  stars: { parTime: 50, avgWait: 3.5, maxWait: 10, score: 2600 },
  hint: 'Avenue traffic can flow both ways at once — but the side street crosses both lanes.',
});
