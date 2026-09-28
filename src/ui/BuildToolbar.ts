import Phaser from 'phaser';
import { COLORS } from '../config/theme';
import { t, type Key } from '../i18n';
import type { BuildTool } from '../types';
import { Button } from './Button';
import { makeText, uiScale, type IconName } from './uiKit';

export const TOOL_ICONS: Record<BuildTool, IconName> = {
  road: 'road',
  delete: 'trash',
  light: 'trafficlight',
  lane: 'lanes',
  direction: 'swap',
  intersection: 'junction',
  spawn: 'entry',
  exit: 'exitflag',
  inspect: 'search',
  decor: 'tree',
};

export interface ToolbarOptions {
  tools: readonly BuildTool[];
  allowed: (t: BuildTool) => boolean;
  active: BuildTool;
  canUndo: boolean;
  canRedo: boolean;
  grid: boolean;
  snap: boolean;
  onTool: (t: BuildTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onGrid: () => void;
  onSnap: () => void;
}

/**
 * Tool buttons (icon + label on wide screens, icon only on phones, wrapping into rows), plus
 * undo/redo and grid/snap toggles. Desktop shows a tooltip on hover. Returns its height.
 */
export class BuildToolbar {
  readonly root: Phaser.GameObjects.Container;
  height = 0;
  private tip: Phaser.GameObjects.Container | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
  ) {
    this.root = scene.add.container(0, 0);
    parent.add(this.root);
  }

  /** Lay the toolbar out with its bottom edge at `bottomY`. */
  build(o: ToolbarOptions, bottomY: number): number {
    this.root.removeAll(true);
    this.tip = null;
    const scene = this.scene;
    const W = scene.scale.width;
    const s = uiScale(scene);
    const pad = 8 * s;
    const size = Math.max(44, 46 * s);
    const wide = W >= 1000;
    type Item = { icon: IconName; label: string; tip: string; active: boolean; enabled: boolean; go: () => void; locked?: boolean };
    const items: Item[] = o.tools.map((tool) => ({
      icon: TOOL_ICONS[tool],
      label: t(`tool.${tool}` as Key),
      tip: t(`tip.${tool}` as Key),
      active: tool === o.active,
      enabled: o.allowed(tool),
      locked: !o.allowed(tool),
      go: () => o.onTool(tool),
    }));
    items.push(
      { icon: 'undo', label: t('tool.undo'), tip: t('tool.undo'), active: false, enabled: o.canUndo, go: o.onUndo },
      { icon: 'redo', label: t('tool.redo'), tip: t('tool.redo'), active: false, enabled: o.canRedo, go: o.onRedo },
      { icon: 'grid', label: t('tool.grid'), tip: t('tool.grid'), active: o.grid, enabled: true, go: o.onGrid },
      { icon: 'magnet', label: t('tool.snap'), tip: t('tool.snap'), active: o.snap, enabled: true, go: o.onSnap },
    );
    const bw = wide ? Math.min(128 * s, (W - pad * 2) / items.length - 6) : size;
    const perRow = Math.max(1, Math.floor((W - pad * 2 + 6) / (bw + 6)));
    const rows = Math.ceil(items.length / perRow);
    const rowH = size + 6;
    const top = bottomY - rows * rowH - pad;
    const bg = scene.add.graphics();
    bg.fillStyle(COLORS.bgDeep, 0.9);
    bg.fillRect(0, top - pad * 0.5, W, bottomY - top + pad * 0.5);
    this.root.add(bg);
    items.forEach((it, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, items.length - row * perRow);
      const rowW = inRow * (bw + 6) - 6;
      const col = i % perRow;
      const x = (W - rowW) / 2 + col * (bw + 6) + bw / 2;
      const y = top + row * rowH + size / 2 + pad * 0.5;
      const btn = new Button(scene, x, y, {
        icon: it.icon,
        label: wide ? it.label : undefined,
        width: bw,
        height: size,
        style: it.active ? 'primary' : 'secondary',
        fontSize: 12 * s,
        onClick: it.go,
      });
      if (!it.enabled) btn.setAlpha(it.locked ? 0.3 : 0.45);
      btn.on(Phaser.Input.Events.POINTER_OVER, (p: Phaser.Input.Pointer) => {
        if (p.wasTouch) return;
        this.showTip(it.tip, x, y - size / 2 - 6);
      });
      btn.on(Phaser.Input.Events.POINTER_OUT, () => this.hideTip());
      this.root.add(btn);
    });
    this.height = bottomY - top + pad * 0.5;
    return this.height;
  }

  private showTip(text: string, x: number, y: number): void {
    this.hideTip();
    const s = uiScale(this.scene);
    const W = this.scene.scale.width;
    const txt = makeText(this.scene, 0, 0, text, { size: 12 * s, wrap: Math.min(320, W - 40) }).setOrigin(0.5, 1);
    const w = txt.width + 16;
    const h = txt.height + 10;
    const cx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, x));
    const g = this.scene.add.graphics();
    g.fillStyle(COLORS.panel, 0.97);
    g.fillRoundedRect(-w / 2, -h, w, h, 8);
    g.lineStyle(1, COLORS.panelStroke, 1);
    g.strokeRoundedRect(-w / 2, -h, w, h, 8);
    txt.setPosition(0, -5);
    this.tip = this.scene.add.container(cx, y, [g, txt]);
    this.root.add(this.tip);
  }

  private hideTip(): void {
    this.tip?.destroy();
    this.tip = null;
  }

  destroy(): void {
    this.root.destroy();
  }
}
