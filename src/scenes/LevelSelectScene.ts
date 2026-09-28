import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { t } from '../i18n';
import { customToLevel } from '../editor/CustomLevelStore';
import { levelManager } from '../systems/LevelManager';
import type { LevelDef } from '../types';
import { Button } from '../ui/Button';
import { LevelCard } from '../ui/LevelCard';
import { drawStar, enterScene, goTo, makeText, uiScale } from '../ui/uiKit';

export type LevelTab = 'campaign' | 'classic' | 'custom';

/** Tabs (campaign / classic / my levels) with a grid of level cards or the custom level list. */
export class LevelSelectScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private tab: LevelTab = 'campaign';

  constructor() {
    super('LevelSelect');
  }

  init(data: { tab?: LevelTab }): void {
    if (data?.tab) this.tab = data.tab;
  }

  create(): void {
    this.root = this.add.container(0, 0);
    this.build();
    const onResize = () => this.build();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    enterScene(this);
  }

  private build(): void {
    this.root.removeAll(true);
    const { width: W, height: H } = this.scale;
    this.cameras.main.setSize(W, H);
    const s = uiScale(this);
    const lm = levelManager();

    const bg = this.add.graphics();
    bg.fillGradientStyle(COLORS.bg, COLORS.bg, COLORS.bgDeep, COLORS.bgDeep, 1);
    bg.fillRect(0, 0, W, H);
    // Decorative road stripes.
    bg.fillStyle(0xffffff, 0.03);
    for (let x = -H; x < W; x += 90) bg.fillTriangle(x, H, x + 40, H, x + H + 40, 0);
    this.root.add(bg);

    const pad = 16 * s;
    const btn = Math.max(44, 46 * s);
    const back = new Button(this, pad + btn / 2, pad + btn / 2, {
      icon: 'back',
      width: btn,
      height: btn,
      style: 'secondary',
      onClick: () => goTo(this, 'Menu'),
    });
    const title = makeText(this, W / 2, pad + btn / 2, t('levels.title'), { size: 26 * s, bold: true }).setOrigin(0.5);
    const starG = this.add.graphics();
    const starTxt = makeText(this, W - pad, pad + btn / 2, `${lm.totalStars}/${lm.starLevels.length * 5}`, {
      size: 16 * s,
      bold: true,
      color: COLORS.star,
    }).setOrigin(1, 0.5);
    drawStar(starG, W - pad - starTxt.width - 14 * s, pad + btn / 2, 10 * s, COLORS.star);
    if (title.x - title.width / 2 < pad + btn + 8 || title.x + title.width / 2 > starTxt.x - starTxt.width - 30 * s) {
      title.setY(pad + btn + 24 * s);
    }
    this.root.add([back, title, starG, starTxt]);

    // Tabs.
    const tabs: { id: LevelTab; label: string }[] = [
      { id: 'campaign', label: t('levels.campaign') },
      { id: 'classic', label: t('levels.classic') },
      { id: 'custom', label: t('levels.custom') },
    ];
    const tabW = Math.min(180 * s, (W - pad * 2 - 16) / 3);
    const tabY = title.y + 30 * s + btn / 2;
    tabs.forEach((tb, i) => {
      this.root.add(
        new Button(this, W / 2 + (i - 1) * (tabW + 8), tabY, {
          label: tb.label,
          width: tabW,
          height: btn,
          style: this.tab === tb.id ? 'primary' : 'secondary',
          fontSize: 13 * s,
          onClick: () => {
            this.tab = tb.id;
            this.build();
          },
        }),
      );
    });
    const header = tabY + btn / 2 + 16 * s;
    if (this.tab === 'custom') {
      this.buildCustom(header, pad);
      return;
    }
    const levels: readonly LevelDef[] = this.tab === 'campaign' ? lm.campaign : lm.levels;
    const n = levels.length;
    const cols = W < 560 ? 2 : W < 900 && H > W ? 3 : 5;
    const rows = Math.ceil(n / cols);
    const gap = 14 * s;
    const availH = H - header - pad;
    const cardW = Math.min(190 * s, (W - pad * 2 - gap * (cols - 1)) / cols, (availH - gap * (rows - 1)) / rows / 1.12);
    const cardH = cardW * 1.12;
    const gridH = rows * cardH + (rows - 1) * gap;
    const startY = header + Math.max(0, (availH - gridH) / 2);

    levels.forEach((level, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const rowW = inRow * cardW + (inRow - 1) * gap;
      const col = i % cols;
      const x = (W - rowW) / 2 + col * (cardW + gap) + cardW / 2;
      const y = startY + row * (cardH + gap) + cardH / 2;
      const p = lm.save.progress(level.id);
      const card = new LevelCard(this, x, y, {
        level,
        width: cardW,
        height: cardH,
        unlocked: lm.isUnlocked(level.id),
        stars: p.stars,
        bestScore: p.bestScore,
        onSelect: (l) => goTo(this, 'Game', { levelId: l.id }),
      });
      card.setAlpha(0);
      card.y += 12;
      this.tweens.add({ targets: card, alpha: card.input ? 1 : 0.75, y: y, duration: 260, delay: 40 * i, ease: 'Quad.Out' });
      this.root.add(card);
    });
  }

  /** My levels: name, date, PLAY and EDIT. */
  private buildCustom(top: number, pad: number): void {
    const { width: W, height: H } = this.scale;
    const s = uiScale(this);
    const lm = levelManager();
    const list = lm.custom.list();
    const bh = Math.max(44, 48 * s);
    const rowW = Math.min(W - pad * 2, 640 * s);
    const x0 = (W - rowW) / 2;
    const create = new Button(this, W / 2, top + bh / 2, {
      label: t('menu.create'),
      icon: 'plus',
      width: Math.min(rowW, 260 * s),
      height: bh,
      style: 'primary',
      onClick: () => goTo(this, 'Editor', { fresh: true }),
    });
    this.root.add(create);
    let y = top + bh + 14 * s;
    if (!list.length) {
      this.root.add(makeText(this, W / 2, y + 30 * s, t('levels.noCustom'), { size: 15 * s, color: COLORS.textDim, align: 'center', wrap: rowW }).setOrigin(0.5));
      return;
    }
    const rowH = bh + 12 * s;
    const fit = Math.max(1, Math.floor((H - y - pad) / rowH));
    for (const c of list.slice(0, fit)) {
      const g = this.add.graphics();
      g.fillStyle(COLORS.panelLight, 1);
      g.fillRoundedRect(x0, y, rowW, rowH - 6 * s, 12);
      this.root.add(g);
      const mid = y + (rowH - 6 * s) / 2;
      const small = rowW < 460;
      const bw = small ? bh : 110 * s;
      const name = makeText(this, x0 + 14 * s, mid - 9 * s, c.name, { size: 15 * s, bold: true }).setOrigin(0, 0.5);
      while (name.width > rowW - bw * 2 - 50 * s && parseFloat(String(name.style.fontSize)) > 9) name.setFontSize(parseFloat(String(name.style.fontSize)) - 1);
      const date = new Date(c.updatedAt).toLocaleDateString();
      this.root.add([
        name,
        makeText(this, x0 + 14 * s, mid + 11 * s, t('ed2.updated', { date }), { size: 11 * s, color: COLORS.textDim }).setOrigin(0, 0.5),
        new Button(this, x0 + rowW - 8 * s - bw / 2, mid, {
          label: small ? undefined : t('common.start'),
          icon: 'play',
          width: bw,
          height: bh - 4,
          style: 'primary',
          fontSize: 12 * s,
          onClick: () => goTo(this, 'Game', { custom: customToLevel(c), customId: c.id }),
        }),
        new Button(this, x0 + rowW - 16 * s - bw * 1.5, mid, {
          label: small ? undefined : t('result.edit'),
          icon: 'edit',
          width: bw,
          height: bh - 4,
          style: 'secondary',
          fontSize: 12 * s,
          onClick: () => goTo(this, 'Editor', { customId: c.id }),
        }),
      ]);
      y += rowH;
    }
  }
}
