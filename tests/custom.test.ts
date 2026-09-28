import { describe, expect, it } from 'vitest';
import {
  CUSTOM_KEY,
  CustomLevelStore,
  customToLevel,
  decodeCustom,
  encodeCustom,
  migrateEditorLevel,
  sanitizeCustomLevel,
} from '../src/editor/CustomLevelStore';
import { EDITOR_KEY } from '../src/editor/EditorStore';
import { defaultEditorLevel } from '../src/editor/EditorModel';
import { validateNetwork } from '../src/editor/LevelValidator';
import { RoadNetwork } from '../src/graph/RoadNetwork';
import { MemoryStore, SAVE_KEY, SaveManager } from '../src/systems/SaveManager';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { crossNetwork } from './netHelpers';

const CAMPAIGN = { first: 101, last: 110 };

describe('CustomLevelSave', () => {
  it('creates, saves, renames, duplicates and deletes levels and survives a reload', () => {
    const store = new MemoryStore();
    const a = new CustomLevelStore(store);
    const lvl = a.create('Mine', 1000);
    lvl.map.network = crossNetwork().data;
    lvl.budget = 1234;
    lvl.rules.maxWait = 20;
    a.save(lvl, 2000);
    expect(a.rename(lvl.id, '  Renamed <b>  ', 3000)).toBe(true);
    const copy = a.duplicate(lvl.id, 'Copy', 4000)!;
    expect(copy.id).not.toBe(lvl.id);
    expect(copy.map.network.edges.length).toBe(lvl.map.network.edges.length);

    const b = new CustomLevelStore(store); // "reload"
    const list = b.list();
    expect(list.map((l) => l.name)).toEqual(['Copy', 'Renamed b']);
    const back = b.get(lvl.id)!;
    expect(back.budget).toBe(1234);
    expect(back.rules.maxWait).toBe(20);
    expect(back.createdAt).toBe(1000);
    expect(back.updatedAt).toBe(3000);
    expect(back.map.network).toEqual(lvl.map.network);
    expect(b.remove(copy.id)).toBe(true);
    expect(new CustomLevelStore(store).count).toBe(1);
  });

  it('stores the documented JSON shape', () => {
    const store = new MemoryStore();
    new CustomLevelStore(store).create('Shape', 5);
    const raw = JSON.parse(store.getItem(CUSTOM_KEY)!);
    expect(raw.version).toBe(2);
    const l = raw.levels[0];
    for (const k of ['id', 'name', 'createdAt', 'updatedAt', 'map', 'rules', 'budget']) expect(l).toHaveProperty(k);
    expect(l.schemaVersion).toBe(2);
    expect(l.map.network).toHaveProperty('nodes');
  });

  it('drops corrupted entries and broken references instead of crashing', () => {
    const store = new MemoryStore();
    store.setItem(
      CUSTOM_KEY,
      JSON.stringify({
        migrated: true,
        levels: [
          null,
          { id: 'x' },
          { id: 'ok', name: 'OK', map: { network: { nodes: [{ id: 'n1', x: 0, y: 0 }], edges: [{ id: 'e', a: 'n1', b: 'missing', f: 1, bk: 1 }], lights: [{ node: 'n1', edge: 'e' }] } } },
        ],
      }),
    );
    const s = new CustomLevelStore(store);
    expect(s.count).toBe(1);
    const l = s.list()[0];
    expect(l.map.network.edges).toEqual([]);
    expect(l.map.network.lights).toEqual([]);
    store.setItem(CUSTOM_KEY, '{not json');
    expect(new CustomLevelStore(store).count).toBe(0);
  });

  it('a saved custom level compiles into a playable, validated level with locked roads', () => {
    const s = new CustomLevelStore(new MemoryStore());
    const c = s.create('Play');
    c.map.network = crossNetwork({ count: 3 }).data;
    c.map.world = { width: 800, height: 640 };
    c.rules.timeLimit = 90;
    expect(validateNetwork(c.map.network, c.map.world, c.budget).ok).toBe(true);
    const lvl = customToLevel(c);
    expect(lvl.custom).toBe(true);
    expect(lvl.schemaVersion).toBe(2);
    expect(lvl.goal.timeLimit).toBe(90);
    expect(lvl.network!.edges.every((e) => e.locked)).toBe(true);
    const sim = new TrafficSimulation(lvl);
    for (let i = 0; i < 60 * 20; i++) sim.step();
    expect(sim.score.passed).toBeGreaterThan(0);
  });

  it('share codes round-trip; bad codes are rejected', () => {
    const s = new CustomLevelStore(new MemoryStore());
    const c = s.create('Шеринг');
    c.map.network = crossNetwork().data;
    const code = encodeCustom(c);
    expect(code.startsWith('TF2-')).toBe(true);
    const d = decodeCustom(code)!;
    expect(d.name).toBe('Шеринг');
    expect(d.map.network.edges.length).toBe(c.map.network.edges.length);
    expect(decodeCustom('TF2-@@@')).toBeNull();
    expect(decodeCustom('TF1-abc')).toBeNull();
  });

  it('migrates levels of the old grid editor once', () => {
    const store = new MemoryStore();
    const old = defaultEditorLevel('Old');
    old.h.push({ at: 520, lanes: 2 });
    store.setItem(EDITOR_KEY, JSON.stringify({ slots: [old, null, null], current: 0 }));
    const s = new CustomLevelStore(store);
    expect(s.migratedNow).toBe(1);
    const m = s.list()[0];
    expect(m.name).toBe('Old');
    expect(validateNetwork(m.map.network, m.map.world, m.budget).ok).toBe(true);
    // 2 horizontal + 1 vertical full-length roads → 2 junctions.
    const net = new RoadNetwork(m.map.network);
    expect(net.nodes.filter((n) => net.isJunction(n.id)).length).toBe(2);
    expect(new CustomLevelStore(store).count).toBe(1); // not migrated twice
    expect(sanitizeCustomLevel(migrateEditorLevel(old))).not.toBeNull();
  });
});

describe('SaveManager v2', () => {
  it('migrates a v1 save: keeps progress, opens the first campaign level', () => {
    const store = new MemoryStore();
    store.setItem(SAVE_KEY, JSON.stringify({ version: 1, unlocked: 4, levels: { 2: { bestScore: 900, stars: 3, completed: true } }, sound: false, lastLevel: 3 }));
    const s = new SaveManager(9, store, CAMPAIGN);
    expect(s.snapshot.version).toBe(2);
    expect(s.progress(2).stars).toBe(3);
    expect(s.isUnlocked(4)).toBe(true);
    expect(s.isUnlocked(101)).toBe(true);
    expect(s.isUnlocked(102)).toBe(false);
  });

  it('campaign progress unlocks the next campaign level and persists', () => {
    const store = new MemoryStore();
    const s = new SaveManager(9, store, CAMPAIGN);
    s.recordResult(101, true, 3000, 4);
    expect(s.isUnlocked(102)).toBe(true);
    expect(s.snapshot.unlocked).toBe(1); // classic progress untouched
    const again = new SaveManager(9, store, CAMPAIGN);
    expect(again.progress(101).stars).toBe(4);
    expect(again.isUnlocked(102)).toBe(true);
    s.recordResult(110, true, 1, 1);
    expect(s.snapshot.campaignUnlocked).toBeLessThanOrEqual(110);
  });
});
