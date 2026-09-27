/**
 * Helpers for authoring levels on a simple road grid with right-hand traffic.
 * Horizontal roads are identified by their centre y, vertical roads by their centre x.
 */
import { ROAD } from '../config/balanceConfig';
import type {
  DecorDef,
  Dir,
  ExitPointDef,
  IntersectionDef,
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

const isHorizontal = (d: Dir): boolean => d === 'E' || d === 'W';

/** Fixed coordinate of the lane travelling in `dir` on the road whose centre is `road`. */
export function laneCoord(dir: Dir, road: number): number {
  switch (dir) {
    case 'E':
      return road + LANE_OFFSET;
    case 'W':
      return road - LANE_OFFSET;
    case 'S':
      return road - LANE_OFFSET;
    case 'N':
      return road + LANE_OFFSET;
  }
}

export interface Leg {
  dir: Dir;
  /** Centre coordinate of the road this leg drives on. */
  road: number;
}

/**
 * Build route waypoints from a list of legs. The first leg starts at `start` (coordinate along
 * the leg's axis) and the last leg ends at `end`. Consecutive legs must alternate axis.
 */
export function legsToPoints(legs: Leg[], start: number, end: number): WaypointDef[] {
  const pts: WaypointDef[] = [];
  const first = legs[0];
  pts.push(isHorizontal(first.dir) ? { x: start, y: laneCoord(first.dir, first.road) } : { x: laneCoord(first.dir, first.road), y: start });
  for (let i = 1; i < legs.length; i++) {
    const a = legs[i - 1];
    const b = legs[i];
    if (isHorizontal(a.dir) === isHorizontal(b.dir)) throw new Error('Consecutive legs must turn');
    const h = isHorizontal(a.dir) ? a : b;
    const v = isHorizontal(a.dir) ? b : a;
    pts.push({ x: laneCoord(v.dir, v.road), y: laneCoord(h.dir, h.road) });
  }
  const last = legs[legs.length - 1];
  pts.push(isHorizontal(last.dir) ? { x: end, y: laneCoord(last.dir, last.road) } : { x: laneCoord(last.dir, last.road), y: end });
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

export function hRoad(id: string, y: number, x0 = -ROAD_OVERHANG, x1 = 5000): RoadDef {
  return { id, from: { x: x0, y }, to: { x: x1, y }, lanes: 1 };
}

export function vRoad(id: string, x: number, y0 = -ROAD_OVERHANG, y1 = 5000): RoadDef {
  return { id, from: { x, y: y0 }, to: { x, y: y1 }, lanes: 1 };
}

export function crossing(id: string, x: number, y: number, crosswalks: Dir[] = ['N', 'S', 'E', 'W']): IntersectionDef {
  return { id, x, y, halfW: ROAD_HALF, halfH: ROAD_HALF, crosswalks };
}

/**
 * Traffic light for traffic arriving at intersection `ix` while travelling `dir`.
 * The stop line sits before the box; the signal head stands on the right-hand sidewalk.
 */
export function light(id: string, ix: IntersectionDef, dir: Dir, initial?: LightState): LightDef {
  const off = ROAD.stopLineOffset;
  const side = ROAD_HALF + ROAD.sidewalk * 0.9;
  let stop: Vec2;
  let head: Vec2;
  switch (dir) {
    case 'E':
      stop = { x: ix.x - ix.halfW - off, y: ix.y + LANE_OFFSET };
      head = { x: stop.x - 6, y: ix.y + side };
      break;
    case 'W':
      stop = { x: ix.x + ix.halfW + off, y: ix.y - LANE_OFFSET };
      head = { x: stop.x + 6, y: ix.y - side };
      break;
    case 'S':
      stop = { x: ix.x - LANE_OFFSET, y: ix.y - ix.halfH - off };
      head = { x: ix.x - side, y: stop.y - 6 };
      break;
    case 'N':
      stop = { x: ix.x + LANE_OFFSET, y: ix.y + ix.halfH + off };
      head = { x: ix.x + side, y: stop.y + 6 };
      break;
  }
  return { id, stop, dir, width: LW, head, initial };
}

/** Spawn and exit markers derived from route end points. */
export function endpoints(routes: RouteDef[]): { spawns: SpawnPointDef[]; exits: ExitPointDef[] } {
  const spawns = new Map<string, SpawnPointDef>();
  const exits = new Map<string, ExitPointDef>();
  const dirOf = (a: WaypointDef, b: WaypointDef): Dir =>
    Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 'E' : 'W') : b.y > a.y ? 'S' : 'N';
  for (const r of routes) {
    const p = r.points;
    if (!spawns.has(r.spawnId)) spawns.set(r.spawnId, { id: r.spawnId, x: p[0].x, y: p[0].y, dir: dirOf(p[0], p[1]) });
    const n = p.length;
    if (!exits.has(r.exitId)) exits.set(r.exitId, { id: r.exitId, x: p[n - 1].x, y: p[n - 1].y, dir: dirOf(p[n - 2], p[n - 1]) });
  }
  return { spawns: [...spawns.values()], exits: [...exits.values()] };
}

/**
 * Scatter trees, bushes and buildings in the free space between roads (deterministic).
 */
export function autoDecor(world: World, roads: RoadDef[], seed: number, density = 1): DecorDef[] {
  const rng = new SeededRandom(seed ^ 0x9e3779b9);
  const out: DecorDef[] = [];
  const clearance = ROAD_HALF + ROAD.sidewalk + 6;
  const nearRoad = (x: number, y: number, pad: number): boolean =>
    roads.some((r) => {
      const horizontal = r.from.y === r.to.y;
      if (horizontal) {
        const x0 = Math.min(r.from.x, r.to.x);
        const x1 = Math.max(r.from.x, r.to.x);
        return Math.abs(y - r.from.y) < clearance + pad && x > x0 - clearance - pad && x < x1 + clearance + pad;
      }
      const y0 = Math.min(r.from.y, r.to.y);
      const y1 = Math.max(r.from.y, r.to.y);
      return Math.abs(x - r.from.x) < clearance + pad && y > y0 - clearance - pad && y < y1 + clearance + pad;
    });
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

export type LevelInput = Omit<import('../types').LevelDef, 'spawns' | 'exits' | 'decor'> & { decorDensity?: number };

/** Complete a level definition with derived spawn/exit markers and decoration. */
export function defineLevel(input: LevelInput): import('../types').LevelDef {
  const { decorDensity, ...rest } = input;
  const { spawns, exits } = endpoints(rest.routes);
  return { ...rest, spawns, exits, decor: autoDecor(rest.world, rest.roads, rest.seed, decorDensity ?? 1) };
}
