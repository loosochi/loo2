import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { levelName, t } from '../i18n';
import { audio } from '../systems/AudioManager';
import type { LevelDef } from '../types';
import { drawIcon, drawStar, makeText } from './uiKit';

export interface LevelCardOptions {
  level: LevelDef;
  width: number;
  height: number;
  unlocked: boolean;
  stars: number;
  bestScore: number;
  onSelect: (level: LevelDef) => void;
}

/** Level selection tile: number, name, stars and locked state. */
export class LevelCard extends Phaser.GameObjects.Container {
  private pressed = false;

  constructor(scene: Phaser.Scene, x: number, y: number, o: LevelCardOptions) {
    super(scene, x, y);
    const { width: w, height: h } = o;
    const g = scene.add.graphics();
    this.add(g);
    const fill = o.unlocked ? COLORS.panelLight : 0x1f2535;
    g.fillStyle(0x000000, 0.3);
    g.fillRoundedRect(-w / 2 + 2, -h / 2 + 5, w, h, 16);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.lineStyle(2, o.unlocked ? (o.stars > 0 ? COLORS.good : COLORS.accent) : COLORS.panelStroke, o.unlocked ? 0.9 : 0.6);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

    const s = Math.min(w, h * 1.1);
    const numSize = s * 0.3;
    const num = makeText(scene, 0, -h * 0.22, o.level.id === 0 ? t('levels.tutorial') : String(o.level.id), {
      size: o.level.id === 0 ? numSize * 0.36 : numSize,
      bold: true,
      color: o.unlocked ? COLORS.text : COLORS.textDim,
    }).setOrigin(0.5);
    const tutorial = o.level.id === 0;
    const name = makeText(scene, 0, h * 0.06, levelName(o.level).toUpperCase(), {
      size: Math.max(11, s * 0.085),
      bold: true,
      color: o.unlocked ? COLORS.text : COLORS.textDim,
      align: 'center',
      wrap: w - 12,
    }).setOrigin(0.5);
    this.add([num, name]);

    if (o.unlocked && tutorial) {
      if (o.stars > 0) {
        const done = scene.add.graphics();
        drawIcon(done, 'check', s * 0.2, COLORS.good);
        done.y = h * 0.3;
        this.add(done);
      }
    } else if (o.unlocked) {
      const sg = scene.add.graphics();
      const r = Math.min(9, w / 16);
      for (let i = 0; i < 5; i++) {
        drawStar(sg, (i - 2) * r * 2.3, h * 0.3, r, i < o.stars ? COLORS.star : COLORS.starOff);
      }
      this.add(sg);
      if (o.bestScore > 0) {
        const best = makeText(scene, 0, h * 0.43, t('levels.best', { n: o.bestScore }), { size: Math.max(9, s * 0.065), color: COLORS.textDim }).setOrigin(0.5);
        this.add(best);
      }
    } else {
      const lock = scene.add.graphics();
      drawIcon(lock, 'lock', s * 0.2, COLORS.textDim);
      lock.y = h * 0.3;
      const locked = makeText(scene, 0, h * 0.43, t('levels.locked'), { size: Math.max(9, s * 0.065), color: COLORS.textDim }).setOrigin(0.5);
      this.add([lock, locked]);
    }

    this.setSize(w, h);
    if (o.unlocked) {
      this.setInteractive({ useHandCursor: true });
      this.on(Phaser.Input.Events.POINTER_DOWN, () => {
        this.pressed = true;
        audio.unlock();
        scene.tweens.add({ targets: this, scale: 0.95, duration: 70 });
      });
      this.on(Phaser.Input.Events.POINTER_OUT, () => {
        this.pressed = false;
        scene.tweens.add({ targets: this, scale: 1, duration: 120 });
      });
      this.on(Phaser.Input.Events.POINTER_UP, () => {
        if (!this.pressed) return;
        this.pressed = false;
        scene.tweens.add({ targets: this, scale: 1, duration: 120 });
        audio.play('click');
        o.onSelect(o.level);
      });
    } else {
      this.setAlpha(0.75);
    }
    scene.add.existing(this);
  }
}
