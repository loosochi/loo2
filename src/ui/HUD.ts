import Phaser from 'phaser';
import { COLORS } from '../config/theme';
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
  levelId: number;
  levelName: string;
  goal: number;
  timeLimit?: number;
  hint?: string;
  onPause: () => void;
  onRestart: () => void;
}

interface Chip {
  value: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
}

/**
 * In-game interface: level name, goal, passed/left counters, score, timer, pause and restart.
 * Rebuilt on resize; switches to a two-row layout on narrow (portrait) screens.
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
    const scene = this.scene;
    const { width: W, height: H } = scene.scale;
    const s = uiScale(scene);
    const narrow = W < 640;
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
    const title = makeText(scene, pad + 4, pad + 2, `LEVEL ${this.o.levelId}`, { size: 12 * s, bold: true, color: COLORS.accent });
    const name = makeText(scene, pad + 4, pad + 17 * s, this.o.levelName, { size: 18 * s, bold: true });
    const goalText = `GOAL: PASS ${this.o.goal} CARS${this.o.timeLimit ? ` IN ${formatTime(this.o.timeLimit)}` : ''}`;
    const goal = makeText(scene, pad + 4, pad + 40 * s, goalText, { size: 11 * s, bold: true, color: COLORS.warn });
    this.root.add([title, name, goal]);

    // Buttons (right).
    const restart = new Button(scene, W - pad - btn * 1.5 - 8, pad + btn / 2, {
      icon: 'restart',
      width: btn,
      height: btn,
      style: 'secondary',
      onClick: this.o.onRestart,
    });
    const pause = new Button(scene, W - pad - btn / 2, pad + btn / 2, {
      icon: 'pause',
      width: btn,
      height: btn,
      style: 'secondary',
      onClick: this.o.onPause,
    });
    this.pauseButton = pause;
    this.root.add([restart, pause]);

    // Stat chips.
    const keys = ['passed', 'left', 'score', 'time'] as const;
    const labels = { passed: 'PASSED', left: 'LEFT', score: 'SCORE', time: this.o.timeLimit ? 'TIME LEFT' : 'TIME' };
    let x0: number;
    let x1: number;
    let cy: number;
    if (narrow) {
      x0 = pad;
      x1 = W - pad;
      cy = rowH + statsH / 2 - 4 * s;
    } else {
      x0 = Math.max(220 * s, W * 0.3);
      x1 = W - pad - btn * 2 - 24;
      cy = rowH / 2;
    }
    const cw = (x1 - x0) / keys.length;
    const chips = {} as Record<(typeof keys)[number], Chip>;
    keys.forEach((k, i) => {
      const cx = x0 + cw * (i + 0.5);
      const value = makeText(scene, cx, cy - 6 * s, '0', { size: 20 * s, bold: true, mono: true }).setOrigin(0.5);
      const label = makeText(scene, cx, cy + 14 * s, labels[k], { size: 10 * s, bold: true, color: COLORS.textDim }).setOrigin(0.5);
      chips[k] = { value, label };
      this.root.add([value, label]);
    });
    this.chips = chips;
    this.top = barH + 3;

    // Bottom control hint.
    const hintH = 30 * s;
    const hint = makeText(scene, W / 2, H - hintH / 2, 'TAP a light: RED ⇄ GREEN   ·   HOLD: YELLOW (one car)', {
      size: Math.max(11, 12 * s),
      color: COLORS.textDim,
      bold: true,
    }).setOrigin(0.5);
    if (hint.width > W - 16) hint.setText('TAP: RED⇄GREEN · HOLD: YELLOW');
    const hintBg = scene.add.graphics();
    hintBg.fillStyle(COLORS.bgDeep, 0.78);
    hintBg.fillRect(0, H - hintH, W, hintH);
    this.root.add([hintBg, hint]);
    this.bottom = hintH;
    this.lastScore = -1;
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
    const t = makeText(scene, 0, 0, text, { size: 14 * s, bold: true, align: 'center', wrap: Math.min(W - 48, 560) }).setOrigin(0.5);
    const w = t.width + 32 * s;
    const h = t.height + 18 * s;
    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.3);
    g.fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, 12);
    g.fillStyle(color, 0.97);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    const c = scene.add.container(W / 2, this.top + h / 2 + 12, [g, t]);
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
