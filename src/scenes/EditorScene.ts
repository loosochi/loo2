import Phaser from 'phaser';
import { BuildManager } from '../building/BuildManager';
import { COLORS } from '../config/theme';
import {
  customToLevel,
  decodeCustom,
  encodeCustom,
  totalCars,
  type CustomLevel,
  type ToolPreset,
  EDITOR_TOOLSET,
} from '../editor/CustomLevelStore';
import { validateNetwork } from '../editor/LevelValidator';
import { t, type Key } from '../i18n';
import { CameraController } from '../render/CameraController';
import { WorldRenderer } from '../render/WorldRenderer';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import { Button } from '../ui/Button';
import { openDialog } from '../ui/domDialog';
import { Modal, type ModalButton } from '../ui/Modal';
import { createSplitView, enterScene, goTo, makeText, uiScale, type IconName, type SplitView } from '../ui/uiKit';
import { formatTime } from '../utils/math';
import { BuildController } from './build/BuildController';

const BUDGETS = [0, 500, 1000, 1500, 2000, 3000, 5000, 8000];
const TIME_LIMITS = [0, 60, 90, 120, 180, 240];
const MAX_WAITS = [0, 12, 15, 20, 30, 45];
const PRESETS: ToolPreset[] = ['all', 'lights', 'none'];
const next = <T,>(list: readonly T[], v: T): T => list[(list.indexOf(v) + 1) % list.length];

/**
 * Level editor 2.0: draw a road network with the same tools the player uses (plus entries,
 * exits and decorations), set the rules, and test-play it. Levels autosave to this device.
 */
export class EditorScene extends Phaser.Scene {
  private view!: SplitView;
  private camCtl!: CameraController;
  private world: WorldRenderer | null = null;
  private sim: TrafficSimulation | null = null;
  private level!: CustomLevel;
  private manager!: BuildManager;
  private build!: BuildController;
  private ui!: Phaser.GameObjects.Container;
  private modal: Modal | null = null;
  private top = 0;
  private frame: Phaser.GameObjects.Graphics | null = null;
  private toastBox: Phaser.GameObjects.Container | null = null;
  private status: Phaser.GameObjects.Text | null = null;

  constructor() {
    super('Editor');
  }

  init(data: { customId?: string; fresh?: boolean }): void {
    const store = levelManager().custom;
    let lvl = data?.customId ? store.get(data.customId) : null;
    if (!lvl && !data?.fresh) lvl = store.list()[0] ?? null;
    this.level = lvl ?? store.create(t('ed2.untitled'));
    this.modal = null;
    this.world = null;
    this.frame = null;
    this.toastBox = null;
  }

  create(): void {
    const w = this.level.map.world;
    this.view = createSplitView(this);
    this.camCtl = new CameraController(this.view.worldCam, w);
    this.manager = new BuildManager(this.level.map.network, Infinity, {}, w, EDITOR_TOOLSET);
    this.ui = this.add.container(0, 0);
    this.view.uiRoot.add(this.ui);
    this.rebuildPreview();
    this.build = new BuildController({
      scene: this,
      uiRoot: this.view.uiRoot,
      worldLayer: this.view.worldLayer,
      cam: this.camCtl,
      manager: this.manager,
      world: w,
      getSim: () => this.sim,
      getAnalytics: () => null,
      onNetworkChanged: () => {
        this.persist();
        this.rebuildPreview();
      },
      onModeChange: () => true,
      toast: (text, color) => this.toast(text, color),
      confirm: (title, body, ok, onOk) => this.confirm(title, body, ok, onOk),
      topInset: () => this.top,
      editor: true,
    });
    this.layout();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    this.input.mouse?.disableContextMenu();
    const onResize = () => this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.on('build-relayout', () => {
      if (!this.camCtl.isZoomed) this.fit();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
      this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
      this.build.destroy();
      this.world?.destroy();
    });
    enterScene(this);
    const migrated = levelManager().custom.migratedNow;
    if (migrated) {
      this.toast(t('ed2.migrated'), COLORS.good);
      levelManager().custom.migratedNow = 0;
    } else if (this.manager.net.edges.length === 0) this.toast(t('ed2.empty'), COLORS.panelLight);
  }

  // ------------------------------------------------------------------ model

  private persist(): void {
    this.level.map.network = structuredClone(this.manager.net.data);
    this.level = levelManager().custom.save(this.level);
    this.updateStatus();
  }

  private rebuildPreview(): void {
    this.world?.destroy();
    this.frame?.destroy();
    this.sim = new TrafficSimulation(customToLevel({ ...this.level, map: { ...this.level.map, network: structuredClone(this.manager.net.data) } }));
    this.world = new WorldRenderer(this, this.sim, this.view.worldLayer);
    this.world.showDanger = false;
    // Dim the area outside the map and outline it.
    const { width: W, height: H } = this.level.map.world;
    const P = 3000;
    const f = this.add.graphics().setDepth(10.5);
    f.fillStyle(COLORS.bgDeep, 0.55);
    f.fillRect(-P, -P, W + P * 2, P);
    f.fillRect(-P, H, W + P * 2, P);
    f.fillRect(-P, 0, P, H);
    f.fillRect(W, 0, P, H);
    f.lineStyle(3, 0xffffff, 0.7);
    f.strokeRect(0, 0, W, H);
    this.view.worldLayer.add(f);
    this.frame = f;
    this.world.update(0);
  }

  // ------------------------------------------------------------------ layout

  private layout(): void {
    const { width: W } = this.scale;
    this.view.uiCam.setSize(W, this.scale.height);
    this.buildTopBar();
    this.build.layout();
    this.fit();
  }

  private fit(): void {
    const { width: W, height: H } = this.scale;
    const m = 8;
    this.camCtl.fit({ x: m, y: this.top + m, w: W - m * 2, h: H - this.top - this.build.dockHeight - m * 2 }, { width: W, height: H }, false);
    this.world?.setViewRotation(0);
  }

  private buildTopBar(): void {
    this.ui.removeAll(true);
    this.status = null;
    const { width: W } = this.scale;
    const s = uiScale(this);
    const pad = 8 * s;
    const btn = Math.max(44, 46 * s);
    const narrow = W < 900;
    const actions: { key: Key; icon: IconName; style?: 'primary' | 'danger'; go: () => void }[] = [
      { key: 'ed2.new', icon: 'plus', go: () => this.newLevel() },
      { key: 'ed2.load', icon: 'grid', go: () => this.openLoad() },
      { key: 'ed2.save', icon: 'check', go: () => this.saveNow() },
      { key: 'ed2.duplicate', icon: 'share', go: () => this.duplicate() },
      { key: 'ed2.delete', icon: 'trash', style: 'danger', go: () => this.deleteLevel() },
      { key: 'ed2.settings', icon: 'gear', go: () => this.openRules() },
    ];
    const rows = narrow ? 2 : 1;
    const barH = rows * (btn + pad) + pad + 20 * s;
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.bgDeep, 0.92);
    bg.fillRect(0, 0, W, barH);
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
    const testW = narrow ? Math.max(btn, 118 * s) : 170 * s;
    this.ui.add(
      new Button(this, W - pad - testW / 2, pad + btn / 2, {
        label: t('ed2.test'),
        icon: 'play',
        width: testW,
        height: btn,
        style: 'primary',
        fontSize: 13 * s,
        onClick: () => this.test(),
      }),
    );
    // Name (tap to rename).
    const nx = pad * 2 + btn;
    const title = makeText(this, nx, pad, t('ed2.title'), { size: 11 * s, bold: true, color: COLORS.accent });
    const name = makeText(this, nx, pad + 15 * s, `${this.level.name}  ✎`, { size: 16 * s, bold: true });
    const nameMaxW = narrow ? W - nx - testW - pad * 2 : Math.min(260 * s, W * 0.22);
    while (name.width > nameMaxW && parseFloat(String(name.style.fontSize)) > 9) name.setFontSize(parseFloat(String(name.style.fontSize)) - 1);
    name.setInteractive({ useHandCursor: true }).on(Phaser.Input.Events.POINTER_UP, () => this.rename());
    this.ui.add([title, name]);
    // Actions.
    const row2 = narrow;
    const x0 = row2 ? pad : nx + nameMaxW + pad * 2;
    const x1 = row2 ? W - pad : W - pad * 2 - testW;
    const aw = Math.min(row2 ? 140 * s : 128 * s, (x1 - x0 - (actions.length - 1) * 6) / actions.length);
    const ay = row2 ? pad * 2 + btn + btn / 2 : pad + btn / 2;
    const showLabels = aw >= 96;
    actions.forEach((a, i) => {
      this.ui.add(
        new Button(this, x0 + aw / 2 + i * (aw + 6), ay, {
          label: showLabels ? t(a.key) : undefined,
          icon: a.icon,
          width: aw,
          height: btn,
          style: a.style ?? 'secondary',
          fontSize: 12 * s,
          onClick: a.go,
        }),
      );
    });
    this.status = makeText(this, W / 2, barH - 11 * s, '', { size: 11 * s, color: COLORS.textDim, bold: true }).setOrigin(0.5);
    this.ui.add(this.status);
    this.top = barH;
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    const net = this.manager.net;
    const r = this.level.rules;
    const parts = [
      `${net.edges.length} ${t('insp.road').toLowerCase()}`,
      `${net.data.spawns.length}→${net.data.exits.length}`,
      `${totalCars(this.level)} 🚗`,
      `$${this.level.budget}`,
      r.timeLimit ? formatTime(r.timeLimit) : '∞',
      t(`ed2.tools${r.tools === 'all' ? 'All' : r.tools === 'lights' ? 'Lights' : 'None'}` as Key),
    ];
    this.status.setText(parts.join('  ·  '));
  }

  private toast(text: string, color: number = COLORS.panelLight): void {
    this.toastBox?.destroy();
    const s = uiScale(this);
    const W = this.scale.width;
    const txt = makeText(this, 0, 0, text, { size: 14 * s, bold: true, align: 'center', wrap: Math.min(W - 48, 560) }).setOrigin(0.5);
    const w = txt.width + 32 * s;
    const h = txt.height + 18 * s;
    const g = this.add.graphics();
    g.fillStyle(color, 0.97);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    const c = this.add.container(W / 2, this.top + h / 2 + 10, [g, txt]);
    this.view.uiRoot.add(c);
    this.toastBox = c;
    this.tweens.add({
      targets: c,
      alpha: 0,
      delay: 3200,
      duration: 400,
      onComplete: () => {
        if (this.toastBox === c) this.toastBox = null;
        c.destroy();
      },
    });
  }

  private showModal(title: string, subtitle: string | undefined, buttons: ModalButton[]): void {
    this.modal?.destroy();
    const close = () => {
      this.modal?.destroy();
      this.modal = null;
    };
    this.modal = new Modal(this, {
      title,
      subtitle,
      buttons: buttons.map((b) => ({ ...b, onClick: () => (close(), b.onClick()) })),
    });
    this.view.uiRoot.add(this.modal);
  }

  private confirm(title: string, body: string, ok: string, onOk: () => void): void {
    this.showModal(title, body, [
      { label: ok, icon: 'trash', style: 'danger', onClick: onOk },
      { label: t('common.cancel'), icon: 'back', style: 'secondary', onClick: () => {} },
    ]);
  }

  // ------------------------------------------------------------------ input

  private readonly touches = new Map<number, { x: number; y: number; ctl: boolean; pan: boolean }>();
  private pinch: { d: number; x: number; y: number } | null = null;

  private pinchState(): { d: number; x: number; y: number } | null {
    const p = [...this.touches.values()];
    if (p.length < 2) return null;
    return { d: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
  }

  private onDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.modal || over.length > 0 || p.y < this.top || p.y > this.scale.height - this.build.dockHeight) return;
    const tp = { x: p.x, y: p.y, ctl: false, pan: false };
    this.touches.set(p.id, tp);
    if (this.touches.size >= 2) {
      this.build.cancelDrag();
      for (const o of this.touches.values()) o.ctl = false;
      this.pinch = this.pinchState();
      return;
    }
    if (p.rightButtonDown() || p.middleButtonDown()) {
      tp.pan = true;
      return;
    }
    tp.ctl = this.build.pointerDown(p);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const tp = this.touches.get(p.id);
    if (!tp) return;
    const px = tp.x;
    const py = tp.y;
    tp.x = p.x;
    tp.y = p.y;
    if (this.pinch && this.touches.size >= 2) {
      const n = this.pinchState();
      if (!n) return;
      this.camCtl.zoomAt(n.x, n.y, n.d / this.pinch.d);
      this.camCtl.panBy(this.pinch.x, this.pinch.y, n.x, n.y);
      this.pinch = n;
      return;
    }
    if (tp.ctl) this.build.pointerMove(p);
    else if (tp.pan && p.isDown) this.camCtl.panBy(px, py, p.x, p.y);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const tp = this.touches.get(p.id);
    this.touches.delete(p.id);
    if (this.touches.size < 2) this.pinch = null;
    if (tp?.ctl && !this.modal) this.build.pointerUp(p);
  }

  private onWheel(p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number): void {
    if (this.modal) return;
    this.camCtl.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
  }

  // ------------------------------------------------------------------ actions

  private saveNow(): void {
    this.persist();
    this.toast(t('ed2.saved'), COLORS.good);
  }

  private newLevel(): void {
    this.persist();
    const c = levelManager().custom.create(t('ed2.untitled'));
    this.scene.restart({ customId: c.id });
  }

  private duplicate(): void {
    this.persist();
    const c = levelManager().custom.duplicate(this.level.id, t('ed2.copyOf', { name: this.level.name }));
    if (c) this.scene.restart({ customId: c.id });
  }

  private deleteLevel(): void {
    this.confirm(t('ed2.deleteTitle'), t('ed2.deleteBody', { name: this.level.name }), t('common.delete'), () => {
      levelManager().custom.remove(this.level.id);
      const rest = levelManager().custom.list();
      this.scene.restart(rest.length ? { customId: rest[0].id } : { fresh: true });
    });
  }

  private rename(): void {
    const dlg = openDialog({
      title: t('ed2.renameTitle'),
      value: this.level.name,
      maxLength: 40,
      buttons: [
        { label: t('common.cancel'), action: () => undefined },
        {
          label: t('common.ok'),
          primary: true,
          action: (v) => {
            this.persist();
            if (!levelManager().custom.rename(this.level.id, v)) {
              dlg.setMessage(t('ed2.renameTitle'));
              return false;
            }
            this.level = levelManager().custom.get(this.level.id)!;
            this.buildTopBar();
            return true;
          },
        },
      ],
    });
  }

  private openLoad(): void {
    this.persist();
    const list = levelManager().custom.list().slice(0, 7);
    const buttons: ModalButton[] = list.map((c) => ({
      label: `${c.id === this.level.id ? '● ' : ''}${c.name}`,
      icon: 'edit' as IconName,
      style: c.id === this.level.id ? ('primary' as const) : ('secondary' as const),
      onClick: () => this.scene.restart({ customId: c.id }),
    }));
    buttons.push(
      { label: t('editor.share'), icon: 'share', style: 'secondary', onClick: () => this.share() },
      { label: t('common.close'), icon: 'back', style: 'secondary', onClick: () => {} },
    );
    this.showModal(t('ed2.loadTitle'), undefined, buttons);
  }

  private share(): void {
    const dlg = openDialog({
      title: t('editor.shareTitle'),
      help: t('editor.shareHelp'),
      value: encodeCustom(this.level),
      multiline: true,
      readOnlySelect: true,
      buttons: [
        {
          label: t('editor.copy'),
          action: (v) => {
            try {
              navigator.clipboard.writeText(v).then(
                () => dlg.setMessage(t('editor.copied')),
                () => dlg.input.select(),
              );
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
            const c = decodeCustom(v);
            if (!c) {
              dlg.setMessage(t('editor.badCode'));
              return false;
            }
            const saved = levelManager().custom.save(c);
            this.scene.restart({ customId: saved.id });
            return true;
          },
        },
        { label: t('common.close'), action: () => undefined },
      ],
    });
  }

  private openRules(): void {
    const r = this.level.rules;
    const off = t('ed2.none');
    const change = (fn: () => void) => () => {
      fn();
      this.persist();
      this.openRules();
    };
    this.showModal(t('ed2.settings'), undefined, [
      { label: t('ed2.budget', { v: `$${this.level.budget}` }), onClick: change(() => (this.level.budget = next(BUDGETS, this.level.budget))) },
      { label: t('ed2.timeLimit', { v: r.timeLimit ? formatTime(r.timeLimit) : off }), onClick: change(() => (r.timeLimit = next(TIME_LIMITS, r.timeLimit))) },
      { label: t('ed2.maxWait', { v: r.maxWait ? `${r.maxWait} s` : off }), onClick: change(() => (r.maxWait = next(MAX_WAITS, r.maxWait))) },
      {
        label: t('ed2.tools', { v: t(`ed2.tools${r.tools === 'all' ? 'All' : r.tools === 'lights' ? 'Lights' : 'None'}` as Key) }),
        icon: 'hammer',
        onClick: change(() => (r.tools = next(PRESETS, r.tools))),
      },
      { label: t('common.close'), icon: 'back', style: 'primary', onClick: () => this.buildTopBar() },
    ]);
  }

  private test(): void {
    this.persist();
    const report = validateNetwork(this.manager.net.data, this.level.map.world, this.level.budget);
    const err = report.issues.find((i) => i.level === 'error');
    if (err) {
      this.toast(t(err.key as Key), COLORS.bad);
      return;
    }
    goTo(this, 'Game', { custom: customToLevel(this.level), customId: this.level.id, fromEditor: true });
  }

  override update(_t: number, delta: number): void {
    this.build?.update(delta);
  }

  /** Test hooks. */
  get debug(): { manager: BuildManager; build: BuildController; level: CustomLevel; worldToScreen: (x: number, y: number) => { x: number; y: number } } {
    return { manager: this.manager, build: this.build, level: this.level, worldToScreen: (x, y) => this.camCtl.toScreen(x, y) };
  }
}
