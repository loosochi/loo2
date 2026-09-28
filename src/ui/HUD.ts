import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { carsWord, t } from '../i18n';
import { formatTime } from '../utils/math';
import { Button } from './Button';
import { makeText, uiScale } from './uiKit';

export interface HUDStats {
  passed: number;
  goal: number;
  left: number;
  score: number;
  time: number;
  timeLimit?: number;
}

export interface HUDOptions {
  /** "LEVEL 3", "TUTORIAL"… */
  label: string;
  levelName: string;
  goal: number;
  timeLimit?: number;
  onPause: () => void;
  onRestart: () => void;
  onResetView: () => void;
}

interface Chip {
  value: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
}

/**
 * In-game interface: level name, goal, passed/left counters, score, timer and the
 * reset-view, restart and pause buttons. Rebuilt on resize; two rows on narrow screens.
 */
export class HUD {
  readonly root: Phaser.GameObjects.Container;
  private chips: Record<'passed' | 'left' | 'score' | 'time', Chip> | null = null;
  /** Screen pixels reserved at the top / bottom for the HUD. */
  top = 0;
  bottom = 0;
  private toast: Phaser.GameObjects.Container | null = null;
  private lastScore = -1;
  pauseButton: Button | null = null;
  fitButton: Button | null = null;
  private hintText: Phaser.GameObjects.Text | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly o: HUDOptions,
  ) {
    this.root = scene.add.container(0, 0);
    parent.add(this.root);
    this.build();
  }

  build(): void {
    this.root.removeAll(true);
    this.toast = null;
    const scene = this.scene;
    const { width: W, height: H } = scene.scale;
    const s = uiScale(scene);
    const narrow = W < 700;
    const pad = 10 * s;
    const btn = Math.max(44, 46 * s);

    const rowH = btn + pad * 2;
    const statsH = narrow ? 46 * s : 0;
    const barH = rowH + statsH;
    const bg = scene.add.graphics();
    bg.fillStyle(COLORS.bgDeep, 0.88);
    bg.fillRect(0, 0, W, barH);
    bg.fillStyle(0x000000, 0.25);
    bg.fillRect(0, barH, W, 3);
    this.root.add(bg);

    // Level title and goal.
    const textW = W - pad * 2 - (btn + 8) * 3 - 8;
    const title = makeText(scene, pad + 4, pad + 2, this.o.label, { size: 12 * s, bold: true, color: COLORS.accent });
    const name = makeText(scene, pad + 4, pad + 17 * s, this.o.levelName, { size: 18 * s, bold: true });
    const goalText = this.o.timeLimit
      ? t('hud.goalTime', { n: this.o.goal, cars: carsWord(this.o.goal), t: formatTime(this.o.timeLimit) })
      : t('hud.goal', { n: this.o.goal, cars: carsWord(this.o.goal) });
    const goal = makeText(scene, pad + 4, pad + 40 * s, goalText, { size: 11 * s, bold: true, color: COLORS.warn });
    for (const txt of [name, goal]) {
      while (txt.width > textW && txt.style.fontSize && parseFloat(String(txt.style.fontSize)) > 9) {
        txt.setFontSize(parseFloat(String(txt.style.fontSize)) - 1);
      }
    }
    this.root.add([title, name, goal]);

    // Buttons (right): reset view, restart, pause.
    const mk = (i: number, icon: 'fit' | 'restart' | 'pause', onClick: () => void) =>
      new Button(scene, W - pad - btn / 2 - i * (btn + 8), pad + btn / 2, { icon, width: btn, height: btn, style: 'secondary', onClick });
    this.pauseButton = mk(0, 'pause', this.o.onPause);
    const restart = mk(1, 'restart', this.o.onRestart);
    this.fitButton = mk(2, 'fit', this.o.onResetView);
    this.root.add([this.pauseButton, restart, this.fitButton]);

    // Stat chips.
    const keys = ['passed', 'left', 'score', 'time'] as const;
    const labels = {
      passed: t('hud.passed'),
      left: t('hud.left'),
      score: t('hud.score'),
      time: this.o.timeLimit ? t('hud.timeLeft') : t('hud.time'),
    };
    let x0: number;
    let x1: number;
    let cy: number;
    if (narrow) {
      x0 = pad;
      x1 = W - pad;
      cy = rowH + statsH / 2 - 4 * s;
    } else {
      x0 = Math.max(250 * s, W * 0.3);
      x1 = W - pad - (btn + 8) * 3 - 16;
      cy = rowH / 2;
    }
    const cw = (x1 - x0) / keys.length;
    const chips = {} as Record<(typeof keys)[number], Chip>;
    keys.forEach((k, i) => {
      const cx = x0 + cw * (i + 0.5);
      const value = makeText(scene, cx, cy - 6 * s, '0', { size: 20 * s, bold: true, mono: true }).setOrigin(0.5);
      const label = makeText(scene, cx, cy + 14 * s, labels[k], { size: 10 * s, bold: true, color: COLORS.textDim }).setOrigin(0.5);
      while (label.width > cw - 4 && parseFloat(String(label.style.fontSize)) > 7) label.setFontSize(parseFloat(String(label.style.fontSize)) - 0.5);
      chips[k] = { value, label };
      this.root.add([value, label]);
    });
    this.chips = chips;
    this.top = barH + 3;

    // Bottom control hint.
    const hintH = 30 * s;
    const hint = makeText(scene, W / 2, H - hintH / 2, t('hud.hint'), {
      size: Math.max(11, 12 * s),
      color: COLORS.textDim,
      bold: true,
    }).setOrigin(0.5);
    if (hint.width > W - 16) hint.setText(t('hud.hintShort'));
    while (hint.width > W - 16 && parseFloat(String(hint.style.fontSize)) > 8) hint.setFontSize(parseFloat(String(hint.style.fontSize)) - 0.5);
    const hintBg = scene.add.graphics();
    hintBg.fillStyle(COLORS.bgDeep, 0.78);
    hintBg.fillRect(0, H - hintH, W, hintH);
    this.root.add([hintBg, hint]);
    this.hintText = hint;
    this.bottom = hintH;
    this.lastScore = -1;
  }

  /** Dim the reset-view button when the map is already fitted. */
  setZoomed(zoomed: boolean): void {
    this.fitButton?.setAlpha(zoomed ? 1 : 0.45);
  }

  setHintVisible(on: boolean): void {
    this.hintText?.setVisible(on);
  }

  update(st: HUDStats): void {
    if (!this.chips) return;
    this.chips.passed.value.setText(`${st.passed}/${st.goal}`);
    this.chips.left.value.setText(String(st.left));
    if (st.score !== this.lastScore) {
      if (this.lastScore >= 0 && st.score > this.lastScore) {
        const v = this.chips.score.value;
        this.scene.tweens.killTweensOf(v);
        v.setScale(1.25);
        this.scene.tweens.add({ targets: v, scale: 1, duration: 220, ease: 'Back.Out' });
      }
      this.chips.score.value.setText(String(st.score));
      this.lastScore = st.score;
    }
    if (st.timeLimit !== undefined) {
      const remaining = Math.max(0, st.timeLimit - st.time);
      this.chips.time.value.setText(formatTime(Math.ceil(remaining)));
      this.chips.time.value.setColor(remaining < 20 ? '#ff5a5f' : '#f4f6fb');
    } else {
      this.chips.time.value.setText(formatTime(st.time));
    }
  }

  /** Short message banner under the top bar. */
  showToast(text: string, duration = 4000, color: number = COLORS.panelLight): void {
    this.toast?.destroy();
    const scene = this.scene;
    const s = uiScale(scene);
    const W = scene.scale.width;
    const txt = makeText(scene, 0, 0, text, { size: 14 * s, bold: true, align: 'center', wrap: Math.min(W - 48, 560) }).setOrigin(0.5);
    const w = txt.width + 32 * s;
    const h = txt.height + 18 * s;
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.3);
    g.fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, 12);
    g.fillStyle(color, 0.97);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    const c = scene.add.container(W / 2, this.top + h / 2 + 12, [g, txt]);
    c.setAlpha(0);
    c.y -= 10;
    this.root.add(c);
    this.toast = c;
    scene.tweens.add({ targets: c, alpha: 1, y: c.y + 10, duration: 220, ease: 'Quad.Out' });
    scene.tweens.add({
      targets: c,
      alpha: 0,
      delay: duration,
      duration: 400,
      onComplete: () => {
        if (this.toast === c) this.toast = null;
        c.destroy();
      },
    });
  }
}
