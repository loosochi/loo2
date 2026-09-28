/**
 * Everything the player can build, with costs, rules and undo/redo. Operates on a RoadNetwork;
 * the game recompiles the level from the network after each change.
 */
import { BUILD, BUILD_COSTS } from '../config/balanceConfig';
import { halfWidth } from '../graph/geometry';
import { lightGeometry } from '../graph/NetworkCompiler';
import { MAX_LANES, RoadNetwork, cloneNetwork } from '../graph/RoadNetwork';
import { Command, CommandHistory } from '../history/CommandHistory';
import type { BuildRules, BuildTool, DecorDef, NetworkData, Vec2 } from '../types';
import { BudgetSystem } from './BudgetSystem';
import { checkGeometry, type BuildError } from './BuildValidator';
import { defaultBuildSettings, polylineLength, roadPolyline, snapPoint, type BuildSettings, type SnappedPoint } from './RoadBuilder';

export const GAME_TOOLS: BuildTool[] = ['road', 'delete', 'light', 'lane', 'direction', 'intersection', 'inspect'];
export const EDITOR_TOOLS: BuildTool[] = ['road', 'delete', 'light', 'lane', 'direction', 'intersection', 'spawn', 'exit', 'decor', 'inspect'];

export type BuildResult = { ok: true; cost: number } | { ok: false; reason: BuildError };

export interface RoadPlan {
  start: SnappedPoint;
  end: SnappedPoint;
  points: Vec2[];
  length: number;
  cost: number;
  valid: boolean;
  reason: BuildError | null;
}

interface BuildState {
  net: NetworkData;
  spent: number;
  builds: number;
  roads: number;
}

const ok = (cost: number): BuildResult => ({ ok: true, cost });
const fail = (reason: BuildError): BuildResult => ({ ok: false, reason });

export function roadCost(length: number, lanes = 2): number {
  return Math.ceil(length / BUILD.costUnit) * BUILD_COSTS.road * Math.max(1, lanes / 2);
}

// ------------------------------------------------------------------ commands

abstract class BuildCommand extends Command<BuildManager> {
  result: BuildResult = fail('build.nothing');
  protected done(m: BuildManager, cost: number): boolean {
    if (!m.budget.spend(cost)) {
      this.result = fail('build.noMoney');
      return false;
    }
    m.builds++;
    this.result = ok(cost);
    return true;
  }
  protected refuse(reason: BuildError): boolean {
    this.result = fail(reason);
    return false;
  }
}

export class CreateRoadCommand extends BuildCommand {
  readonly name = 'CreateRoad';
  constructor(private readonly plan: RoadPlan) {
    super();
  }
  perform(m: BuildManager): boolean {
    if (!this.plan.valid) return this.refuse(this.plan.reason ?? 'build.nothing');
    const pts = this.plan.points;
    for (let i = 0; i < pts.length - 1; i++) m.net.addRoad(pts[i], pts[i + 1]);
    m.roadsBuilt++;
    return this.done(m, this.plan.cost);
  }
}

export class DeleteRoadCommand extends BuildCommand {
  readonly name = 'DeleteRoad';
  constructor(private readonly edgeId: string) {
    super();
  }
  perform(m: BuildManager): boolean {
    const e = m.net.edge(this.edgeId);
    if (!e) return this.refuse('build.noRoad');
    if (e.locked) return this.refuse('build.locked');
    if (m.edgeInUse(this.edgeId)) return this.refuse('build.inUse');
    m.net.removeEdge(this.edgeId);
    return this.done(m, BUILD_COSTS.delete);
  }
}

export class ChangeDirectionCommand extends BuildCommand {
  readonly name = 'ChangeDirection';
  constructor(private readonly edgeId: string) {
    super();
  }
  perform(m: BuildManager): boolean {
    const e = m.net.edge(this.edgeId);
    if (!e) return this.refuse('build.noRoad');
    if (e.locked) return this.refuse('build.locked');
    if (m.edgeInUse(this.edgeId)) return this.refuse('build.inUse');
    m.net.cycleDirection(this.edgeId);
    return this.done(m, BUILD_COSTS.direction);
  }
}

export class ChangeLanesCommand extends BuildCommand {
  readonly name = 'ChangeLanes';
  /** `forward` = lanes travelling a→b. */
  constructor(
    private readonly edgeId: string,
    private readonly forward: boolean,
  ) {
    super();
  }
  perform(m: BuildManager): boolean {
    const e = m.net.edge(this.edgeId);
    if (!e) return this.refuse('build.noRoad');
    if (e.locked) return this.refuse('build.locked');
    if (m.edgeInUse(this.edgeId)) return this.refuse('build.inUse');
    // One-way roads grow in their only direction.
    let fwd = this.forward;
    if (e.f === 0) fwd = false;
    if (e.bk === 0) fwd = true;
    const cur = fwd ? e.f : e.bk;
    const next = cur >= MAX_LANES ? 1 : cur + 1;
    m.net.setLanes(e.id, fwd ? next : e.f, fwd ? e.bk : next);
    const geo = checkGeometry(m.net, m.world);
    if (geo) return this.refuse(geo);
    return this.done(m, next > cur ? BUILD_COSTS.lane : 0);
  }
}

export class AddTrafficLightCommand extends BuildCommand {
  readonly name = 'AddTrafficLight';
  constructor(
    private readonly node: string,
    private readonly edge: string,
  ) {
    super();
  }
  perform(m: BuildManager): boolean {
    if (!m.net.isJunction(this.node) || !lightGeometry(m.net, this.node, this.edge)) return this.refuse('build.notJunction');
    const max = m.rules.maxTrafficLights;
    if (max !== undefined && m.net.data.lights.filter((l) => !l.locked).length >= max) return this.refuse('build.limitLights');
    m.net.setLight(this.node, this.edge, true);
    return this.done(m, BUILD_COSTS.trafficLight);
  }
}

export class RemoveTrafficLightCommand extends BuildCommand {
  readonly name = 'RemoveTrafficLight';
  constructor(
    private readonly node: string,
    private readonly edge: string,
  ) {
    super();
  }
  perform(m: BuildManager): boolean {
    const l = m.net.lightAt(this.node, this.edge);
    if (!l) return this.refuse('build.nothing');
    if (l.locked) return this.refuse('build.locked');
    m.net.setLight(this.node, this.edge, false);
    return this.done(m, 0);
  }
}

export class ChangeIntersectionCommand extends BuildCommand {
  readonly name = 'ChangeIntersection';
  constructor(private readonly node: string) {
    super();
  }
  perform(m: BuildManager): boolean {
    if (!m.net.isJunction(this.node)) return this.refuse('build.notJunction');
    m.net.cyclePriority(this.node);
    return this.done(m, BUILD_COSTS.intersection);
  }
}

export class SetEndpointCommand extends BuildCommand {
  readonly name = 'SetEndpoint';
  /** Toggles an entry or an exit on a road end (a two-way road end can be both). */
  constructor(
    private readonly node: string,
    private readonly kind: 'spawn' | 'exit',
  ) {
    super();
  }
  perform(m: BuildManager): boolean {
    if (m.net.degree(this.node) !== 1) return this.refuse('build.endpointOnly');
    if (this.kind === 'spawn') {
      if (m.net.spawnAt(this.node)) m.net.setSpawn(this.node, null);
      else m.net.setSpawn(this.node, { count: 8, startDelay: 1, interval: [2.2, 3.4] });
    } else m.net.setExit(this.node, !m.net.exitAt(this.node));
    return this.done(m, 0);
  }
}

export class MoveEndpointCommand extends BuildCommand {
  readonly name = 'MoveEndpoint';
  constructor(
    private readonly from: string,
    private readonly to: string,
  ) {
    super();
  }
  perform(m: BuildManager): boolean {
    if (m.net.degree(this.to) !== 1) return this.refuse('build.endpointOnly');
    if (!m.net.moveEndpoint(this.from, this.to)) return this.refuse('build.occupied');
    return this.done(m, 0);
  }
}

export class DecorCommand extends BuildCommand {
  readonly name = 'Decoration';
  constructor(
    private readonly p: Vec2,
    private readonly kind: DecorDef['type'],
  ) {
    super();
  }
  perform(m: BuildManager): boolean {
    const list = (m.net.data.decor ??= []);
    const hit = list.findIndex((d) => Math.hypot(d.x - this.p.x, d.y - this.p.y) < (d.type === 'building' ? 30 : 16));
    if (hit >= 0) list.splice(hit, 1);
    else if (this.kind === 'building') list.push({ type: 'building', x: this.p.x, y: this.p.y, w: 60, h: 54, color: list.length % 6 });
    else list.push({ type: this.kind, x: this.p.x, y: this.p.y, r: 12 });
    m.net.touch();
    return this.done(m, 0);
  }
}

// ------------------------------------------------------------------ manager

export class BuildManager {
  readonly net: RoadNetwork;
  readonly budget: BudgetSystem;
  readonly history: CommandHistory<BuildManager, BuildState>;
  builds = 0;
  roadsBuilt = 0;
  settings: BuildSettings = defaultBuildSettings();
  /** Game hook: is a road currently carrying vehicles (cannot be removed or changed)? */
  edgeInUse: (edgeId: string) => boolean = () => false;
  /** Called after every successful change, undo or redo. */
  onChange: () => void = () => {};

  constructor(
    network: NetworkData,
    budget: number,
    readonly rules: BuildRules,
    readonly world: { width: number; height: number },
    readonly tools: readonly BuildTool[] = rules.allowed ?? GAME_TOOLS,
  ) {
    this.net = new RoadNetwork(cloneNetwork(network));
    this.budget = new BudgetSystem(budget);
    this.history = new CommandHistory<BuildManager, BuildState>(this, {
      save: () => ({ net: cloneNetwork(this.net.data), spent: this.budget.spent, builds: this.builds, roads: this.roadsBuilt }),
      restore: (s) => {
        this.net.restore(s.net);
        this.budget.spent = s.spent;
        this.builds = s.builds;
        this.roadsBuilt = s.roads;
      },
    });
  }

  isAllowed(tool: BuildTool): boolean {
    return tool === 'inspect' || this.tools.includes(tool);
  }

  private run(cmd: BuildCommand, tool: BuildTool): BuildResult {
    if (!this.isAllowed(tool)) return fail('build.toolLocked');
    const done = this.history.execute(cmd);
    if (done) this.onChange();
    return cmd.result;
  }

  // -------------------------------------------------------------- roads

  /** Preview of a road dragged from `a` to `b` (world coordinates). */
  planRoad(a: Vec2, b: Vec2): RoadPlan {
    const start = snapPoint(this.net, a, this.settings, this.world);
    const end = snapPoint(this.net, b, this.settings, this.world);
    const points = roadPolyline(start, end);
    const length = polylineLength(points);
    const cost = roadCost(length);
    const plan: RoadPlan = { start, end, points, length, cost, valid: false, reason: null };
    const max = this.rules.maxRoadLength ?? BUILD.defaultMaxRoadLength;
    if (points.length < 2 || length < BUILD.minRoadLength) plan.reason = 'build.tooShort';
    else if (length > max) plan.reason = 'build.tooLong';
    else if (this.rules.maxRoadCount !== undefined && this.roadsBuilt >= this.rules.maxRoadCount) plan.reason = 'build.limitRoads';
    else if (!this.budget.canAfford(cost)) plan.reason = 'build.noMoney';
    else {
      // Try it on a copy of the network.
      const trial = this.net.clone();
      const before = trial.edges.length;
      for (let i = 0; i < points.length - 1; i++) trial.addRoad(points[i], points[i + 1]);
      if (trial.edges.length === before) plan.reason = 'build.nothing';
      else plan.reason = checkGeometry(trial, this.world);
    }
    plan.valid = plan.reason === null;
    return plan;
  }

  buildRoad(plan: RoadPlan): BuildResult {
    return this.run(new CreateRoadCommand(plan), 'road');
  }

  deleteRoad(edgeId: string): BuildResult {
    return this.run(new DeleteRoadCommand(edgeId), 'delete');
  }

  cycleDirection(edgeId: string): BuildResult {
    return this.run(new ChangeDirectionCommand(edgeId), 'direction');
  }

  /** Add a lane on the side of the road nearest to `p` (cycles 1 → 2 → 3 → 1). */
  cycleLanes(edgeId: string, p: Vec2): BuildResult {
    const e = this.net.edge(edgeId);
    if (!e) return fail('build.noRoad');
    const a = this.net.node(e.a)!;
    const b = this.net.node(e.b)!;
    const right = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0;
    return this.run(new ChangeLanesCommand(edgeId, right), 'lane');
  }

  toggleLight(nodeId: string, edgeId: string): BuildResult {
    const has = !!this.net.lightAt(nodeId, edgeId);
    return this.run(has ? new RemoveTrafficLightCommand(nodeId, edgeId) : new AddTrafficLightCommand(nodeId, edgeId), 'light');
  }

  cyclePriority(nodeId: string): BuildResult {
    return this.run(new ChangeIntersectionCommand(nodeId), 'intersection');
  }

  toggleEndpoint(nodeId: string, kind: 'spawn' | 'exit'): BuildResult {
    return this.run(new SetEndpointCommand(nodeId, kind), kind);
  }

  moveEndpoint(from: string, to: string): BuildResult {
    return this.run(new MoveEndpointCommand(from, to), this.net.spawnAt(from) ? 'spawn' : 'exit');
  }

  toggleDecor(p: Vec2, kind: DecorDef['type'] = 'tree'): BuildResult {
    return this.run(new DecorCommand(p, kind), 'decor');
  }

  undo(): boolean {
    const r = this.history.undo();
    if (r) this.onChange();
    return r;
  }

  redo(): boolean {
    const r = this.history.redo();
    if (r) this.onChange();
    return r;
  }

  // -------------------------------------------------------------- picking

  pickEdge(p: Vec2, radius = 30): string | null {
    const hit = this.net.findEdgeNear(p, radius);
    if (!hit) return null;
    return hit.d <= halfWidth(hit.edge) + radius ? hit.edge.id : null;
  }

  pickNode(p: Vec2, radius = 36): string | null {
    return this.net.findNodeNear(p, radius)?.id ?? null;
  }

  /** The junction approach (node + incoming road) whose stop line is nearest to `p`. */
  pickApproach(p: Vec2, radius = 70): { node: string; edge: string } | null {
    let best: { node: string; edge: string } | null = null;
    let bd = radius;
    for (const n of this.net.nodes) {
      if (!this.net.isJunction(n.id)) continue;
      for (const e of this.net.edgesAt(n.id)) {
        const g = lightGeometry(this.net, n.id, e.id);
        if (!g) continue;
        const d = Math.min(Math.hypot(g.stop.x - p.x, g.stop.y - p.y), Math.hypot(g.head.x - p.x, g.head.y - p.y));
        if (d < bd) {
          bd = d;
          best = { node: n.id, edge: e.id };
        }
      }
    }
    return best;
  }
}
