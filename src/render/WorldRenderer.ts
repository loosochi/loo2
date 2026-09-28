import Phaser from 'phaser';
import { ROAD } from '../config/balanceConfig';
import { COLORS } from '../config/theme';
import { Intersection } from '../entities/Intersection';
import { Road } from '../entities/Road';
import type { Vehicle } from '../entities/Vehicle';
import { isYieldZone, type RuntimeRoute } from '../systems/RouteNetwork';
import type { TrafficSimulation } from '../systems/TrafficSimulation';
import { LightState, type Dir, type LightDef, type Vec2 } from '../types';
import { dirAngle, dirVector } from '../utils/geometry';
import { wrapAngle } from '../utils/math';
import { RoadNetwork } from '../graph/RoadNetwork';
import { paintNetworkMarkings, paintNetworkRoads } from './NetworkPainter';
import { CAR_BLINK, CAR_BRAKE, CAR_SHADOW, SOFT_DOT, TEX_SCALE, carKey } from './textures';

const DEPTH = { ground: 0, road: 1, marks: 2, markers: 3, zones: 4, shadow: 5, car: 6, carFx: 7, decor: 8, light: 9, fx: 10 };
const LIGHT_COLOR: Record<LightState, number> = {
  [LightState.RED]: COLORS.lightRed,
  [LightState.YELLOW]: COLORS.lightYellow,
  [LightState.GREEN]: COLORS.lightGreen,
};
/** World units baked around the level so edges stay detailed on wide screens. */
const BAKE_MARGIN = 480;
/** Pixel budget of the baked map texture (memory friendly on phones). */
const BAKE_PIXELS = 5_000_000;
const BUILDING_COLORS = [0xe9d8a6, 0xcad2c5, 0xf4a261, 0xbde0fe, 0xd6ccc2, 0xa3b18a];

interface CarSprite {
  shadow: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  brake: Phaser.GameObjects.Image;
  blinkF: Phaser.GameObjects.Image;
  blinkR: Phaser.GameObjects.Image;
  beaconA: Phaser.GameObjects.Image;
  beaconB: Phaser.GameObjects.Image;
  texture: string;
}

interface LightView {
  id: string;
  def: LightDef;
  container: Phaser.GameObjects.Container;
  lamps: Phaser.GameObjects.Arc[];
  glow: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Rectangle;
  ring: Phaser.GameObjects.Arc;
  state: LightState | null;
}

/**
 * Draws a simulation: static city map, traffic lights and pooled vehicle sprites.
 * Pure view — reads simulation state, never mutates it.
 */
export class WorldRenderer {
  private readonly cars = new Map<number, CarSprite>();
  private readonly pool: CarSprite[] = [];
  private readonly lightViews: LightView[] = [];
  private readonly zoneGfx: Phaser.GameObjects.Graphics;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private blinkClock = 0;
  showDanger = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sim: TrafficSimulation,
    private readonly layer: Phaser.GameObjects.Layer,
  ) {
    this.drawStatic();
    this.createLights();
    this.zoneGfx = this.track(scene.add.graphics().setDepth(DEPTH.zones));
  }

  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.layer.add(obj);
    this.objects.push(obj);
    return obj;
  }

  // ---------------------------------------------------------------- static map

  private drawStatic(): void {
    const { width: W, height: H } = this.sim.level.world;
    const lvl = this.sim.level;
    const roads = lvl.roads.map((r) => new Road(r));
    const boxes = lvl.intersections.map((i) => new Intersection(i));
    const PAD = 3000;
    const M = BAKE_MARGIN;
    const layers: Phaser.GameObjects.Graphics[] = [];
    const make = () => {
      const gr = this.scene.make.graphics({ x: 0, y: 0 }, false);
      layers.push(gr);
      return gr;
    };

    // Far background: a few cheap shapes so roads continue beyond the baked area.
    const far = this.track(this.scene.add.graphics().setDepth(DEPTH.ground));
    far.fillStyle(COLORS.ground, 1);
    far.fillRect(-PAD, -PAD, W + PAD * 2, H + PAD * 2);
    for (const r of roads) {
      const [c, a] = [r.rect(ROAD.sidewalk), r.rect(0)];
      far.fillStyle(COLORS.sidewalk, 1).fillRect(c.x, c.y, c.w, c.h);
      far.fillStyle(COLORS.asphalt, 1).fillRect(a.x, a.y, a.w, a.h);
    }

    const g = make();
    g.fillStyle(COLORS.ground, 1);
    g.fillRect(-M, -M, W + M * 2, H + M * 2);
    // Subtle lawn texture: deterministic darker patches.
    let seed = lvl.seed;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle(COLORS.groundDark, 0.35);
    for (let i = 0; i < 70; i++) g.fillCircle(rnd() * (W + 200) - 100, rnd() * (H + 200) - 100, 20 + rnd() * 50);

    // Decorations that sit on the ground (ponds, bushes) and building shadows.
    const low = make();
    const road = make();
    const m = make();
    const high = make();
    for (const d of lvl.decor) {
      if (d.type === 'building') {
        const w = d.w ?? 60;
        const h = d.h ?? 60;
        const col = BUILDING_COLORS[(d.color ?? 0) % BUILDING_COLORS.length];
        high.fillStyle(0x000000, 0.18);
        high.fillRoundedRect(d.x - w / 2 + 6, d.y - h / 2 + 7, w, h, 4);
        high.fillStyle(Phaser.Display.Color.ValueToColor(col).darken(18).color, 1);
        high.fillRoundedRect(d.x - w / 2, d.y - h / 2, w, h, 4);
        high.fillStyle(col, 1);
        high.fillRoundedRect(d.x - w / 2 + 4, d.y - h / 2 + 4, w - 8, h - 8, 3);
        high.fillStyle(0xffffff, 0.25);
        high.fillRect(d.x - w / 2 + 10, d.y - h / 2 + 10, Math.min(16, w / 4), Math.min(10, h / 5));
      } else if (d.type === 'tree') {
        const r = d.r ?? 10;
        high.fillStyle(0x000000, 0.18);
        high.fillCircle(d.x + 4, d.y + 5, r);
        high.fillStyle(0x3f7d4e, 1);
        high.fillCircle(d.x, d.y, r);
        high.fillStyle(0x5a9e62, 1);
        high.fillCircle(d.x - r * 0.25, d.y - r * 0.25, r * 0.62);
      } else if (d.type === 'bush') {
        const r = (d.r ?? 8) * 0.8;
        low.fillStyle(0x000000, 0.12);
        low.fillCircle(d.x + 2, d.y + 3, r);
        low.fillStyle(0x6ea865, 1);
        low.fillCircle(d.x, d.y, r);
      }
    }

    // Sidewalks, curbs and asphalt.
    const sw = ROAD.sidewalk;
    road.fillStyle(COLORS.curb, 1);
    for (const r of roads) {
      const q = r.rect(sw + 1.5);
      road.fillRect(q.x, q.y, q.w, q.h);
    }
    road.fillStyle(COLORS.sidewalk, 1);
    for (const r of roads) {
      const q = r.rect(sw);
      road.fillRect(q.x, q.y, q.w, q.h);
    }
    const slips = this.sim.routes.filter((r) => r.def.free).map((r) => slipPoints(r));
    for (const pts of slips) strokePath(road, pts, ROAD.laneWidth + sw * 2 + 3, COLORS.curb);
    for (const pts of slips) strokePath(road, pts, ROAD.laneWidth + sw * 2, COLORS.sidewalk);
    road.fillStyle(COLORS.asphalt, 1);
    for (const r of roads) {
      const q = r.rect(0);
      road.fillRect(q.x, q.y, q.w, q.h);
    }
    for (const pts of slips) strokePath(road, pts, ROAD.laneWidth - 2, COLORS.asphalt);
    const net = lvl.network ? new RoadNetwork(lvl.network) : null;
    if (net) paintNetworkRoads(road, net, lvl.world);

    // Lane markings (suppressed inside intersections).
    for (const r of roads) this.drawRoadMarkings(m, r, boxes);
    for (const b of boxes) {
      const q = b.bounds;
      m.fillStyle(COLORS.asphaltLight, 1);
      m.fillRect(q.x, q.y, q.w, q.h);
      this.drawCrosswalks(m, b);
    }
    if (net) paintNetworkMarkings(m, net, lvl.world);
    for (const l of lvl.lights) this.drawStopLine(m, l.stop, l.angle ?? dirAngle(l.dir), l.width);
    for (const r of this.sim.routes) if (r.def.free) this.drawYield(m, r);
    if (!net) this.drawEndpoints(m);

    // Bake everything static into one texture: one quad per frame instead of thousands of shapes.
    const bw = W + M * 2;
    const bh = H + M * 2;
    const res = Phaser.Math.Clamp(Math.sqrt(BAKE_PIXELS / (bw * bh)), 0.6, 2);
    const rt = this.scene.add.renderTexture(-M, -M, Math.ceil(bw * res), Math.ceil(bh * res));
    rt.setOrigin(0, 0).setScale(1 / res).setDepth(DEPTH.road);
    for (const gr of layers) {
      gr.setScale(res).setPosition(M * res, M * res);
      rt.draw(gr);
      gr.destroy();
    }
    this.track(rt);
  }

  private drawRoadMarkings(g: Phaser.GameObjects.Graphics, r: Road, boxes: Intersection[]): void {
    const { from, to } = r.def;
    const horiz = r.horizontal;
    const world = this.sim.level.world;
    const extent = horiz ? world.width : world.height;
    const a = Math.max(horiz ? Math.min(from.x, to.x) : Math.min(from.y, to.y), -BAKE_MARGIN - 20);
    const b = Math.min(horiz ? Math.max(from.x, to.x) : Math.max(from.y, to.y), extent + BAKE_MARGIN + 20);
    const c = horiz ? from.y : from.x;
    const inBox = (t: number, pad: number) =>
      boxes.some((bx) => (horiz ? bx.contains(t, c, pad) : bx.contains(c, t, pad)));
    const dash = 16;
    const gap = 12;
    const edge = r.width / 2 - 3;
    const lanes = r.def.lanes;
    for (let t = a; t < b; t += dash + gap) {
      if (inBox(t, ROAD.stopLineOffset + 4) || inBox(t + dash, ROAD.stopLineOffset + 4)) continue;
      if (lanes === 1) {
        // Dashed amber centre line on two-lane streets.
        g.fillStyle(COLORS.center, 0.95);
        if (horiz) g.fillRect(t, c - 1.2, dash, 2.4);
        else g.fillRect(c - 1.2, t, 2.4, dash);
      }
      // White dashed dividers between lanes going the same way.
      g.fillStyle(COLORS.lane, 0.85);
      for (let k = 1; k < lanes; k++) {
        for (const side of [-1, 1]) {
          const o = c + side * k * ROAD.laneWidth;
          if (horiz) g.fillRect(t, o - 1, dash, 2);
          else g.fillRect(o - 1, t, 2, dash);
        }
      }
    }
    if (lanes > 1) {
      // Double solid centre line on multi-lane avenues.
      g.fillStyle(COLORS.center, 0.95);
      for (let t = a; t < b; t += 8) {
        if (inBox(t, 0) || inBox(t + 8, 0)) continue;
        if (horiz) {
          g.fillRect(t, c - 3.4, 8, 2);
          g.fillRect(t, c + 1.4, 8, 2);
        } else {
          g.fillRect(c - 3.4, t, 2, 8);
          g.fillRect(c + 1.4, t, 2, 8);
        }
      }
    }
    // Solid centre line approaching junctions and edge lines.
    g.fillStyle(COLORS.lane, 0.55);
    for (let t = a; t < b; t += 8) {
      if (inBox(t, 0) || inBox(t + 8, 0)) continue;
      if (horiz) {
        g.fillRect(t, c - edge - 0.8, 8, 1.6);
        g.fillRect(t, c + edge - 0.8, 8, 1.6);
      } else {
        g.fillRect(c - edge - 0.8, t, 1.6, 8);
        g.fillRect(c + edge - 0.8, t, 1.6, 8);
      }
    }
    g.fillStyle(COLORS.center, 0.95);
    for (const bx of boxes) {
      const d = bx.def;
      const onThisRoad = horiz ? Math.abs(d.y - c) < 1 : Math.abs(d.x - c) < 1;
      if (!onThisRoad) continue;
      const len = ROAD.stopLineOffset + 2;
      const onRoad = (x: number, y: number) => r.containsPoint(x, y);
      if (horiz) {
        if (onRoad(d.x - d.halfW - len / 2, c)) g.fillRect(d.x - d.halfW - len, c - 1.2, len, 2.4);
        if (onRoad(d.x + d.halfW + len / 2, c)) g.fillRect(d.x + d.halfW, c - 1.2, len, 2.4);
      } else {
        if (onRoad(c, d.y - d.halfH - len / 2)) g.fillRect(c - 1.2, d.y - d.halfH - len, 2.4, len);
        if (onRoad(c, d.y + d.halfH + len / 2)) g.fillRect(c - 1.2, d.y + d.halfH, 2.4, len);
      }
    }
  }

  /** Shark-teeth give-way line and a yield sign where a free right turn merges. */
  private drawYield(g: Phaser.GameObjects.Graphics, r: RuntimeRoute): void {
    const z = r.zones.find((rz) => isYieldZone(r, rz));
    if (!z) return;
    const s = Math.max(0, z.sEnter - 6);
    const p = r.path.pointAt(s);
    const h = r.path.headingAt(s);
    const dx = Math.cos(h);
    const dy = Math.sin(h);
    const nx = -dy;
    const ny = dx;
    g.fillStyle(0xffffff, 0.95);
    for (let i = -1.5; i <= 1.5; i += 1) {
      const cx = p.x + nx * i * 6.5;
      const cy = p.y + ny * i * 6.5;
      // Triangles point towards approaching traffic.
      g.fillTriangle(cx - dx * 5 + nx * 2.8, cy - dy * 5 + ny * 2.8, cx - dx * 5 - nx * 2.8, cy - dy * 5 - ny * 2.8, cx + dx * 1, cy + dy * 1);
    }
    // Yield sign on the inner (island) side of the slip lane.
    const sx = p.x + nx * (ROAD.laneWidth / 2 + 7) - dx * 8;
    const sy = p.y + ny * (ROAD.laneWidth / 2 + 7) - dy * 8;
    const pts = [0, 1, 2].map((k) => {
      const a = h + Math.PI + (k * Math.PI * 2) / 3;
      return new Phaser.Math.Vector2(sx + Math.cos(a) * 7, sy + Math.sin(a) * 7);
    });
    g.fillStyle(0x000000, 0.2);
    g.fillCircle(sx + 1.5, sy + 2, 7);
    g.fillStyle(0xe63946, 1);
    g.fillPoints(pts, true);
    const inner = pts.map((q) => new Phaser.Math.Vector2(sx + (q.x - sx) * 0.55, sy + (q.y - sy) * 0.55));
    g.fillStyle(0xffffff, 1);
    g.fillPoints(inner, true);
  }

  private drawCrosswalks(g: Phaser.GameObjects.Graphics, b: Intersection): void {
    const d = b.def;
    const sides: Dir[] = d.crosswalks ?? [];
    g.fillStyle(0xffffff, 0.8);
    const depth = ROAD.stopLineOffset - 6;
    for (const side of sides) {
      const horizSide = side === 'N' || side === 'S';
      const span = horizSide ? d.halfW * 2 : d.halfH * 2;
      const stripes = Math.floor(span / 7);
      for (let i = 0; i < stripes; i++) {
        const o = -span / 2 + 2 + i * 7;
        if (side === 'N') g.fillRect(d.x + o, d.y - d.halfH - depth - 2, 3.5, depth);
        if (side === 'S') g.fillRect(d.x + o, d.y + d.halfH + 2, 3.5, depth);
        if (side === 'W') g.fillRect(d.x - d.halfW - depth - 2, d.y + o, depth, 3.5);
        if (side === 'E') g.fillRect(d.x + d.halfW + 2, d.y + o, depth, 3.5);
      }
    }
  }

  private drawStopLine(g: Phaser.GameObjects.Graphics, p: { x: number; y: number }, angle: number, width: number): void {
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const n = { x: -u.y, y: u.x };
    const h = width / 2 - 1;
    g.lineStyle(3, COLORS.stopLine, 0.95);
    g.lineBetween(p.x + n.x * h, p.y + n.y * h, p.x - n.x * h, p.y - n.y * h);
  }

  /** Arrow markers where traffic enters (cyan) and leaves (white) the map. */
  private drawEndpoints(g: Phaser.GameObjects.Graphics): void {
    const { width: W, height: H } = this.sim.level.world;
    const clampIn = (x: number, y: number) => ({ x: Phaser.Math.Clamp(x, 16, W - 16), y: Phaser.Math.Clamp(y, 16, H - 16) });
    const chevron = (x: number, y: number, dir: Dir, color: number, alpha: number) => {
      const v = dirVector(dir);
      const n = { x: -v.y, y: v.x };
      g.lineStyle(3, color, alpha);
      g.beginPath();
      g.moveTo(x - v.x * 4 + n.x * 6, y - v.y * 4 + n.y * 6);
      g.lineTo(x + v.x * 3, y + v.y * 3);
      g.lineTo(x - v.x * 4 - n.x * 6, y - v.y * 4 - n.y * 6);
      g.strokePath();
    };
    for (const s of this.sim.level.spawns) {
      const p = clampIn(s.x, s.y);
      const v = dirVector(s.dir);
      for (let k = 0; k < 3; k++) chevron(p.x + v.x * k * 9, p.y + v.y * k * 9, s.dir, COLORS.accent, 0.35 + k * 0.25);
    }
    for (const e of this.sim.level.exits) {
      const p = clampIn(e.x, e.y);
      const v = dirVector(e.dir);
      for (let k = 0; k < 2; k++) chevron(p.x - v.x * k * 9, p.y - v.y * k * 9, e.dir, 0xffffff, 0.5 - k * 0.2);
    }
  }

  // ---------------------------------------------------------------- lights

  private createLights(): void {
    for (const l of this.sim.lights.lights) {
      const def = l.def;
      const bar = this.track(
        this.scene.add
          .rectangle(def.stop.x, def.stop.y, 5, def.width - 4, COLORS.lightRed, 0.9)
          .setRotation(def.angle ?? dirAngle(def.dir))
          .setDepth(DEPTH.marks),
      );
      const container = this.scene.add.container(def.head.x, def.head.y).setDepth(DEPTH.light);
      this.track(container);
      const ring = this.scene.add.circle(0, 0, 17, 0xffffff, 0).setStrokeStyle(2, 0xffffff, 0.0);
      const glow = this.scene.add.image(0, 0, SOFT_DOT).setScale(0.75).setAlpha(0.7);
      const shadow = this.scene.add.rectangle(2.5, 3, 12, 30, 0x000000, 0.25);
      const housing = this.scene.add.rectangle(0, 0, 12, 30, COLORS.lightHousing).setStrokeStyle(1.2, 0x5b6479);
      const lamps = [-9, 0, 9].map((dy) => this.scene.add.circle(0, dy, 3.6, COLORS.lightOff));
      container.add([ring, glow, shadow, housing, ...lamps]);
      const view: LightView = { id: l.id, def, container, lamps, glow, bar, ring, state: null };
      this.lightViews.push(view);
      this.applyLight(view, l.state, false);
    }
  }

  private applyLight(view: LightView, state: LightState, animate: boolean): void {
    view.state = state;
    const order = [LightState.RED, LightState.YELLOW, LightState.GREEN];
    view.lamps.forEach((lamp, i) => lamp.setFillStyle(order[i] === state ? LIGHT_COLOR[order[i]] : COLORS.lightOff));
    const col = LIGHT_COLOR[state];
    view.glow.setTint(col);
    view.glow.y = [-9, 0, 9][order.indexOf(state)];
    view.bar.setFillStyle(col, 0.95);
    if (animate) {
      this.scene.tweens.killTweensOf([view.container, view.glow, view.bar]);
      view.container.setScale(1.3);
      this.scene.tweens.add({ targets: view.container, scale: 1, duration: 260, ease: 'Back.Out' });
      view.glow.setScale(1.4).setAlpha(1);
      this.scene.tweens.add({ targets: view.glow, scale: 0.75, alpha: 0.7, duration: 380, ease: 'Quad.Out' });
      view.bar.setAlpha(0.3);
      this.scene.tweens.add({ targets: view.bar, alpha: 1, duration: 200 });
    }
  }

  /** Nearest light to a world point within `radius` (matches the signal head or its stop line). */
  pickLight(x: number, y: number, radius: number): string | null {
    let best: string | null = null;
    let bestD = radius;
    for (const v of this.lightViews) {
      const dHead = Math.hypot(v.def.head.x - x, v.def.head.y - y);
      const dBar = Math.hypot(v.def.stop.x - x, v.def.stop.y - y) + 4;
      const d = Math.min(dHead, dBar);
      if (d < bestD) {
        bestD = d;
        best = v.id;
      }
    }
    return best;
  }

  /** Keep signal heads upright on screen when the camera is rotated. */
  setViewRotation(rad: number): void {
    for (const v of this.lightViews) v.container.setRotation(-rad);
  }

  highlightLight(id: string | null): void {
    for (const v of this.lightViews) v.ring.setStrokeStyle(2, 0xffffff, v.id === id ? 0.85 : 0);
  }

  // ---------------------------------------------------------------- per frame

  update(delta: number): void {
    this.blinkClock += delta;
    for (const v of this.lightViews) {
      const st = this.sim.lights.get(v.id)!.state;
      if (st !== v.state) this.applyLight(v, st, true);
      if (st === LightState.YELLOW) v.glow.setAlpha(0.5 + 0.4 * Math.sin(this.blinkClock / 90));
    }
    this.syncVehicles();
    this.drawZones();
  }

  private syncVehicles(): void {
    const seen = new Set<number>();
    const blinkOn = Math.floor(this.blinkClock / 330) % 2 === 0;
    for (const v of this.sim.vehicles) {
      seen.add(v.id);
      let sprite = this.cars.get(v.id);
      if (!sprite) {
        sprite = this.acquire(v);
        this.cars.set(v.id, sprite);
      }
      this.placeCar(sprite, v, blinkOn);
    }
    for (const [id, sprite] of this.cars) {
      if (seen.has(id)) continue;
      this.release(sprite);
      this.cars.delete(id);
    }
  }

  private acquire(v: Vehicle): CarSprite {
    const key = carKey(v.kind, v.color);
    let s = this.pool.pop();
    if (!s) {
      s = {
        shadow: this.track(this.scene.add.image(0, 0, CAR_SHADOW).setDepth(DEPTH.shadow)),
        body: this.track(this.scene.add.image(0, 0, key).setDepth(DEPTH.car)),
        brake: this.track(this.scene.add.image(0, 0, CAR_BRAKE).setDepth(DEPTH.carFx)),
        blinkF: this.track(this.scene.add.image(0, 0, CAR_BLINK).setDepth(DEPTH.carFx)),
        blinkR: this.track(this.scene.add.image(0, 0, CAR_BLINK).setDepth(DEPTH.carFx)),
        beaconA: this.track(this.scene.add.image(0, 0, SOFT_DOT).setDepth(DEPTH.carFx).setBlendMode(Phaser.BlendModes.ADD)),
        beaconB: this.track(this.scene.add.image(0, 0, SOFT_DOT).setDepth(DEPTH.carFx).setBlendMode(Phaser.BlendModes.ADD)),
        texture: key,
      };
    }
    if (s.texture !== key) {
      s.body.setTexture(key);
      s.texture = key;
    }
    s.body.clearTint();
    for (const img of [s.shadow, s.body, s.brake, s.blinkF, s.blinkR]) img.setVisible(true);
    s.beaconA.setVisible(v.emergency);
    s.beaconB.setVisible(v.emergency);
    return s;
  }

  private release(s: CarSprite): void {
    for (const img of [s.shadow, s.body, s.brake, s.blinkF, s.blinkR, s.beaconA, s.beaconB]) img.setVisible(false);
    this.pool.push(s);
  }

  private placeCar(s: CarSprite, v: Vehicle, blinkOn: boolean): void {
    const k = 1 / TEX_SCALE;
    const grow = Math.min(1, v.age / 0.45);
    const scale = k * (0.7 + 0.3 * Phaser.Math.Easing.Back.Out(grow));
    const alpha = Math.min(1, v.age / 0.3);
    const cos = Math.cos(v.angle);
    const sin = Math.sin(v.angle);

    s.body.setPosition(v.x, v.y).setRotation(v.angle).setScale(scale).setAlpha(alpha);
    s.shadow
      .setPosition(v.x + 2.5, v.y + 3.5)
      .setRotation(v.angle)
      .setScale((scale * (v.length + 3)) / 26, (scale * (v.width + 3)) / 15)
      .setAlpha(alpha);

    const rearX = v.x - cos * (v.length / 2 - 1);
    const rearY = v.y - sin * (v.length / 2 - 1);
    s.brake.setPosition(rearX, rearY).setRotation(v.angle).setScale(k * 1.1, (k * v.width) / 12);
    const braking = v.acc < -12 || (v.speed < 1 && v.stopTarget !== null);
    s.brake.setAlpha(braking ? alpha : 0);

    // Turn signal: look ahead along the route for a heading change.
    const path = v.route.path;
    const ahead = Math.min(path.length, v.s + 80);
    const turn = wrapAngle(path.headingAt(ahead) - path.headingAt(v.s));
    const signalling = Math.abs(turn) > 0.5 && v.s < path.length - 10;
    const side = turn > 0 ? 1 : -1; // +1 = right in screen space
    const show = signalling && blinkOn && !v.crashed;
    if (show) {
      const hw = v.width / 2 - 0.5;
      const hl = v.length / 2 - 1.5;
      const nx = -sin * side;
      const ny = cos * side;
      s.blinkF.setPosition(v.x + cos * hl + nx * hw, v.y + sin * hl + ny * hw).setScale(k * 1.4);
      s.blinkR.setPosition(v.x - cos * hl + nx * hw, v.y - sin * hl + ny * hw).setScale(k * 1.4);
    }
    s.blinkF.setVisible(show);
    s.blinkR.setVisible(show);
    if (v.crashed) s.body.setTint(0xff9a9a);

    if (v.emergency) {
      // Alternating red / blue roof beacons.
      const phase = Math.floor(this.blinkClock / 160) % 2 === 0;
      const off = v.length * 0.12;
      const hw = v.width * 0.28;
      s.beaconA
        .setPosition(v.x + cos * off - sin * hw, v.y + sin * off + cos * hw)
        .setTint(0xff3040)
        .setScale(phase ? 0.32 : 0.18)
        .setAlpha(alpha * (phase ? 1 : 0.5));
      s.beaconB
        .setPosition(v.x + cos * off + sin * hw, v.y + sin * off - cos * hw)
        .setTint(0x3a7bff)
        .setScale(phase ? 0.18 : 0.32)
        .setAlpha(alpha * (phase ? 0.5 : 1));
    }
  }

  private drawZones(): void {
    const g = this.zoneGfx;
    g.clear();
    if (!this.showDanger) return;
    const pulse = 0.35 + 0.25 * Math.sin(this.blinkClock / 110);
    for (const z of this.sim.collisions.zones) {
      if (!z.danger) continue;
      g.fillStyle(COLORS.bad, pulse * 0.6);
      g.fillCircle(z.x, z.y, Math.min(z.radius, 22));
      g.lineStyle(2, COLORS.bad, pulse + 0.2);
      g.strokeCircle(z.x, z.y, Math.min(z.radius, 22) + 2);
    }
  }

  /** Visual feedback for a crash: sparks, flash ring and red tint. */
  playCrash(x: number, y: number): void {
    const ring = this.track(this.scene.add.circle(x, y, 6, 0xffffff, 0).setStrokeStyle(4, COLORS.bad, 1).setDepth(DEPTH.fx));
    this.scene.tweens.add({ targets: ring, radius: 60, alpha: 0, duration: 700, ease: 'Cubic.Out' });
    const flash = this.track(this.scene.add.image(x, y, SOFT_DOT).setTint(0xffe0a0).setScale(0.4).setDepth(DEPTH.fx));
    this.scene.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: 600, ease: 'Quad.Out' });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
      const d = 22 + Math.random() * 40;
      const col = i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xffc94a : 0xff7a45;
      const p = this.track(this.scene.add.circle(x, y, 2 + Math.random() * 2, col).setDepth(DEPTH.fx));
      this.scene.tweens.add({
        targets: p,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        scale: 0.3,
        duration: 500 + Math.random() * 400,
        ease: 'Cubic.Out',
      });
    }
    const smoke = this.track(this.scene.add.image(x, y, SOFT_DOT).setTint(0x333333).setAlpha(0.0).setScale(0.3).setDepth(DEPTH.fx));
    this.scene.tweens.add({ targets: smoke, alpha: 0.55, scale: 1.3, duration: 900, yoyo: true, hold: 600 });
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.cars.clear();
    this.pool.length = 0;
  }
}

/** The curved part of a slip-lane route, with a little straight lead-in and lead-out. */
function slipPoints(r: RuntimeRoute): Vec2[] {
  const path = r.path;
  let first = -1;
  let last = -1;
  for (let i = 0; i < path.points.length; i++) {
    if (path.curvature[i] > 1e-3) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return [];
  const pad = Math.round(12 / path.step);
  return path.points.slice(Math.max(0, first - pad), Math.min(path.points.length, last + pad + 1));
}

function strokePath(g: Phaser.GameObjects.Graphics, pts: Vec2[], width: number, color: number): void {
  if (pts.length < 2) return;
  g.lineStyle(width, color, 1);
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.strokePath();
  g.fillStyle(color, 1);
  g.fillCircle(pts[0].x, pts[0].y, width / 2);
  g.fillCircle(pts[pts.length - 1].x, pts[pts.length - 1].y, width / 2);
}
