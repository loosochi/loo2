import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { localized, t } from '../i18n';
import type { TutorialController } from '../systems/TutorialController';
import { makeText, uiScale } from './uiKit';

/**
 * Tutorial hint bubble at the bottom of the screen plus a pulsing marker on the light the
 * current step is about. "Tap to continue" steps capture taps anywhere.
 */
export class TutorialOverlay {
  private readonly root: Phaser.GameObjects.Container;
  private readonly marker: Phaser.GameObjects.Container;
  private shownStep = -1;
  private clock = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly tut: TutorialController,
    private readonly bottomInset: () => number,
    private readonly lightPos: (id: string) => { x: number; y: number } | null,
  ) {
    this.root = scene.add.container(0, 0);
    this.marker = scene.add.container(0, 0);
    parent.add([this.marker, this.root]);
    const ring = scene.add.circle(0, 0, 26, 0xffffff, 0).setStrokeStyle(4, COLORS.star, 1);
    const ring2 = scene.add.circle(0, 0, 36, 0xffffff, 0).setStrokeStyle(2, COLORS.star, 0.6);
    const arrow = scene.add.triangle(0, -58, -12, -12, 12, -12, 0, 8, COLORS.star);
    this.marker.add([ring2, ring, arrow]);
    this.marker.setVisible(false);
    this.rebuild();
  }

  /** Rebuild the bubble (step change or resize). */
  rebuild(): void {
    this.root.removeAll(true);
    this.shownStep = this.tut.done ? -2 : this.tut.stepNumber;
    const step = this.tut.current;
    if (!step) {
      this.marker.setVisible(false);
      return;
    }
    const scene = this.scene;
    const { width: W, height: H } = scene.scale;
    const s = uiScale(scene);
    const pw = Math.min(W - 24, 560 * s);
    const tapStep = step.wait.type === 'tap';

    if (tapStep) {
      // Tap anywhere to continue.
      const catcher = scene.add.rectangle(0, 0, W, H, COLORS.bgDeep, 0.35).setOrigin(0).setInteractive();
      catcher.on(Phaser.Input.Events.POINTER_UP, () => this.tut.tap());
      this.root.add(catcher);
    }
    const counter = makeText(scene, 0, 0, t('tutorial.step', { n: this.tut.stepNumber, total: this.tut.steps.length }), {
      size: 11 * s,
      bold: true,
      color: COLORS.accent,
    });
    const body = makeText(scene, 0, 0, localized(step.text), { size: 16 * s, wrap: pw - 32 * s });
    const tap = tapStep ? makeText(scene, 0, 0, t('tutorial.tap'), { size: 12 * s, bold: true, color: COLORS.star }) : null;
    const ph = 16 * s + counter.height + 6 * s + body.height + (tap ? 10 * s + tap.height : 0) + 16 * s;
    const px = (W - pw) / 2;
    const py = H - this.bottomInset() - ph - 12 * s;
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.3);
    g.fillRoundedRect(px + 3, py + 5, pw, ph, 16);
    g.fillStyle(COLORS.panel, 0.97);
    g.fillRoundedRect(px, py, pw, ph, 16);
    g.lineStyle(2, COLORS.accent, 0.9);
    g.strokeRoundedRect(px, py, pw, ph, 16);
    counter.setPosition(px + 16 * s, py + 14 * s);
    body.setPosition(px + 16 * s, counter.y + counter.height + 6 * s);
    this.root.add([g, counter, body]);
    if (tap) {
      tap.setPosition(px + pw - 16 * s - tap.width, body.y + body.height + 10 * s);
      this.root.add(tap);
      scene.tweens.add({ targets: tap, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
    }
    this.root.setAlpha(0);
    scene.tweens.add({ targets: this.root, alpha: 1, duration: 200 });
  }

  update(delta: number): void {
    const now = this.tut.done ? -2 : this.tut.stepNumber;
    if (now !== this.shownStep) this.rebuild();
    this.clock += delta;
    const target = this.tut.current?.target;
    const pos = target ? this.lightPos(target) : null;
    this.marker.setVisible(!!pos);
    if (pos) {
      const k = 1 + 0.12 * Math.sin(this.clock / 160);
      this.marker.setPosition(pos.x, pos.y).setScale(k);
      (this.marker.list[2] as Phaser.GameObjects.Triangle).y = -58 + 6 * Math.sin(this.clock / 200);
    }
  }

  destroy(): void {
    this.root.destroy();
    this.marker.destroy();
  }
}
