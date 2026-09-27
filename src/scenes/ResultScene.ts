import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { audio } from '../systems/AudioManager';
import { levelManager } from '../systems/LevelManager';
import type { LevelResult } from '../types';
import { Button } from '../ui/Button';
import { drawStar, enterScene, goTo, makeText, panel, uiScale } from '../ui/uiKit';
import { formatTime } from '../utils/math';

export interface ResultData {
  result: LevelResult;
  newBest: boolean;
}

/** Win / lose summary: stats, stars and navigation. */
export class ResultScene extends Phaser.Scene {
  private data_!: ResultData;
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super('Result');
  }

  init(data: ResultData): void {
    this.data_ = data;
  }

  create(): void {
    this.root = this.add.container(0, 0);
    this.build(true);
    const onResize = () => this.build(false);
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    enterScene(this);
    audio.play(this.data_.result.outcome === 'win' ? 'win' : 'lose');
  }

  private build(animate: boolean): void {
    this.root.removeAll(true);
    const { result: r, newBest } = this.data_;
    const lm = levelManager();
    const level = lm.get(r.levelId)!;
    const next = lm.next(r.levelId);
    const win = r.outcome === 'win';
    const { width: W, height: H } = this.scale;
    this.cameras.main.setSize(W, H);
    const s = Math.min(uiScale(this), H / 700);

    const bg = this.add.graphics();
    bg.fillGradientStyle(COLORS.bg, COLORS.bg, COLORS.bgDeep, COLORS.bgDeep, 1);
    bg.fillRect(0, 0, W, H);
    this.root.add(bg);

    const pw = Math.min(W - 24, 460 * s);
    const buttons: { label: string; icon: 'next' | 'restart' | 'grid'; style: 'primary' | 'secondary'; go: () => void }[] = [];
    if (win && next) buttons.push({ label: 'NEXT LEVEL', icon: 'next', style: 'primary', go: () => goTo(this, 'Game', { levelId: next.id }) });
    buttons.push({ label: 'RETRY', icon: 'restart', style: win && next ? 'secondary' : 'primary', go: () => goTo(this, 'Game', { levelId: r.levelId }) });
    buttons.push({ label: 'LEVEL SELECT', icon: 'grid', style: 'secondary', go: () => goTo(this, 'LevelSelect') });

    const bh = Math.max(46, 52 * s);
    const rowButtons = W >= 700;
    const statRows = [
      ['Cars passed', `${r.passed} / ${level.goal.carsToPass}`],
      ['Time', formatTime(r.time)],
      ['Average wait', `${r.avgWait.toFixed(1)} s`],
      ['Longest wait', `${r.maxWait.toFixed(1)} s`],
      ['Crashes', String(r.crashes)],
    ];
    const lineH = 26 * s;
    const headerH = 162 * s;
    const statsH = statRows.length * lineH + 12 * s;
    const breakdownH = win ? r.starBreakdown.length * 20 * s + 14 * s : 0;
    const buttonsH = rowButtons ? bh + 20 * s : buttons.length * (bh + 10 * s) + 10 * s;
    const ph = headerH + statsH + breakdownH + buttonsH + 16 * s;
    const px = (W - pw) / 2;
    const py = Math.max(8, (H - ph) / 2);

    const g = this.add.graphics();
    panel(g, px, py, pw, ph, 22);
    g.fillStyle(win ? COLORS.good : COLORS.bad, 1);
    g.fillRoundedRect(px, py, pw, 8 * s, { tl: 22, tr: 22, bl: 0, br: 0 });
    this.root.add(g);

    const heading = win ? 'LEVEL COMPLETE' : r.outcome === 'crash' ? 'CRASH!' : "TIME'S UP";
    this.root.add(
      makeText(this, W / 2, py + 44 * s, heading, { size: 30 * s, bold: true, color: win ? COLORS.good : COLORS.bad }).setOrigin(0.5),
    );
    this.root.add(
      makeText(this, W / 2, py + 74 * s, `Level ${level.id} · ${level.name}`, { size: 15 * s, color: COLORS.textDim }).setOrigin(0.5),
    );

    // Stars.
    const starY = py + 108 * s;
    const sr = 17 * s;
    for (let i = 0; i < 5; i++) {
      const sx = W / 2 + (i - 2) * sr * 2.5;
      const off = this.add.graphics();
      drawStar(off, 0, 0, sr, COLORS.starOff);
      off.setPosition(sx, starY);
      this.root.add(off);
      if (i < r.stars) {
        const on = this.add.graphics();
        drawStar(on, 0, 0, sr, COLORS.star);
        on.setPosition(sx, starY);
        this.root.add(on);
        if (animate) {
          on.setScale(0).setAlpha(0);
          this.tweens.add({ targets: on, scale: 1, alpha: 1, duration: 320, delay: 250 + i * 160, ease: 'Back.Out' });
        }
      }
    }
    const scoreText = makeText(this, W / 2, py + 144 * s, `SCORE ${r.score}${newBest ? '  ·  NEW BEST!' : ''}`, {
      size: 19 * s,
      bold: true,
      color: newBest ? COLORS.star : COLORS.text,
      mono: true,
    }).setOrigin(0.5);
    this.root.add(scoreText);

    let y = py + headerH + 6 * s;
    const lx = px + 28 * s;
    const rx = px + pw - 28 * s;
    for (const [k, v] of statRows) {
      this.root.add(makeText(this, lx, y, k, { size: 15 * s, color: COLORS.textDim }));
      this.root.add(makeText(this, rx, y, v, { size: 15 * s, bold: true, mono: true }).setOrigin(1, 0));
      y += lineH;
    }
    if (win) {
      y += 6 * s;
      for (const b of r.starBreakdown) {
        const sg = this.add.graphics();
        drawStar(sg, lx + 6 * s, y + 8 * s, 6 * s, b.earned ? COLORS.star : COLORS.starOff);
        this.root.add(sg);
        this.root.add(makeText(this, lx + 20 * s, y, b.label, { size: 12.5 * s, color: b.earned ? COLORS.text : COLORS.textDim }));
        y += 20 * s;
      }
    }

    const by = py + ph - buttonsH - 4 * s;
    if (rowButtons) {
      const bw = (pw - 40 * s - (buttons.length - 1) * 10 * s) / buttons.length;
      buttons.forEach((b, i) => {
        const x = px + 20 * s + bw / 2 + i * (bw + 10 * s);
        this.root.add(new Button(this, x, by + bh / 2 + 6 * s, { label: b.label, icon: b.icon, width: bw, height: bh, style: b.style, fontSize: 14 * s, onClick: b.go }));
      });
    } else {
      buttons.forEach((b, i) => {
        const yb = by + 6 * s + bh / 2 + i * (bh + 10 * s);
        this.root.add(new Button(this, W / 2, yb, { label: b.label, icon: b.icon, width: pw - 48 * s, height: bh, style: b.style, onClick: b.go }));
      });
    }
  }
}
