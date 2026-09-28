import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { levelName, t } from '../i18n';
import { levelManager } from '../systems/LevelManager';
import type { RecordEntry } from '../systems/Leaderboard';
import { Button } from '../ui/Button';
import { drawStar, enterScene, goTo, makeText, panel, uiScale } from '../ui/uiKit';
import { formatTime } from '../utils/math';

/** Best results per level: rank, name, stars, score and time. */
export class RecordsScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private levelId = 1;
  private shared: RecordEntry[] | null = null;
  private request = 0;

  constructor() {
    super('Records');
  }

  init(data: { levelId?: number }): void {
    const lm = levelManager();
    const ids = lm.starLevels.map((l) => l.id);
    this.levelId = data?.levelId && ids.includes(data.levelId) ? data.levelId : Math.max(1, Math.min(lm.save.snapshot.unlocked, ids[ids.length - 1]));
    this.shared = null;
  }

  create(): void {
    this.root = this.add.container(0, 0);
    this.build();
    this.loadShared();
    const onResize = () => this.build();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    enterScene(this);
  }

  private loadShared(): void {
    const id = this.levelId;
    const req = ++this.request;
    this.shared = null;
    void levelManager()
      .records.sharedTop(id)
      .then((list) => {
        if (req !== this.request || !this.sys.isActive()) return;
        this.shared = list;
        if (list) this.build();
      });
  }

  private switchLevel(dir: number): void {
    const ids = levelManager().starLevels.map((l) => l.id);
    const i = ids.indexOf(this.levelId);
    this.levelId = ids[(i + dir + ids.length) % ids.length];
    this.build();
    this.loadShared();
  }

  private build(): void {
    this.root.removeAll(true);
    const { width: W, height: H } = this.scale;
    this.cameras.main.setSize(W, H);
    const s = uiScale(this);
    const lm = levelManager();
    const level = lm.get(this.levelId)!;

    const bg = this.add.graphics();
    bg.fillGradientStyle(COLORS.bg, COLORS.bg, COLORS.bgDeep, COLORS.bgDeep, 1);
    bg.fillRect(0, 0, W, H);
    this.root.add(bg);

    const pad = 16 * s;
    const btn = Math.max(44, 46 * s);
    this.root.add(new Button(this, pad + btn / 2, pad + btn / 2, { icon: 'back', width: btn, height: btn, style: 'secondary', onClick: () => goTo(this, 'Menu') }));
    this.root.add(makeText(this, W / 2, pad + btn / 2, t('records.title'), { size: 26 * s, bold: true }).setOrigin(0.5));

    // Level switcher.
    const pw = Math.min(W - 24, 560 * s);
    const px = (W - pw) / 2;
    const sy = pad + btn + 18 * s + btn / 2;
    this.root.add(new Button(this, px + btn / 2, sy, { icon: 'back', width: btn, height: btn, style: 'secondary', onClick: () => this.switchLevel(-1) }));
    this.root.add(new Button(this, px + pw - btn / 2, sy, { icon: 'forward', width: btn, height: btn, style: 'secondary', onClick: () => this.switchLevel(1) }));
    const label = makeText(this, W / 2, sy - 9 * s, t('hud.level', { n: level.id }), { size: 12 * s, bold: true, color: COLORS.accent }).setOrigin(0.5);
    const nm = makeText(this, W / 2, sy + 9 * s, levelName(level), { size: 18 * s, bold: true }).setOrigin(0.5);
    while (nm.width > pw - btn * 2 - 20 && parseFloat(String(nm.style.fontSize)) > 10) nm.setFontSize(parseFloat(String(nm.style.fontSize)) - 1);
    this.root.add([label, nm]);

    // Table.
    const list = this.shared ?? lm.records.local(level.id);
    const top = sy + btn / 2 + 16 * s;
    const rowH = Math.max(30, Math.min(40 * s, (H - top - 70 * s) / 11));
    const ph = rowH * (Math.max(list.length, 3) + 1) + 24 * s;
    const g = this.add.graphics();
    panel(g, px, top, pw, ph, 18);
    this.root.add(g);
    const cols = {
      rank: px + 20 * s,
      name: px + 58 * s,
      stars: px + pw * 0.52,
      score: px + pw * 0.82,
      time: px + pw - 18 * s,
    };
    const hy = top + 14 * s;
    const hdr = (x: number, text: string, originX = 0) =>
      this.root.add(makeText(this, x, hy, text, { size: 11 * s, bold: true, color: COLORS.textDim }).setOrigin(originX, 0));
    hdr(cols.rank, t('records.rank'));
    hdr(cols.name, t('records.name'));
    hdr(cols.score, t('records.score'), 1);
    hdr(cols.time, t('records.time'), 1);

    if (list.length === 0) {
      this.root.add(
        makeText(this, W / 2, top + ph / 2 + 8 * s, t('records.empty'), { size: 14 * s, color: COLORS.textDim, align: 'center', wrap: pw - 40 }).setOrigin(0.5),
      );
    }
    const me = lm.save.playerName || t('common.player');
    list.forEach((e, i) => {
      const y = top + 14 * s + rowH * (i + 1);
      if (i % 2 === 0) {
        const stripe = this.add.graphics();
        stripe.fillStyle(0xffffff, 0.035);
        stripe.fillRect(px + 8, y - 6 * s, pw - 16, rowH);
        this.root.add(stripe);
      }
      const color = i === 0 ? COLORS.star : e.name === me ? COLORS.accent : COLORS.text;
      this.root.add(makeText(this, cols.rank, y, String(i + 1), { size: 15 * s, bold: true, color, mono: true }));
      const nameT = makeText(this, cols.name, y, e.name, { size: 15 * s, bold: e.name === me, color });
      while (nameT.width > cols.stars - cols.name - 8 && parseFloat(String(nameT.style.fontSize)) > 9) nameT.setFontSize(parseFloat(String(nameT.style.fontSize)) - 1);
      this.root.add(nameT);
      const sg = this.add.graphics();
      for (let k = 0; k < 5; k++) drawStar(sg, cols.stars + k * 13 * s, y + 9 * s, 5.5 * s, k < e.stars ? COLORS.star : COLORS.starOff);
      this.root.add(sg);
      this.root.add(makeText(this, cols.score, y, String(e.score), { size: 15 * s, bold: true, mono: true }).setOrigin(1, 0));
      this.root.add(makeText(this, cols.time, y, formatTime(e.time), { size: 14 * s, mono: true, color: COLORS.textDim }).setOrigin(1, 0));
    });

    this.root.add(
      makeText(this, W / 2, top + ph + 16 * s, this.shared ? t('records.shared') : t('records.local'), {
        size: 12 * s,
        color: COLORS.textDim,
      }).setOrigin(0.5, 0),
    );
  }
}
