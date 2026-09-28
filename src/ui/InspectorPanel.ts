import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { Button } from './Button';
import { makeText, panel, uiScale, type IconName } from './uiKit';

export interface InspectorRow {
  label: string;
  value: string;
  color?: number;
}

export interface InspectorAction {
  label: string;
  icon?: IconName;
  style?: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

export interface InspectorContent {
  title: string;
  rows: InspectorRow[];
  actions?: InspectorAction[];
}

/**
 * Object details: a side panel on wide screens, a bottom sheet on phones.
 * `area` is the free screen area (between the HUD and the bottom dock).
 */
export class InspectorPanel {
  readonly root: Phaser.GameObjects.Container;
  /** Height of the sheet on narrow screens (0 when shown as a side panel or hidden). */
  sheetHeight = 0;
  visible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly onClose: () => void,
  ) {
    this.root = scene.add.container(0, 0);
    parent.add(this.root);
  }

  hide(): void {
    this.root.removeAll(true);
    this.visible = false;
    this.sheetHeight = 0;
  }

  show(c: InspectorContent, area: { top: number; bottom: number }): void {
    this.root.removeAll(true);
    this.visible = true;
    const scene = this.scene;
    const { width: W } = scene.scale;
    const s = uiScale(scene);
    const side = W >= 900;
    const pw = side ? Math.min(300 * s, W * 0.3) : W - 16;
    const rowH = 22 * s;
    const actH = Math.max(44, 44 * s);
    const actions = c.actions ?? [];
    const actRows = side ? actions.length : Math.ceil(actions.length / 2);
    const ph = 46 * s + c.rows.length * rowH + (actions.length ? actRows * (actH + 8) + 6 : 0) + 10 * s;
    const px = side ? W - pw - 10 : 8;
    const py = side ? area.top + 10 : area.bottom - ph - 8;
    const g = scene.add.graphics();
    panel(g, px, py, pw, ph, 14);
    // Swallow taps on the panel so they don't reach the map.
    const hit = scene.add.rectangle(px, py, pw, ph, 0x000000, 0).setOrigin(0).setInteractive();
    this.root.add([hit, g]);
    this.root.add(makeText(scene, px + 14, py + 14 * s, c.title, { size: 15 * s, bold: true, color: COLORS.accent }));
    this.root.add(
      new Button(scene, px + pw - 26 * s, py + 22 * s, {
        icon: 'back',
        width: Math.max(44, 36 * s),
        height: Math.max(44, 36 * s),
        style: 'ghost',
        onClick: this.onClose,
      }).setScale(0.8),
    );
    let y = py + 44 * s;
    for (const r of c.rows) {
      this.root.add(makeText(scene, px + 14, y, r.label, { size: 13 * s, color: COLORS.textDim }));
      this.root.add(makeText(scene, px + pw - 14, y, r.value, { size: 13 * s, bold: true, color: r.color ?? COLORS.text }).setOrigin(1, 0));
      y += rowH;
    }
    y += 6;
    const aw = side ? pw - 24 : (pw - 32) / 2;
    actions.forEach((a, i) => {
      const col = side ? 0 : i % 2;
      const row = side ? i : Math.floor(i / 2);
      const x = px + 12 + aw / 2 + col * (aw + 8);
      this.root.add(
        new Button(scene, x, y + row * (actH + 8) + actH / 2, {
          label: a.label,
          icon: a.icon,
          width: aw,
          height: actH,
          style: a.style ?? 'secondary',
          fontSize: 12 * s,
          onClick: a.onClick,
        }),
      );
    });
    this.sheetHeight = side ? 0 : ph + 16;
  }

  destroy(): void {
    this.root.destroy();
  }
}
