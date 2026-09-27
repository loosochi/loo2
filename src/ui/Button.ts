import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { audio } from '../systems/AudioManager';
import { drawIcon, makeText, type IconName } from './uiKit';

export type ButtonStyle = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions {
  label?: string;
  icon?: IconName;
  width: number;
  height: number;
  style?: ButtonStyle;
  fontSize?: number;
  onClick: () => void;
}

const STYLE: Record<ButtonStyle, { fill: number; stroke: number; text: number }> = {
  primary: { fill: COLORS.accent, stroke: 0x8fe3f8, text: 0x0f1522 },
  secondary: { fill: COLORS.panelLight, stroke: COLORS.panelStroke, text: COLORS.text },
  ghost: { fill: 0x000000, stroke: COLORS.panelStroke, text: COLORS.text },
  danger: { fill: COLORS.bad, stroke: 0xff9a9d, text: 0x1a0b0c },
};

/**
 * Rounded button with press animation. Works identically with mouse and touch:
 * activates on pointer release inside the button (no hover required).
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly iconG: Phaser.GameObjects.Graphics | null = null;
  private readonly label: Phaser.GameObjects.Text | null = null;
  private opts: ButtonOptions;
  private pressed = false;
  private enabledState = true;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: ButtonOptions) {
    super(scene, x, y);
    this.opts = opts;
    this.bg = scene.add.graphics();
    this.add(this.bg);
    const st = STYLE[opts.style ?? 'primary'];
    const fs = opts.fontSize ?? Math.round(opts.height * 0.38);
    if (opts.icon) {
      this.iconG = scene.add.graphics();
      this.add(this.iconG);
    }
    if (opts.label) {
      this.label = makeText(scene, 0, 0, opts.label, { size: fs, bold: true, color: st.text }).setOrigin(0.5);
      this.add(this.label);
    }
    this.layoutContent();
    this.draw(false);
    this.setSize(opts.width, opts.height);
    this.setInteractive({ useHandCursor: true });

    this.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!this.enabledState) return;
      this.pressed = true;
      audio.unlock();
      this.draw(true);
      scene.tweens.add({ targets: this, scale: 0.94, duration: 70, ease: 'Quad.Out' });
    });
    this.on(Phaser.Input.Events.POINTER_UP, () => {
      if (!this.pressed || !this.enabledState) return;
      this.release();
      audio.play('click');
      this.opts.onClick();
    });
    this.on(Phaser.Input.Events.POINTER_OUT, () => {
      if (this.pressed) this.release();
    });
    scene.add.existing(this);
  }

  private release(): void {
    this.pressed = false;
    this.draw(false);
    this.scene.tweens.add({ targets: this, scale: 1, duration: 140, ease: 'Back.Out' });
  }

  private layoutContent(): void {
    const { width: w, height: h, icon, label } = this.opts;
    const st = STYLE[this.opts.style ?? 'primary'];
    const iconSize = h * 0.46;
    if (this.iconG) {
      this.iconG.clear();
      drawIcon(this.iconG, icon!, iconSize, st.text);
      this.iconG.x = label ? -w / 2 + h * 0.55 : 0;
    }
    if (this.label && icon) this.label.x = h * 0.2;
  }

  private draw(down: boolean): void {
    const { width: w, height: h } = this.opts;
    const st = STYLE[this.opts.style ?? 'primary'];
    const r = Math.min(h / 2, 16);
    const g = this.bg;
    g.clear();
    if (this.opts.style !== 'ghost') {
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(-w / 2, -h / 2 + (down ? 1 : 4), w, h, r);
    }
    g.fillStyle(st.fill, this.opts.style === 'ghost' ? 0.35 : 1);
    g.fillRoundedRect(-w / 2, -h / 2 + (down ? 1 : 0), w, h, r);
    g.lineStyle(1.5, st.stroke, 0.9);
    g.strokeRoundedRect(-w / 2, -h / 2 + (down ? 1 : 0), w, h, r);
    if (!down && this.opts.style !== 'ghost') {
      g.fillStyle(0xffffff, 0.12);
      g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.4, { tl: r - 2, tr: r - 2, bl: 4, br: 4 });
    }
    this.setAlpha(this.enabledState ? 1 : 0.4);
  }

  setLabel(text: string): this {
    this.label?.setText(text);
    return this;
  }

  setIcon(icon: IconName): this {
    this.opts = { ...this.opts, icon };
    this.layoutContent();
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabledState = on;
    this.draw(false);
    return this;
  }
}
