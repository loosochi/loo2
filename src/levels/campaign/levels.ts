/**
 * Campaign 2.0 — ten road-network levels. Each one needs an infrastructure decision:
 * where to put lights, which road gets priority, what to build, turn around or widen.
 */
import { LightState } from '../../types';
import { NetBuilder, allLights, at, campaign, lightFrom, type CampaignLevel } from './common';

const W = 800;
const H = 640;
const TAXI = { taxi: 1.5 };

// 1 ─ Simple Crossing: a busy main road starves the side street until you add lights.
const c01 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [W, 320],
    ])
    .road([
      [400, 0],
      [400, H],
    ])
    .exit([0, 320], [W, 320], [400, H])
    .spawn([0, 320], 20, [0.9, 1.3], { to: [[W, 320]], mix: TAXI })
    .spawn([W, 320], 20, [0.9, 1.3], { delay: 0.6, to: [[0, 320]] })
    .spawn([400, 0], 8, [2.2, 3.2], { delay: 1, to: [[400, H]] })
    .priority([400, 320], [0, 320], [W, 320]);
  return campaign(
    {
      id: 101,
      key: 'c-simple-crossing',
      name: 'Simple Crossing',
      description: 'The avenue has right of way and never stops. The side street waits forever.',
      hint: 'BUILD mode → TRAFFIC LIGHT: tap the approaches of the junction, then press START.',
      ru: {
        name: 'Простой перекрёсток',
        description: 'У проспекта главная дорога, и он не останавливается. Боковая улица ждёт вечно.',
        hint: 'Режим СТРОЙКА → СВЕТОФОР: нажмите на подъезды к перекрёстку, затем СТАРТ.',
      },
      seed: 2101,
      network: b.data(),
      budget: 1500,
      rules: { allowed: ['light', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 48 },
        { type: 'MAX_WAIT_TIME', value: 18 },
      ],
      stars: { parTime: 55, avgWait: 5, maxWait: 12, score: 3700 },
    },
    (m) => {
      lightFrom(m, [400, 320], [0, 320]);
      lightFrom(m, [400, 320], [W, 320]);
      lightFrom(m, [400, 320], [400, 0]);
    },
  );
})();

// 2 ─ Three Ways: a Y junction with no obvious main road — everyone gives way to everyone.
const c02 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [400, 320],
    ])
    .road([
      [400, 320],
      [720, 0],
    ])
    .road([
      [400, 320],
      [720, 640],
    ])
    .exit([0, 320], [720, 0], [720, 640])
    .spawn([0, 320], 20, [0.8, 1.1], { to: [[720, 0]] })
    .spawn([720, 0], 20, [0.8, 1.1], { delay: 0.5, to: [[0, 320]] })
    .spawn([720, 640], 6, [3.0, 4.0], { delay: 2, to: [[720, 0]] });
  return campaign(
    {
      id: 102,
      key: 'c-three-ways',
      name: 'Three Ways',
      description: 'A Y junction without a main road: every driver gives way to every other.',
      hint: 'INTERSECTION tool: tap the junction until the busy west–northeast road is the main road.',
      ru: {
        name: 'Три дороги',
        description: 'Y-образный перекрёсток без главной дороги: все уступают всем.',
        hint: 'Инструмент ПЕРЕКРЁСТОК: нажимайте на перекрёсток, пока главной не станет оживлённая дорога запад — северо-восток.',
      },
      seed: 2102,
      network: b.data(),
      budget: 1000,
      rules: { allowed: ['intersection', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 46 },
        { type: 'TIME_LIMIT', value: 75 },
      ],
      stars: { parTime: 55, avgWait: 4, maxWait: 25, score: 5300 },
    },
    (m) => {
      const j = at(m, 400, 320);
      const w = m.net.edgesAt(j).find((e) => m.net.node(m.net.other(e, j))!.x === 0)!.id;
      const ne = m.net.edgesAt(j).find((e) => m.net.node(m.net.other(e, j))!.y === 0)!.id;
      for (let i = 0; i < 8; i++) {
        const p = m.net.node(j)!.priority;
        if (Array.isArray(p) && p.includes(w) && p.includes(ne)) return;
        m.budget.spent = 0; // cycling is paid once in the real game; the test only needs the end state
        m.cyclePriority(j);
      }
      m.budget.spent = 1000;
    },
  );
})();

// 3 ─ Missing Link: the avenue ends before the east exit. Build the missing road.
const c03 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [480, 320],
    ])
    .road([
      [640, 320],
      [W, 320],
    ])
    .road([
      [320, 0],
      [320, H],
    ])
    .exit([W, 320], [320, H])
    .spawn([0, 320], 12, [1.6, 2.4], { to: [[W, 320]], mix: TAXI })
    .spawn([320, 0], 10, [2.0, 3.0], { delay: 1, to: [[320, H]] });
  return campaign(
    {
      id: 103,
      key: 'c-missing-link',
      name: 'Missing Link',
      description: 'Drivers from the west want to go east — but the road stops short.',
      hint: 'BUILD → ROAD: drag from the dead end to the stub on the right. Snapping joins them.',
      ru: {
        name: 'Недостающее звено',
        description: 'Машины с запада едут на восток — но дорога обрывается.',
        hint: 'СТРОЙКА → ДОРОГА: протяните от тупика до обрывка справа. Привязка соединит их.',
      },
      seed: 2103,
      network: b.data(),
      budget: 1200,
      rules: { allowed: ['road', 'delete', 'light', 'inspect'] },
      objectives: [{ type: 'PASS_CARS', value: 22 }],
      stars: { parTime: 50, avgWait: 4, maxWait: 12, score: 2800 },
    },
    (m) => {
      const r = m.buildRoad(m.planRoad({ x: 480, y: 320 }, { x: 640, y: 320 }));
      if (!r.ok) throw new Error(r.reason);
    },
  );
})();

// 4 ─ T-Junction: most traffic comes out of the side road; give it the right of way.
const c04 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 240],
      [W, 240],
    ])
    .road([
      [400, 240],
      [400, H],
    ])
    .exit([0, 240], [W, 240], [400, H])
    .spawn([400, H], 14, [1.4, 2.0], { to: [[0, 240]], mix: TAXI })
    .spawn([0, 240], 13, [1.0, 1.4], { delay: 0.5, to: [[W, 240]] })
    .spawn([W, 240], 13, [1.0, 1.4], { delay: 1.1, to: [[0, 240]] });
  return campaign(
    {
      id: 104,
      key: 'c-t-junction',
      name: 'T-Junction',
      description: 'Left turns out of the side road must cross both directions of a busy avenue.',
      hint: 'Three approaches, three lights. Give the side road its own phase.',
      ru: {
        name: 'Т-образный перекрёсток',
        description: 'Левый поворот с боковой дороги пересекает оба направления оживлённого проспекта.',
        hint: 'Три подъезда — три светофора. Дайте боковой дороге свою фазу.',
      },
      seed: 2104,
      network: b.data(),
      budget: 1500,
      rules: { allowed: ['light', 'intersection', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 40 },
        { type: 'MAX_WAIT_TIME', value: 17 },
      ],
      stars: { parTime: 55, avgWait: 5, maxWait: 14, score: 4600 },
    },
    (m) => allLights(m, [400, 240]),
  );
})();

// 5 ─ Tight Budget: four busy approaches, money for three lights.
const c05 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [W, 320],
    ])
    .road([
      [400, 0],
      [400, H],
    ])
    .exit([0, 320], [W, 320], [400, 0], [400, H])
    .spawn([0, 320], 22, [0.9, 1.3], { to: [[W, 320]] })
    .spawn([W, 320], 22, [0.9, 1.3], { delay: 0.7, to: [[0, 320]] })
    .spawn([400, 0], 8, [2.2, 3.0], { delay: 1.2, to: [[400, H]] })
    .spawn([400, H], 8, [2.2, 3.0], { delay: 1.8, to: [[400, 0]] })
    .priority([400, 320], [0, 320], [W, 320]);
  return campaign(
    {
      id: 105,
      key: 'c-tight-budget',
      name: 'Tight Budget',
      description: 'Four busy approaches and money for only three lights. Spend it wisely.',
      hint: 'An approach without a light gives way — it goes when the others are red.',
      ru: {
        name: 'Скромный бюджет',
        description: 'Четыре оживлённых подъезда и деньги только на три светофора.',
        hint: 'Подъезд без светофора уступает — он поедет, когда у остальных красный.',
      },
      seed: 2105,
      network: b.data(),
      budget: 1500,
      rules: { allowed: ['light', 'intersection', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 60 },
        { type: 'MAX_WAIT_TIME', value: 28 },
        { type: 'BUDGET_LIMIT', value: 1500 },
      ],
      stars: { parTime: 70, avgWait: 7, maxWait: 16, score: 6400 },
    },
    (m) => {
      lightFrom(m, [400, 320], [0, 320]);
      lightFrom(m, [400, 320], [W, 320]);
      lightFrom(m, [400, 320], [400, 0]);
    },
  );
})();

// 6 ─ Twin Junctions: two junctions on one avenue; queues between them matter.
const c06 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [W, 320],
    ])
    .road([
      [260, 0],
      [260, H],
    ])
    .road([
      [540, 0],
      [540, H],
    ])
    .exit([0, 320], [W, 320], [260, H], [540, 0])
    .spawn([0, 320], 12, [1.3, 2.0], { to: [[W, 320]], mix: TAXI })
    .spawn([W, 320], 12, [1.3, 2.0], { delay: 0.8, to: [[0, 320]] })
    .spawn([260, 0], 8, [2.2, 3.2], { delay: 1.2, to: [[260, H]] })
    .spawn([540, H], 8, [2.2, 3.2], { delay: 1.6, to: [[540, 0]] });
  return campaign(
    {
      id: 106,
      key: 'c-twin-junctions',
      name: 'Twin Junctions',
      description: 'Two side streets cross the avenue close together.',
      hint: 'Not every approach needs a light. INSPECT shows where drivers wait the longest.',
      ru: {
        name: 'Два перекрёстка',
        description: 'Две улицы пересекают проспект рядом друг с другом.',
        hint: 'Не каждому подъезду нужен светофор. ИНСПЕКТОР покажет, где ждут дольше всего.',
      },
      seed: 2106,
      network: b.data(),
      budget: 4000,
      rules: { allowed: ['light', 'intersection', 'road', 'delete', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 40 },
        { type: 'MAX_WAIT_TIME', value: 19 },
      ],
      stars: { parTime: 55, avgWait: 5, maxWait: 14, score: 4600 },
    },
    (m) => {
      // Only the side streets need a signal: the avenue then gives way while they are green.
      lightFrom(m, [260, 320], [260, 0]);
      lightFrom(m, [540, 320], [540, H]);
    },
  );
})();

// 7 ─ Wrong Way: the road to the north exit is one-way in the wrong direction.
const c07 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 360],
      [W, 360],
    ])
    .road([
      [400, 0],
      [400, 360],
    ])
    .editable([400, 180])
    .exit([W, 360], [400, 0], [0, 360])
    .spawn([0, 360], 12, [1.6, 2.4], { to: [[400, 0], [W, 360]] })
    .spawn([W, 360], 10, [1.8, 2.8], { delay: 1, to: [[0, 360]] });
  const d = b.data();
  // Make the northern street one-way southbound (towards the junction).
  const north = b.net.edges.find((e) => !e.locked)!;
  const top = b.net.node(north.a)!.y < b.net.node(north.b)!.y ? 'a' : 'b';
  if (top === 'a') b.net.setLanes(north.id, 2, 0);
  else b.net.setLanes(north.id, 0, 2);
  return campaign(
    {
      id: 107,
      key: 'c-wrong-way',
      name: 'Wrong Way',
      description: 'Half of the westerners want to go north — but that street is one-way south.',
      hint: 'DIRECTION tool: tap the northern street to change its direction.',
      ru: {
        name: 'Не в ту сторону',
        description: 'Половина машин с запада едет на север — но там одностороннее движение на юг.',
        hint: 'Инструмент НАПРАВЛЕНИЕ: нажмите на северную улицу, чтобы развернуть движение.',
      },
      seed: 2107,
      network: d,
      budget: 600,
      rules: { allowed: ['direction', 'light', 'inspect'] },
      objectives: [{ type: 'PASS_CARS', value: 22 }],
      stars: { parTime: 50, avgWait: 4, maxWait: 12, score: 2700 },
    },
    (m) => {
      const e = m.net.edges.find((x) => !x.locked)!;
      const r = m.cycleDirection(e.id); // one-way northbound
      if (!r.ok) throw new Error(r.reason);
    },
  );
})();

// 8 ─ Lanes: a single-lane approach queues up at a signal; widen it.
const c08 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [400, 320],
    ])
    .road([
      [400, 320],
      [W, 320],
    ])
    .road([
      [400, 0],
      [400, H],
    ])
    .editable([200, 320])
    .editable([600, 320])
    .exit([W, 320], [400, H], [0, 320])
    .spawn([0, 320], 26, [0.75, 1.0], { to: [[W, 320]], mix: TAXI })
    .spawn([400, 0], 10, [1.8, 2.6], { delay: 1, to: [[400, H]] })
    .light([400, 320], [0, 320])
    .light([400, 320], [400, 0]);
  return campaign(
    {
      id: 108,
      key: 'c-lanes',
      name: 'Lanes',
      description: 'A wall of cars from the west and only one lane to hold them.',
      hint: 'LANE tool: tap the side of a road to add a lane in that direction.',
      ru: {
        name: 'Полосы',
        description: 'Стена машин с запада — и всего одна полоса.',
        hint: 'Инструмент ПОЛОСА: нажмите на сторону дороги, чтобы добавить полосу в этом направлении.',
      },
      seed: 2108,
      network: b.data(),
      budget: 1400,
      rules: { allowed: ['lane', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 36 },
        { type: 'TIME_LIMIT', value: 61 },
      ],
      stars: { parTime: 55, avgWait: 6, maxWait: 16, score: 4000 },
    },
    (m) => {
      const west = m.net.edges.find((e) => !e.locked && Math.max(m.net.node(e.a)!.x, m.net.node(e.b)!.x) <= 400)!;
      const east = m.net.edges.find((e) => !e.locked && Math.min(m.net.node(e.a)!.x, m.net.node(e.b)!.x) >= 400)!;
      // Eastbound traffic drives on the south side (y > 320).
      for (const e of [west, east]) {
        const r = m.cycleLanes(e.id, { x: (m.net.node(e.a)!.x + m.net.node(e.b)!.x) / 2, y: 340 });
        if (!r.ok) throw new Error(r.reason);
      }
    },
  );
})();

// 9 ─ Siren Street: rush hour on the avenue, and an ambulance from the side street.
const c09 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 320],
      [W, 320],
    ])
    .road([
      [400, 0],
      [400, H],
    ])
    .exit([0, 320], [W, 320], [400, 0], [400, H])
    .spawn([0, 320], 18, [1.0, 1.5], { to: [[W, 320]], mix: { bus: 1, taxi: 1 } })
    .spawn([W, 320], 18, [1.0, 1.5], { delay: 0.6, to: [[0, 320]] })
    .spawn([400, H], 6, [3.0, 4.0], { delay: 2, to: [[400, 0]] })
    .spawn([400, 0], 4, [3.0, 4.0], { delay: 3, to: [[400, H]] })
    .emergency(14, [400, H], [400, 0], 'ambulance');
  return campaign(
    {
      id: 109,
      key: 'c-siren-street',
      name: 'Siren Street',
      description: 'The avenue is jammed and an ambulance must cross it from the south.',
      hint: 'Emergency vehicles cross on red when the junction is clear. Keep it clear for them.',
      ru: {
        name: 'Улица сирен',
        description: 'Проспект стоит, а скорой нужно пересечь его с юга.',
        hint: 'Спецтранспорт проезжает на красный, если перекрёсток свободен. Освободите его.',
      },
      seed: 2109,
      network: b.data(),
      budget: 2000,
      rules: { allowed: ['light', 'intersection', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 47 },
        { type: 'EMERGENCY_PRIORITY', value: 8 },
      ],
      stars: { parTime: 70, avgWait: 7, maxWait: 18, score: 5500 },
    },
    (m) => allLights(m, [400, 320]),
  );
})();

// 10 ─ City Grid: a 2×2 grid of streets; limited money for a whole district.
const c10 = (() => {
  const b = new NetBuilder()
    .road([
      [0, 220],
      [W, 220],
    ])
    .road([
      [0, 440],
      [W, 440],
    ])
    .road([
      [270, 0],
      [270, H],
    ])
    .road([
      [540, 0],
      [540, H],
    ])
    .exit([W, 220], [0, 440], [270, H], [540, 0], [W, 440], [270, 0])
    .spawn([0, 220], 16, [1.0, 1.5], { to: [[W, 220], [540, 0]], mix: TAXI })
    .spawn([W, 440], 16, [1.0, 1.5], { delay: 0.8, to: [[0, 440], [270, H]] })
    .spawn([270, 0], 12, [1.6, 2.4], { delay: 1.4, to: [[270, H], [W, 440]] })
    .spawn([540, H], 12, [1.6, 2.4], { delay: 2, to: [[540, 0], [270, 0]] })
    .emergency(30, [0, 220], [W, 220], 'fire');
  return campaign(
    {
      id: 110,
      key: 'c-city-grid',
      name: 'City Grid',
      description: 'Four junctions, four entries, one budget. Plan the whole district.',
      hint: 'Not every junction needs lights. Check the traffic load view (STATS) first.',
      ru: {
        name: 'Городская сетка',
        description: 'Четыре перекрёстка, четыре въезда, один бюджет. Спланируйте весь район.',
        hint: 'Не каждому перекрёстку нужны светофоры. Сначала посмотрите загрузку (СТАТИСТИКА).',
      },
      seed: 2110,
      network: b.data(),
      budget: 6000,
      rules: { allowed: ['road', 'delete', 'light', 'lane', 'direction', 'intersection', 'inspect'] },
      objectives: [
        { type: 'PASS_CARS', value: 57 },
        { type: 'MAX_WAIT_TIME', value: 50 },
        { type: 'EMERGENCY_PRIORITY', value: 10 },
      ],
      stars: { parTime: 85, avgWait: 12, maxWait: 40, score: 6000 },
    },
    (m) => {
      allLights(m, [540, 220]);
      allLights(m, [270, 440]);
    },
  );
})();

export const CAMPAIGN: readonly CampaignLevel[] = [c01, c02, c03, c04, c05, c06, c07, c08, c09, c10];
export const CAMPAIGN_LEVELS = CAMPAIGN.map((c) => c.level);
void LightState;
void at;
