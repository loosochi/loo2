/**
 * Level editor data model. A custom level is a grid of full-length horizontal and vertical
 * roads; junctions, traffic lights, routes and traffic flows are generated from it.
 */
import { crossing, defineLevel, freeRight, hRoad, light, route, vRoad, type Leg } from '../levels/builder';
import type { Dir, FlowDef, IntersectionDef, LevelDef, LightDef, RouteDef, SpecialDef, VehicleKind } from '../types';
import { SeededRandom } from '../utils/math';

export type Density = 'low' | 'med' | 'high';
export type Axis = 'h' | 'v';

export interface EditorRoad {
  /** Centre coordinate: y for horizontal roads, x for vertical ones. */
  at: number;
  lanes: 1 | 2;
}

export interface EditorLevel {
  v: 1;
  name: string;
  h: EditorRoad[];
  vr: EditorRoad[];
  /** Vehicles per entry point. */
  cars: number;
  density: Density;
  buses: boolean;
  trucks: boolean;
  emergency: boolean;
  slips: boolean;
  /** Seconds, 0 = no limit. */
  timeLimit: number;
}

export const EDITOR_WORLD = { width: 900, height: 640 } as const;
/** Minimum distance between parallel roads (centre to centre). */
export const MIN_GAP = 190;
/** Minimum distance from a road to the map edge. */
export const MIN_EDGE = 110;
export const MAX_ROADS = 3;
export const SNAP = 10;
export const CARS_RANGE: [number, number] = [2, 20];
export const TIME_LIMITS = [0, 120, 180, 240] as const;
export const CUSTOM_LEVEL_ID = 1000;

const INTERVALS: Record<Density, [number, number]> = { low: [3.0, 4.4], med: [2.0, 3.2], high: [1.3, 2.2] };

export function defaultEditorLevel(name = 'My level'): EditorLevel {
  return {
    v: 1,
    name,
    h: [{ at: 320, lanes: 1 }],
    vr: [{ at: 450, lanes: 1 }],
    cars: 6,
    density: 'med',
    buses: false,
    trucks: false,
    emergency: false,
    slips: false,
    timeLimit: 0,
  };
}

const roadsOf = (m: EditorLevel, axis: Axis): EditorRoad[] => (axis === 'h' ? m.h : m.vr);
const extentOf = (axis: Axis): number => (axis === 'h' ? EDITOR_WORLD.height : EDITOR_WORLD.width);

export type EditError = 'tooClose' | 'maxRoads';

/** Add a road at a (snapped) coordinate. Returns an error key when it is not allowed. */
export function addRoad(m: EditorLevel, axis: Axis, coord: number): EditError | null {
  const roads = roadsOf(m, axis);
  if (roads.length >= MAX_ROADS) return 'maxRoads';
  const at = Math.round(coord / SNAP) * SNAP;
  if (at < MIN_EDGE || at > extentOf(axis) - MIN_EDGE) return 'tooClose';
  if (roads.some((r) => Math.abs(r.at - at) < MIN_GAP)) return 'tooClose';
  roads.push({ at, lanes: 1 });
  roads.sort((a, b) => a.at - b.at);
  return null;
}

export function removeRoad(m: EditorLevel, axis: Axis, index: number): void {
  roadsOf(m, axis).splice(index, 1);
}

export function toggleLanes(m: EditorLevel, axis: Axis, index: number): void {
  const r = roadsOf(m, axis)[index];
  if (r) r.lanes = r.lanes === 1 ? 2 : 1;
}

/** Road closest to a world point (within `maxDist`), if any. */
export function nearestRoad(m: EditorLevel, x: number, y: number, maxDist = 40): { axis: Axis; index: number } | null {
  let best: { axis: Axis; index: number } | null = null;
  let bestD = maxDist;
  m.h.forEach((r, i) => {
    const d = Math.abs(r.at - y);
    if (d < bestD) {
      bestD = d;
      best = { axis: 'h', index: i };
    }
  });
  m.vr.forEach((r, i) => {
    const d = Math.abs(r.at - x);
    if (d < bestD) {
      bestD = d;
      best = { axis: 'v', index: i };
    }
  });
  return best;
}

export type ValidationError = 'needRoad' | 'needCrossing';

export function validate(m: EditorLevel): ValidationError | null {
  if (m.h.length + m.vr.length === 0) return 'needRoad';
  if (m.h.length === 0 || m.vr.length === 0) return 'needCrossing';
  return null;
}

export function totalVehicles(m: EditorLevel): number {
  const entries = (m.h.length + m.vr.length) * 2;
  return entries * m.cars + (m.emergency ? 3 : 0);
}

/** Right turn of a vehicle travelling `d`. */
const rightOf: Record<Dir, Dir> = { E: 'S', S: 'W', W: 'N', N: 'E' };
const leftOf: Record<Dir, Dir> = { E: 'N', N: 'W', W: 'S', S: 'E' };

/** Build a playable level from the editor model. Throws for an invalid model. */
export function buildLevel(m: EditorLevel, seed = 12345): LevelDef {
  const err = validate(m);
  if (err) throw new Error(err);
  const world = { ...EDITOR_WORLD };
  const roads = [...m.h.map((r, i) => hRoad(`h${i}`, r.at, { lanes: r.lanes })), ...m.vr.map((r, j) => vRoad(`v${j}`, r.at, { lanes: r.lanes }))];

  const intersections: IntersectionDef[] = [];
  const lights: LightDef[] = [];
  m.h.forEach((hr, i) =>
    m.vr.forEach((vr, j) => {
      const ix = crossing(`X${i}_${j}`, vr.at, hr.at, ['N', 'S', 'E', 'W'], { h: hr.lanes, v: vr.lanes });
      intersections.push(ix);
      for (const d of ['E', 'W', 'S', 'N'] as Dir[]) lights.push(light(`L${i}_${j}${d}`, ix, d, undefined, m.slips ? 24 : 0));
    }),
  );

  const routes: RouteDef[] = [];
  const flows: FlowDef[] = [];
  const rng = new SeededRandom(seed);
  const [i0, i1] = INTERVALS[m.density];
  const mix: Partial<Record<VehicleKind, number>> = {};
  if (m.buses) mix.bus = 1.2;
  if (m.trucks) mix.truck = 1.2;
  const specials: SpecialDef[] = [];

  const addEntry = (axis: Axis, idx: number, dir: Dir) => {
    const self = roadsOf(m, axis)[idx];
    const cross = axis === 'h' ? m.vr : m.h;
    const crossAxis: Axis = axis === 'h' ? 'v' : 'h';
    const spawnId = `${axis}${idx}${dir}`;
    const leg = (lane: number): Leg => ({ dir, road: self.at, lane, lanes: self.lanes });
    const exitId = (a: Axis, k: number, d: Dir) => `${a}${k}${d}out`;
    const weights: { id: string; weight: number }[] = [];
    for (let k = 0; k < self.lanes; k++) {
      const id = `${spawnId}_s${k}`;
      routes.push(route(id, spawnId, exitId(axis, idx, dir), [leg(k)], world));
      weights.push({ id, weight: 3 });
    }
    cross.forEach((cr, k) => {
      const rd = rightOf[dir];
      const ld = leftOf[dir];
      const rightId = `${spawnId}_r${k}`;
      const rLeg: Leg = { dir: rd, road: cr.at, lane: 0, lanes: cr.lanes };
      routes.push(
        m.slips
          ? freeRight(rightId, spawnId, exitId(crossAxis, k, rd), leg(0), rLeg, world)
          : route(rightId, spawnId, exitId(crossAxis, k, rd), [leg(0), rLeg], world),
      );
      const leftId = `${spawnId}_l${k}`;
      routes.push(route(leftId, spawnId, exitId(crossAxis, k, ld), [leg(self.lanes - 1), { dir: ld, road: cr.at, lane: cr.lanes - 1, lanes: cr.lanes }], world));
      weights.push({ id: rightId, weight: 1 / cross.length }, { id: leftId, weight: 1 / cross.length });
    });
    flows.push({
      spawnId,
      routes: weights,
      count: m.cars,
      startDelay: Math.round(rng.range(0.3, 3) * 10) / 10,
      interval: [i0, i1],
      mix: Object.keys(mix).length ? mix : undefined,
    });
  };
  m.h.forEach((_, i) => {
    addEntry('h', i, 'E');
    addEntry('h', i, 'W');
  });
  m.vr.forEach((_, j) => {
    addEntry('v', j, 'S');
    addEntry('v', j, 'N');
  });

  if (m.emergency) {
    const kinds: VehicleKind[] = ['ambulance', 'police', 'fire'];
    const straight = routes.filter((r) => /_s\d$/.test(r.id));
    kinds.forEach((kind, k) => {
      const r = straight[rng.int(0, straight.length - 1)];
      specials.push({ at: 15 + k * 20, spawnId: r.spawnId, routeId: r.id, kind });
    });
  }

  const total = totalVehicles(m);
  const perCar = [i0, i1].reduce((a, b) => a + b) / 2;
  const par = Math.round(m.cars * perCar + 25 + intersections.length * 8);
  return defineLevel({
    id: CUSTOM_LEVEL_ID,
    key: 'custom',
    name: m.name || 'Custom level',
    description: 'A level made in the editor.',
    ru: { name: m.name || 'Свой уровень', description: 'Уровень из редактора.' },
    world,
    seed,
    roads,
    intersections,
    lights,
    routes,
    flows,
    specials: specials.length ? specials : undefined,
    goal: { carsToPass: total, timeLimit: m.timeLimit > 0 ? m.timeLimit : undefined },
    stars: { parTime: par, avgWait: 6, maxWait: 18, score: Math.round(total * 100 * 1.1) },
    custom: true,
    decorDensity: 0.9,
  });
}

// ------------------------------------------------------------------ share codes

const CODE_PREFIX = 'TF1:';

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeLevel(m: EditorLevel): string {
  const compact = {
    n: m.name,
    h: m.h.map((r) => [r.at, r.lanes]),
    v: m.vr.map((r) => [r.at, r.lanes]),
    c: m.cars,
    d: m.density,
    f: [m.buses, m.trucks, m.emergency, m.slips].map((b) => (b ? 1 : 0)).join(''),
    t: m.timeLimit,
  };
  return CODE_PREFIX + toBase64(JSON.stringify(compact));
}

/** Parse and validate a share code (or stored JSON). Returns null when invalid. */
export function decodeLevel(code: string): EditorLevel | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(CODE_PREFIX)) return null;
    const raw = JSON.parse(fromBase64(trimmed.slice(CODE_PREFIX.length))) as Record<string, unknown>;
    return sanitizeEditorLevel({
      v: 1,
      name: raw.n,
      h: Array.isArray(raw.h) ? raw.h.map((r: unknown) => (Array.isArray(r) ? { at: r[0], lanes: r[1] } : null)) : [],
      vr: Array.isArray(raw.v) ? raw.v.map((r: unknown) => (Array.isArray(r) ? { at: r[0], lanes: r[1] } : null)) : [],
      cars: raw.c,
      density: raw.d,
      buses: String(raw.f ?? '')[0] === '1',
      trucks: String(raw.f ?? '')[1] === '1',
      emergency: String(raw.f ?? '')[2] === '1',
      slips: String(raw.f ?? '')[3] === '1',
      timeLimit: raw.t,
    });
  } catch {
    return null;
  }
}

/** Validate untrusted editor data; re-applies all placement rules. */
export function sanitizeEditorLevel(raw: unknown): EditorLevel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const m = defaultEditorLevel(typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f<>]/g, '').slice(0, 24) : 'My level');
  m.h = [];
  m.vr = [];
  const place = (axis: Axis, list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      if (typeof it.at !== 'number' || !Number.isFinite(it.at)) continue;
      if (addRoad(m, axis, it.at) === null && it.lanes === 2) {
        const roads = roadsOf(m, axis);
        const idx = roads.findIndex((x) => x.at === Math.round((it.at as number) / SNAP) * SNAP);
        if (idx >= 0) roads[idx].lanes = 2;
      }
    }
  };
  place('h', r.h);
  place('v', r.vr);
  if (typeof r.cars === 'number' && Number.isFinite(r.cars)) m.cars = Math.max(CARS_RANGE[0], Math.min(CARS_RANGE[1], Math.round(r.cars)));
  if (r.density === 'low' || r.density === 'med' || r.density === 'high') m.density = r.density;
  m.buses = r.buses === true;
  m.trucks = r.trucks === true;
  m.emergency = r.emergency === true;
  m.slips = r.slips === true;
  if (typeof r.timeLimit === 'number' && (TIME_LIMITS as readonly number[]).includes(r.timeLimit)) m.timeLimit = r.timeLimit;
  return m;
}
