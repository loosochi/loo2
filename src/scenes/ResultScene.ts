import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { levelLabel, levelName, starLabel, t } from '../i18n';
import { audio } from '../systems/AudioManager';
import { levelManager } from '../systems/LevelManager';
import type { LevelDef, LevelResult } from '../types';
import { Button } from '../ui/Button';
import type { IconName } from '../ui/uiKit';
import { drawStar, enterScene, goTo, makeText, panel, uiScale } from '../ui/uiKit';
import { formatTime } from '../utils/math';

export interface ResultData {
  result: LevelResult;
  level: LevelDef;
  newBest: boolean;
  /** Place in the records table (wins only). */
  rank: number | null;
  custom?: boolean;
  editorSlot?: number;
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
    const { result: r, newBest, level, rank, custom } = this.data_;
    const lm = levelManager();
    const next = custom ? undefined : lm.next(level.id);
    const win = r.outcome === 'win';
    const { width: W, height: H } = this.scale;
    this.cameras.main.setSize(W, H);
    const s = Math.min(uiScale(this), H / 720);

    const bg = this.add.graphics();
    bg.fillGradientStyle(COLORS.bg, COLORS.bg, COLORS.bgDeep, COLORS.bgDeep, 1);
    bg.fillRect(0, 0, W, H);
    this.root.add(bg);

    const pw = Math.min(W - 24, 470 * s);
    const buttons: { label: string; icon: IconName; style: 'primary' | 'secondary'; go: () => void }[] = [];
    const retry = () =>
      goTo(this, 'Game', custom ? { custom: level, editorSlot: this.data_.editorSlot } : { levelId: level.id });
    if (win && next) buttons.push({ label: t('result.next'), icon: 'next', style: 'primary', go: () => goTo(this, 'Game', { levelId: next.id }) });
    buttons.push({ label: t('result.retry'), icon: 'restart', style: buttons.length ? 'secondary' : 'primary', go: retry });
    if (custom) {
      buttons.push({ label: t('result.editor'), icon: 'edit', style: 'secondary', go: () => goTo(this, 'Editor', { slot: this.data_.editorSlot }) });
    } else {
      buttons.push({ label: t('result.levelSelect'), icon: 'grid', style: 'secondary', go: () => goTo(this, 'LevelSelect') });
      if (win) buttons.push({ label: t('menu.records'), icon: 'trophy', style: 'secondary', go: () => goTo(this, 'Records', { levelId: level.id }) });
    }

    const bh = Math.max(46, 50 * s);
    const rowButtons = W >= 760;
    const statRows = [
      [t('result.passed'), `${r.passed} / ${level.goal.carsToPass}`],
      [t('result.time'), formatTime(r.time)],
      [t('result.avgWait'), t('common.seconds', { v: r.avgWait.toFixed(1) })],
      [t('result.maxWait'), t('common.seconds', { v: r.maxWait.toFixed(1) })],
      [t('result.crashes'), String(r.crashes)],
    ];
    const lineH = 25 * s;
    const headerH = 162 * s + (rank ? 20 * s : 0);
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

    const heading = win ? t('result.complete') : r.outcome === 'crash' ? t('result.crash') : t('result.timeout');
    const head = makeText(this, W / 2, py + 44 * s, heading, { size: 30 * s, bold: true, color: win ? COLORS.good : COLORS.bad }).setOrigin(0.5);
    while (head.width > pw - 24 && parseFloat(String(head.style.fontSize)) > 14) head.setFontSize(parseFloat(String(head.style.fontSize)) - 1);
    this.root.add(head);
    this.root.add(
      makeText(this, W / 2, py + 74 * s, t('level.subtitle', { label: levelLabel(level), name: levelName(level) }), {
        size: 15 * s,
        color: COLORS.textDim,
      }).setOrigin(0.5),
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
    const scoreLine = t('result.score', { n: r.score }) + (newBest ? `  ·  ${t('result.newBest')}` : '');
    this.root.add(
      makeText(this, W / 2, py + 144 * s, scoreLine, { size: 19 * s, bold: true, color: newBest ? COLORS.star : COLORS.text, mono: true }).setOrigin(0.5),
    );
    if (rank) {
      this.root.add(makeText(this, W / 2, py + 168 * s, t('result.rank', { rank }), { size: 13 * s, bold: true, color: COLORS.accent }).setOrigin(0.5));
    }

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
        this.root.add(makeText(this, lx + 20 * s, y, starLabel(b), { size: 12.5 * s, color: b.earned ? COLORS.text : COLORS.textDim }));
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
