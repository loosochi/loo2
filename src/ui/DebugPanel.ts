import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { t, type Key } from '../i18n';
import type { DebugFlags } from '../render/NetworkOverlay';
import { Button } from './Button';
import { makeText, uiScale } from './uiKit';

export type DebugLine = [label: string, value: string];

/**
 * Developer overlay: live numbers (FPS, counts, queues, timings) and switches for the
 * world-space debug drawing (collision zones, paths, nodes, lanes, arrows, entries, exits).
 */
export class DebugPanel {
  readonly root: Phaser.GameObjects.Container;
  private text: Phaser.GameObjects.Text | null = null;
  private timer = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly flags: DebugFlags | null,
    private readonly onFlags: () => void,
  ) {
    this.root = scene.add.container(0, 0);
    parent.add(this.root);
  }

  /** Lay out below `top` (screen px). */
  build(top: number): void {
    this.root.removeAll(true);
    const s = uiScale(this.scene);
    const x = 8;
    const y = top + 8;
    const w = Math.min(this.scene.scale.width - 16, 230 * s);
    const bg = this.scene.add.graphics();
    this.text = makeText(this.scene, x + 10, y + 8, '', { size: 11 * s, mono: true, color: COLORS.text });
    this.root.add([bg, this.text]);
    // Reserve room for the title + 11 stat lines before the switches.
    this.text.setText(new Array(12).fill('M').join('\n'));
    let bottom = y + 16 + this.text.height;
    this.text.setText('');
    if (this.flags) {
      const keys = Object.keys(this.flags) as (keyof DebugFlags)[];
      const bh = 44;
      const bw = (w - 26) / 2;
      keys.forEach((k, i) => {
        const on = this.flags![k];
        const bx = x + 10 + bw / 2 + (i % 2) * (bw + 6);
        const by = bottom + Math.floor(i / 2) * (bh + 4) + bh / 2;
        this.root.add(
          new Button(this.scene, bx, by, {
            label: `${on ? '■' : '□'} ${t(`debug.${k}` as Key)}`,
            width: bw,
            height: bh,
            style: on ? 'primary' : 'secondary',
            fontSize: 10.5 * s,
            onClick: () => {
              this.flags![k] = !this.flags![k];
              this.onFlags();
              this.build(top);
            },
          }),
        );
      });
      bottom += Math.ceil(keys.length / 2) * (bh + 4) + 6;
    }
    bg.fillStyle(COLORS.bgDeep, 0.85);
    bg.fillRoundedRect(x, y, w, bottom - y, 10);
    bg.lineStyle(1, COLORS.accent, 0.6);
    bg.strokeRoundedRect(x, y, w, bottom - y, 10);
    this.timer = 1e9;
  }

  update(delta: number, lines: () => DebugLine[]): void {
    this.timer += delta;
    if (!this.text || this.timer < 250) return;
    this.timer = 0;
    const rows = lines();
    const pad = Math.max(...rows.map((r) => r[0].length));
    this.text.setText([t('debug.title'), ...rows.map(([k, v]) => `${k.padEnd(pad)}  ${v}`)].join('\n'));
  }

  destroy(): void {
    this.root.destroy();
  }
}
