import { LightState } from '../types';
import { crossing, defineLevel, hRoad, light, route, vRoad } from './builder';

const world = { width: 560, height: 560 };
const X = 280;
const Y = 280;
const I = crossing('I0', X, Y);

/** Level 0 — Driving School: a guided tutorial with step-by-step hints. */
export const level00 = defineLevel({
  id: 0,
  key: 'tutorial',
  name: 'Driving School',
  description: 'Learn the controls step by step.',
  ru: { name: 'Автошкола', description: 'Пошаговое обучение управлению.' },
  world,
  seed: 1000,
  roads: [hRoad('main', Y), vRoad('cross', X)],
  intersections: [I],
  lights: [light('L_W', I, 'E', LightState.RED), light('L_N', I, 'S', LightState.RED)],
  routes: [route('we', 'W', 'E', [{ dir: 'E', road: Y }], world), route('ns', 'N', 'S', [{ dir: 'S', road: X }], world)],
  flows: [
    { spawnId: 'W', routes: [{ id: 'we', weight: 1 }], count: 4, startDelay: 0.5, interval: [2.6, 3.4] },
    { spawnId: 'N', routes: [{ id: 'ns', weight: 1 }], count: 4, startDelay: 1.5, interval: [2.6, 3.4] },
  ],
  goal: { carsToPass: 8 },
  stars: { parTime: 90, avgWait: 12, maxWait: 40, score: 800 },
  tutorial: [
    {
      text: {
        en: 'Welcome to Traffic Flow! Cars drive by themselves — you control the traffic lights.',
        ru: 'Добро пожаловать в Traffic Flow! Машины едут сами — вы управляете светофорами.',
      },
      wait: { type: 'tap' },
      freeze: true,
    },
    {
      text: {
        en: 'Cars are coming from the west. Tap the highlighted light to turn it GREEN.',
        ru: 'С запада едут машины. Нажмите на подсвеченный светофор, чтобы включить ЗЕЛЁНЫЙ.',
      },
      target: 'L_W',
      wait: { type: 'light', id: 'L_W', state: LightState.GREEN },
    },
    {
      text: { en: 'Green means go. Let two cars through.', ru: 'Зелёный — можно ехать. Пропустите две машины.' },
      wait: { type: 'passed', count: 2 },
    },
    {
      text: {
        en: 'Cars are waiting in the north. First stop the west: tap its light to turn it RED.',
        ru: 'На севере ждут машины. Сначала остановите запад: нажмите на его светофор, чтобы включить КРАСНЫЙ.',
      },
      target: 'L_W',
      wait: { type: 'light', id: 'L_W', state: LightState.RED },
    },
    {
      text: { en: 'Now tap the north light to turn it GREEN.', ru: 'Теперь нажмите на северный светофор — ЗЕЛЁНЫЙ.' },
      target: 'L_N',
      wait: { type: 'light', id: 'L_N', state: LightState.GREEN },
    },
    {
      text: {
        en: 'HOLD a light to switch it to YELLOW: exactly one car passes, then it turns red by itself. Try it on the north light.',
        ru: 'УДЕРЖИВАЙТЕ светофор, чтобы включить ЖЁЛТЫЙ: проедет ровно одна машина, затем он сам станет красным. Попробуйте на северном.',
      },
      target: 'L_N',
      wait: { type: 'light', id: 'L_N', state: LightState.YELLOW },
    },
    {
      text: {
        en: 'Never give green to crossing roads at the same time — cars will crash. Pinch or scroll to zoom, drag to move the map.',
        ru: 'Никогда не включайте зелёный пересекающимся дорогам одновременно — будет авария. Масштаб — щипком или колёсиком, карту можно двигать.',
      },
      wait: { type: 'tap' },
      freeze: true,
    },
    {
      text: { en: 'Now let all the cars through to finish the lesson!', ru: 'Теперь пропустите все машины, чтобы закончить урок!' },
      wait: { type: 'time', seconds: 5 },
    },
  ],
  decorDensity: 0.8,
});
