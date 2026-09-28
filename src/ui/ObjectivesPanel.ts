import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { t, type Key } from '../i18n';
import type { Objective, ObjectiveState } from '../types';
import { makeText, uiScale } from './uiKit';

export function objectiveLabel(o: Objective): string {
  return t(`obj.${o.type}` as Key, { v: o.value });
}

function progress(o: ObjectiveState): string {
  switch (o.type) {
    case 'PASS_CARS':
    case 'PASS_CARS_WITHOUT_CRASH':
      return `${Math.floor(o.current)}/${o.value}`;
    case 'BUDGET_LIMIT':
      return `$${Math.round(o.current)}`;
    case 'BUILD_LIMIT':
    case 'MAX_QUEUE_LENGTH':
      return `${Math.round(o.current)}`;
    default:
      return `${o.current.toFixed(0)} s`;
  }
}

/** Compact list of level objectives with live status; tap the header to collapse. */
export class ObjectivesPanel {
  readonly root: Phaser.GameObjects.Container;
  private collapsed = false;
  private lastKey = '';
  /** Screen height currently used (0 when empty). */
  height = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
  ) {
    this.root = scene.add.container(0, 0);
    parent.add(this.root);
  }

  update(states: readonly ObjectiveState[], top: number): void {
    const key = `${this.collapsed}|${top}|${this.scene.scale.width}|` + states.map((s) => `${s.status}:${progress(s)}`).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.root.removeAll(true);
    this.height = 0;
    if (!states.length) return;
    const s = uiScale(this.scene);
    const W = this.scene.scale.width;
    const pw = Math.min(W - 16, 270 * s);
    const rowH = 19 * s;
    const ph = 26 * s + (this.collapsed ? 0 : states.length * rowH + 4);
    const x = 8;
    const y = top + 8;
    this.height = ph + 8;
    const g = this.scene.add.graphics();
    g.fillStyle(COLORS.bgDeep, 0.82);
    g.fillRoundedRect(x, y, pw, ph, 10);
    const hit = this.scene.add.rectangle(x, y, pw, 26 * s, 0, 0).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on(Phaser.Input.Events.POINTER_UP, () => {
      this.collapsed = !this.collapsed;
      this.lastKey = '';
      this.update(states, top);
    });
    const done = states.filter((o) => o.status === 'done').length;
    this.root.add([g, hit]);
    this.root.add(
      makeText(this.scene, x + 10, y + 6 * s, `${t('obj.title')}  ${done}/${states.length}  ${this.collapsed ? '▸' : '▾'}`, {
        size: 11 * s,
        bold: true,
        color: COLORS.accent,
      }),
    );
    if (this.collapsed) return;
    states.forEach((o, i) => {
      const yy = y + 26 * s + i * rowH;
      const color = o.status === 'done' ? COLORS.good : o.status === 'failed' ? COLORS.bad : COLORS.text;
      const mark = o.status === 'done' ? '✓' : o.status === 'failed' ? '✗' : '•';
      const label = makeText(this.scene, x + 10, yy, `${mark} ${objectiveLabel(o)}`, { size: 11.5 * s, color });
      const val = makeText(this.scene, x + pw - 10, yy, progress(o), { size: 11.5 * s, bold: true, color }).setOrigin(1, 0);
      while (label.width > pw - val.width - 26 && parseFloat(String(label.style.fontSize)) > 8) label.setFontSize(parseFloat(String(label.style.fontSize)) - 0.5);
      this.root.add([label, val]);
    });
  }

  destroy(): void {
    this.root.destroy();
  }
}
