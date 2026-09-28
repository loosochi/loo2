/**
 * Checks a road-network level before it is played: entries and exits exist, every entry has a
 * route, roads are connected, lights sit on real junctions, geometry and budget are sane.
 */
import { checkGeometry } from '../building/BuildValidator';
import { compileNetwork } from '../graph/NetworkCompiler';
import { RoadNetwork } from '../graph/RoadNetwork';
import type { NetworkData } from '../types';

export type ValidationKey =
  | 'val.noSpawn'
  | 'val.noExit'
  | 'val.spawnNoRoute'
  | 'val.exitNoRoute'
  | 'val.spawnNotEnd'
  | 'val.exitNotEnd'
  | 'val.isolated'
  | 'val.badLight'
  | 'val.budget'
  | 'val.geometry'
  | 'val.noCars';

export interface ValidationIssue {
  level: 'error' | 'warning';
  key: ValidationKey;
  /** Offending object id (spawn / edge / light), when there is one. */
  ref?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateNetwork(data: NetworkData, world: { width: number; height: number }, budget = 0): ValidationReport {
  const net = new RoadNetwork(JSON.parse(JSON.stringify(data)) as NetworkData);
  const issues: ValidationIssue[] = [];
  const err = (key: ValidationKey, ref?: string) => issues.push({ level: 'error', key, ref });
  const warn = (key: ValidationKey, ref?: string) => issues.push({ level: 'warning', key, ref });

  if (!Number.isFinite(budget) || budget < 0) err('val.budget');
  if (data.spawns.length === 0) err('val.noSpawn');
  if (data.exits.length === 0) err('val.noExit');
  for (const s of data.spawns) {
    if (!net.node(s.node) || net.degree(s.node) !== 1) err('val.spawnNotEnd', s.id);
    if (!(s.count > 0)) err('val.noCars', s.id);
  }
  for (const x of data.exits) if (!net.node(x.node) || net.degree(x.node) !== 1) err('val.exitNotEnd', x.id);
  for (const l of data.lights) {
    const e = net.edge(l.edge);
    if (!e || !net.isJunction(l.node) || net.lanesInto(e, l.node) === 0) err('val.badLight', `${l.node}:${l.edge}`);
  }
  if (checkGeometry(net, world)) err('val.geometry');

  if (data.spawns.length && data.exits.length) {
    const c = compileNetwork(net, world);
    for (const id of c.unreachableSpawns) err('val.spawnNoRoute', id);
    for (const p of c.unreachablePairs) if (!c.unreachableSpawns.includes(p.spawn)) err('val.exitNoRoute', `${p.spawn}>${p.exit}`);
    // Roads no vehicle can ever use.
    const used = new Set(c.routes.flatMap((r) => r.edges ?? []));
    for (const e of net.edges) if (!used.has(e.id)) warn('val.isolated', e.id);
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}
