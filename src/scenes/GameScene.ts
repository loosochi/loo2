import Phaser from 'phaser';
import { TrafficAnalytics } from '../analytics/TrafficAnalytics';
import { BuildManager } from '../building/BuildManager';
import { COLORS } from '../config/theme';
import { validateNetwork } from '../editor/LevelValidator';
import { recompileLevel } from '../graph/NetworkCompiler';
import { levelHint, levelLabel, levelName, t, vehicleName, type Key } from '../i18n';
import { CameraController } from '../render/CameraController';
import { WorldRenderer } from '../render/WorldRenderer';
import { audio } from '../systems/AudioManager';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import { TutorialController } from '../systems/TutorialController';
import { LightState, type LevelDef, type LevelResult } from '../types';
import { DebugPanel } from '../ui/DebugPanel';
import { HUD } from '../ui/HUD';
import { Modal } from '../ui/Modal';
import { ObjectivesPanel } from '../ui/ObjectivesPanel';
import { TutorialOverlay } from '../ui/TutorialOverlay';
import { createSplitView, enterScene, goTo, type SplitView } from '../ui/uiKit';
import { FrameClock } from '../utils/clock';
import { BuildController, type PlayMode } from './build/BuildController';
import type { ResultData } from './ResultScene';

/** Milliseconds a light must be held to switch it to YELLOW. */
const HOLD_MS = 380;
/** Minimum on-screen radius (px) of a light's touch area. */
const TOUCH_RADIUS_PX = 34;
/** Pointer travel (px) that turns a tap into a map drag. */
const DRAG_THRESHOLD = 10;

export interface GameData {
  levelId?: number;
  /** A level made in the editor. */
  custom?: LevelDef;
  editorSlot?: number;
  /** Id of a saved custom road-network level (editor 2.0). */
  customId?: string;
  /** Started with TEST LEVEL from the editor. */
  fromEditor?: boolean;
}

interface Press {
  pointerId: number;
  lightId: string;
  /** performance.now() when the press started (wall clock, independent of frame smoothing). */
  start: number;
  fired: boolean;
}

interface Touch {
  x: number;
  y: number;
  startX: number;
  startY: number;
  panning: boolean;
  /** Handled by the build/inspect controller. */
  ctl?: boolean;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The playable level: simulation + world view + HUD + input + pause/finish flow. */
export class GameScene extends Phaser.Scene {
  private level!: LevelDef;
  private custom = false;
  private editorSlot: number | undefined;
  private customId: string | undefined;
  private fromEditor = false;
  /** Road-network (schema 2) levels: building, analytics, objectives. */
  private manager: BuildManager | null = null;
  private build: BuildController | null = null;
  private analytics: TrafficAnalytics | null = null;
  private objectivesPanel: ObjectivesPanel | null = null;
  private debugPanel: DebugPanel | null = null;
  private confirmModal: Modal | null = null;
  private compileMs = 0;
  /** The level as loaded (before the player built anything) — used for restart / result. */
  private initialLevel: LevelDef | null = null;
  private sim!: TrafficSimulation;
  private view!: SplitView;
  private world!: WorldRenderer;
  private camCtl!: CameraController;
  private hud!: HUD;
  private tutorial: TutorialController | null = null;
  private tutorialOverlay: TutorialOverlay | null = null;
  private paused = false;
  private ended = false;
  private pauseModal: Modal | null = null;
  private press: Press | null = null;
  private readonly touches = new Map<number, Touch>();
  private pinch: { dist: number; x: number; y: number } | null = null;
  private readonly clock = new FrameClock();

  constructor() {
    super('Game');
  }

  init(data: GameData): void {
    const lm = levelManager();
    if (data?.custom) {
      this.level = data.custom;
      this.custom = true;
      this.editorSlot = data.editorSlot;
      this.customId = data.customId;
      this.fromEditor = !!data.fromEditor;
    } else {
      let id = data?.levelId ?? lm.playTarget();
      if (!lm.get(id) || !lm.isUnlocked(id)) id = lm.playTarget();
      this.level = lm.get(id)!;
      this.custom = false;
      this.editorSlot = undefined;
      this.customId = undefined;
      this.fromEditor = false;
      lm.save.setLastLevel(id);
    }
    this.paused = false;
    this.ended = false;
    this.pauseModal = null;
    this.press = null;
    this.touches.clear();
    this.pinch = null;
    this.tutorial = null;
    this.tutorialOverlay = null;
    this.clock.reset();
    this.manager = null;
    this.build = null;
    this.analytics = null;
    this.objectivesPanel = null;
    this.debugPanel = null;
    this.confirmModal = null;
    this.initialLevel = this.level;
  }

  create(): void {
    this.sim = new TrafficSimulation(this.level);
    this.view = createSplitView(this);
    this.world = new WorldRenderer(this, this.sim, this.view.worldLayer);
    this.camCtl = new CameraController(this.view.worldCam, this.level.world);
    this.hud = new HUD(this, this.view.uiRoot, {
      label: levelLabel(this.level),
      levelName: levelName(this.level),
      goal: this.level.goal.carsToPass,
      timeLimit: this.level.goal.timeLimit,
      onPause: () => this.setPaused(true),
      onRestart: () => this.restart(),
      onResetView: () => {
        this.camCtl.reset();
        this.hud.setZoomed(false);
      },
    });
    if (this.level.network) this.setupBuilding();
    if (this.level.tutorial?.length) {
      this.tutorial = new TutorialController(this.level.tutorial, this.sim);
      this.tutorialOverlay = new TutorialOverlay(
        this,
        this.view.uiRoot,
        this.tutorial,
        () => this.hud.bottom,
        (id) => {
          const l = this.sim.lights.get(id);
          return l ? this.camCtl.toScreen(l.def.head.x, l.def.head.y) : null;
        },
      );
    }
    this.layout();

    this.sim.on({
      light: (c) => {
        if (c.cause === 'player') audio.play(c.state === LightState.YELLOW ? 'yellow' : 'light');
        else audio.play('light');
      },
      spawn: (v) => {
        if (!v.emergency) return;
        audio.play('siren');
        this.hud.showToast(t('toast.emergency', { vehicle: vehicleName(v.kind) }), 3500, 0x7a2231);
      },
      exit: () => audio.play('pass'),
      crash: (c) => this.onCrash(c.x, c.y),
      end: (r) => this.onEnd(r),
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3' || (e.key === '`' && !e.repeat)) this.toggleDebug();
    };
    this.input.keyboard?.on('keydown', onKey);
    this.input.mouse?.disableContextMenu();

    const onResize = () => this.handleResize();
    const onHidden = () => this.setPaused(true);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
      this.input.keyboard?.off('keydown', onKey);
      audio.setEngineLevel(0);
      this.tutorialOverlay?.destroy();
      this.build?.destroy();
      this.world.destroy();
    });

    enterScene(this);
    if (!this.tutorial) this.hud.showToast(levelHint(this.level) ?? '', 5500);
  }

  // ------------------------------------------------------------------ road-network levels

  private setupBuilding(): void {
    const lvl = this.level;
    const m = new BuildManager(lvl.network!, lvl.budget ?? 0, lvl.rules ?? {}, lvl.world);
    m.edgeInUse = (id) => this.sim.vehicles.some((v) => v.route.def.edges?.includes(id));
    this.manager = m;
    this.analytics = new TrafficAnalytics(this.sim, m.net);
    this.objectivesPanel = new ObjectivesPanel(this, this.view.uiRoot);
    this.hud.setHintVisible(false);
    this.build = new BuildController({
      scene: this,
      uiRoot: this.view.uiRoot,
      worldLayer: this.view.worldLayer,
      cam: this.camCtl,
      manager: m,
      world: lvl.world,
      getSim: () => this.sim,
      getAnalytics: () => this.analytics,
      onNetworkChanged: () => this.onNetworkChanged(),
      onModeChange: (mode) => this.onModeChange(mode),
      toast: (text, color) => this.hud.showToast(text, 3000, color),
      confirm: (title, body, ok, onOk) => this.confirm(title, body, ok, onOk),
      topInset: () => this.hud.top + (this.objectivesPanel?.height ?? 0),
    });
    this.events.on('build-relayout', () => {
      if (!this.camCtl.isZoomed) this.fitCamera();
    });
  }

  /** The player changed the network: recompile routes/lights and hot-swap them into the simulation. */
  private onNetworkChanged(): void {
    const m = this.manager!;
    const t0 = now();
    this.level = recompileLevel(this.level, m.net.data);
    this.compileMs = now() - t0;
    this.sim.applyNetwork(this.level);
    this.sim.buildStats = { spent: m.budget.spent, builds: m.builds };
    this.world.destroy();
    this.world = new WorldRenderer(this, this.sim, this.view.worldLayer);
    this.world.setViewRotation(this.camCtl.rotated ? Math.PI / 2 : 0);
    this.analytics?.rebind(this.sim, m.net);
  }

  private onModeChange(mode: PlayMode): boolean {
    if (mode === 'build') return true;
    const m = this.manager!;
    const report = validateNetwork(m.net.data, this.level.world, 0);
    const err = report.issues.find((i) => i.level === 'error');
    if (err) {
      this.hud.showToast(t(err.key as Key), 3500, COLORS.bad);
      return false;
    }
    return true;
  }

  private confirm(title: string, body: string, ok: string, onOk: () => void): void {
    this.confirmModal?.destroy();
    const close = () => {
      this.confirmModal?.destroy();
      this.confirmModal = null;
    };
    this.confirmModal = new Modal(this, {
      title,
      subtitle: body,
      buttons: [
        {
          label: ok,
          icon: 'trash',
          style: 'danger',
          onClick: () => {
            close();
            onOk();
          },
        },
        { label: t('common.cancel'), icon: 'back', style: 'secondary', onClick: close },
      ],
    });
    this.view.uiRoot.add(this.confirmModal);
  }

  private toggleDebug(): void {
    if (this.debugPanel) {
      this.debugPanel.destroy();
      this.debugPanel = null;
      if (this.build) this.build.debug = false;
      return;
    }
    this.debugPanel = new DebugPanel(this, this.view.uiRoot, this.build?.debugFlags ?? null, () => {});
    if (this.build) this.build.debug = true;
    this.debugPanel.build(this.hud.top + (this.objectivesPanel?.height ?? 0));
  }

  private debugLines(): [string, string][] {
    const sim = this.sim;
    const g = this.analytics?.global();
    const net = this.manager?.net;
    const zones = sim.collisions.zones;
    return [
      ['FPS', this.game.loop.actualFps.toFixed(0)],
      ['vehicles', `${sim.vehicles.length}`],
      ['roads', `${net ? net.edges.length : this.level.roads.length}`],
      ['junctions', `${net ? net.nodes.filter((n) => net.isJunction(n.id)).length : this.level.intersections.length}`],
      ['zones', `${zones.filter((z) => z.vehicles.size > 0).length}/${zones.length}`],
      ['queue max', `${g?.longestQueue ?? '—'}`],
      ['avg wait', `${(g?.avgWait ?? 0).toFixed(1)} s`],
      ['density', `${((g?.density ?? 0) * 100).toFixed(0)}%`],
      ['mode', this.build?.mode ?? 'sim'],
      ['budget', this.manager ? (this.manager.budget.unlimited ? '∞' : `$${Math.round(this.manager.budget.remaining)}`) : '—'],
      ['route ms', this.compileMs.toFixed(1)],
    ];
  }

  /** Traffic runs in TRAFFIC and STATS modes (always on classic levels). */
  private get running(): boolean {
    return !this.build || this.build.mode !== 'build';
  }

  private get bottomInset(): number {
    return this.build ? this.build.dockHeight : this.hud.bottom;
  }

  private layout(): void {
    const { width: W, height: H } = this.scale;
    this.view.uiCam.setSize(W, H);
    this.build?.layout();
    this.fitCamera();
    this.tutorialOverlay?.rebuild();
    this.debugPanel?.build(this.hud.top + (this.objectivesPanel?.height ?? 0));
  }

  private fitCamera(): void {
    const { width: W, height: H } = this.scale;
    const margin = 8;
    const box = { x: margin, y: this.hud.top + margin, w: W - margin * 2, h: H - this.hud.top - this.bottomInset - margin * 2 };
    this.camCtl.fit(box, { width: W, height: H });
    this.world.setViewRotation(this.camCtl.rotated ? Math.PI / 2 : 0);
    this.hud.setZoomed(false);
  }

  private handleResize(): void {
    this.hud.build();
    if (this.build) this.hud.setHintVisible(false);
    this.layout();
    if (this.pauseModal) {
      this.pauseModal.destroy();
      this.pauseModal = null;
      this.showPauseMenu();
    }
  }

  // ------------------------------------------------------------------ input

  private inMap(y: number): boolean {
    return y >= this.hud.top && y <= this.scale.height - this.bottomInset;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.paused || this.ended || over.length > 0 || !this.inMap(pointer.y)) return;
    audio.unlock();
    const tp: Touch = { x: pointer.x, y: pointer.y, startX: pointer.x, startY: pointer.y, panning: false };
    this.touches.set(pointer.id, tp);

    if (this.touches.size >= 2) {
      // Second finger: pinch-zoom / two-finger pan, never a tap or a build drag.
      this.cancelPress();
      this.build?.cancelDrag();
      for (const other of this.touches.values()) other.ctl = false;
      this.pinch = this.pinchState();
      return;
    }
    if (this.build && (pointer.rightButtonDown() || pointer.middleButtonDown())) {
      tp.panning = true; // right / middle drag pans the map
      return;
    }
    if (this.build?.pointerDown(pointer)) {
      tp.ctl = true;
      return;
    }
    const wp = this.camCtl.worldAt(pointer.x, pointer.y);
    const radius = Math.max(22, TOUCH_RADIUS_PX / this.camCtl.zoom);
    const id = this.world.pickLight(wp.x, wp.y, radius);
    if (!id) return;
    if (pointer.rightButtonDown()) {
      this.sim.yellowLight(id);
      return;
    }
    this.cancelPress();
    this.press = { pointerId: pointer.id, lightId: id, start: now(), fired: false };
    this.world.highlightLight(id);
  }

  private pinchState(): { dist: number; x: number; y: number } | null {
    const pts = [...this.touches.values()].slice(0, 2);
    if (pts.length < 2) return null;
    return {
      dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    };
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const tp = this.touches.get(pointer.id);
    if (!tp || this.paused || this.ended) return;
    const prevX = tp.x;
    const prevY = tp.y;
    tp.x = pointer.x;
    tp.y = pointer.y;
    if (this.touches.size >= 2 && this.pinch) {
      const next = this.pinchState();
      if (!next) return;
      this.camCtl.zoomAt(next.x, next.y, next.dist / this.pinch.dist);
      this.camCtl.panBy(this.pinch.x, this.pinch.y, next.x, next.y);
      this.pinch = next;
      this.hud.setZoomed(this.camCtl.isZoomed);
      return;
    }
    if (!pointer.isDown) return;
    if (tp.ctl) {
      this.build?.pointerMove(pointer);
      this.hud.setZoomed(this.camCtl.isZoomed);
      return;
    }
    if (!tp.panning && Math.hypot(tp.x - tp.startX, tp.y - tp.startY) > DRAG_THRESHOLD) {
      tp.panning = true;
      if (this.press?.pointerId === pointer.id) this.cancelPress();
    }
    if (tp.panning) {
      this.camCtl.panBy(prevX, prevY, tp.x, tp.y);
      this.hud.setZoomed(this.camCtl.isZoomed);
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const tp = this.touches.get(pointer.id);
    this.touches.delete(pointer.id);
    if (this.pinch && this.touches.size < 2) {
      this.pinch = null;
      // The finger left on the screen continues as a drag, not as a tap.
      for (const other of this.touches.values()) other.panning = true;
    }
    if (tp?.ctl && !this.paused && !this.ended) {
      this.build?.pointerUp(pointer);
      return;
    }
    const p = this.press;
    if (!p || p.pointerId !== pointer.id) return;
    this.press = null;
    this.world.highlightLight(null);
    if (!p.fired && !tp?.panning && !this.paused && !this.ended) this.sim.toggleLight(p.lightId);
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (this.paused || this.ended) return;
    this.camCtl.zoomAt(pointer.x, pointer.y, Math.exp(-dy * 0.0015));
    this.hud.setZoomed(this.camCtl.isZoomed);
  }

  /** Long-press detection, checked every frame. */
  private checkHold(): void {
    const p = this.press;
    if (!p || p.fired || now() - p.start < HOLD_MS) return;
    p.fired = true;
    this.sim.yellowLight(p.lightId);
    this.world.highlightLight(null);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(12);
      } catch {
        /* not supported */
      }
    }
  }

  private cancelPress(): void {
    if (!this.press) return;
    this.press = null;
    this.world.highlightLight(null);
  }

  // ------------------------------------------------------------------ flow

  private setPaused(on: boolean): void {
    if (this.ended || on === this.paused) return;
    this.paused = on;
    this.cancelPress();
    this.touches.clear();
    this.pinch = null;
    this.build?.cancelDrag();
    if (on) {
      audio.setEngineLevel(0);
      this.showPauseMenu();
    } else {
      this.pauseModal?.destroy();
      this.pauseModal = null;
    }
  }

  private showPauseMenu(): void {
    this.pauseModal = new Modal(this, {
      title: t('pause.title'),
      subtitle: t('level.subtitle', { label: levelLabel(this.level), name: levelName(this.level) }),
      buttons: [
        { label: t('pause.resume'), icon: 'play', style: 'primary', onClick: () => this.setPaused(false) },
        { label: t('pause.restart'), icon: 'restart', style: 'secondary', onClick: () => this.restart() },
        {
          label: `${t('debug.title')}: ${this.debugPanel ? t('common.on') : t('common.off')}`,
          icon: 'bug',
          style: 'secondary',
          onClick: () => {
            this.toggleDebug();
            this.setPaused(false);
          },
        },
        this.customId
          ? { label: t('result.edit'), icon: 'edit', style: 'secondary', onClick: () => goTo(this, 'Editor', { customId: this.customId }) }
          : this.custom
          ? { label: t('result.editor'), icon: 'edit', style: 'secondary', onClick: () => goTo(this, 'Editor', { slot: this.editorSlot }) }
          : { label: t('pause.menu'), icon: 'menu', style: 'secondary', onClick: () => goTo(this, 'Menu') },
      ],
    });
    this.view.uiRoot.add(this.pauseModal);
  }

  private restart(): void {
    goTo(this, 'Game', this.replayData());
  }

  private replayData(): GameData {
    if (!this.custom) return { levelId: this.level.id };
    // Custom network levels restart from the saved (unbuilt) design.
    const lvl = this.initialLevel ?? this.level;
    return { custom: lvl, editorSlot: this.editorSlot, customId: this.customId, fromEditor: this.fromEditor };
  }

  private onCrash(x: number, y: number): void {
    this.world.playCrash(x, y);
    audio.play('crash');
    this.view.worldCam.shake(320, 0.012);
    this.hud.showToast(t('toast.crash'), 3000, COLORS.bad);
  }

  private onEnd(result: LevelResult): void {
    this.ended = true;
    this.cancelPress();
    audio.setEngineLevel(0);
    const lm = levelManager();
    const win = result.outcome === 'win';
    let newBest = false;
    let rank: number | null = null;
    if (!this.custom) {
      newBest = lm.save.recordResult(result.levelId, win, result.score, result.stars);
      if (win) {
        rank = lm.records.submit(result.levelId, {
          name: lm.save.playerName || t('common.player'),
          score: result.score,
          stars: result.stars,
          time: Math.round(result.time * 10) / 10,
        }).rank;
      }
    }
    if (win) this.hud.showToast(t('toast.complete'), 2000, 0x1f7a55);
    if (result.outcome === 'timeout') this.hud.showToast(t('toast.timeout'), 2000, COLORS.bad);
    if (result.outcome === 'failed') this.hud.showToast(t('result.failed'), 2000, COLORS.bad);
    const data: ResultData = {
      result,
      level: this.initialLevel ?? this.level,
      newBest,
      rank,
      custom: this.custom,
      editorSlot: this.editorSlot,
      customId: this.customId,
      fromEditor: this.fromEditor,
    };
    const delay = result.outcome === 'crash' ? 1600 : 1000;
    this.time.delayedCall(delay, () => goTo(this, 'Result', data));
  }

  override update(): void {
    const delta = this.clock.tick();
    const live = !this.paused && !this.ended && this.running;
    if (live) {
      this.checkHold();
      this.tutorial?.update(delta / 1000);
      if (!this.tutorial?.frozen) this.sim.advance(delta / 1000);
      this.analytics?.update();
      const moving = this.sim.vehicles.filter((v) => v.speed > 10).length;
      audio.setEngineLevel(Math.min(1, moving / 10));
    } else audio.setEngineLevel(0);
    this.world.update(live ? delta : 0);
    this.build?.update(delta);
    if (this.objectivesPanel && this.sim.objectives) this.objectivesPanel.update(this.sim.objectives.states, this.hud.top);
    // On narrow screens toasts would cover the objectives panel.
    this.hud.extraTop = this.objectivesPanel && this.scale.width < 700 ? this.objectivesPanel.height : 0;
    this.debugPanel?.update(delta, () => this.debugLines());
    this.tutorialOverlay?.update(delta);
    this.hud.update({
      passed: this.sim.score.passed,
      goal: this.sim.goal,
      left: this.sim.carsLeft,
      score: this.sim.score.liveScore,
      time: this.sim.time,
      timeLimit: this.level.goal.timeLimit,
    });
  }

  /** Debug/testing hooks (used by automated browser smoke tests). */
  get debug(): {
    sim: TrafficSimulation;
    paused: boolean;
    zoom: number;
    rotated: boolean;
    tutorialStep: number | null;
    mode: PlayMode | null;
    build: BuildController | null;
    manager: BuildManager | null;
    worldToScreen: (x: number, y: number) => { x: number; y: number };
  } {
    return {
      sim: this.sim,
      paused: this.paused,
      zoom: this.camCtl.zoom,
      rotated: this.camCtl.rotated,
      tutorialStep: this.tutorial ? (this.tutorial.done ? -1 : this.tutorial.stepNumber) : null,
      mode: this.build?.mode ?? null,
      build: this.build,
      manager: this.manager,
      worldToScreen: (x, y) => this.camCtl.toScreen(x, y),
    };
  }
}
