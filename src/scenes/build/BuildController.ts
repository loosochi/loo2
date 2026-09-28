/**
 * Build / inspect interaction shared by the game (road-network levels) and the level editor:
 * mode switching, tools, drag-to-build with a live preview, selection + inspector, overlays and
 * the bottom dock (mode bar, budget, toolbar).
 */
import Phaser from 'phaser';
import type { TrafficAnalytics } from '../../analytics/TrafficAnalytics';
import type { BuildManager, BuildResult, RoadPlan } from '../../building/BuildManager';
import { COLORS } from '../../config/theme';
import { nodeRadius } from '../../graph/geometry';
import { lightId, mainPair } from '../../graph/NetworkCompiler';
import { t, type Key } from '../../i18n';
import type { CameraController } from '../../render/CameraController';
import {
  defaultDebugFlags,
  drawDebug,
  drawGrid,
  drawLoad,
  drawPreview,
  drawSelection,
  drawToolHints,
  LOAD_COLORS,
  type DebugFlags,
  type Selection,
} from '../../render/NetworkOverlay';
import type { TrafficSimulation } from '../../systems/TrafficSimulation';
import type { BuildTool, NetSpawn, Vec2, VehicleKind } from '../../types';
import { BuildToolbar } from '../../ui/BuildToolbar';
import { Button } from '../../ui/Button';
import { InspectorPanel, type InspectorAction, type InspectorContent } from '../../ui/InspectorPanel';
import { makeText, uiScale } from '../../ui/uiKit';

export type PlayMode = 'build' | 'sim' | 'stats';

export interface BuildHost {
  scene: Phaser.Scene;
  uiRoot: Phaser.GameObjects.Container;
  worldLayer: Phaser.GameObjects.Layer;
  cam: CameraController;
  manager: BuildManager;
  world: { width: number; height: number };
  getSim(): TrafficSimulation | null;
  getAnalytics(): TrafficAnalytics | null;
  /** The network changed: recompile and redraw. */
  onNetworkChanged(): void;
  /** Mode switch request; return false to refuse (e.g. level not valid yet). */
  onModeChange(mode: PlayMode): boolean;
  toast(text: string, color?: number): void;
  confirm(title: string, body: string, ok: string, onOk: () => void): void;
  topInset(): number;
  /** Editor: no mode bar, spawn/exit editing in the inspector. */
  editor?: boolean;
}

const DRAG_MIN = 12;

export class BuildController {
  mode: PlayMode;
  tool: BuildTool;
  showGrid = true;
  showLoad = false;
  debug = false;
  debugFlags: DebugFlags = defaultDebugFlags();
  selection: Selection = null;

  private readonly gridG: Phaser.GameObjects.Graphics;
  private readonly overlayG: Phaser.GameObjects.Graphics;
  private readonly debugG: Phaser.GameObjects.Graphics;
  private readonly dock: Phaser.GameObjects.Container;
  private readonly toolbar: BuildToolbar;
  private readonly inspector: InspectorPanel;
  private label: Phaser.GameObjects.Container | null = null;
  private budgetText: Phaser.GameObjects.Text | null = null;
  private drag: { id: number; start: Vec2; screen: Vec2; moved: boolean; node?: string } | null = null;
  private plan: RoadPlan | null = null;
  private moveTarget: string | null = null;
  private clock = 0;
  private inspectorTimer = 0;
  /** Screen pixels used by the dock at the bottom. */
  dockHeight = 0;

  constructor(private readonly h: BuildHost) {
    const scene = h.scene;
    this.mode = h.editor ? 'build' : 'build';
    this.tool = h.manager.tools.find((x) => x !== 'inspect') ?? 'inspect';
    this.gridG = scene.add.graphics().setDepth(11);
    this.overlayG = scene.add.graphics().setDepth(12);
    this.debugG = scene.add.graphics().setDepth(13);
    h.worldLayer.add([this.gridG, this.overlayG, this.debugG]);
    this.dock = scene.add.container(0, 0);
    h.uiRoot.add(this.dock);
    this.toolbar = new BuildToolbar(scene, h.uiRoot);
    this.inspector = new InspectorPanel(scene, h.uiRoot, () => this.select(null));
    this.redrawGrid();
  }

  get m(): BuildManager {
    return this.h.manager;
  }

  // ------------------------------------------------------------------ layout

  /** Build the bottom dock; returns its height. */
  layout(): number {
    this.dock.removeAll(true);
    this.budgetText = null;
    const scene = this.h.scene;
    const { width: W, height: H } = scene.scale;
    const s = uiScale(scene);
    const pad = 8 * s;
    const size = Math.max(44, 46 * s);
    let bottom = H;
    if (!this.h.editor) {
      // Mode bar: BUILD | TRAFFIC | STATS + budget.
      const barH = size + pad * 2;
      const bg = scene.add.graphics();
      bg.fillStyle(COLORS.bgDeep, 0.92);
      bg.fillRect(0, H - barH, W, barH);
      this.dock.add(bg);
      const modes: { m: PlayMode; label: Key; icon: 'hammer' | 'play' | 'chart' }[] = [
        { m: 'build', label: 'mode.build', icon: 'hammer' },
        { m: 'sim', label: 'mode.sim', icon: 'play' },
        { m: 'stats', label: 'mode.stats', icon: 'chart' },
      ];
      const narrow = W < 560;
      const bw = narrow ? Math.min(118, (W * 0.62) / 3) : Math.min(150 * s, W * 0.17);
      modes.forEach((md, i) => {
        const b = new Button(scene, pad + bw / 2 + i * (bw + 6), H - barH / 2, {
          label: narrow ? undefined : t(md.label),
          icon: md.icon,
          width: narrow ? Math.max(size, bw * 0.62) : bw,
          height: size,
          style: this.mode === md.m ? 'primary' : 'secondary',
          fontSize: 13 * s,
          onClick: () => this.setMode(md.m),
        });
        if (narrow) b.x = pad + Math.max(size, bw * 0.62) / 2 + i * (Math.max(size, bw * 0.62) + 6);
        this.dock.add(b);
      });
      this.budgetText = makeText(scene, W - pad, H - barH / 2, '', { size: 12.5 * s, bold: true, mono: true, align: 'right' }).setOrigin(1, 0.5);
      this.dock.add(this.budgetText);
      bottom = H - barH;
    }
    let toolH = 0;
    if (this.mode === 'build') {
      toolH = this.toolbar.build(
        {
          tools: this.m.tools,
          allowed: (x) => this.m.isAllowed(x),
          active: this.tool,
          canUndo: this.m.history.canUndo,
          canRedo: this.m.history.canRedo,
          grid: this.showGrid,
          snap: this.m.settings.snapToGrid,
          onTool: (x) => this.setTool(x),
          onUndo: () => this.undo(),
          onRedo: () => this.redo(),
          onGrid: () => {
            this.showGrid = !this.showGrid;
            this.redrawGrid();
            this.relayout();
          },
          onSnap: () => {
            this.m.settings.snapToGrid = !this.m.settings.snapToGrid;
            this.relayout();
          },
        },
        bottom,
      );
    } else this.toolbar.root.removeAll(true);
    this.dockHeight = H - bottom + toolH;
    this.updateBudget();
    this.refreshInspector();
    return this.dockHeight;
  }

  /** Rebuild the dock and let the host re-fit the camera. */
  private relayout(): void {
    this.layout();
    this.h.scene.events.emit('build-relayout');
  }

  private updateBudget(): void {
    // The text may already be gone while the scene shuts down.
    if (!this.budgetText?.active) return;
    const b = this.m.budget;
    if (b.unlimited) {
      this.budgetText.setText(t('budget.unlimited'));
      return;
    }
    const cost = this.plan && this.drag ? this.plan.cost : 0;
    const narrow = this.h.scene.scale.width < 560;
    const avail = `${t('budget.available')} $${Math.round(b.remaining)}`;
    this.budgetText.setText(
      cost ? (narrow ? `$${Math.round(b.remaining)} −$${cost}` : `${avail}\n${t('budget.cost')} $${cost} · ${t('budget.remaining')} $${Math.round(b.remaining - cost)}`) : narrow ? `$${Math.round(b.remaining)}` : avail,
    );
    this.budgetText.setColor(cost > b.remaining ? '#ff5a5f' : '#f4f6fb');
  }

  // ------------------------------------------------------------------ modes & tools

  setMode(mode: PlayMode): void {
    if (mode === this.mode) return;
    if (!this.h.onModeChange(mode)) return;
    this.mode = mode;
    this.cancelDrag();
    this.showLoad = mode === 'stats';
    if (mode === 'sim') this.select(null);
    this.redrawGrid();
    this.relayout();
    if (mode === 'build') this.h.toast(t('mode.buildHelp'), COLORS.panelLight);
  }

  setTool(tool: BuildTool): void {
    if (!this.m.isAllowed(tool)) {
      this.h.toast(t('build.toolLocked'), COLORS.warn);
      return;
    }
    this.tool = tool;
    this.cancelDrag();
    this.relayout();
    this.h.toast(t(`tip.${tool}` as Key), COLORS.panelLight);
  }

  private undo(): void {
    if (this.m.undo()) this.afterChange();
  }

  private redo(): void {
    if (this.m.redo()) this.afterChange();
  }

  private afterChange(): void {
    this.h.onNetworkChanged();
    // Selection may point at something that no longer exists.
    if (this.selection?.kind === 'edge' && !this.m.net.edge(this.selection.id)) this.select(null);
    if (this.selection?.kind === 'node' && !this.m.net.node(this.selection.id)) this.select(null);
    this.relayout();
  }

  private report(r: BuildResult, silentOk = false): void {
    if (!r.ok) {
      this.h.toast(t(r.reason as Key), COLORS.bad);
      return;
    }
    if (!silentOk && r.cost > 0) this.h.toast(t('build.done', { cost: r.cost }), 0x1f7a55);
    this.afterChange();
  }

  private redrawGrid(): void {
    this.gridG.clear();
    if (this.mode === 'build' && this.showGrid) drawGrid(this.gridG, this.h.world, this.m.settings.gridSize);
  }

  // ------------------------------------------------------------------ input

  cancelDrag(): void {
    this.drag = null;
    this.plan = null;
    this.moveTarget = null;
    this.label?.destroy();
    this.label = null;
    this.updateBudget();
  }

  /** Returns true when the controller handles this pointer. */
  pointerDown(p: Phaser.Input.Pointer): boolean {
    if (this.mode === 'sim') return false;
    if (p.rightButtonDown() || p.middleButtonDown()) return false;
    const w = this.h.cam.worldAt(p.x, p.y);
    this.drag = { id: p.id, start: { x: w.x, y: w.y }, screen: { x: p.x, y: p.y }, moved: false };
    if (this.mode === 'build' && (this.tool === 'spawn' || this.tool === 'exit')) {
      const n = this.m.pickNode(w, 30);
      if (n && (this.m.net.spawnAt(n) || this.m.net.exitAt(n))) this.drag.node = n;
    }
    return true;
  }

  pointerMove(p: Phaser.Input.Pointer): boolean {
    const d = this.drag;
    if (!d || d.id !== p.id) return false;
    if (Math.hypot(p.x - d.screen.x, p.y - d.screen.y) > DRAG_MIN) d.moved = true;
    const w = this.h.cam.worldAt(p.x, p.y);
    if (this.mode === 'build' && this.tool === 'road' && d.moved) {
      this.plan = this.m.planRoad(d.start, w);
      this.showPlanLabel(p.x, p.y);
      this.updateBudget();
    } else if (this.mode === 'build' && d.node && d.moved) {
      const n = this.m.pickNode(w, 34);
      this.moveTarget = n && n !== d.node && this.m.net.degree(n) === 1 ? n : null;
    } else if (d.moved && this.mode !== 'build') {
      // Inspect mode: dragging pans the map.
      const prev = (d as { last?: Vec2 }).last ?? d.screen;
      this.h.cam.panBy(prev.x, prev.y, p.x, p.y);
      (d as { last?: Vec2 }).last = { x: p.x, y: p.y };
    }
    return true;
  }

  pointerUp(p: Phaser.Input.Pointer): boolean {
    const d = this.drag;
    if (!d || d.id !== p.id) return false;
    const w = this.h.cam.worldAt(p.x, p.y);
    const plan = this.plan;
    const target = this.moveTarget;
    this.cancelDrag();
    if (this.mode !== 'build') {
      if (!d.moved) this.select(this.pick(w));
      return true;
    }
    switch (this.tool) {
      case 'road':
        if (plan && d.moved) this.report(this.m.buildRoad(plan));
        else if (!d.moved) this.h.toast(t('tip.road'), COLORS.panelLight);
        break;
      case 'delete': {
        if (d.moved) break;
        const e = this.m.pickEdge(w, 18);
        if (!e) break;
        this.select({ kind: 'edge', id: e });
        this.h.confirm(t('build.deleteTitle'), t('build.deleteBody'), t('common.delete'), () => {
          this.report(this.m.deleteRoad(e), true);
          this.select(null);
        });
        break;
      }
      case 'light': {
        if (d.moved) break;
        const a = this.m.pickApproach(w);
        if (a) this.report(this.m.toggleLight(a.node, a.edge));
        else this.h.toast(t('build.notJunction'), COLORS.warn);
        break;
      }
      case 'lane': {
        if (d.moved) break;
        const e = this.m.pickEdge(w, 18);
        if (e) this.report(this.m.cycleLanes(e, w));
        break;
      }
      case 'direction': {
        if (d.moved) break;
        const e = this.m.pickEdge(w, 18);
        if (e) this.report(this.m.cycleDirection(e));
        break;
      }
      case 'intersection': {
        if (d.moved) break;
        const n = this.m.pickNode(w, 60);
        if (n && this.m.net.isJunction(n)) {
          this.report(this.m.cyclePriority(n));
          this.select({ kind: 'node', id: n });
        } else this.h.toast(t('build.notJunction'), COLORS.warn);
        break;
      }
      case 'spawn':
      case 'exit': {
        if (d.node && target) this.report(this.m.moveEndpoint(d.node, target), true);
        else if (!d.moved) {
          const n = this.m.pickNode(w, 30);
          if (n) {
            this.report(this.cycleEndpoint(n), true);
            this.select({ kind: 'node', id: n });
          }
        }
        break;
      }
      case 'decor':
        if (!d.moved) this.report(this.m.toggleDecor(w), true);
        break;
      case 'inspect':
        if (!d.moved) this.select(this.pick(w));
        break;
    }
    return true;
  }

  /** none → entry → exit → both → none. */
  private cycleEndpoint(n: string): BuildResult {
    const net = this.m.net;
    const hasS = !!net.spawnAt(n);
    const hasX = !!net.exitAt(n);
    if (!hasS && !hasX) return this.m.toggleEndpoint(n, 'spawn');
    if (hasS && !hasX) {
      const r = this.m.toggleEndpoint(n, 'spawn');
      return r.ok ? this.m.toggleEndpoint(n, 'exit') : r;
    }
    if (!hasS && hasX) return this.m.toggleEndpoint(n, 'spawn');
    const r = this.m.toggleEndpoint(n, 'spawn');
    return r.ok ? this.m.toggleEndpoint(n, 'exit') : r;
  }

  private pick(w: Vec2): Selection {
    const a = this.m.pickApproach(w, 24);
    if (a && this.m.net.lightAt(a.node, a.edge)) return { kind: 'light', node: a.node, edge: a.edge };
    const n = this.m.net.findNodeNear(w, 70);
    if (n && (this.m.net.isJunction(n.id) || this.m.net.spawnAt(n.id) || this.m.net.exitAt(n.id)) && Math.hypot(n.x - w.x, n.y - w.y) < Math.max(28, nodeRadius(this.m.net, n) + 6)) {
      return { kind: 'node', id: n.id };
    }
    const e = this.m.pickEdge(w, 16);
    return e ? { kind: 'edge', id: e } : null;
  }

  private showPlanLabel(sx: number, sy: number): void {
    this.label?.destroy();
    const plan = this.plan;
    if (!plan) return;
    const s = uiScale(this.h.scene);
    const lines = [
      plan.valid ? t('build.valid') : t('build.invalid'),
      `${t('build.length', { v: Math.round(plan.length) })} · $${plan.cost}`,
      ...(plan.reason ? [t(plan.reason as Key)] : []),
    ];
    const txt = makeText(this.h.scene, 0, 0, lines.join('\n'), { size: 12 * s, bold: true, align: 'center', color: plan.valid ? COLORS.good : COLORS.bad });
    const w = txt.width + 16;
    const hgt = txt.height + 10;
    const g = this.h.scene.add.graphics();
    g.fillStyle(COLORS.bgDeep, 0.9);
    g.fillRoundedRect(-w / 2, -hgt / 2, w, hgt, 8);
    txt.setOrigin(0.5);
    const W = this.h.scene.scale.width;
    const x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, sx));
    const y = Math.max(this.h.topInset() + hgt, sy - 70);
    this.label = this.h.scene.add.container(x, y, [g, txt]);
    this.h.uiRoot.add(this.label);
  }

  // ------------------------------------------------------------------ inspector

  select(sel: Selection): void {
    this.selection = sel;
    this.refreshInspector();
  }

  private refreshInspector(): void {
    if (!this.selection) {
      if (this.inspector.visible) {
        this.inspector.hide();
        this.h.scene.events.emit('build-relayout');
      }
      return;
    }
    const content = this.inspectorContent(this.selection);
    if (!content) {
      this.selection = null;
      this.inspector.hide();
      return;
    }
    const H = this.h.scene.scale.height;
    this.inspector.show(content, { top: this.h.topInset(), bottom: H - this.dockHeight });
  }

  private inspectorContent(sel: NonNullable<Selection>): InspectorContent | null {
    const net = this.m.net;
    const an = this.h.getAnalytics();
    const sim = this.h.getSim();
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    if (sel.kind === 'edge') {
      const e = net.edge(sel.id);
      if (!e) return null;
      const st = an?.edge(e.id);
      const dir = net.directionOf(e);
      const rows = [
        { label: t('insp.length'), value: `${Math.round(net.length(e))}` },
        { label: t('insp.lanes'), value: `${e.f} + ${e.bk}` },
        { label: t('insp.direction'), value: dir === 'two' ? t('insp.dir.two') : `${t('insp.dir.one')} ${dir === 'ab' ? '→' : '←'}` },
      ];
      if (st) {
        rows.push(
          { label: t('insp.load'), value: `${t(`load.${st.level}` as Key)} ${pct(st.utilization)}`, color: LOAD_COLORS[st.level] } as never,
          { label: t('insp.speed'), value: `${Math.round(st.avgSpeed)}` },
          { label: t('insp.perMin'), value: st.perMinute.toFixed(1) },
          { label: t('insp.vehicles'), value: `${st.vehicles}` },
        );
      }
      return { title: t('insp.road'), rows };
    }
    if (sel.kind === 'light') {
      const id = lightId(sel.node, sel.edge);
      const ls = an?.light(id);
      const l = sim?.lights.get(id);
      return {
        title: t('insp.light'),
        rows: [
          { label: t('insp.state'), value: l ? l.state : '—' },
          { label: t('insp.incoming'), value: `${ls?.incoming ?? 0}` },
          { label: t('insp.queue'), value: `${ls?.queue ?? 0}` },
        ],
      };
    }
    const n = net.node(sel.id);
    if (!n) return null;
    const spawn = net.spawnAt(n.id);
    const exit = net.exitAt(n.id);
    if (!net.isJunction(n.id) && (spawn || exit)) return this.endpointContent(n.id, spawn, !!exit);
    if (!net.isJunction(n.id)) return null;
    const ns = an?.node(n.id);
    const hasLights = net.data.lights.some((l) => l.node === n.id);
    const prio = hasLights ? t('insp.prio.signal') : mainPair(net, n) ? t('insp.prio.main') : t('insp.prio.allway');
    return {
      title: t('insp.junction'),
      rows: [
        { label: t('insp.priority'), value: prio },
        { label: t('insp.perMin'), value: (ns?.perMinute ?? 0).toFixed(1) },
        { label: t('insp.delay'), value: `${(ns?.avgDelay ?? 0).toFixed(1)} s` },
        { label: t('insp.topMove'), value: ns?.topMovement ? t(`insp.move.${ns.topMovement}` as Key) : '—' },
        { label: t('insp.conflicts'), value: `${ns?.conflictPoints ?? sim?.collisions.zones.filter((z) => Math.hypot(z.x - n.x, z.y - n.y) < nodeRadius(net, n) + 20).length ?? 0}` },
      ],
    };
  }

  /** Entry / exit: counts and vehicle mix are editable in the editor. */
  private endpointContent(nodeId: string, spawn: NetSpawn | undefined, isExit: boolean): InspectorContent {
    const rows = [];
    if (spawn) {
      rows.push(
        { label: t('insp.count'), value: `${spawn.count}` },
        { label: t('insp.interval'), value: `${spawn.interval[0].toFixed(1)}–${spawn.interval[1].toFixed(1)} s` },
        { label: t('insp.mix'), value: Object.keys(spawn.mix ?? {}).join(', ') || '—' },
      );
    }
    const actions: InspectorAction[] = [];
    if (spawn && this.h.editor) {
      const edit = (fn: (s: NetSpawn) => void) => () => {
        fn(spawn);
        this.m.net.touch();
        this.afterChange();
      };
      actions.push(
        { label: t('insp.lighter'), icon: 'minus', onClick: edit((s) => (s.count = Math.max(1, s.count - 2))) },
        { label: t('insp.heavier'), icon: 'plus', onClick: edit((s) => (s.count = Math.min(60, s.count + 2))) },
        { label: t('insp.slower'), onClick: edit((s) => (s.interval = [Math.min(8, s.interval[0] + 0.4), Math.min(9, s.interval[1] + 0.4)])) },
        { label: t('insp.faster'), onClick: edit((s) => (s.interval = [Math.max(0.7, s.interval[0] - 0.4), Math.max(1, s.interval[1] - 0.4)])) },
      );
      for (const kind of ['bus', 'truck', 'taxi'] as VehicleKind[]) {
        const on = !!spawn.mix?.[kind];
        actions.push({
          label: `${on ? '✓ ' : ''}${t(`vehicle.${kind}` as Key)}`,
          style: on ? 'primary' : 'secondary',
          onClick: edit((s) => {
            const mix = { ...(s.mix ?? {}) };
            if (on) delete mix[kind];
            else mix[kind] = 1.2;
            s.mix = Object.keys(mix).length ? mix : undefined;
          }),
        });
      }
      actions.push({
        label: t('insp.addEmergency'),
        icon: 'plus',
        onClick: () => {
          const ex = this.m.net.data.exits.find((x) => x.node !== nodeId);
          if (!ex) return;
          const specials = (this.m.net.data.specials ??= []);
          const kinds: VehicleKind[] = ['ambulance', 'police', 'fire'];
          specials.push({ at: 10 + specials.length * 15, spawn: spawn.id, exit: ex.id, kind: kinds[specials.length % 3] });
          this.m.net.touch();
          this.afterChange();
        },
      });
    }
    return { title: spawn && isExit ? `${t('insp.spawn')} + ${t('insp.exit')}` : spawn ? t('insp.spawn') : t('insp.exit'), rows, actions };
  }

  // ------------------------------------------------------------------ per frame

  update(delta: number): void {
    this.clock += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock / 180);
    const g = this.overlayG;
    g.clear();
    const an = this.h.getAnalytics();
    if (this.showLoad && an) drawLoad(g, this.m.net, an);
    if (this.mode === 'build') drawToolHints(g, this.m.net, this.tool, pulse);
    if (this.plan && this.drag) drawPreview(g, this.plan);
    if (this.drag?.node) {
      const from = this.m.net.node(this.drag.node);
      const to = this.moveTarget ? this.m.net.node(this.moveTarget) : null;
      if (from && to) {
        g.lineStyle(3, COLORS.accent, 0.9);
        g.lineBetween(from.x, from.y, to.x, to.y);
        g.strokeCircle(to.x, to.y, 20);
      }
    }
    drawSelection(g, this.m.net, this.selection, pulse);
    this.debugG.clear();
    const sim = this.h.getSim();
    if (this.debug && sim) drawDebug(this.debugG, sim, this.m.net, this.debugFlags);
    // Live inspector numbers.
    this.inspectorTimer += delta;
    if (this.selection && this.mode !== 'build' && this.inspectorTimer > 500) {
      this.inspectorTimer = 0;
      this.refreshInspector();
    }
  }

  /** Extra bottom space used by the inspector bottom sheet (phones). */
  get sheetHeight(): number {
    return this.inspector.sheetHeight;
  }

  destroy(): void {
    this.budgetText = null;
    this.drag = null;
    this.plan = null;
    if (this.label?.active) this.label.destroy();
    this.label = null;
    this.toolbar.destroy();
    this.inspector.destroy();
    this.dock.destroy();
    this.gridG.destroy();
    this.overlayG.destroy();
    this.debugG.destroy();
  }
}
