import { LightState, type Dir } from '../types';
import { crossing, defineLevel, freeRight, hRoad, light, route, vRoad, type Leg } from './builder';

const world = { width: 720, height: 720 };
const X = 360;
const Y = 360;
const I = crossing('C', X, Y);
/** Signal heads move away from the corner where the slip lane runs. */
const HEAD = 24;

const h = (dir: Dir): Leg => ({ dir, road: Y });
const v = (dir: Dir): Leg => ({ dir, road: X });

/** Level 7 — Slip Lanes: every approach has a free right turn that yields instead of stopping. */
export const level07 = defineLevel({
  id: 7,
  key: 'slip-lanes',
  name: 'Slip Lanes',
  description: 'Right turns use slip lanes and give way on their own. Trucks join the traffic.',
  ru: {
    name: 'Съезды',
    description: 'Правые повороты идут по съездам и сами уступают дорогу. В потоке появились грузовики.',
    hint: 'Машины на съездах не смотрят на светофор — они ждут разрыва в потоке. Не держите поток бесконечно.',
  },
  hint: 'Cars in slip lanes ignore the lights and wait for a gap. Don’t keep a stream going forever.',
  world,
  seed: 7707,
  roads: [hRoad('ew', Y), vRoad('ns', X)],
  intersections: [I],
  lights: [
    light('L_W', I, 'E', LightState.GREEN, HEAD),
    light('L_E', I, 'W', LightState.RED, HEAD),
    light('L_N', I, 'S', LightState.RED, HEAD),
    light('L_S', I, 'N', LightState.RED, HEAD),
  ],
  routes: [
    route('we', 'W', 'E', [h('E')], world),
    route('wn', 'W', 'N', [h('E'), v('N')], world),
    freeRight('ws', 'W', 'S', h('E'), v('S'), world),
    route('ew', 'E', 'W', [h('W')], world),
    route('es', 'E', 'S', [h('W'), v('S')], world),
    freeRight('en', 'E', 'N', h('W'), v('N'), world),
    route('ns', 'N', 'S', [v('S')], world),
    route('ne', 'N', 'E', [v('S'), h('E')], world),
    freeRight('nw', 'N', 'W', v('S'), h('W'), world),
    route('sn', 'S', 'N', [v('N')], world),
    route('sw', 'S', 'W', [v('N'), h('W')], world),
    freeRight('se', 'S', 'E', v('N'), h('E'), world),
  ],
  flows: [
    { spawnId: 'W', routes: [{ id: 'we', weight: 3 }, { id: 'wn', weight: 1 }, { id: 'ws', weight: 2 }], count: 8, startDelay: 0.3, interval: [2.0, 3.0], mix: { truck: 1.4 } },
    { spawnId: 'E', routes: [{ id: 'ew', weight: 3 }, { id: 'es', weight: 1 }, { id: 'en', weight: 2 }], count: 8, startDelay: 1.1, interval: [2.0, 3.0], mix: { truck: 1.4 } },
    { spawnId: 'N', routes: [{ id: 'ns', weight: 3 }, { id: 'ne', weight: 1 }, { id: 'nw', weight: 2 }], count: 8, startDelay: 0.8, interval: [2.2, 3.2] },
    { spawnId: 'S', routes: [{ id: 'sn', weight: 3 }, { id: 'sw', weight: 1 }, { id: 'se', weight: 2 }], count: 8, startDelay: 1.8, interval: [2.2, 3.2] },
  ],
  goal: { carsToPass: 32 },
  stars: { parTime: 75, avgWait: 7, maxWait: 20, score: 4200 },
});
