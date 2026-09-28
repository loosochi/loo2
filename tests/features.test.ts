import { describe, expect, it } from 'vitest';
import { SCORE, specOf } from '../src/config/balanceConfig';
import { carsWord, pluralRu, setLang, t, levelName } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ru } from '../src/i18n/ru';
import { crossing, defineLevel, freeRight, hRoad, light, route, vRoad } from '../src/levels/builder';
import { level00 } from '../src/levels/level00';
import { level06 } from '../src/levels/level06';
import { LEVELS } from '../src/levels/levelRegistry';
import { Leaderboard, RECORDS_KEY } from '../src/systems/Leaderboard';
import { LevelManager } from '../src/systems/LevelManager';
import { MemoryStore, SaveManager } from '../src/systems/SaveManager';
import { ScoreSystem } from '../src/systems/ScoreSystem';
import { TrafficSimulation } from '../src/systems/TrafficSimulation';
import { TutorialController } from '../src/systems/TutorialController';
import { Vehicle } from '../src/entities/Vehicle';
import { LightState, type FlowDef, type LevelDef, type SpecialDef } from '../src/types';
import { runFor } from './helpers';

const world = { width: 600, height: 600 };

/** One crossing; N→S straight on green and a W→S slip-lane right turn that must yield. */
function yieldLevel(west: Partial<FlowDef> = {}): LevelDef {
  const I = crossing('I', 300, 300);
  return defineLevel({
    id: 98,
    key: 'yield',
    name: 'Yield',
    description: '',
    world,
    seed: 7,
    roads: [hRoad('h', 300), vRoad('v', 300)],
    intersections: [I],
    lights: [light('LW', I, 'E', LightState.RED, 24), light('LN', I, 'S', LightState.GREEN)],
    routes: [route('ns', 'N', 'S', [{ dir: 'S', road: 300 }], world), freeRight('ws', 'W', 'S', { dir: 'E', road: 300 }, { dir: 'S', road: 300 }, world)],
    flows: [
      { spawnId: 'N', routes: [{ id: 'ns', weight: 1 }], count: 8, startDelay: 0, interval: [1.1, 1.1] },
      { spawnId: 'W', routes: [{ id: 'ws', weight: 1 }], count: 3, startDelay: 0, interval: [1.5, 1.5], ...west },
    ],
    goal: { carsToPass: 11 },
    stars: { parTime: 60, avgWait: 5, maxWait: 20, score: 1000 },
    decorDensity: 0,
  });
}

describe('multi-lane roads', () => {
  it('binds one stop line to every lane of a two-lane approach', () => {
    const sim = new TrafficSimulation(level06);
    for (const id of ['we0', 'we1']) {
      const r = sim.routes.find((x) => x.id === id)!;
      expect(r.stops.map((s) => s.light.id)).toEqual(['L_W']);
    }
    const s0 = sim.routes.find((x) => x.id === 'we0')!.stops[0].s;
    const s1 = sim.routes.find((x) => x.id === 'we1')!.stops[0].s;
    expect(Math.abs(s0 - s1)).toBeLessThan(2);
  });

  it('cars in adjacent lanes do not block each other at the entry', () => {
    const base = level06;
    const onlyInner = (flowRoute: string): LevelDef => ({
      ...base,
      flows: [{ spawnId: 'W', routes: [{ id: flowRoute, weight: 1 }], count: 1, startDelay: 0, interval: [1, 1] }],
      specials: undefined,
      goal: { carsToPass: 1 },
    });
    const block = (sim: TrafficSimulation, routeId: string) => {
      const r = sim.routes.find((x) => x.id === routeId)!;
      const v = new Vehicle({ id: 999, spec: specOf('sedan'), maxSpeed: 0.1, color: 0xffffff, route: r, speed: 0 });
      v.s = 8;
      v.syncPose();
      sim.vehicles.push(v);
    };
    // A car standing at the start of the curb lane does not stop a spawn in the inner lane…
    const a = new TrafficSimulation(onlyInner('we1'));
    block(a, 'we0');
    a.step();
    expect(a.vehicles.some((v) => v.route.id === 'we1')).toBe(true);
    // …but it does block a spawn in its own lane.
    const b = new TrafficSimulation(onlyInner('we0'));
    block(b, 'we0');
    b.step();
    expect(b.vehicles.filter((v) => v.route.id === 'we0').length).toBe(1);
  });
});

describe('free right turns (slip lanes)', () => {
  it('slip-lane routes are not held by the light and yield to crossing traffic', () => {
    const sim = new TrafficSimulation(yieldLevel());
    const slip = sim.routes.find((r) => r.id === 'ws')!;
    expect(slip.stops.length).toBe(0);
    let yielded = false;
    runFor(sim, 60, (s) => {
      for (const v of s.vehicles) {
        if (v.route.id === 'ws' && v.stopTarget !== null && v.speed < 1) yielded = true;
      }
    });
    expect(yielded).toBe(true);
    expect(sim.outcome).toBe('win'); // all slip cars eventually merge…
    expect(sim.result?.crashes).toBe(0); // …without a crash
  });

  it('with no crossing traffic slip cars merge without stopping', () => {
    const base = yieldLevel();
    const sim = new TrafficSimulation({ ...base, flows: [base.flows[1]], goal: { carsToPass: 3 } });
    let stopped = false;
    runFor(sim, 30, (s) => {
      for (const v of s.vehicles) if (v.age > 1 && v.speed < 2) stopped = true;
    });
    expect(stopped).toBe(false);
    expect(sim.outcome).toBe('win');
  });
});

describe('heavy and emergency vehicles', () => {
  it('flows can mix in buses and trucks', () => {
    const base = yieldLevel();
    const sim = new TrafficSimulation({
      ...base,
      flows: [{ ...base.flows[0], mix: { bus: 5, truck: 5, compact: 0, sedan: 0, hatch: 0, sport: 0 } }],
      goal: { carsToPass: 8 },
    });
    const kinds = new Set<string>();
    runFor(sim, 30, (s) => s.vehicles.forEach((v) => kinds.add(v.kind)));
    expect([...kinds].sort()).toEqual(['bus', 'truck']);
  });

  it('buses are worth more points than cars', () => {
    const s = new ScoreSystem();
    s.onVehicleExit(0, specOf('bus').points);
    s.onVehicleExit(0, specOf('sedan').points);
    expect(s.liveScore).toBe(specOf('bus').points + specOf('sedan').points);
    expect(specOf('bus').points).toBeGreaterThan(specOf('sedan').points);
  });

  it('emergency vehicles spawn on schedule and waiting costs points', () => {
    const base = yieldLevel();
    const specials: SpecialDef[] = [{ at: 1, spawnId: 'W', routeId: 'ws', kind: 'ambulance' }];
    const I = base.intersections[0];
    // A signalled route for the ambulance so it has to wait at a red light.
    const sim = new TrafficSimulation({
      ...base,
      routes: [...base.routes, route('we', 'W', 'E', [{ dir: 'E', road: 300 }], world)],
      lights: [light('LW', I, 'E', LightState.RED), base.lights[1]],
      flows: [],
      specials: [{ ...specials[0], routeId: 'we' }],
      goal: { carsToPass: 1 },
    });
    const spawned: string[] = [];
    sim.on({ spawn: (v) => spawned.push(v.kind) });
    runFor(sim, 12);
    expect(spawned).toEqual(['ambulance']);
    expect(sim.vehicles[0].emergency).toBe(true);
    expect(sim.score.emergencyWaitSeconds).toBeGreaterThan(3);
    expect(sim.score.liveScore).toBe(0);
    sim.toggleLight('LW');
    runFor(sim, 20);
    expect(sim.outcome).toBe('win');
    expect(sim.totalCars).toBe(1);
    expect(SCORE.emergencyWaitPenaltyPerSecond).toBeGreaterThan(SCORE.longWaitPenaltyPerSecond);
  });
});

describe('tutorial', () => {
  it('advances through taps, light changes and passed cars, freezing traffic on reading steps', () => {
    const sim = new TrafficSimulation(level00);
    const tut = new TutorialController(level00.tutorial!, sim);
    expect(tut.stepNumber).toBe(1);
    expect(tut.frozen).toBe(true);
    tut.update(1);
    expect(tut.stepNumber).toBe(1); // needs a tap
    tut.tap();
    expect(tut.stepNumber).toBe(2);
    expect(tut.frozen).toBe(false);
    sim.toggleLight('L_W'); // → GREEN
    tut.update(0.016);
    expect(tut.stepNumber).toBe(3);
    runFor(sim, 20, () => tut.update(1 / 60));
    expect(tut.stepNumber).toBeGreaterThanOrEqual(4);
  });

  it('a yellow that already returned to red still counts for the yellow step', () => {
    const sim = new TrafficSimulation(level00);
    const tut = new TutorialController(level00.tutorial!, sim);
    while (tut.current && tut.current.wait.type !== 'light') tut.tap();
    // Jump to the YELLOW step.
    while (tut.current && !(tut.current.wait.type === 'light' && tut.current.wait.state === LightState.YELLOW)) {
      const w = tut.current.wait;
      if (w.type === 'tap') tut.tap();
      else if (w.type === 'light') sim.lights.set(w.id, w.state, 0);
      else if (w.type === 'passed') runFor(sim, 30, () => tut.update(1 / 60));
      tut.update(0.016);
    }
    const w = tut.current!.wait as { id: string };
    const before = tut.stepNumber;
    sim.yellowLight(w.id);
    sim.lights.set(w.id, LightState.RED, 1, 'auto');
    tut.update(0.016);
    expect(tut.stepNumber).toBe(before + 1);
  });
});

describe('records table', () => {
  it('keeps the top ten sorted by score then time, and survives reloads', () => {
    const store = new MemoryStore();
    const lb = new Leaderboard(store);
    for (let i = 0; i < 12; i++) lb.submit(3, { name: `P${i}`, score: 1000 + i * 10, stars: 3, time: 60 });
    const tie = lb.submit(3, { name: 'Fast', score: 1110, stars: 4, time: 30 });
    expect(tie.rank).toBe(1); // same score as P11 but faster
    const low = lb.submit(3, { name: 'Low', score: 5, stars: 1, time: 99 });
    expect(low.rank).toBeNull();
    const again = new Leaderboard(store);
    const list = again.local(3);
    expect(list.length).toBe(10);
    expect(list[0].name).toBe('Fast');
    expect(list[1].name).toBe('P11');
    expect(list.map((e) => e.score)).toEqual([...list.map((e) => e.score)].sort((a, b) => b - a));
  });

  it('ignores corrupted data', () => {
    const store = new MemoryStore();
    store.setItem(RECORDS_KEY, '{"3":[{"name":1},{"id":"a","name":"ok","score":5,"stars":1,"time":3,"date":"2026-01-01"}],"x":5}');
    expect(new Leaderboard(store).local(3).map((e) => e.name)).toEqual(['ok']);
    store.setItem(RECORDS_KEY, 'not json');
    expect(new Leaderboard(store).local(3)).toEqual([]);
  });
});

describe('localisation and profile', () => {
  it('Russian covers every English key and plural forms agree', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect([1, 2, 5, 11, 21, 22, 34].map((n) => pluralRu(n, ['машина', 'машины', 'машин']))).toEqual([
      'машина',
      'машины',
      'машин',
      'машин',
      'машина',
      'машины',
      'машины',
    ]);
    setLang('ru');
    expect(t('hud.goal', { n: 21, cars: carsWord(21) })).toBe('ЦЕЛЬ: ПРОПУСТИТЬ 21 МАШИНУ');
    expect(levelName(LEVELS[1])).toBe('Первый перекрёсток');
    setLang('en');
    expect(t('hud.goal', { n: 1, cars: carsWord(1) })).toBe('GOAL: PASS 1 CAR');
    expect(levelName(LEVELS[1])).toBe('First Crossing');
  });

  it('every level has Russian texts', () => {
    for (const l of LEVELS) expect(l.ru?.name, l.name).toBeTruthy();
  });

  it('saves language and a cleaned player name; new players start with the tutorial', () => {
    const store = new MemoryStore();
    const save = new SaveManager(9, store);
    const lm = new LevelManager(save, new Leaderboard(store));
    expect(lm.playTarget()).toBe(0);
    expect(save.isUnlocked(0)).toBe(true);
    save.setLang('ru');
    save.setPlayerName('  <Оля>\u0007 the very long name  ');
    const again = new SaveManager(9, store);
    expect(again.lang).toBe('ru');
    expect(again.playerName).toBe('Оля the very lon');
    save.recordResult(0, true, 800, 5);
    expect(new LevelManager(save, new Leaderboard(store)).playTarget()).toBe(1);
  });
});
