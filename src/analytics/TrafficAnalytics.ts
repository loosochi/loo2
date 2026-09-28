/**
 * Live traffic statistics for road-network levels: per road utilisation, speed and flow; per
 * light queue; per junction throughput, delay and busiest movement. No rendering here.
 */
import { DRIVING } from '../config/balanceConfig';
import type { Vehicle } from '../entities/Vehicle';
import { nodeRadius } from '../graph/geometry';
import type { RoadNetwork } from '../graph/RoadNetwork';
import type { RuntimeRoute } from '../systems/RouteNetwork';
import type { TrafficSimulation } from '../systems/TrafficSimulation';
import { wrapAngle } from '../utils/math';

export type LoadLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Movement = 'straight' | 'left' | 'right';

export function loadLevel(u: number): LoadLevel {
  if (u < 0.3) return 'LOW';
  if (u < 0.6) return 'MEDIUM';
  if (u < 0.85) return 'HIGH';
  return 'CRITICAL';
}

export interface EdgeStats {
  vehicles: number;
  utilization: number;
  level: LoadLevel;
  avgSpeed: number;
  perMinute: number;
  length: number;
  lanes: number;
  queue: number;
}

export interface NodeStats {
  perMinute: number;
  avgDelay: number;
  topMovement: Movement | null;
  conflictPoints: number;
  passes: number;
}

export interface LightStats {
  state: string;
  incoming: number;
  queue: number;
}

export interface GlobalStats {
  vehicles: number;
  density: number;
  avgSpeed: number;
  avgWait: number;
  longestQueue: number;
}

interface Track {
  edgeIndex: number;
  waitAtEntry: number;
}

const WINDOW = 60;

export class TrafficAnalytics {
  private ranges = new WeakMap<RuntimeRoute, number[]>();
  private tracks = new Map<number, Track>();
  private edgeEnters = new Map<string, number[]>();
  private nodePasses = new Map<string, { t: number; delay: number; move: Movement }[]>();
  private speedEma = new Map<string, number>();
  private current = new Map<string, Vehicle[]>();
  private startTime: number;

  constructor(
    private sim: TrafficSimulation,
    private net: RoadNetwork,
  ) {
    this.startTime = sim.time;
  }

  /** Re-point at a new simulation / network (after rebuilding) without losing history. */
  rebind(sim: TrafficSimulation, net: RoadNetwork): void {
    this.sim = sim;
    this.net = net;
  }

  /** Arc positions of the route's nodes (junction centres), computed once per route. */
  private nodeS(r: RuntimeRoute): number[] {
    let s = this.ranges.get(r);
    if (s) return s;
    s = [];
    let from = 0;
    for (const id of r.def.nodes ?? []) {
      const n = this.net.node(id);
      if (!n) {
        s.push(from);
        continue;
      }
      const hit = r.path.closestInRange(n, from, r.path.length);
      s.push(hit.s);
      from = hit.s;
    }
    this.ranges.set(r, s);
    return s;
  }

  private edgeIndexOf(v: Vehicle): number {
    const s = this.nodeS(v.route);
    let i = 0;
    while (i + 1 < s.length - 1 && v.s >= s[i + 1]) i++;
    return i;
  }

  private movement(v: Vehicle, sNode: number): Movement {
    const p = v.route.path;
    const d = wrapAngle(p.headingAt(Math.min(p.length, sNode + 40)) - p.headingAt(Math.max(0, sNode - 40)));
    if (Math.abs(d) < 0.4) return 'straight';
    return d > 0 ? 'right' : 'left';
  }

  update(): void {
    const t = this.sim.time;
    this.current.clear();
    const alive = new Set<number>();
    for (const v of this.sim.vehicles) {
      const edges = v.route.def.edges;
      if (!edges) continue;
      alive.add(v.id);
      const idx = this.edgeIndexOf(v);
      const tr = this.tracks.get(v.id);
      if (!tr || tr.edgeIndex !== idx) {
        if (tr && idx > tr.edgeIndex) {
          const nodeId = v.route.def.nodes![idx];
          const list = this.nodePasses.get(nodeId) ?? [];
          list.push({ t, delay: v.waitTime - tr.waitAtEntry, move: this.movement(v, this.nodeS(v.route)[idx]) });
          this.nodePasses.set(nodeId, list);
        }
        const eid = edges[idx];
        const enters = this.edgeEnters.get(eid) ?? [];
        enters.push(t);
        this.edgeEnters.set(eid, enters);
        this.tracks.set(v.id, { edgeIndex: idx, waitAtEntry: v.waitTime });
      }
      const eid = edges[idx];
      const list = this.current.get(eid) ?? [];
      list.push(v);
      this.current.set(eid, list);
    }
    for (const id of [...this.tracks.keys()]) if (!alive.has(id)) this.tracks.delete(id);
    for (const [eid, vs] of this.current) {
      const avg = vs.reduce((s, v) => s + v.speed, 0) / vs.length;
      const prev = this.speedEma.get(eid);
      this.speedEma.set(eid, prev === undefined ? avg : prev * 0.9 + avg * 0.1);
    }
    // Forget events older than the window.
    for (const [k, list] of this.edgeEnters) this.edgeEnters.set(k, list.filter((x) => t - x <= WINDOW));
    for (const [k, list] of this.nodePasses) this.nodePasses.set(k, list.filter((x) => t - x.t <= WINDOW));
  }

  private perMinute(count: number): number {
    const span = Math.max(10, Math.min(WINDOW, this.sim.time - this.startTime));
    return (count * 60) / span;
  }

  edge(edgeId: string): EdgeStats | null {
    const e = this.net.edge(edgeId);
    if (!e) return null;
    const length = this.net.length(e);
    const lanes = e.f + e.bk;
    const vs = this.current.get(edgeId) ?? [];
    const occupied = vs.reduce((s, v) => s + v.length + DRIVING.minGap, 0);
    const utilization = Math.min(1, occupied / Math.max(1, lanes * length));
    return {
      vehicles: vs.length,
      utilization,
      level: loadLevel(utilization),
      avgSpeed: vs.length ? (this.speedEma.get(edgeId) ?? 0) : 0,
      perMinute: this.perMinute(this.edgeEnters.get(edgeId)?.length ?? 0),
      length,
      lanes,
      queue: vs.filter((v) => v.speed < DRIVING.waitingSpeed).length,
    };
  }

  node(nodeId: string): NodeStats | null {
    const n = this.net.node(nodeId);
    if (!n) return null;
    const passes = this.nodePasses.get(nodeId) ?? [];
    const counts: Record<Movement, number> = { straight: 0, left: 0, right: 0 };
    for (const p of passes) counts[p.move]++;
    const top = (Object.keys(counts) as Movement[]).sort((a, b) => counts[b] - counts[a])[0];
    const r = nodeRadius(this.net, n) + 20;
    return {
      perMinute: this.perMinute(passes.length),
      avgDelay: passes.length ? passes.reduce((s, p) => s + p.delay, 0) / passes.length : 0,
      topMovement: passes.length ? top : null,
      conflictPoints: this.sim.collisions.zones.filter((z) => Math.hypot(z.x - n.x, z.y - n.y) < r).length,
      passes: passes.length,
    };
  }

  light(lightId: string): LightStats | null {
    const l = this.sim.lights.get(lightId);
    if (!l) return null;
    let incoming = 0;
    let queue = 0;
    for (const v of this.sim.vehicles) {
      const st = v.route.stops[v.nextStop];
      if (!st || st.light !== l || st.s - v.front > 220) continue;
      incoming++;
      if (v.speed < DRIVING.waitingSpeed) queue++;
    }
    return { state: l.state, incoming, queue };
  }

  global(): GlobalStats {
    const vs = this.sim.vehicles;
    const totalLen = this.net.edges.reduce((s, e) => s + this.net.length(e) * (e.f + e.bk), 0);
    const occupied = vs.reduce((s, v) => s + v.length + DRIVING.minGap, 0);
    let longest = 0;
    for (const e of this.net.edges) longest = Math.max(longest, this.edge(e.id)?.queue ?? 0);
    return {
      vehicles: vs.length,
      density: totalLen ? occupied / totalLen : 0,
      avgSpeed: vs.length ? vs.reduce((s, v) => s + v.speed, 0) / vs.length : 0,
      avgWait: this.sim.score.avgWait,
      longestQueue: longest,
    };
  }
}
