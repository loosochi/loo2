import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import {
  CARS_RANGE,
  EDITOR_WORLD,
  TIME_LIMITS,
  addRoad,
  buildLevel,
  decodeLevel,
  encodeLevel,
  nearestRoad,
  removeRoad,
  toggleLanes,
  totalVehicles,
  validate,
  type EditorLevel,
} from '../editor/EditorModel';
import { SLOT_COUNT } from '../editor/EditorStore';
import { t, type Key } from '../i18n';
import { crossing, defineLevel, hRoad, vRoad } from '../levels/builder';
import { CameraController } from '../render/CameraController';
import { WorldRenderer } from '../render/WorldRenderer';
import { AutoPilot } from '../systems/AutoPilot';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import type { LevelDef } from '../types';
import { Button } from '../ui/Button';
import { openDialog } from '../ui/domDialog';
import { createSplitView, enterScene, goTo, makeText, panel, uiScale, type IconName, type SplitView } from '../ui/uiKit';
import { formatTime } from '../utils/math';

type Tool = 'h' | 'v' | 'lanes' | 'erase';

/**
 * Level editor: tap the map to lay roads, toggle lanes, set up the traffic, then test-play,
 * let the autopilot check it, or share it as a code. Three save slots.
 */
export class EditorScene extends Phaser.Scene {
  private view!: SplitView;
  private camCtl!: CameraController;
  private worldView: WorldRenderer | null = null;
  private sim: TrafficSimulation | null = null;
  private ui!: Phaser.GameObjects.Container;
  private panelLayer: Phaser.GameObjects.Container | null = null;
  private model!: EditorLevel;
  private slot = 0;
  private tool: Tool = 'h';
  private top = 0;
  private bottom = 0;
  private status!: Phaser.GameObjects.Text;
  private toastText: Phaser.GameObjects.Text | null = null;
  private checking = false;

  constructor() {
    super('Editor');
  }

  init(data: { slot?: number }): void {
    const store = levelManager().editor;
    this.slot = typeof data?.slot === 'number' ? data.slot : store.current;
    this.model = store.load(this.slot, t('editor.name', { n: this.slot + 1 }));
    this.panelLayer = null;
    this.worldView = null;
    this.checking = false;
  }

  create(): void {
    this.view = createSplitView(this);
    this.camCtl = new CameraController(this.view.worldCam, EDITOR_WORLD);
    this.ui = this.add.container(0, 0);
    this.view.uiRoot.add(this.ui);
    this.buildUI();
    this.rebuildPreview();
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onMapTap, this);
    const onResize = () => {
      this.buildUI();
      this.fit();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onMapTap, this);
      this.worldView?.destroy();
    });
    enterScene(this);
  }

  // ------------------------------------------------------------------ model

  private persist(): void {
    levelManager().editor.save(this.slot, this.model);
  }

  /** Preview: the generated level, or just the roads while it has no junction yet. */
  private previewLevel(): LevelDef {
    if (!validate(this.model)) return buildLevel(this.model);
    return defineLevel({
      id: 1000,
      key: 'preview',
      name: 'preview',
      description: '',
      world: { ...EDITOR_WORLD },
      seed: 1,
      roads: [...this.model.h.map((r, i) => hRoad(`h${i}`, r.at, { lanes: r.lanes })), ...this.model.vr.map((r, j) => vRoad(`v${j}`, r.at, { lanes: r.lanes }))],
      intersections: this.model.h.flatMap((hr, i) => this.model.vr.map((vr, j) => crossing(`X${i}_${j}`, vr.at, hr.at, [], { h: hr.lanes, v: vr.lanes }))),
      lights: [],
      routes: [],
      flows: [],
      goal: { carsToPass: 0 },
      stars: { parTime: 1, avgWait: 1, maxWait: 1, score: 1 },
      decorDensity: 0.9,
    });
  }

  private rebuildPreview(): void {
    this.worldView?.destroy();
    this.sim = new TrafficSimulation(this.previewLevel());
    this.worldView = new WorldRenderer(this, this.sim, this.view.worldLayer);
    this.worldView.showDanger = false;
    this.fit();
    this.worldView.update(0);
    this.updateStatus();
  }

  private fit(): void {
    const { width: W, height: H } = this.scale;
    this.view.uiCam.setSize(W, H);
    const m = 8;
    this.camCtl.fit({ x: m, y: this.top + m, w: W - m * 2, h: H - this.top - this.bottom - m * 2 }, { width: W, height: H }, false);
  }

  // ------------------------------------------------------------------ UI

  private buildUI(): void {
    this.ui.removeAll(true);
    this.panelLayer = null;
    const { width: W, height: H } = this.scale;
    const s = uiScale(this);
    const pad = 10 * s;
    const btn = Math.max(44, 46 * s);
    const narrow = W < 720;

    // Top bar.
    const topH = btn + pad * 2;
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.bgDeep, 0.9);
    bg.fillRect(0, 0, W, topH);
    this.ui.add(bg);
    this.ui.add(
      new Button(this, pad + btn / 2, pad + btn / 2, {
        icon: 'back',
        width: btn,
        height: btn,
        style: 'secondary',
        onClick: () => {
          this.persist();
          goTo(this, 'Menu');
        },
      }),
    );
    const title = makeText(this, pad * 2 + btn, pad + 2, t('editor.title'), { size: 12 * s, bold: true, color: COLORS.accent });
    const name = makeText(this, pad * 2 + btn, pad + 17 * s, this.model.name, { size: 17 * s, bold: true });
    this.ui.add([title, name]);

    const actions: { label: string; icon: IconName; style: 'primary' | 'secondary'; go: () => void }[] = [
      { label: t('editor.slot', { n: this.slot + 1 }), icon: 'grid', style: 'secondary', go: () => this.switchSlot() },
      { label: t('editor.share'), icon: 'share', style: 'secondary', go: () => this.share() },
      { label: t('editor.check'), icon: 'check', style: 'secondary', go: () => this.check() },
      { label: t('editor.test'), icon: 'play', style: 'primary', go: () => this.test() },
    ];
    const aw = narrow ? btn : Math.min(150 * s, (W * 0.62) / actions.length);
    actions.forEach((a, i) => {
      const x = W - pad - aw / 2 - (actions.length - 1 - i) * (aw + 8);
      this.ui.add(
        new Button(this, x, pad + btn / 2, {
          label: narrow ? undefined : a.label,
          icon: a.icon,
          width: aw,
          height: btn,
          style: a.style,
          fontSize: 13 * s,
          onClick: a.go,
        }),
      );
    });
    if (narrow) name.setFontSize(Math.min(17 * s, 14));
    const maxNameW = W - (pad * 3 + btn) - actions.length * (aw + 8) - 8;
    while (name.width > maxNameW && parseFloat(String(name.style.fontSize)) > 9) name.setFontSize(parseFloat(String(name.style.fontSize)) - 1);
    this.top = topH + 2;

    // Bottom tool bar + status line.
    const tools: { id: Tool | 'traffic'; label: Key; icon: IconName }[] = [
      { id: 'h', label: 'editor.toolH', icon: 'minus' },
      { id: 'v', label: 'editor.toolV', icon: 'pause' },
      { id: 'lanes', label: 'editor.toolLanes', icon: 'menu' },
      { id: 'erase', label: 'editor.toolErase', icon: 'trash' },
      { id: 'traffic', label: 'editor.traffic', icon: 'car' },
    ];
    const tbH = btn + pad * 2;
    const statusH = 26 * s;
    const bb = this.add.graphics();
    bb.fillStyle(COLORS.bgDeep, 0.9);
    bb.fillRect(0, H - tbH - statusH, W, tbH + statusH);
    this.ui.add(bb);
    this.status = makeText(this, W / 2, H - tbH - statusH / 2, '', { size: Math.max(10, 12 * s), color: COLORS.textDim, bold: true }).setOrigin(0.5);
    this.ui.add(this.status);
    const tw = (W - pad * 2 - (tools.length - 1) * 8) / tools.length;
    tools.forEach((tl, i) => {
      const active = tl.id === this.tool;
      this.ui.add(
        new Button(this, pad + tw / 2 + i * (tw + 8), H - tbH / 2, {
          label: tw > 96 ? t(tl.label) : undefined,
          icon: tl.icon,
          width: tw,
          height: btn,
          style: active ? 'primary' : 'secondary',
          fontSize: 13 * s,
          onClick: () => {
            if (tl.id === 'traffic') this.openTraffic();
            else {
              this.tool = tl.id;
              this.buildUI();
              this.updateStatus();
            }
          },
        }),
      );
    });
    this.bottom = tbH + statusH;
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    const help = { h: t('editor.help.h'), v: t('editor.help.v'), lanes: t('editor.help.lanes'), erase: t('editor.help.erase') }[this.tool];
    const summary = t('editor.summary', {
      roads: this.model.h.length + this.model.vr.length,
      junctions: this.model.h.length * this.model.vr.length,
      cars: totalVehicles(this.model),
    });
    this.status.setText(`${help}   ·   ${summary}`);
    const W = this.scale.width;
    if (this.status.width > W - 16) this.status.setText(help);
    while (this.status.width > W - 16 && parseFloat(String(this.status.style.fontSize)) > 8) {
      this.status.setFontSize(parseFloat(String(this.status.style.fontSize)) - 0.5);
    }
  }

  private toast(text: string, color: number = COLORS.warn): void {
    this.toastText?.destroy();
    const s = uiScale(this);
    const txt = makeText(this, this.scale.width / 2, this.top + 18 * s, text, {
      size: 14 * s,
      bold: true,
      color,
      align: 'center',
      wrap: this.scale.width - 40,
    }).setOrigin(0.5, 0);
    txt.setShadow(0, 2, 'rgba(0,0,0,0.8)', 6);
    this.ui.add(txt);
    this.toastText = txt;
    this.tweens.add({ targets: txt, alpha: 0, delay: 3200, duration: 400, onComplete: () => txt.destroy() });
  }

  // ------------------------------------------------------------------ actions

  private onMapTap(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.panelLayer || this.checking || over.length > 0) return;
    if (pointer.y < this.top || pointer.y > this.scale.height - this.bottom) return;
    const w = this.camCtl.worldAt(pointer.x, pointer.y);
    if (w.x < 0 || w.y < 0 || w.x > EDITOR_WORLD.width || w.y > EDITOR_WORLD.height) return;
    let changed = false;
    if (this.tool === 'h' || this.tool === 'v') {
      const err = addRoad(this.model, this.tool, this.tool === 'h' ? w.y : w.x);
      if (err === 'maxRoads') this.toast(t('editor.maxRoads', { n: 3 }));
      else if (err) this.toast(t('editor.tooClose'));
      else changed = true;
    } else {
      const hit = nearestRoad(this.model, w.x, w.y, 40);
      if (hit) {
        if (this.tool === 'lanes') toggleLanes(this.model, hit.axis, hit.index);
        else removeRoad(this.model, hit.axis, hit.index);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
      this.rebuildPreview();
    }
  }

  private switchSlot(): void {
    this.persist();
    const next = (this.slot + 1) % SLOT_COUNT;
    this.scene.restart({ slot: next });
  }

  private invalidMessage(): string | null {
    const err = validate(this.model);
    return err ? t(err === 'needRoad' ? 'editor.needRoad' : 'editor.needCrossing') : null;
  }

  private test(): void {
    const msg = this.invalidMessage();
    if (msg) return this.toast(msg);
    this.persist();
    goTo(this, 'Game', { custom: buildLevel(this.model), editorSlot: this.slot });
  }

  /** Let the autopilot play the level (in slices so the UI stays responsive). */
  private check(): void {
    const msg = this.invalidMessage();
    if (msg) return this.toast(msg);
    if (this.checking) return;
    this.checking = true;
    this.toast(t('editor.checking'), COLORS.accent);
    const sim = new TrafficSimulation(buildLevel(this.model));
    const pilot = new AutoPilot(sim);
    const limit = (sim.level.goal.timeLimit ?? 600) * 60;
    let steps = 0;
    const slice = () => {
      for (let i = 0; i < 900 && sim.status === 'running' && steps < limit; i++, steps++) {
        pilot.update(1 / 60);
        sim.step();
      }
      if (sim.status === 'running' && steps < limit) {
        this.time.delayedCall(1, slice);
        return;
      }
      this.checking = false;
      if (sim.outcome === 'win') this.toast(t('editor.checkOk', { t: formatTime(sim.time) }), COLORS.good);
      else this.toast(t('editor.checkFail', { reason: sim.outcome === 'crash' ? t('result.crash') : t('result.timeout') }), COLORS.bad);
    };
    this.time.delayedCall(30, slice);
  }

  private share(): void {
    const dlg = openDialog({
      title: t('editor.shareTitle'),
      help: t('editor.shareHelp'),
      value: encodeLevel(this.model),
      multiline: true,
      readOnlySelect: true,
      buttons: [
        {
          label: t('editor.copy'),
          action: (v) => {
            const done = () => dlg.setMessage(t('editor.copied'));
            try {
              navigator.clipboard.writeText(v).then(done, () => {
                dlg.input.select();
              });
            } catch {
              dlg.input.select();
            }
            return false;
          },
        },
        {
          label: t('editor.load'),
          primary: true,
          action: (v) => {
            const lvl = decodeLevel(v);
            if (!lvl) {
              dlg.setMessage(t('editor.badCode'));
              return false;
            }
            this.model = lvl;
            this.persist();
            this.buildUI();
            this.rebuildPreview();
            this.toast(t('editor.loaded'), COLORS.good);
            return true;
          },
        },
        { label: t('common.close'), action: () => undefined },
      ],
    });
  }

  private openTraffic(): void {
    this.panelLayer?.destroy();
    const { width: W, height: H } = this.scale;
    const s = uiScale(this);
    const c = this.add.container(0, 0);
    const dim = this.add.rectangle(0, 0, W, H, COLORS.bgDeep, 0.72).setOrigin(0).setInteractive();
    c.add(dim);
    const m = this.model;
    const onOff = (b: boolean) => (b ? t('common.on') : t('common.off'));
    const rows: { label: string; go: () => void }[] = [
      { label: t('editor.density', { v: t(`editor.density.${m.density}` as Key) }), go: () => (m.density = m.density === 'low' ? 'med' : m.density === 'med' ? 'high' : 'low') },
      { label: t('editor.buses', { state: onOff(m.buses) }), go: () => (m.buses = !m.buses) },
      { label: t('editor.trucks', { state: onOff(m.trucks) }), go: () => (m.trucks = !m.trucks) },
      { label: t('editor.emergency', { state: onOff(m.emergency) }), go: () => (m.emergency = !m.emergency) },
      { label: t('editor.slips', { state: onOff(m.slips) }), go: () => (m.slips = !m.slips) },
      {
        label: t('editor.timeLimit', { v: m.timeLimit ? formatTime(m.timeLimit) : t('common.off') }),
        go: () => (m.timeLimit = TIME_LIMITS[(TIME_LIMITS.indexOf(m.timeLimit as (typeof TIME_LIMITS)[number]) + 1) % TIME_LIMITS.length]),
      },
    ];
    const n = rows.length + 3; // + cars row, clear, close
    const gap = 8 * s;
    const bh = Math.max(40, Math.min(48 * s, (H - 40 - 50 * s) / n - gap));
    const pw = Math.min(W - 24, 380 * s);
    const ph = 50 * s + n * (bh + gap) + 10 * s;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    const g = this.add.graphics();
    panel(g, px, py, pw, ph, 20);
    c.add(g);
    c.add(makeText(this, W / 2, py + 26 * s, t('editor.traffic'), { size: 22 * s, bold: true }).setOrigin(0.5));
    const bw = pw - 40 * s;
    let y = py + 50 * s + bh / 2;
    const refresh = () => {
      this.persist();
      this.rebuildPreview();
      this.openTraffic();
    };
    // Cars per entry with − / +.
    const small = bh;
    c.add(makeText(this, W / 2, y, t('editor.cars', { n: m.cars }), { size: 15 * s, bold: true }).setOrigin(0.5));
    c.add(
      new Button(this, px + 20 * s + small / 2, y, {
        icon: 'minus',
        width: small,
        height: bh,
        style: 'secondary',
        onClick: () => {
          m.cars = Math.max(CARS_RANGE[0], m.cars - 1);
          refresh();
        },
      }),
    );
    c.add(
      new Button(this, px + pw - 20 * s - small / 2, y, {
        icon: 'plus',
        width: small,
        height: bh,
        style: 'secondary',
        onClick: () => {
          m.cars = Math.min(CARS_RANGE[1], m.cars + 1);
          refresh();
        },
      }),
    );
    y += bh + gap;
    for (const r of rows) {
      c.add(
        new Button(this, W / 2, y, {
          label: r.label,
          width: bw,
          height: bh,
          style: 'secondary',
          fontSize: 14 * s,
          onClick: () => {
            r.go();
            refresh();
          },
        }),
      );
      y += bh + gap;
    }
    c.add(
      new Button(this, W / 2, y, {
        label: t('editor.clear'),
        icon: 'trash',
        width: bw,
        height: bh,
        style: 'danger',
        fontSize: 14 * s,
        onClick: () => {
          m.h = [];
          m.vr = [];
          refresh();
        },
      }),
    );
    y += bh + gap;
    c.add(
      new Button(this, W / 2, y, {
        label: t('common.close'),
        icon: 'back',
        width: bw,
        height: bh,
        style: 'primary',
        fontSize: 14 * s,
        onClick: () => {
          this.panelLayer?.destroy();
          this.panelLayer = null;
        },
      }),
    );
    this.ui.add(c);
    this.panelLayer = c;
  }
}
