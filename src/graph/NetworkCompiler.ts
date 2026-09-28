/**
 * Compiles an editable RoadNetwork into the route/light/flow format the traffic simulation
 * runs on. Routes are found with A*, every junction transition gets a lane-to-lane turning
 * curve, unsignalled junctions get right-of-way (yield) rules.
 */
import { ROAD } from '../config/balanceConfig';
import type {
  BuildRules,
  DecorDef,
  FlowDef,
  LevelDef,
  LightDef,
  NetworkData,
  NetNode,
  Objective,
  RouteDef,
  SpecialDef,
  StarCriteria,
  TutorialStep,
  Vec2,
  WaypointDef,
} from '../types';
import { LightState } from '../types';
import { SeededRandom } from '../utils/math';
import { LW, STOP_GAP, frame, halfWidth, laneOffset, lineIntersection, nodeRadius, onBoundary } from './geometry';
import { PathFinder } from './PathFinder';
import { RoadNetwork, distToSegment, type Traversal } from './RoadNetwork';

export const OFFSCREEN = 60;

export type Turn = 'straight' | 'right' | 'left' | 'end';

export function classifyTurn(a: Traversal, b: Traversal | undefined): Turn {
  if (!b) return 'end';
  const u = frame(a.from, a.to).u;
  const v = frame(b.from, b.to).u;
  const dot = u.x * v.x + u.y * v.y;
  if (dot > 0.94) return 'straight';
  return u.x * v.y - u.y * v.x > 0 ? 'right' : 'left';
}

export const lightId = (node: string, edge: string): string => `L:${node}:${edge}`;

/** Main road pair of an unsignalled junction (null = everyone yields). */
export function mainPair(net: RoadNetwork, node: NetNode): [string, string] | null {
  const p = node.priority;
  if (p === 'allway') return null;
  if (Array.isArray(p)) return p;
  const es = net.edgesAt(node.id);
  let best: [string, string] | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const a = net.node(net.other(es[i], node.id))!;
      const b = net.node(net.other(es[j], node.id))!;
      const u = frame(node, a).u;
      const v = frame(node, b).u;
      const straight = -(u.x * v.x + u.y * v.y); // 1 = opposite directions
      if (straight < 0.94) continue;
      const score = straight + (es[i].f + es[i].bk + es[j].f + es[j].bk) * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = [es[i].id, es[j].id];
      }
    }
  }
  return best;
}

export interface CompiledNetwork {
  routes: RouteDef[];
  lights: LightDef[];
  flows: FlowDef[];
  specials: SpecialDef[];
  /** Spawn ids with no possible route to any exit. */
  unreachableSpawns: string[];
  /** Required destinations (spawn.to) that cannot be reached. */
  unreachablePairs: { spawn: string; exit: string }[];
  pathfindingMs: number;
}

/** Lane position helper for a traversal. */
function laneLine(t: Traversal, lane: number): { p: Vec2; u: Vec2; n: Vec2 } {
  const f = frame(t.from, t.to);
  const off = laneOffset(lane, halfWidth(t.edge) * 2);
  return { p: { x: t.from.x + f.n.x * off, y: t.from.y + f.n.y * off }, u: f.u, n: f.n };
}

function pointOnLane(t: Traversal, lane: number, node: Vec2): Vec2 {
  const l = laneLine(t, lane);
  const off = laneOffset(lane, halfWidth(t.edge) * 2);
  return { x: node.x + l.n.x * off, y: node.y + l.n.y * off };
}

/** Build waypoints for a path with a preferred lane `pref`. */
export function routePoints(
  net: RoadNetwork,
  trav: Traversal[],
  pref: number,
  world: { width: number; height: number },
): { points: WaypointDef[]; lanes: number[] } {
  const lanes = trav.map((t, i) => {
    const turn = classifyTurn(t, trav[i + 1]);
    if (turn === 'right') return 0;
    if (turn === 'left') return t.lanes - 1;
    return Math.min(pref, t.lanes - 1);
  });
  const pts: WaypointDef[] = [];
  const first = trav[0];
  const f0 = frame(first.from, first.to);
  const s0 = pointOnLane(first, lanes[0], first.from);
  const back = onBoundary(first.from, world) ? OFFSCREEN : 0;
  pts.push({ x: s0.x - f0.u.x * back, y: s0.y - f0.u.y * back });

  for (let i = 0; i < trav.length - 1; i++) {
    const tin = trav[i];
    const tout = trav[i + 1];
    const N = tin.to;
    const r = Math.max(nodeRadius(net, N), 12);
    const Lin = pointOnLane(tin, lanes[i], N);
    const Lout = pointOnLane(tout, lanes[i + 1], N);
    const uin = frame(tin.from, tin.to).u;
    const uout = frame(tout.from, tout.to).u;
    const turn = classifyTurn(tin, tout);
    const Pin = { x: Lin.x - uin.x * r, y: Lin.y - uin.y * r };
    const Pout = { x: Lout.x + uout.x * r, y: Lout.y + uout.y * r };
    if (turn === 'straight') {
      if (Math.hypot(Lin.x - Lout.x, Lin.y - Lout.y) > 1) pts.push(Pin, Pout);
      continue;
    }
    const x = lineIntersection(Lin, uin, Lout, uout);
    // Corner must lie between the approach and the exit; otherwise use a two-point connector.
    if (!x || x.a < -r + 2 || x.b > r - 2) {
      pts.push(Pin, Pout);
      continue;
    }
    const C = x.point;
    const rr = Math.max(6, Math.min(Math.hypot(C.x - Pin.x, C.y - Pin.y), Math.hypot(C.x - Pout.x, C.y - Pout.y)));
    pts.push({ x: C.x, y: C.y, r: rr });
  }

  const last = trav[trav.length - 1];
  const fl = frame(last.from, last.to);
  const e0 = pointOnLane(last, lanes[lanes.length - 1], last.to);
  const fwd = onBoundary(last.to, world) ? OFFSCREEN : 0;
  pts.push({ x: e0.x + fl.u.x * fwd, y: e0.y + fl.u.y * fwd });
  return { points: pts, lanes };
}

/** Stop line + signal head for a light at `node` controlling traffic arriving via `edge`. */
export function lightGeometry(net: RoadNetwork, nodeId: string, edgeId: string): Omit<LightDef, 'id' | 'initial'> | null {
  const node = net.node(nodeId);
  const edge = net.edge(edgeId);
  if (!node || !edge) return null;
  const lanesIn = net.lanesInto(edge, nodeId);
  if (lanesIn === 0) return null;
  const from = net.node(net.other(edge, nodeId))!;
  const f = frame(from, node);
  const W = halfWidth(edge) * 2;
  const r = nodeRadius(net, node);
  const centerOff = W / 2 - (lanesIn * LW) / 2;
  const back = r + STOP_GAP;
  const stop = { x: node.x - f.u.x * back + f.n.x * centerOff, y: node.y - f.u.y * back + f.n.y * centerOff };
  const side = W / 2 + ROAD.sidewalk * 0.9 + 3;
  const head = { x: node.x - f.u.x * (back + 8) + f.n.x * side, y: node.y - f.u.y * (back + 8) + f.n.y * side };
  const angle = Math.atan2(f.u.y, f.u.x);
  const dir = Math.abs(f.u.x) >= Math.abs(f.u.y) ? (f.u.x > 0 ? 'E' : 'W') : f.u.y > 0 ? 'S' : 'N';
  return { stop, head, width: lanesIn * LW, angle, dir };
}

export function compileNetwork(net: RoadNetwork, world: { width: number; height: number }): CompiledNetwork {
  const pf = new PathFinder(net);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const d = net.data;

  const lights: LightDef[] = [];
  for (const l of d.lights) {
    const g = lightGeometry(net, l.node, l.edge);
    if (!g) continue;
    lights.push({ id: lightId(l.node, l.edge), ...g, initial: l.initial ?? LightState.RED });
  }
  const lightSet = new Set(d.lights.map((l) => `${l.node}|${l.edge}`));

  const routes: RouteDef[] = [];
  const flows: FlowDef[] = [];
  const unreachable: string[] = [];
  const missingPairs: { spawn: string; exit: string }[] = [];
  const routeFor = new Map<string, string>();

  for (const sp of d.spawns) {
    const targets = d.exits.filter((x) => x.node !== sp.node && (!sp.to || sp.to.includes(x.id)));
    const weights: { id: string; weight: number }[] = [];
    const seen = new Set<string>();
    for (const ex of targets) {
      const res = pf.find(sp.node, ex.node);
      if (!res || res.traversals.length === 0) {
        if (sp.to) missingPairs.push({ spawn: sp.id, exit: ex.id });
        continue;
      }
      const tr = res.traversals;
      const variants: RouteDef[] = [];
      for (let p = 0; p < tr[0].lanes; p++) {
        const { points } = routePoints(net, tr, p, world);
        const key = points.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join(';');
        if (seen.has(key)) continue;
        seen.add(key);
        const yields: { x: number; y: number; r: number }[] = [];
        for (let i = 0; i < tr.length - 1; i++) {
          const N = tr[i].to;
          if (net.degree(N.id) < 3) continue;
          const signalled = lightSet.has(`${N.id}|${tr[i].edge.id}`);
          if (signalled) continue;
          const nodeHasLights = d.lights.some((l) => l.node === N.id);
          const mp = mainPair(net, N);
          // The main road (default: the straightest wide pair; chosen with the Intersection tool) never yields.
          const main = !nodeHasLights && mp !== null && mp.includes(tr[i].edge.id) && mp.includes(tr[i + 1].edge.id);
          if (!main) yields.push({ x: N.x, y: N.y, r: nodeRadius(net, N) + 14 });
        }
        const id = `${sp.id}>${ex.id}#${p}`;
        variants.push({
          id,
          spawnId: sp.id,
          exitId: ex.id,
          points,
          yields: yields.length ? yields : undefined,
          nodes: [tr[0].from.id, ...tr.map((t) => t.to.id)],
          edges: tr.map((t) => t.edge.id),
        });
      }
      if (!variants.length) continue;
      routeFor.set(`${sp.id}>${ex.id}`, variants[0].id);
      routes.push(...variants);
      for (const v of variants) weights.push({ id: v.id, weight: 1 / variants.length });
    }
    if (!weights.length) {
      unreachable.push(sp.id);
      continue;
    }
    flows.push({ spawnId: sp.id, routes: weights, count: sp.count, startDelay: sp.startDelay, interval: sp.interval, mix: sp.mix });
  }

  const specials: SpecialDef[] = [];
  for (const s of d.specials ?? []) {
    const rid = routeFor.get(`${s.spawn}>${s.exit}`);
    if (rid) specials.push({ at: s.at, spawnId: s.spawn, routeId: rid, kind: s.kind });
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return { routes, lights, flows, specials, unreachableSpawns: unreachable, unreachablePairs: missingPairs, pathfindingMs: t1 - t0 };
}

/** Deterministic trees and buildings placed away from every road. */
export function networkDecor(net: RoadNetwork, world: { width: number; height: number }, seed: number, density = 1): DecorDef[] {
  const rng = new SeededRandom(seed ^ 0x51ed270b);
  const out: DecorDef[] = [];
  const segs = net.edges.map((e) => ({ a: net.node(e.a)!, b: net.node(e.b)!, half: halfWidth(e) + ROAD.sidewalk + 8 }));
  const nearRoad = (x: number, y: number, pad: number) =>
    segs.some((s) => distToSegment({ x, y }, s.a, s.b).d < s.half + pad) ||
    net.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < nodeRadius(net, n) + ROAD.sidewalk + pad + 8);
  const overlaps = (x: number, y: number, rad: number) =>
    out.some((dd) => Math.hypot(dd.x - x, dd.y - y) < (dd.type === 'building' ? Math.max(dd.w ?? 0, dd.h ?? 0) / 2 : (dd.r ?? 10)) + rad + 4);
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
  // Hand-placed decorations (editor) that are not under a road.
  for (const dd of net.data.decor ?? []) if (!nearRoad(dd.x, dd.y, 4)) out.push(dd);
  return out;
}

export interface NetworkLevelInput {
  id: number;
  key: string;
  name: string;
  description: string;
  ru?: LevelDef['ru'];
  hint?: string;
  world: { width: number; height: number };
  seed: number;
  network: NetworkData;
  budget: number;
  rules?: BuildRules;
  objectives: Objective[];
  stars: StarCriteria;
  tutorial?: TutorialStep[];
  custom?: boolean;
  decorDensity?: number;
}

/** A playable schema-2 level: the network plus everything compiled from it. */
export function buildNetworkLevel(input: NetworkLevelInput): LevelDef {
  const net = new RoadNetwork(input.network);
  const c = compileNetwork(net, input.world);
  const pass = input.objectives.find((o) => o.type === 'PASS_CARS' || o.type === 'PASS_CARS_WITHOUT_CRASH');
  const limit = input.objectives.find((o) => o.type === 'TIME_LIMIT');
  const total = input.network.spawns.reduce((s, sp) => s + sp.count, 0) + (input.network.specials?.length ?? 0);
  return {
    id: input.id,
    key: input.key,
    name: input.name,
    description: input.description,
    ru: input.ru,
    hint: input.hint,
    world: input.world,
    seed: input.seed,
    roads: [],
    intersections: [],
    lights: c.lights,
    spawns: [],
    exits: [],
    routes: c.routes,
    flows: c.flows,
    specials: c.specials.length ? c.specials : undefined,
    goal: { carsToPass: pass?.value ?? total, timeLimit: limit?.value },
    stars: input.stars,
    decor: networkDecor(net, input.world, input.seed, input.decorDensity ?? 1),
    tutorial: input.tutorial,
    custom: input.custom,
    schemaVersion: 2,
    network: input.network,
    budget: input.budget,
    rules: input.rules,
    objectives: input.objectives,
  };
}

/** Re-compile a level after its network changed (keeps all metadata). */
export function recompileLevel(level: LevelDef, network: NetworkData): LevelDef {
  return buildNetworkLevel({
    id: level.id,
    key: level.key,
    name: level.name,
    description: level.description,
    ru: level.ru,
    hint: level.hint,
    world: level.world,
    seed: level.seed,
    network,
    budget: level.budget ?? 0,
    rules: level.rules,
    objectives: level.objectives ?? [],
    stars: level.stars,
    tutorial: level.tutorial,
    custom: level.custom,
  });
}
