import Phaser from 'phaser';
import { COLORS, FONT, hex } from '../config/theme';

export const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);

export interface TextOpts {
  size: number;
  color?: number;
  bold?: boolean;
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
  wrap?: number;
}

/** Crisp text on high-DPI screens. */
export function makeText(scene: Phaser.Scene, x: number, y: number, text: string, o: TextOpts): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: o.mono ? FONT.mono : FONT.family,
    fontSize: `${Math.round(o.size)}px`,
    fontStyle: o.bold ? 'bold' : 'normal',
    color: hex(o.color ?? COLORS.text),
    align: o.align ?? 'left',
    resolution: DPR,
    wordWrap: o.wrap ? { width: o.wrap, useAdvancedWrap: true } : undefined,
  });
}

/** Responsive UI scale factor based on the smaller screen dimension. */
export function uiScale(scene: Phaser.Scene): number {
  const { width, height } = scene.scale;
  return Phaser.Math.Clamp(Math.min(width, height) / 640, 0.72, 1.25);
}

export function panel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 14,
  fill: number = COLORS.panel,
  alpha = 0.96,
): void {
  g.fillStyle(0x000000, 0.28);
  g.fillRoundedRect(x + 3, y + 5, w, h, r);
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, r);
  g.lineStyle(1.5, COLORS.panelStroke, 1);
  g.strokeRoundedRect(x, y, w, h, r);
}

/** Five-point star path centred at (x, y). */
export function drawStar(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, alpha = 1): void {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * rr, y + Math.sin(a) * rr));
  }
  g.fillStyle(fill, alpha);
  g.fillPoints(pts, true);
}

export type IconName =
  | 'pause'
  | 'play'
  | 'restart'
  | 'back'
  | 'lock'
  | 'sound'
  | 'mute'
  | 'next'
  | 'menu'
  | 'grid'
  | 'gear'
  | 'fit'
  | 'trophy'
  | 'edit'
  | 'globe'
  | 'user'
  | 'share'
  | 'check'
  | 'download'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'car';

/** Simple vector icons drawn with Graphics, centred at (0, 0) within a box of size `s`. */
export function drawIcon(g: Phaser.GameObjects.Graphics, name: IconName, s: number, color: number): void {
  const h = s / 2;
  g.fillStyle(color, 1);
  g.lineStyle(Math.max(2, s * 0.12), color, 1);
  switch (name) {
    case 'pause':
      g.fillRoundedRect(-h * 0.6, -h * 0.7, h * 0.42, h * 1.4, 2);
      g.fillRoundedRect(h * 0.18, -h * 0.7, h * 0.42, h * 1.4, 2);
      break;
    case 'play':
      g.fillTriangle(-h * 0.45, -h * 0.7, -h * 0.45, h * 0.7, h * 0.7, 0);
      break;
    case 'next':
      g.fillTriangle(-h * 0.7, -h * 0.6, -h * 0.7, h * 0.6, h * 0.1, 0);
      g.fillRect(h * 0.25, -h * 0.6, h * 0.3, h * 1.2);
      break;
    case 'restart': {
      g.beginPath();
      g.arc(0, 0, h * 0.62, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(230), false);
      g.strokePath();
      const ax = Math.cos(Phaser.Math.DegToRad(-60)) * h * 0.62;
      const ay = Math.sin(Phaser.Math.DegToRad(-60)) * h * 0.62;
      g.fillTriangle(ax - h * 0.05, ay - h * 0.42, ax + h * 0.42, ay + h * 0.12, ax - h * 0.32, ay + h * 0.22);
      break;
    }
    case 'back':
      g.beginPath();
      g.moveTo(h * 0.2, -h * 0.6);
      g.lineTo(-h * 0.4, 0);
      g.lineTo(h * 0.2, h * 0.6);
      g.strokePath();
      break;
    case 'lock':
      g.fillRoundedRect(-h * 0.55, -h * 0.05, h * 1.1, h * 0.85, 3);
      g.beginPath();
      g.arc(0, -h * 0.1, h * 0.36, Math.PI, 0, false);
      g.strokePath();
      break;
    case 'sound':
    case 'mute':
      g.fillRect(-h * 0.7, -h * 0.25, h * 0.35, h * 0.5);
      g.fillTriangle(-h * 0.4, -h * 0.25, h * 0.05, -h * 0.65, h * 0.05, h * 0.25);
      g.fillTriangle(-h * 0.4, h * 0.25, h * 0.05, h * 0.65, h * 0.05, -h * 0.25);
      if (name === 'sound') {
        g.beginPath();
        g.arc(h * 0.1, 0, h * 0.45, -0.8, 0.8, false);
        g.strokePath();
      } else {
        g.lineBetween(h * 0.25, -h * 0.35, h * 0.75, h * 0.35);
        g.lineBetween(h * 0.25, h * 0.35, h * 0.75, -h * 0.35);
      }
      break;
    case 'menu':
      for (const y of [-0.5, 0, 0.5]) g.fillRoundedRect(-h * 0.65, y * h - h * 0.1, h * 1.3, h * 0.2, 2);
      break;
    case 'grid':
      for (const x of [-1, 1]) for (const y of [-1, 1]) g.fillRoundedRect(x * h * 0.35 - h * 0.28, y * h * 0.35 - h * 0.28, h * 0.56, h * 0.56, 2);
      break;
    case 'gear':
      g.fillCircle(0, 0, h * 0.45);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillCircle(Math.cos(a) * h * 0.55, Math.sin(a) * h * 0.55, h * 0.14);
      }
      g.fillStyle(COLORS.panel, 1);
      g.fillCircle(0, 0, h * 0.2);
      break;
    case 'fit': {
      const a = h * 0.7;
      const k = h * 0.32;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        g.beginPath();
        g.moveTo(sx * a, sy * (a - k));
        g.lineTo(sx * a, sy * a);
        g.lineTo(sx * (a - k), sy * a);
        g.strokePath();
      }
      g.fillCircle(0, 0, h * 0.14);
      break;
    }
    case 'trophy':
      g.fillRoundedRect(-h * 0.45, -h * 0.65, h * 0.9, h * 0.6, { tl: 2, tr: 2, bl: h * 0.4, br: h * 0.4 });
      g.fillRect(-h * 0.1, -h * 0.1, h * 0.2, h * 0.45);
      g.fillRoundedRect(-h * 0.4, h * 0.35, h * 0.8, h * 0.22, 2);
      g.lineStyle(Math.max(1.5, s * 0.08), color, 1);
      g.strokeCircle(-h * 0.5, -h * 0.4, h * 0.2);
      g.strokeCircle(h * 0.5, -h * 0.4, h * 0.2);
      break;
    case 'edit':
      g.fillTriangle(-h * 0.7, h * 0.7, -h * 0.55, h * 0.25, -h * 0.25, h * 0.55);
      g.beginPath();
      g.moveTo(-h * 0.45, h * 0.4);
      g.lineTo(h * 0.45, -h * 0.5);
      g.strokePath();
      g.fillCircle(h * 0.52, -h * 0.57, h * 0.16);
      break;
    case 'globe':
      g.lineStyle(Math.max(1.5, s * 0.08), color, 1);
      g.strokeCircle(0, 0, h * 0.65);
      g.strokeEllipse(0, 0, h * 0.6, h * 1.3);
      g.lineBetween(-h * 0.65, 0, h * 0.65, 0);
      break;
    case 'user':
      g.fillCircle(0, -h * 0.3, h * 0.3);
      g.fillRoundedRect(-h * 0.55, h * 0.1, h * 1.1, h * 0.55, { tl: h * 0.3, tr: h * 0.3, bl: 2, br: 2 });
      break;
    case 'share':
      g.fillCircle(-h * 0.45, 0, h * 0.2);
      g.fillCircle(h * 0.45, -h * 0.45, h * 0.2);
      g.fillCircle(h * 0.45, h * 0.45, h * 0.2);
      g.lineStyle(Math.max(1.5, s * 0.08), color, 1);
      g.lineBetween(-h * 0.45, 0, h * 0.45, -h * 0.45);
      g.lineBetween(-h * 0.45, 0, h * 0.45, h * 0.45);
      break;
    case 'check':
      g.beginPath();
      g.moveTo(-h * 0.6, 0);
      g.lineTo(-h * 0.15, h * 0.45);
      g.lineTo(h * 0.65, -h * 0.5);
      g.strokePath();
      break;
    case 'download':
      g.fillRect(-h * 0.1, -h * 0.7, h * 0.2, h * 0.7);
      g.fillTriangle(-h * 0.4, -h * 0.05, h * 0.4, -h * 0.05, 0, h * 0.4);
      g.fillRect(-h * 0.65, h * 0.5, h * 1.3, h * 0.18);
      break;
    case 'plus':
      g.fillRect(-h * 0.6, -h * 0.1, h * 1.2, h * 0.2);
      g.fillRect(-h * 0.1, -h * 0.6, h * 0.2, h * 1.2);
      break;
    case 'minus':
      g.fillRect(-h * 0.6, -h * 0.1, h * 1.2, h * 0.2);
      break;
    case 'trash':
      g.fillRect(-h * 0.55, -h * 0.55, h * 1.1, h * 0.16);
      g.fillRect(-h * 0.15, -h * 0.7, h * 0.3, h * 0.16);
      g.fillRoundedRect(-h * 0.42, -h * 0.35, h * 0.84, h * 1.0, 2);
      break;
    case 'car':
      g.fillRoundedRect(-h * 0.7, -h * 0.35, h * 1.4, h * 0.7, h * 0.2);
      g.fillStyle(COLORS.panel, 1);
      g.fillRect(h * 0.1, -h * 0.25, h * 0.22, h * 0.5);
      break;
  }
}

/** Camera fade transition to another scene (fades every camera of the scene). */
export function goTo(scene: Phaser.Scene, key: string, data?: object): void {
  const flagged = scene as Phaser.Scene & { __leaving?: boolean };
  if (flagged.__leaving) return;
  flagged.__leaving = true;
  scene.input.enabled = false;
  for (const cam of scene.cameras.cameras) cam.fadeOut(220, 18, 23, 34);
  scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    scene.scene.start(key, data);
  });
}

/** Common scene entry: reset the leave flag and fade every camera in. */
export function enterScene(scene: Phaser.Scene): void {
  (scene as Phaser.Scene & { __leaving?: boolean }).__leaving = false;
  scene.input.enabled = true;
  for (const cam of scene.cameras.cameras) cam.fadeIn(260, 18, 23, 34);
}

export interface SplitView {
  /** Zoomable camera showing the world. */
  worldCam: Phaser.Cameras.Scene2D.Camera;
  /** Fixed 1:1 camera for the interface. */
  uiCam: Phaser.Cameras.Scene2D.Camera;
  worldLayer: Phaser.GameObjects.Layer;
  /** Root container for all UI (rendered and hit-tested only by the UI camera). */
  uiRoot: Phaser.GameObjects.Container;
}

/**
 * Two cameras: the main camera zooms/pans the world; a second camera draws the UI unscaled.
 * Camera filters are set on the top-level objects so rendering *and* input hit-testing agree.
 */
export function createSplitView(scene: Phaser.Scene): SplitView {
  const worldCam = scene.cameras.main;
  const uiCam = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
  uiCam.setName('ui');
  const worldLayer = scene.add.layer();
  const uiRoot = scene.add.container(0, 0);
  worldLayer.cameraFilter |= uiCam.id;
  uiRoot.cameraFilter |= worldCam.id;
  return { worldCam, uiCam, worldLayer, uiRoot };
}

/**
 * Zoom (and optionally rotate by 90°) a camera so the world rectangle fits inside the given
 * screen box, centred in it. Returns the zoom used.
 */
export function fitCamera(
  cam: Phaser.Cameras.Scene2D.Camera,
  world: { width: number; height: number },
  box: { x: number; y: number; w: number; h: number },
  screen: { width: number; height: number },
  rotate = false,
): number {
  cam.setSize(screen.width, screen.height);
  const ww = rotate ? world.height : world.width;
  const wh = rotate ? world.width : world.height;
  const zoom = Math.min(box.w / ww, box.h / wh);
  cam.setZoom(zoom);
  cam.setRotation(rotate ? Math.PI / 2 : 0);
  const cx = world.width / 2;
  const cy = world.height / 2;
  cam.centerOn(cx, cy);
  // The screen→world mapping is affine: measure where the box centre lands and correct once.
  cam.preRender();
  const p = cam.getWorldPoint(box.x + box.w / 2, box.y + box.h / 2);
  cam.centerOn(cx + (cx - p.x), cy + (cy - p.y));
  cam.preRender();
  return zoom;
}
