/**
 * Geometry rules for road networks: junction spacing, angles, road lengths and map bounds.
 * Used to validate a build before it is applied (on a cloned network).
 */
import { BUILD } from '../config/balanceConfig';
import { nodeRadius } from '../graph/geometry';
import type { RoadNetwork } from '../graph/RoadNetwork';

export type BuildError =
  | 'build.tooShort'
  | 'build.tooLong'
  | 'build.outside'
  | 'build.tooClose'
  | 'build.angle'
  | 'build.noMoney'
  | 'build.limitRoads'
  | 'build.limitLights'
  | 'build.locked'
  | 'build.inUse'
  | 'build.toolLocked'
  | 'build.notJunction'
  | 'build.noRoad'
  | 'build.nothing'
  | 'build.endpointOnly'
  | 'build.occupied';

/** Problems with a network's geometry (null = fine). */
export function checkGeometry(net: RoadNetwork, world: { width: number; height: number }): BuildError | null {
  for (const n of net.nodes) {
    if (n.x < -0.5 || n.y < -0.5 || n.x > world.width + 0.5 || n.y > world.height + 0.5) return 'build.outside';
  }
  const radius = new Map(net.nodes.map((n) => [n.id, nodeRadius(net, n)]));
  // Junctions (and road ends) must keep their distance.
  const ns = net.nodes.filter((n) => net.degree(n.id) > 0);
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i];
      const b = ns[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const bothJunctions = net.degree(a.id) >= 3 && net.degree(b.id) >= 3;
      const need = Math.max(bothJunctions ? BUILD.minNodeGap : 30, radius.get(a.id)! + radius.get(b.id)! + 16);
      if (d < need) return 'build.tooClose';
    }
  }
  for (const e of net.edges) {
    const need = Math.max(30, radius.get(e.a)! + radius.get(e.b)! + 12);
    if (net.length(e) < need) return 'build.tooClose';
  }
  // Roads meeting at a node must not be too close in angle.
  for (const n of ns) {
    const angles = net
      .edgesAt(n.id)
      .map((e) => {
        const o = net.node(net.other(e, n.id))!;
        return Math.atan2(o.y - n.y, o.x - n.x);
      })
      .sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      if (angles.length > 1 && next - angles[i] < BUILD.minJunctionAngle) return 'build.angle';
    }
  }
  return null;
}
