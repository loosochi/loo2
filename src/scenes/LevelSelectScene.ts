import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { levelManager } from '../systems/LevelManager';
import { Button } from '../ui/Button';
import { LevelCard } from '../ui/LevelCard';
import { drawStar, enterScene, goTo, makeText, uiScale } from '../ui/uiKit';

/** Grid of level cards with stars, best score and locked state. */
export class LevelSelectScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super('LevelSelect');
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
    const title = makeText(this, W / 2, pad + btn / 2, 'SELECT LEVEL', { size: 26 * s, bold: true }).setOrigin(0.5);
    const starG = this.add.graphics();
    const starTxt = makeText(this, W - pad, pad + btn / 2, `${lm.totalStars}/${lm.levels.length * 5}`, {
      size: 16 * s,
      bold: true,
      color: COLORS.star,
    }).setOrigin(1, 0.5);
    drawStar(starG, W - pad - starTxt.width - 14 * s, pad + btn / 2, 10 * s, COLORS.star);
    if (title.x - title.width / 2 < pad + btn + 8 || title.x + title.width / 2 > starTxt.x - starTxt.width - 30 * s) {
      title.setY(pad + btn + 24 * s);
    }
    this.root.add([back, title, starG, starTxt]);

    const header = title.y + 34 * s;
    const n = lm.levels.length;
    const cols = W < 560 ? 2 : W < 960 ? 3 : 5;
    const rows = Math.ceil(n / cols);
    const gap = 14 * s;
    const availH = H - header - pad;
    const cardW = Math.min(190 * s, (W - pad * 2 - gap * (cols - 1)) / cols, (availH - gap * (rows - 1)) / rows / 1.12);
    const cardH = cardW * 1.12;
    const gridH = rows * cardH + (rows - 1) * gap;
    const startY = header + Math.max(0, (availH - gridH) / 2);

    lm.levels.forEach((level, i) => {
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
}
