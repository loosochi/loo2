import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { Button, type ButtonStyle } from './Button';
import type { IconName } from './uiKit';
import { makeText, panel, uiScale } from './uiKit';

export interface ModalButton {
  label: string;
  icon?: IconName;
  style?: ButtonStyle;
  onClick: () => void;
}

export interface ModalOptions {
  title: string;
  subtitle?: string;
  buttons: ModalButton[];
}

/** Dimmed overlay with a centred panel and a column of buttons. Blocks input underneath. */
export class Modal extends Phaser.GameObjects.Container {
  readonly buttons: Button[] = [];

  constructor(scene: Phaser.Scene, o: ModalOptions) {
    super(scene, 0, 0);
    const { width: W, height: H } = scene.scale;
    const s = uiScale(scene);
    const dim = scene.add.rectangle(0, 0, W, H, COLORS.bgDeep, 0.72).setOrigin(0).setInteractive();
    this.add(dim);

    const pw = Math.min(W - 32, 340 * s);
    const bh = Math.max(46, 54 * s);
    const gap = 12 * s;
    const titleH = 60 * s + (o.subtitle ? 26 * s : 0);
    const ph = titleH + o.buttons.length * (bh + gap) + 24 * s;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    const g = scene.add.graphics();
    panel(g, px, py, pw, ph, 20);
    this.add(g);
    this.add(makeText(scene, W / 2, py + 34 * s, o.title, { size: 28 * s, bold: true }).setOrigin(0.5));
    if (o.subtitle) {
      this.add(makeText(scene, W / 2, py + 64 * s, o.subtitle, { size: 15 * s, color: COLORS.textDim, align: 'center' }).setOrigin(0.5));
    }
    o.buttons.forEach((b, i) => {
      const btn = new Button(scene, W / 2, py + titleH + bh / 2 + i * (bh + gap), {
        label: b.label,
        icon: b.icon,
        width: pw - 48 * s,
        height: bh,
        style: b.style ?? (i === 0 ? 'primary' : 'secondary'),
        onClick: b.onClick,
      });
      this.buttons.push(btn);
      this.add(btn);
    });

    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 160 });
    g.setScale(0.96);
  }
}
