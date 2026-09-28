/** Authoring helpers for the road-network campaign. */
import type { BuildManager } from '../../building/BuildManager';
import { buildNetworkLevel, type NetworkLevelInput } from '../../graph/NetworkCompiler';
import { RoadNetwork } from '../../graph/RoadNetwork';
import type { LevelDef, NetSpawn, NetworkData, Vec2, VehicleKind } from '../../types';

export type P = [number, number];

export class NetBuilder {
  readonly net = new RoadNetwork();
  private unlocked: Vec2[] = [];

  /** Polyline road through the given points. */
  road(pts: P[], lanes: { f?: number; bk?: number } = {}): this {
    for (let i = 0; i < pts.length - 1; i++) {
      const created = this.net.addRoad({ x: pts[i][0], y: pts[i][1] }, { x: pts[i + 1][0], y: pts[i + 1][1] });
      for (const e of created) this.net.setLanes(e.id, lanes.f ?? 1, lanes.bk ?? 1);
    }
    return this;
  }

  /** Road the player may modify / delete (every other road is fixed infrastructure). */
  editable(p: P): this {
    this.unlocked.push({ x: p[0], y: p[1] });
    return this;
  }

  id(x: number, y: number): string {
    const n = this.net.findNodeNear({ x, y }, 2);
    if (!n) throw new Error(`no node at ${x},${y}`);
    return n.id;
  }

  spawn(p: P, count: number, interval: [number, number], opts: { delay?: number; mix?: Partial<Record<VehicleKind, number>>; to?: P[] } = {}): this {
    const s = this.net.setSpawn(this.id(p[0], p[1]), { count, startDelay: opts.delay ?? 0.5, interval, mix: opts.mix })!;
    if (opts.to) (s as NetSpawn).to = opts.to.map((q) => this.net.exitAt(this.id(q[0], q[1]))!.id);
    return this;
  }

  exit(...ps: P[]): this {
    for (const p of ps) this.net.setExit(this.id(p[0], p[1]), true);
    return this;
  }

  /** Fixed traffic light at junction `at` for traffic arriving from the direction of `from`. */
  light(at: P, from: P): this {
    const node = this.id(at[0], at[1]);
    const e = this.edgeTowards(node, from);
    this.net.setLight(node, e, true);
    this.net.data.lights[this.net.data.lights.length - 1].locked = true;
    return this;
  }

  /** Main road (right of way) of an unsignalled junction: the roads towards `a` and `b`. */
  priority(at: P, a: P, b: P): this {
    const node = this.id(at[0], at[1]);
    this.net.node(node)!.priority = [this.edgeTowards(node, a), this.edgeTowards(node, b)];
    return this;
  }

  emergency(at: number, from: P, to: P, kind: VehicleKind): this {
    const spawn = this.net.spawnAt(this.id(from[0], from[1]))!;
    const exit = this.net.exitAt(this.id(to[0], to[1]))!;
    this.net.data.specials!.push({ at, spawn: spawn.id, exit: exit.id, kind });
    return this;
  }

  edgeTowards(node: string, towards: P): string {
    const n = this.net.node(node)!;
    let best = '';
    let bd = Infinity;
    for (const e of this.net.edgesAt(node)) {
      const o = this.net.node(this.net.other(e, node))!;
      const ang = Math.abs(Math.atan2(o.y - n.y, o.x - n.x) - Math.atan2(towards[1] - n.y, towards[0] - n.x));
      const d = Math.min(ang, Math.PI * 2 - ang);
      if (d < bd) {
        bd = d;
        best = e.id;
      }
    }
    return best;
  }

  data(): NetworkData {
    // Edge ids in priorities survive (no merges happen here).
    for (const e of this.net.edges) {
      const a = this.net.node(e.a)!;
      const b = this.net.node(e.b)!;
      const free = this.unlocked.some((p) => {
        const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        return t > 0 && t < 1 && Math.hypot(q.x - p.x, q.y - p.y) < 2;
      });
      if (free) delete e.locked;
      else e.locked = true;
    }
    return this.net.data;
  }
}

export interface CampaignLevel {
  level: LevelDef;
  /** Reference solution (used by the tests to prove the level is winnable). */
  solve: (m: BuildManager) => void;
}

export function campaign(input: Omit<NetworkLevelInput, 'world'> & { world?: { width: number; height: number } }, solve: (m: BuildManager) => void): CampaignLevel {
  return { level: buildNetworkLevel({ world: { width: 800, height: 640 }, ...input }), solve };
}

/** Solution helpers. */
export const at = (m: BuildManager, x: number, y: number): string => m.net.findNodeNear({ x, y }, 2)!.id;
export function lightFrom(m: BuildManager, node: P, from: P): void {
  const nid = at(m, node[0], node[1]);
  const n = m.net.node(nid)!;
  let best = '';
  let bd = Infinity;
  for (const e of m.net.edgesAt(nid)) {
    const o = m.net.node(m.net.other(e, nid))!;
    const d = Math.hypot(o.x - from[0], o.y - from[1]) - Math.hypot(o.x - n.x, o.y - n.y) * 0;
    if (d < bd) {
      bd = d;
      best = e.id;
    }
  }
  const r = m.toggleLight(nid, best);
  if (!r.ok) throw new Error(`solution light failed: ${r.reason}`);
}
export function allLights(m: BuildManager, node: P): void {
  const nid = at(m, node[0], node[1]);
  for (const e of m.net.edgesAt(nid)) {
    if (m.net.lanesInto(e, nid) === 0) continue;
    const r = m.toggleLight(nid, e.id);
    if (!r.ok) throw new Error(`solution light failed: ${r.reason}`);
  }
}
