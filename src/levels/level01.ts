import { LightState } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad } from './builder';

const world = { width: 640, height: 640 };
const X = 320;
const Y = 320;
const I = crossing('I1', X, Y);

/** Level 1 — First Crossing: one junction, two straight flows, two lights. */
export const level01 = defineLevel({
  id: 1,
  key: 'first-crossing',
  name: 'First Crossing',
  description: 'Two streams meet at a quiet junction. Take turns.',
  world,
  seed: 1101,
  roads: [hRoad('main', Y), vRoad('cross', X)],
  intersections: [I],
  lights: [light('L_W', I, 'E', LightState.GREEN), light('L_N', I, 'S', LightState.RED)],
  routes: [
    route('we', 'W', 'E', [{ dir: 'E', road: Y }], world),
    route('ns', 'N', 'S', [{ dir: 'S', road: X }], world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'we', weight: 1 }], count: 6, startDelay: 0.5, interval: [2.6, 3.8] },
    { spawnId: 'N', routes: [{ id: 'ns', weight: 1 }], count: 6, startDelay: 1.6, interval: [2.6, 3.8] },
  ],
  goal: { carsToPass: 12 },
  stars: { parTime: 40, avgWait: 2.5, maxWait: 7, score: 1800 },
  hint: 'Tap a light to switch RED ⇄ GREEN. Hold it for YELLOW: exactly one car may pass.',
  ru: {
    name: 'Первый перекрёсток',
    description: 'Два потока встречаются на тихом перекрёстке. Пропускайте по очереди.',
    hint: 'Нажмите на светофор: КРАСНЫЙ ⇄ ЗЕЛЁНЫЙ. Удерживайте для ЖЁЛТОГО — проедет ровно одна машина.',
  },
});
