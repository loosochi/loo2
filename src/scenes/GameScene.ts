import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { levelHint, levelLabel, levelName, t, vehicleName } from '../i18n';
import { CameraController } from '../render/CameraController';
import { WorldRenderer } from '../render/WorldRenderer';
import { audio } from '../systems/AudioManager';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import { TutorialController } from '../systems/TutorialController';
import { LightState, type LevelDef, type LevelResult } from '../types';
import { HUD } from '../ui/HUD';
import { Modal } from '../ui/Modal';
import { TutorialOverlay } from '../ui/TutorialOverlay';
import { createSplitView, enterScene, goTo, type SplitView } from '../ui/uiKit';
import { FrameClock } from '../utils/clock';
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
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The playable level: simulation + world view + HUD + input + pause/finish flow. */
export class GameScene extends Phaser.Scene {
  private level!: LevelDef;
  private custom = false;
  private editorSlot: number | undefined;
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
    } else {
      let id = data?.levelId ?? lm.playTarget();
      if (!lm.get(id) || !lm.isUnlocked(id)) id = lm.playTarget();
      this.level = lm.get(id)!;
      this.custom = false;
      this.editorSlot = undefined;
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
      audio.setEngineLevel(0);
      this.tutorialOverlay?.destroy();
      this.world.destroy();
    });

    enterScene(this);
    if (!this.tutorial) this.hud.showToast(levelHint(this.level) ?? '', 5500);
  }

  private layout(): void {
    const { width: W, height: H } = this.scale;
    this.view.uiCam.setSize(W, H);
    const margin = 8;
    const box = { x: margin, y: this.hud.top + margin, w: W - margin * 2, h: H - this.hud.top - this.hud.bottom - margin * 2 };
    this.camCtl.fit(box, { width: W, height: H });
    this.world.setViewRotation(this.camCtl.rotated ? Math.PI / 2 : 0);
    this.hud.setZoomed(false);
    this.tutorialOverlay?.rebuild();
  }

  private handleResize(): void {
    this.hud.build();
    this.layout();
    if (this.pauseModal) {
      this.pauseModal.destroy();
      this.pauseModal = null;
      this.showPauseMenu();
    }
  }

  // ------------------------------------------------------------------ input

  private inMap(y: number): boolean {
    return y >= this.hud.top && y <= this.scale.height - this.hud.bottom;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.paused || this.ended || over.length > 0 || !this.inMap(pointer.y)) return;
    audio.unlock();
    this.touches.set(pointer.id, { x: pointer.x, y: pointer.y, startX: pointer.x, startY: pointer.y, panning: false });

    if (this.touches.size >= 2) {
      // Second finger: pinch-zoom, never a light tap.
      this.cancelPress();
      this.pinch = this.pinchState();
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
        this.custom
          ? { label: t('result.editor'), icon: 'edit', style: 'secondary', onClick: () => goTo(this, 'Editor', { slot: this.editorSlot }) }
          : { label: t('pause.menu'), icon: 'menu', style: 'secondary', onClick: () => goTo(this, 'Menu') },
      ],
    });
    this.view.uiRoot.add(this.pauseModal);
  }

  private restart(): void {
    goTo(this, 'Game', this.custom ? { custom: this.level, editorSlot: this.editorSlot } : { levelId: this.level.id });
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
    const data: ResultData = { result, level: this.level, newBest, rank, custom: this.custom, editorSlot: this.editorSlot };
    const delay = result.outcome === 'crash' ? 1600 : 1000;
    this.time.delayedCall(delay, () => goTo(this, 'Result', data));
  }

  override update(): void {
    const delta = this.clock.tick();
    if (!this.paused && !this.ended) {
      this.checkHold();
      this.tutorial?.update(delta / 1000);
      if (!this.tutorial?.frozen) this.sim.advance(delta / 1000);
      const moving = this.sim.vehicles.filter((v) => v.speed > 10).length;
      audio.setEngineLevel(Math.min(1, moving / 10));
    }
    this.world.update(this.paused ? 0 : delta);
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
    worldToScreen: (x: number, y: number) => { x: number; y: number };
  } {
    return {
      sim: this.sim,
      paused: this.paused,
      zoom: this.camCtl.zoom,
      rotated: this.camCtl.rotated,
      tutorialStep: this.tutorial ? (this.tutorial.done ? -1 : this.tutorial.stepNumber) : null,
      worldToScreen: (x, y) => this.camCtl.toScreen(x, y),
    };
  }
}
