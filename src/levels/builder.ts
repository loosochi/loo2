/**
 * Helpers for authoring levels on a simple road grid with right-hand traffic.
 * Horizontal roads are identified by their centre y, vertical roads by their centre x.
 * Roads may have several lanes per direction; lane 0 is the curb (rightmost) lane.
 */
import { ROAD } from '../config/balanceConfig';
import type {
  DecorDef,
  Dir,
  ExitPointDef,
  IntersectionDef,
  LevelDef,
  LightDef,
  LightState,
  RoadDef,
  RouteDef,
  SpawnPointDef,
  Vec2,
  WaypointDef,
} from '../types';
import { SeededRandom } from '../utils/math';

const LW = ROAD.laneWidth;
/** Offset of a lane centre from the road centre line (1 lane per direction). */
export const LANE_OFFSET = LW / 2;
/** Half width of a two-way, one-lane-per-direction road. */
export const ROAD_HALF = LW;
/** Distance vehicles appear/disappear beyond the world edge. */
export const OFFSCREEN = 60;
/** Roads extend this far beyond the world so edges never look cut off. */
export const ROAD_OVERHANG = 1200;
/** Corner radius of a slip-lane (free) right turn. */
export const SLIP_RADIUS = 90;

const isHorizontal = (d: Dir): boolean => d === 'E' || d === 'W';

/**
 * Fixed coordinate of lane `lane` (0 = curb lane) travelling in `dir` on the road whose centre
 * is `road`, for a road with `lanes` lanes per direction.
 */
export function laneCoord(dir: Dir, road: number, lane = 0, lanes = 1): number {
  const off = (lanes - lane - 0.5) * LW;
  switch (dir) {
    case 'E':
      return road + off;
    case 'W':
      return road - off;
    case 'S':
      return road - off;
    case 'N':
      return road + off;
  }
}

export interface Leg {
  dir: Dir;
  /** Centre coordinate of the road this leg drives on. */
  road: number;
  /** Lane index, 0 = curb lane (default). */
  lane?: number;
  /** Lanes per direction of this road (default 1). */
  lanes?: number;
}

/**
 * Build route waypoints from a list of legs. The first leg starts at `start` (coordinate along
 * the leg's axis) and the last leg ends at `end`. Consecutive legs must alternate axis.
 * `radii[i]` optionally overrides the corner radius of turn i.
 */
export function legsToPoints(legs: Leg[], start: number, end: number, radii: (number | undefined)[] = []): WaypointDef[] {
  const lc = (l: Leg) => laneCoord(l.dir, l.road, l.lane ?? 0, l.lanes ?? 1);
  const pts: WaypointDef[] = [];
  const first = legs[0];
  pts.push(isHorizontal(first.dir) ? { x: start, y: lc(first) } : { x: lc(first), y: start });
  for (let i = 1; i < legs.length; i++) {
    const a = legs[i - 1];
    const b = legs[i];
    if (isHorizontal(a.dir) === isHorizontal(b.dir)) throw new Error('Consecutive legs must turn');
    const h = isHorizontal(a.dir) ? a : b;
    const v = isHorizontal(a.dir) ? b : a;
    const p: WaypointDef = { x: lc(v), y: lc(h) };
    if (radii[i - 1] !== undefined) p.r = radii[i - 1];
    pts.push(p);
  }
  const last = legs[legs.length - 1];
  pts.push(isHorizontal(last.dir) ? { x: end, y: lc(last) } : { x: lc(last), y: end });
  return pts;
}

export interface World {
  width: number;
  height: number;
}

/** Off-screen start coordinate for traffic entering while travelling `dir`. */
export function entryCoord(dir: Dir, world: World): number {
  switch (dir) {
    case 'E':
      return -OFFSCREEN;
    case 'W':
      return world.width + OFFSCREEN;
    case 'S':
      return -OFFSCREEN;
    case 'N':
      return world.height + OFFSCREEN;
  }
}

/** Off-screen end coordinate for traffic leaving while travelling `dir`. */
export function exitCoord(dir: Dir, world: World): number {
  switch (dir) {
    case 'E':
      return world.width + OFFSCREEN;
    case 'W':
      return -OFFSCREEN;
    case 'S':
      return world.height + OFFSCREEN;
    case 'N':
      return -OFFSCREEN;
  }
}

export function route(id: string, spawnId: string, exitId: string, legs: Leg[], world: World): RouteDef {
  const points = legsToPoints(legs, entryCoord(legs[0].dir, world), exitCoord(legs[legs.length - 1].dir, world));
  return { id, spawnId, exitId, points };
}

/**
 * Free right turn through a slip lane: a wide curve that leaves the curb lane before the stop
 * line, bypasses the signal and merges into the crossing road, yielding to traffic there.
 */
export function freeRight(id: string, spawnId: string, exitId: string, from: Leg, to: Leg, world: World): RouteDef {
  const points = legsToPoints([from, to], entryCoord(from.dir, world), exitCoord(to.dir, world), [SLIP_RADIUS]);
  return { id, spawnId, exitId, points, free: true };
}

export interface RoadOpts {
  lanes?: number;
  from?: number;
  to?: number;
}

export function hRoad(id: string, y: number, o: RoadOpts = {}): RoadDef {
  return { id, from: { x: o.from ?? -ROAD_OVERHANG, y }, to: { x: o.to ?? 5000, y }, lanes: o.lanes ?? 1 };
}

export function vRoad(id: string, x: number, o: RoadOpts = {}): RoadDef {
  return { id, from: { x, y: o.from ?? -ROAD_OVERHANG }, to: { x, y: o.to ?? 5000 }, lanes: o.lanes ?? 1 };
}

/**
 * Intersection of a horizontal road (`hLanes` per direction) and a vertical road (`vLanes`).
 */
export function crossing(
  id: string,
  x: number,
  y: number,
  crosswalks: Dir[] = ['N', 'S', 'E', 'W'],
  lanes: { h?: number; v?: number } = {},
): IntersectionDef {
  return { id, x, y, halfW: (lanes.v ?? 1) * LW, halfH: (lanes.h ?? 1) * LW, crosswalks };
}

/**
 * Traffic light for traffic arriving at intersection `ix` while travelling `dir`.
 * The stop line spans all inbound lanes; the signal head stands on the right-hand sidewalk
 * (pushed further out with `headOffset`, e.g. when a slip lane occupies the corner).
 */
export function light(id: string, ix: IntersectionDef, dir: Dir, initial?: LightState, headOffset = 0): LightDef {
  const off = ROAD.stopLineOffset;
  const sw = ROAD.sidewalk * 0.9 + headOffset;
  let stop: Vec2;
  let head: Vec2;
  let width: number;
  switch (dir) {
    case 'E':
      width = ix.halfH;
      stop = { x: ix.x - ix.halfW - off, y: ix.y + ix.halfH / 2 };
      head = { x: stop.x - 6, y: ix.y + ix.halfH + sw };
      break;
    case 'W':
      width = ix.halfH;
      stop = { x: ix.x + ix.halfW + off, y: ix.y - ix.halfH / 2 };
      head = { x: stop.x + 6, y: ix.y - ix.halfH - sw };
      break;
    case 'S':
      width = ix.halfW;
      stop = { x: ix.x - ix.halfW / 2, y: ix.y - ix.halfH - off };
      head = { x: ix.x - ix.halfW - sw, y: stop.y - 6 };
      break;
    case 'N':
      width = ix.halfW;
      stop = { x: ix.x + ix.halfW / 2, y: ix.y + ix.halfH + off };
      head = { x: ix.x + ix.halfW + sw, y: stop.y + 6 };
      break;
  }
  return { id, stop, dir, width, head, initial };
}

const dirOf = (a: WaypointDef, b: WaypointDef): Dir =>
  Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'E' : 'W') : b.y > a.y ? 'S' : 'N';

/** Spawn and exit markers derived from route end points (one per distinct lane). */
export function endpoints(routes: RouteDef[]): { spawns: SpawnPointDef[]; exits: ExitPointDef[] } {
  const spawns = new Map<string, SpawnPointDef>();
  const exits = new Map<string, ExitPointDef>();
  for (const r of routes) {
    const p = r.points;
    const n = p.length;
    const sk = `${Math.round(p[0].x)},${Math.round(p[0].y)}`;
    const ek = `${Math.round(p[n - 1].x)},${Math.round(p[n - 1].y)}`;
    if (!spawns.has(sk)) spawns.set(sk, { id: r.spawnId, x: p[0].x, y: p[0].y, dir: dirOf(p[0], p[1]) });
    if (!exits.has(ek)) exits.set(ek, { id: r.exitId, x: p[n - 1].x, y: p[n - 1].y, dir: dirOf(p[n - 2], p[n - 1]) });
  }
  return { spawns: [...spawns.values()], exits: [...exits.values()] };
}

/** Half width of a road's asphalt. */
const roadHalf = (r: RoadDef): number => r.lanes * (r.oneWay ? 0.5 : 1) * LW;

/**
 * Scatter trees, bushes and buildings in the free space between roads (deterministic).
 */
export function autoDecor(world: World, roads: RoadDef[], seed: number, density = 1, avoid: WaypointDef[][] = []): DecorDef[] {
  const rng = new SeededRandom(seed ^ 0x9e3779b9);
  const out: DecorDef[] = [];
  const nearRoad = (x: number, y: number, pad: number): boolean =>
    roads.some((r) => {
      const clearance = roadHalf(r) + ROAD.sidewalk + 6;
      const horizontal = r.from.y === r.to.y;
      if (horizontal) {
        const x0 = Math.min(r.from.x, r.to.x);
        const x1 = Math.max(r.from.x, r.to.x);
        return Math.abs(y - r.from.y) < clearance + pad && x > x0 - clearance - pad && x < x1 + clearance + pad;
      }
      const y0 = Math.min(r.from.y, r.to.y);
      const y1 = Math.max(r.from.y, r.to.y);
      return Math.abs(x - r.from.x) < clearance + pad && y > y0 - clearance - pad && y < y1 + clearance + pad;
    }) ||
    // Keep slip lanes clear (their corner points bulge into the free space).
    avoid.some((pts) => pts.some((p) => Math.hypot(p.x - x, p.y - y) < SLIP_RADIUS + pad + 10));
  const overlaps = (x: number, y: number, rad: number): boolean =>
    out.some((d) => {
      const dr = d.type === 'building' ? Math.max(d.w ?? 0, d.h ?? 0) / 2 : (d.r ?? 10);
      return Math.hypot(d.x - x, d.y - y) < dr + rad + 4;
    });

  const margin = 120;
  const buildings = Math.round(((world.width * world.height) / 60000) * density);
  for (let i = 0, tries = 0; i < buildings && tries < 400; tries++) {
    const w = rng.range(46, 92);
    const h = rng.range(40, 84);
    const x = rng.range(-margin, world.width + margin);
    const y = rng.range(-margin, world.height + margin);
    const rad = Math.max(w, h) / 2;
    if (nearRoad(x, y, rad) || overlaps(x, y, rad)) continue;
    out.push({ type: 'building', x, y, w, h, color: rng.int(0, 5) });
    i++;
  }
  const trees = Math.round(((world.width * world.height) / 9000) * density);
  for (let i = 0, tries = 0; i < trees && tries < 1500; tries++) {
    const r = rng.range(8, 15);
    const x = rng.range(-margin, world.width + margin);
    const y = rng.range(-margin, world.height + margin);
    if (nearRoad(x, y, r) || overlaps(x, y, r)) continue;
    out.push({ type: rng.next() < 0.75 ? 'tree' : 'bush', x, y, r });
    i++;
  }
  return out;
}

export type LevelInput = Omit<LevelDef, 'spawns' | 'exits' | 'decor'> & { decorDensity?: number };

/** Complete a level definition with derived spawn/exit markers and decoration. */
export function defineLevel(input: LevelInput): LevelDef {
  const { decorDensity, ...rest } = input;
  const { spawns, exits } = endpoints(rest.routes);
  const slips = rest.routes.filter((r) => r.free).map((r) => r.points.slice(1, -1));
  return { ...rest, spawns, exits, decor: autoDecor(rest.world, rest.roads, rest.seed, decorDensity ?? 1, slips) };
}
