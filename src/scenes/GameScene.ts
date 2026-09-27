import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { WorldRenderer } from '../render/WorldRenderer';
import { audio } from '../systems/AudioManager';
import { levelManager } from '../systems/LevelManager';
import { TrafficSimulation } from '../systems/TrafficSimulation';
import { LightState, type LevelDef, type LevelResult } from '../types';
import { HUD } from '../ui/HUD';
import { Modal } from '../ui/Modal';
import { FrameClock } from '../utils/clock';
import { createSplitView, enterScene, fitCamera, goTo, type SplitView } from '../ui/uiKit';
import type { ResultData } from './ResultScene';

/** Milliseconds a light must be held to switch it to YELLOW. */
const HOLD_MS = 380;
/** Minimum on-screen radius (px) of a light's touch area. */
const TOUCH_RADIUS_PX = 34;

interface Press {
  pointerId: number;
  lightId: string;
  /** performance.now() when the press started (wall clock, independent of frame smoothing). */
  start: number;
  fired: boolean;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The playable level: simulation + world view + HUD + input + pause/finish flow. */
export class GameScene extends Phaser.Scene {
  private level!: LevelDef;
  private sim!: TrafficSimulation;
  private view!: SplitView;
  private world!: WorldRenderer;
  private hud!: HUD;
  private paused = false;
  private ended = false;
  private pauseModal: Modal | null = null;
  private press: Press | null = null;
  private zoom = 1;
  private rotated = false;
  private readonly clock = new FrameClock();

  constructor() {
    super('Game');
  }

  init(data: { levelId?: number }): void {
    const lm = levelManager();
    let id = data?.levelId ?? lm.playTarget();
    if (!lm.get(id) || !lm.isUnlocked(id)) id = lm.playTarget();
    this.level = lm.get(id)!;
    lm.save.setLastLevel(id);
    this.paused = false;
    this.ended = false;
    this.pauseModal = null;
    this.press = null;
    this.clock.reset();
  }

  create(): void {
    this.sim = new TrafficSimulation(this.level);
    this.view = createSplitView(this);
    this.world = new WorldRenderer(this, this.sim, this.view.worldLayer);
    this.hud = new HUD(this, this.view.uiRoot, {
      levelId: this.level.id,
      levelName: this.level.name,
      goal: this.level.goal.carsToPass,
      timeLimit: this.level.goal.timeLimit,
      onPause: () => this.setPaused(true),
      onRestart: () => this.restart(),
    });
    this.layout();

    this.sim.on({
      light: (c) => {
        if (c.cause === 'player') audio.play(c.state === LightState.YELLOW ? 'yellow' : 'light');
        else audio.play('light');
      },
      exit: () => audio.play('pass'),
      crash: (c) => this.onCrash(c.x, c.y),
      end: (r) => this.onEnd(r),
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);

    const onResize = () => this.handleResize();
    const onHidden = () => this.setPaused(true);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
      audio.setEngineLevel(0);
      this.world.destroy();
    });

    enterScene(this);
    this.hud.showToast(this.level.hint ?? this.level.description, 5500);
  }

  private layout(): void {
    const { width: W, height: H } = this.scale;
    this.view.uiCam.setSize(W, H);
    const margin = 8;
    const box = { x: margin, y: this.hud.top + margin, w: W - margin * 2, h: H - this.hud.top - this.hud.bottom - margin * 2 };
    const world = this.level.world;
    // On tall portrait screens, rotate wide maps by 90° when that makes them noticeably bigger.
    const zStraight = Math.min(box.w / world.width, box.h / world.height);
    const zRotated = Math.min(box.w / world.height, box.h / world.width);
    this.rotated = zRotated > zStraight * 1.2;
    this.zoom = fitCamera(this.view.worldCam, world, box, { width: W, height: H }, this.rotated);
    this.world.setViewRotation(this.rotated ? Math.PI / 2 : 0);
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

  private onPointerDown(pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.paused || this.ended || over.length > 0) return;
    const { height: H } = this.scale;
    if (pointer.y < this.hud.top || pointer.y > H - this.hud.bottom) return;
    const wp = this.view.worldCam.getWorldPoint(pointer.x, pointer.y);
    const radius = Math.max(22, TOUCH_RADIUS_PX / this.zoom);
    const id = this.world.pickLight(wp.x, wp.y, radius);
    if (!id) return;
    audio.unlock();

    if (pointer.rightButtonDown()) {
      this.sim.yellowLight(id);
      return;
    }
    this.cancelPress();
    this.press = { pointerId: pointer.id, lightId: id, start: now(), fired: false };
    this.world.highlightLight(id);
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

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const p = this.press;
    if (!p || p.pointerId !== pointer.id) return;
    this.press = null;
    this.world.highlightLight(null);
    if (!p.fired && !this.paused && !this.ended) this.sim.toggleLight(p.lightId);
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
      title: 'PAUSED',
      subtitle: `Level ${this.level.id} · ${this.level.name}`,
      buttons: [
        { label: 'RESUME', icon: 'play', style: 'primary', onClick: () => this.setPaused(false) },
        { label: 'RESTART', icon: 'restart', style: 'secondary', onClick: () => this.restart() },
        { label: 'MAIN MENU', icon: 'menu', style: 'secondary', onClick: () => goTo(this, 'Menu') },
      ],
    });
    this.view.uiRoot.add(this.pauseModal);
  }

  private restart(): void {
    goTo(this, 'Game', { levelId: this.level.id });
  }

  private onCrash(x: number, y: number): void {
    this.world.playCrash(x, y);
    audio.play('crash');
    this.view.worldCam.shake(320, 0.012);
    this.hud.showToast('CRASH!  Two cars collided.', 3000, COLORS.bad);
  }

  private onEnd(result: LevelResult): void {
    this.ended = true;
    this.cancelPress();
    audio.setEngineLevel(0);
    const lm = levelManager();
    const newBest = lm.save.recordResult(result.levelId, result.outcome === 'win', result.score, result.stars);
    if (result.outcome === 'win') this.hud.showToast('LEVEL COMPLETE!', 2000, 0x1f7a55);
    if (result.outcome === 'timeout') this.hud.showToast("TIME'S UP!", 2000, COLORS.bad);
    const data: ResultData = { result, newBest };
    const delay = result.outcome === 'crash' ? 1600 : 1000;
    this.time.delayedCall(delay, () => goTo(this, 'Result', data));
  }

  override update(): void {
    const clamped = this.clock.tick();
    if (!this.paused && !this.ended) {
      this.checkHold();
      this.sim.advance(clamped / 1000);
      const moving = this.sim.vehicles.filter((v) => v.speed > 10).length;
      audio.setEngineLevel(Math.min(1, moving / 10));
    }
    this.world.update(this.paused ? 0 : clamped);
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
  get debug(): { sim: TrafficSimulation; paused: boolean; zoom: number; rotated: boolean; worldToScreen: (x: number, y: number) => { x: number; y: number } } {
    const cam = this.view.worldCam;
    return {
      sim: this.sim,
      paused: this.paused,
      zoom: this.zoom,
      rotated: this.rotated,
      worldToScreen: (x, y) => {
        const m = (cam as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix;
        const p = m.transformPoint(x - cam.scrollX, y - cam.scrollY, { x: 0, y: 0 } as Phaser.Math.Vector2);
        return { x: p.x, y: p.y };
      },
    };
  }
}
