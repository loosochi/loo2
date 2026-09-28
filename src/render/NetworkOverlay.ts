/**
 * Per-frame overlays for road-network levels: build grid, road preview, selection, tool hints,
 * traffic load colouring and the debug view. Drawn into caller-owned Graphics objects.
 */
import type Phaser from 'phaser';
import type { TrafficAnalytics } from '../analytics/TrafficAnalytics';
import type { RoadPlan } from '../building/BuildManager';
import { COLORS } from '../config/theme';
import { LW, frame, halfWidth, laneOffset, nodeRadius } from '../graph/geometry';
import { lightGeometry, mainPair } from '../graph/NetworkCompiler';
import type { RoadNetwork } from '../graph/RoadNetwork';
import type { TrafficSimulation } from '../systems/TrafficSimulation';
import type { BuildTool } from '../types';

type G = Phaser.GameObjects.Graphics;

export const LOAD_COLORS = { LOW: 0x3ddc97, MEDIUM: 0xffd166, HIGH: 0xff9f1c, CRITICAL: 0xff4d4f } as const;

export interface DebugFlags {
  zones: boolean;
  paths: boolean;
  nodes: boolean;
  lanes: boolean;
  arrows: boolean;
  spawns: boolean;
  exits: boolean;
}

export const defaultDebugFlags = (): DebugFlags => ({ zones: true, paths: false, nodes: true, lanes: false, arrows: true, spawns: true, exits: true });

export type Selection =
  | { kind: 'edge'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'light'; node: string; edge: string }
  | null;

export function drawGrid(g: G, world: { width: number; height: number }, size: number): void {
  g.lineStyle(1, 0xffffff, 0.16);
  for (let x = 0; x <= world.width + 0.1; x += size) g.lineBetween(x, 0, x, world.height);
  for (let y = 0; y <= world.height + 0.1; y += size) g.lineBetween(0, y, world.width, y);
  g.fillStyle(0xffffff, 0.35);
  for (let x = 0; x <= world.width + 0.1; x += size * 2) for (let y = 0; y <= world.height + 0.1; y += size * 2) g.fillCircle(x, y, 1.6);
  g.lineStyle(2, 0xffffff, 0.45);
  g.strokeRect(0, 0, world.width, world.height);
}

export function drawPreview(g: G, plan: RoadPlan): void {
  const color = plan.valid ? COLORS.good : COLORS.bad;
  g.lineStyle(LW * 2, color, 0.38);
  g.beginPath();
  g.moveTo(plan.points[0].x, plan.points[0].y);
  for (const p of plan.points.slice(1)) g.lineTo(p.x, p.y);
  g.strokePath();
  g.lineStyle(2, color, 0.95);
  g.beginPath();
  g.moveTo(plan.points[0].x, plan.points[0].y);
  for (const p of plan.points.slice(1)) g.lineTo(p.x, p.y);
  g.strokePath();
  for (const p of [plan.start, plan.end]) {
    g.fillStyle(color, 0.95);
    g.fillCircle(p.x, p.y, p.kind === 'node' || p.kind === 'road' ? 9 : 6);
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeCircle(p.x, p.y, p.kind === 'node' || p.kind === 'road' ? 12 : 8);
  }
}

export function drawSelection(g: G, net: RoadNetwork, sel: Selection, pulse: number): void {
  if (!sel) return;
  const a = 0.55 + 0.35 * pulse;
  g.lineStyle(4, COLORS.star, a);
  if (sel.kind === 'edge') {
    const e = net.edge(sel.id);
    if (!e) return;
    const A = net.node(e.a)!;
    const B = net.node(e.b)!;
    const f = frame(A, B);
    const h = halfWidth(e) + 5;
    g.strokePoints(
      [
        { x: A.x + f.n.x * h, y: A.y + f.n.y * h },
        { x: B.x + f.n.x * h, y: B.y + f.n.y * h },
        { x: B.x - f.n.x * h, y: B.y - f.n.y * h },
        { x: A.x - f.n.x * h, y: A.y - f.n.y * h },
      ] as Phaser.Types.Math.Vector2Like[],
      true,
    );
  } else if (sel.kind === 'node') {
    const n = net.node(sel.id);
    if (n) g.strokeCircle(n.x, n.y, Math.max(nodeRadius(net, n), 20) + 6);
  } else {
    const lg = lightGeometry(net, sel.node, sel.edge);
    if (lg) g.strokeCircle(lg.head.x, lg.head.y, 20);
  }
}

/** Tool hints: light slots, junctions, road ends. */
export function drawToolHints(g: G, net: RoadNetwork, tool: BuildTool, pulse: number): void {
  if (tool === 'light') {
    for (const n of net.nodes) {
      if (!net.isJunction(n.id)) continue;
      for (const e of net.edgesAt(n.id)) {
        const lg = lightGeometry(net, n.id, e.id);
        if (!lg) continue;
        const has = !!net.lightAt(n.id, e.id);
        g.lineStyle(2, has ? COLORS.good : COLORS.accent, 0.9);
        g.strokeCircle(lg.stop.x, lg.stop.y, 11 + pulse * 2);
        if (!has) {
          g.lineStyle(2.5, COLORS.accent, 0.9);
          g.lineBetween(lg.stop.x - 5, lg.stop.y, lg.stop.x + 5, lg.stop.y);
          g.lineBetween(lg.stop.x, lg.stop.y - 5, lg.stop.x, lg.stop.y + 5);
        }
      }
    }
  }
  if (tool === 'intersection') {
    for (const n of net.nodes) {
      if (!net.isJunction(n.id)) continue;
      g.lineStyle(2, COLORS.accent, 0.8);
      g.strokeCircle(n.x, n.y, nodeRadius(net, n) + 4 + pulse * 2);
      const mp = net.data.lights.some((l) => l.node === n.id) ? null : mainPair(net, n);
      if (mp) {
        for (const id of mp) {
          const e = net.edge(id)!;
          const o = net.node(net.other(e, n.id))!;
          const f = frame(n, o);
          g.lineStyle(6, COLORS.star, 0.75);
          g.lineBetween(n.x, n.y, n.x + f.u.x * Math.min(90, f.len), n.y + f.u.y * Math.min(90, f.len));
        }
      }
    }
  }
  if (tool === 'spawn' || tool === 'exit') {
    for (const n of net.nodes) {
      if (net.degree(n.id) !== 1) continue;
      const color = net.spawnAt(n.id) ? COLORS.accent : net.exitAt(n.id) ? 0xffffff : COLORS.warn;
      g.lineStyle(3, color, 0.9);
      g.strokeCircle(n.x, n.y, 16 + pulse * 3);
    }
  }
}

export function drawLoad(g: G, net: RoadNetwork, an: TrafficAnalytics): void {
  for (const e of net.edges) {
    const st = an.edge(e.id);
    if (!st) continue;
    const A = net.node(e.a)!;
    const B = net.node(e.b)!;
    g.lineStyle(halfWidth(e) * 2 - 4, LOAD_COLORS[st.level], 0.42);
    g.lineBetween(A.x, A.y, B.x, B.y);
  }
}

export function drawDebug(g: G, sim: TrafficSimulation, net: RoadNetwork | null, flags: DebugFlags): void {
  if (flags.zones) {
    for (const z of sim.collisions.zones) {
      g.lineStyle(1.5, z.vehicles.size ? COLORS.bad : 0xff00ff, z.vehicles.size ? 0.9 : 0.5);
      g.strokeCircle(z.x, z.y, z.radius);
    }
  }
  if (flags.paths) {
    for (const r of sim.routes) {
      const pts = r.path.points;
      g.lineStyle(1.2, 0x00e5ff, 0.55);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 4; i < pts.length; i += 4) g.lineTo(pts[i].x, pts[i].y);
      g.strokePath();
    }
  }
  if (net && flags.lanes) {
    for (const e of net.edges) {
      const A = net.node(e.a)!;
      const B = net.node(e.b)!;
      const f = frame(A, B);
      const W = halfWidth(e) * 2;
      for (let k = 0; k < e.f; k++) {
        const o = laneOffset(k, W);
        g.lineStyle(1.5, 0x9cff57, 0.8);
        g.lineBetween(A.x + f.n.x * o, A.y + f.n.y * o, B.x + f.n.x * o, B.y + f.n.y * o);
      }
      for (let k = 0; k < e.bk; k++) {
        const o = -laneOffset(k, W);
        g.lineStyle(1.5, 0xffb347, 0.8);
        g.lineBetween(A.x + f.n.x * o, A.y + f.n.y * o, B.x + f.n.x * o, B.y + f.n.y * o);
      }
    }
  }
  if (net && flags.nodes) {
    for (const n of net.nodes) {
      g.fillStyle(net.isJunction(n.id) ? 0xff4dff : 0xffffff, 0.9);
      g.fillCircle(n.x, n.y, 4);
    }
  }
  if (flags.arrows) {
    for (const v of sim.vehicles) {
      const p = v.route.path.pointAt(Math.min(v.route.path.length, v.s + 40));
      g.lineStyle(1.5, 0xffffff, 0.6);
      g.lineBetween(v.x, v.y, p.x, p.y);
    }
  }
  if (net && flags.spawns) for (const s of net.data.spawns) drawRing(g, net, s.node, COLORS.accent);
  if (net && flags.exits) for (const x of net.data.exits) drawRing(g, net, x.node, 0xffffff);
}

function drawRing(g: G, net: RoadNetwork, nodeId: string, color: number): void {
  const n = net.node(nodeId);
  if (!n) return;
  g.lineStyle(2, color, 0.9);
  g.strokeCircle(n.x, n.y, 18);
}
