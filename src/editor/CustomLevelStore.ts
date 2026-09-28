/**
 * Custom road-network levels (editor 2.0), stored on this device as JSON in localStorage:
 * `{ version, migrated, levels: CustomLevel[] }`. Also converts levels made with the old
 * grid editor (three slots / TF1 codes) and reads / writes TF2 share codes.
 */
import { EDITOR_TOOLS, GAME_TOOLS } from '../building/BuildManager';
import { buildNetworkLevel } from '../graph/NetworkCompiler';
import { emptyNetwork, RoadNetwork } from '../graph/RoadNetwork';
import type { KeyValueStore } from '../systems/SaveManager';
import type { BuildRules, BuildTool, LevelDef, NetworkData, Objective, VehicleKind } from '../types';
import { EDITOR_KEY } from './EditorStore';
import { EDITOR_WORLD, sanitizeEditorLevel, type EditorLevel } from './EditorModel';

export const CUSTOM_KEY = 'traffic-flow.custom-levels';
export const CUSTOM_VERSION = 2;
/** Numeric level id used for every custom level while it is played. */
export const CUSTOM_PLAY_ID = 2000;
export const CUSTOM_WORLD = { width: 900, height: 640 };
export const MAX_CUSTOM_LEVELS = 60;

export type ToolPreset = 'all' | 'lights' | 'none';
export const TOOL_PRESETS: Record<ToolPreset, BuildTool[]> = {
  all: GAME_TOOLS,
  lights: ['light', 'intersection', 'inspect'],
  none: ['inspect'],
};

export interface CustomRules extends BuildRules {
  tools: ToolPreset;
  /** Seconds, 0 = no limit. */
  timeLimit: number;
  /** Seconds, 0 = no MAX_WAIT objective. */
  maxWait: number;
}

export interface CustomLevel {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 2;
  map: { world: { width: number; height: number }; seed: number; network: NetworkData };
  rules: CustomRules;
  /** Money the player gets to build with. */
  budget: number;
}

export const defaultRules = (): CustomRules => ({ tools: 'all', timeLimit: 0, maxWait: 0 });

export function newCustomLevel(name: string, now = Date.now(), network: NetworkData = emptyNetwork()): CustomLevel {
  return {
    id: `c${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    createdAt: now,
    updatedAt: now,
    schemaVersion: 2,
    map: { world: { ...CUSTOM_WORLD }, seed: Math.floor(Math.random() * 1e6), network },
    rules: defaultRules(),
    budget: 2000,
  };
}

export function totalCars(c: CustomLevel): number {
  return c.map.network.spawns.reduce((s, sp) => s + sp.count, 0) + (c.map.network.specials?.length ?? 0);
}

/** Objectives derived from the level's rules. */
export function objectivesOf(c: CustomLevel): Objective[] {
  const out: Objective[] = [{ type: 'PASS_CARS', value: Math.max(1, totalCars(c)) }];
  if (c.rules.maxWait > 0) out.push({ type: 'MAX_WAIT_TIME', value: c.rules.maxWait });
  if (c.rules.timeLimit > 0) out.push({ type: 'TIME_LIMIT', value: c.rules.timeLimit });
  if ((c.map.network.specials?.length ?? 0) > 0) out.push({ type: 'EMERGENCY_PRIORITY', value: 12 });
  return out;
}

function lockAll(n: NetworkData): NetworkData {
  for (const e of n.edges) e.locked = true;
  for (const l of n.lights) l.locked = true;
  return n;
}

/** The playable level. */
export function customToLevel(c: CustomLevel): LevelDef {
  const cars = Math.max(1, totalCars(c));
  return buildNetworkLevel({
    id: CUSTOM_PLAY_ID,
    key: `custom-${c.id}`,
    name: c.name,
    description: '',
    world: c.map.world,
    seed: c.map.seed,
    // The designer's roads and lights are fixed infrastructure for the player.
    network: lockAll(structuredClone(c.map.network)),
    budget: c.budget,
    rules: { allowed: TOOL_PRESETS[c.rules.tools] ?? GAME_TOOLS, maxRoadCount: c.rules.maxRoadCount, maxTrafficLights: c.rules.maxTrafficLights },
    objectives: objectivesOf(c),
    stars: { parTime: Math.round(20 + cars * 1.4), avgWait: 5, maxWait: 14, score: cars * 70 },
    custom: true,
  });
}

// ------------------------------------------------------------------ validation of stored data

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function sanitizeNetwork(raw: unknown): NetworkData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.nodes) || !Array.isArray(r.edges)) return null;
  const nodes = r.nodes.filter((n): n is NetworkData['nodes'][number] => !!n && isStr(n.id) && isNum(n.x) && isNum(n.y));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = r.edges
    .filter((e): e is NetworkData['edges'][number] => !!e && isStr(e.id) && ids.has(e.a) && ids.has(e.b) && isNum(e.f) && isNum(e.bk))
    .map((e) => ({ ...e, f: Math.max(0, Math.min(3, Math.round(e.f))), bk: Math.max(0, Math.min(3, Math.round(e.bk))) }))
    .filter((e) => e.f + e.bk > 0);
  const eids = new Set(edges.map((e) => e.id));
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const spawns = arr(r.spawns)
    .filter((s) => isStr(s.id) && ids.has(s.node as string) && isNum(s.count) && Array.isArray(s.interval))
    .map((s) => {
      const iv = s.interval as unknown[];
      const a = isNum(iv[0]) ? Math.max(0.5, iv[0]) : 2;
      const b = isNum(iv[1]) ? Math.max(a, iv[1]) : a + 1;
      return {
        id: s.id as string,
        node: s.node as string,
        count: Math.max(1, Math.min(60, Math.round(s.count as number))),
        startDelay: isNum(s.startDelay) ? Math.max(0, s.startDelay) : 0.5,
        interval: [a, b] as [number, number],
        mix: s.mix && typeof s.mix === 'object' ? (s.mix as Partial<Record<VehicleKind, number>>) : undefined,
        to: Array.isArray(s.to) ? (s.to as unknown[]).filter(isStr) : undefined,
      };
    });
  const exits = arr(r.exits)
    .filter((x) => isStr(x.id) && ids.has(x.node as string))
    .map((x) => ({ id: x.id as string, node: x.node as string, capacity: isNum(x.capacity) ? x.capacity : undefined }));
  const lights = arr(r.lights)
    .filter((l) => ids.has(l.node as string) && eids.has(l.edge as string))
    .map((l) => ({ node: l.node as string, edge: l.edge as string, locked: l.locked === true ? true : undefined, initial: l.initial as never }));
  const sids = new Set(spawns.map((s) => s.id));
  const xids = new Set(exits.map((x) => x.id));
  const specials = arr(r.specials)
    .filter((s) => isNum(s.at) && sids.has(s.spawn as string) && xids.has(s.exit as string) && isStr(s.kind))
    .map((s) => ({ at: s.at as number, spawn: s.spawn as string, exit: s.exit as string, kind: s.kind as VehicleKind }));
  const decor = arr(r.decor)
    .filter((d) => isNum(d.x) && isNum(d.y) && isStr(d.type))
    .map((d) => d as unknown as NonNullable<NetworkData['decor']>[number]);
  return {
    nodes,
    edges,
    lights,
    spawns,
    exits,
    specials: Array.isArray(r.specials) ? specials : undefined,
    decor: Array.isArray(r.decor) ? decor : undefined,
    nextId: isNum(r.nextId) ? Math.max(r.nextId, nodes.length + edges.length + 1) : nodes.length + edges.length + 100,
  };
}

export function sanitizeCustomLevel(raw: unknown): CustomLevel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const map = r.map as Record<string, unknown> | undefined;
  if (!isStr(r.id) || !map) return null;
  const network = sanitizeNetwork(map.network);
  if (!network) return null;
  const world = map.world as Record<string, unknown> | undefined;
  const rules = (r.rules ?? {}) as Record<string, unknown>;
  const tools: ToolPreset = rules.tools === 'lights' || rules.tools === 'none' ? rules.tools : 'all';
  return {
    id: r.id.slice(0, 40),
    name: isStr(r.name) && r.name.trim() ? r.name.trim().slice(0, 40) : 'Level',
    createdAt: isNum(r.createdAt) ? r.createdAt : 0,
    updatedAt: isNum(r.updatedAt) ? r.updatedAt : 0,
    schemaVersion: 2,
    map: {
      world: world && isNum(world.width) && isNum(world.height) ? { width: world.width, height: world.height } : { ...CUSTOM_WORLD },
      seed: isNum(map.seed) ? map.seed : 1,
      network,
    },
    rules: {
      tools,
      timeLimit: isNum(rules.timeLimit) ? Math.max(0, Math.min(900, rules.timeLimit)) : 0,
      maxWait: isNum(rules.maxWait) ? Math.max(0, Math.min(120, rules.maxWait)) : 0,
      maxRoadCount: isNum(rules.maxRoadCount) ? rules.maxRoadCount : undefined,
      maxTrafficLights: isNum(rules.maxTrafficLights) ? rules.maxTrafficLights : undefined,
    },
    budget: isNum(r.budget) ? Math.max(0, Math.min(1e6, Math.round(r.budget))) : 0,
  };
}

// ------------------------------------------------------------------ migration from the grid editor

const DENSITY: Record<EditorLevel['density'], [number, number]> = { low: [3.0, 4.4], med: [2.0, 3.2], high: [1.3, 2.2] };

/** Convert an old grid-editor level: full-length roads, an entry + exit at every road end. */
export function migrateEditorLevel(m: EditorLevel, now = Date.now()): CustomLevel {
  const W = EDITOR_WORLD.width;
  const H = EDITOR_WORLD.height;
  const net = new RoadNetwork(emptyNetwork());
  const ends: { x: number; y: number }[] = [];
  for (const r of m.h) {
    for (const e of net.addRoad({ x: 0, y: r.at }, { x: W, y: r.at })) net.setLanes(e.id, r.lanes, r.lanes);
    ends.push({ x: 0, y: r.at }, { x: W, y: r.at });
  }
  for (const r of m.vr) {
    for (const e of net.addRoad({ x: r.at, y: 0 }, { x: r.at, y: H })) net.setLanes(e.id, r.lanes, r.lanes);
    ends.push({ x: r.at, y: 0 }, { x: r.at, y: H });
  }
  const mix: Partial<Record<VehicleKind, number>> = {};
  if (m.buses) mix.bus = 1;
  if (m.trucks) mix.truck = 1;
  ends.forEach((p, i) => {
    const n = net.findNodeNear(p, 2);
    if (!n) return;
    net.setExit(n.id, true);
    net.setSpawn(n.id, { count: m.cars, startDelay: 0.5 + i * 0.4, interval: DENSITY[m.density], mix: Object.keys(mix).length ? mix : undefined });
  });
  const d = net.data;
  if (m.emergency && d.spawns.length > 0 && d.exits.length > 1) {
    const s = d.spawns[0];
    const x = d.exits.find((e) => e.node !== s.node)!;
    d.specials = [{ at: 25, spawn: s.id, exit: x.id, kind: 'ambulance' }];
  }
  const c = newCustomLevel(m.name, now, d);
  c.map.world = { width: W, height: H };
  c.rules = { ...defaultRules(), tools: 'lights', timeLimit: m.timeLimit };
  c.budget = 3000;
  return c;
}

// ------------------------------------------------------------------ share codes

export function encodeCustom(c: CustomLevel): string {
  const json = JSON.stringify({ n: c.name, m: c.map, r: c.rules, b: c.budget });
  return 'TF2-' + btoa(unescape(encodeURIComponent(json)));
}

export function decodeCustom(code: string, now = Date.now()): CustomLevel | null {
  const s = code.trim().replace(/\s+/g, '');
  if (!s.startsWith('TF2-')) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(escape(atob(s.slice(4))))) as { n?: unknown; m?: unknown; r?: unknown; b?: unknown };
    return sanitizeCustomLevel({ id: newCustomLevel('', now).id, name: raw.n, createdAt: now, updatedAt: now, map: raw.m, rules: raw.r, budget: raw.b });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ store

export class CustomLevelStore {
  private levels: CustomLevel[] = [];
  /** Old grid-editor levels were converted during this load. */
  migratedNow = 0;

  constructor(private readonly store: KeyValueStore) {
    let migrated = false;
    try {
      const raw = JSON.parse(store.getItem(CUSTOM_KEY) ?? 'null') as { levels?: unknown[]; migrated?: unknown } | null;
      if (raw && Array.isArray(raw.levels)) {
        this.levels = raw.levels.map(sanitizeCustomLevel).filter((l): l is CustomLevel => !!l);
      }
      migrated = raw?.migrated === true;
    } catch {
      /* corrupted: start empty */
    }
    if (!migrated) this.migrateOld();
  }

  /** One-off conversion of the old editor's three slots. */
  private migrateOld(): void {
    try {
      const raw = JSON.parse(this.store.getItem(EDITOR_KEY) ?? 'null') as { slots?: unknown[] } | null;
      const now = Date.now();
      (raw?.slots ?? []).forEach((slot, i) => {
        const m = sanitizeEditorLevel(slot);
        if (!m || m.h.length + m.vr.length === 0) return;
        const c = migrateEditorLevel(m, now + i);
        this.levels.push(c);
        this.migratedNow++;
      });
    } catch {
      /* nothing to migrate */
    }
    this.write();
  }

  private write(): void {
    try {
      this.store.setItem(CUSTOM_KEY, JSON.stringify({ version: CUSTOM_VERSION, migrated: true, levels: this.levels }));
    } catch {
      /* storage unavailable or full: keep in memory */
    }
  }

  /** Newest first. */
  list(): CustomLevel[] {
    return [...this.levels].sort((a, b) => b.updatedAt - a.updatedAt).map((l) => structuredClone(l));
  }

  get(id: string): CustomLevel | null {
    const l = this.levels.find((x) => x.id === id);
    return l ? structuredClone(l) : null;
  }

  get count(): number {
    return this.levels.length;
  }

  create(name: string, now = Date.now()): CustomLevel {
    const c = newCustomLevel(name, now);
    this.levels.push(c);
    this.write();
    return structuredClone(c);
  }

  /** Insert or update (bumps updatedAt). */
  save(level: CustomLevel, now = Date.now()): CustomLevel {
    const copy = structuredClone(level);
    copy.updatedAt = Math.max(now, copy.createdAt);
    const i = this.levels.findIndex((x) => x.id === copy.id);
    if (i >= 0) this.levels[i] = copy;
    else {
      if (this.levels.length >= MAX_CUSTOM_LEVELS) throw new Error('too many levels');
      this.levels.push(copy);
    }
    this.write();
    return structuredClone(copy);
  }

  rename(id: string, name: string, now = Date.now()): boolean {
    const l = this.levels.find((x) => x.id === id);
    const clean = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    if (!l || !clean) return false;
    l.name = clean;
    l.updatedAt = now;
    this.write();
    return true;
  }

  duplicate(id: string, name: string, now = Date.now()): CustomLevel | null {
    const src = this.levels.find((x) => x.id === id);
    if (!src) return null;
    const c = newCustomLevel(name, now, structuredClone(src.map.network));
    c.map = structuredClone(src.map);
    c.rules = structuredClone(src.rules);
    c.budget = src.budget;
    this.levels.push(c);
    this.write();
    return structuredClone(c);
  }

  remove(id: string): boolean {
    const n = this.levels.length;
    this.levels = this.levels.filter((x) => x.id !== id);
    if (this.levels.length === n) return false;
    this.write();
    return true;
  }
}

/** Tools the editor itself offers. */
export const EDITOR_TOOLSET = EDITOR_TOOLS;
