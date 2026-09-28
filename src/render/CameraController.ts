import Phaser from 'phaser';

export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far the player may zoom in, relative to the fitted zoom. */
const MAX_ZOOM_FACTOR = 4;

/**
 * Zoom / pan for the world camera. Works with a camera rotated by 90° (portrait layout):
 * all maths goes through the camera's own screen→world mapping, which is affine, so
 * "keep the world point under the finger" is a simple scroll correction.
 */
export class CameraController {
  private fitZoom = 1;
  private box: ScreenBox = { x: 0, y: 0, w: 1, h: 1 };
  rotated = false;

  constructor(
    private readonly cam: Phaser.Cameras.Scene2D.Camera,
    private readonly world: { width: number; height: number },
  ) {}

  /** Fit the whole world into `box` (screen px). Chooses rotation for tall screens. */
  fit(box: ScreenBox, screen: { width: number; height: number }, allowRotate = true): number {
    this.box = box;
    const W = this.world.width;
    const H = this.world.height;
    const zStraight = Math.min(box.w / W, box.h / H);
    const zRotated = Math.min(box.w / H, box.h / W);
    this.rotated = allowRotate && zRotated > zStraight * 1.2;
    this.fitZoom = this.rotated ? zRotated : zStraight;
    this.cam.setSize(screen.width, screen.height);
    this.cam.setRotation(this.rotated ? Math.PI / 2 : 0);
    this.cam.setZoom(this.fitZoom);
    this.centerWorldAt(W / 2, H / 2);
    return this.fitZoom;
  }

  /** Back to the fitted view. */
  reset(): void {
    this.cam.setZoom(this.fitZoom);
    this.centerWorldAt(this.world.width / 2, this.world.height / 2);
  }

  get zoom(): number {
    return this.cam.zoom;
  }

  get isZoomed(): boolean {
    return this.cam.zoom > this.fitZoom * 1.03;
  }

  worldAt(sx: number, sy: number): Phaser.Math.Vector2 {
    this.cam.preRender();
    return this.cam.getWorldPoint(sx, sy);
  }

  /** Put world point (wx, wy) at the centre of the view box. */
  private centerWorldAt(wx: number, wy: number): void {
    this.cam.centerOn(wx, wy);
    const p = this.worldAt(this.box.x + this.box.w / 2, this.box.y + this.box.h / 2);
    this.cam.scrollX += wx - p.x;
    this.cam.scrollY += wy - p.y;
    this.cam.preRender();
  }

  /** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.worldAt(sx, sy);
    const z = Phaser.Math.Clamp(this.cam.zoom * factor, this.fitZoom, this.fitZoom * MAX_ZOOM_FACTOR);
    this.cam.setZoom(z);
    const after = this.worldAt(sx, sy);
    this.cam.scrollX += before.x - after.x;
    this.cam.scrollY += before.y - after.y;
    this.clamp();
  }

  /** Drag the map from screen point a to b. */
  panBy(ax: number, ay: number, bx: number, by: number): void {
    const a = this.worldAt(ax, ay);
    const b = this.worldAt(bx, by);
    this.cam.scrollX += a.x - b.x;
    this.cam.scrollY += a.y - b.y;
    this.clamp();
  }

  /** Keep the centre of the view inside the world. */
  private clamp(): void {
    const c = this.worldAt(this.box.x + this.box.w / 2, this.box.y + this.box.h / 2);
    const cx = Phaser.Math.Clamp(c.x, 0, this.world.width);
    const cy = Phaser.Math.Clamp(c.y, 0, this.world.height);
    if (!this.isZoomed) {
      this.centerWorldAt(this.world.width / 2, this.world.height / 2);
      return;
    }
    this.cam.scrollX += cx - c.x;
    this.cam.scrollY += cy - c.y;
    this.cam.preRender();
  }

  /** World → screen (for UI anchored to world objects). */
  toScreen(wx: number, wy: number): { x: number; y: number } {
    this.cam.preRender();
    const m = (this.cam as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix;
    const p = m.transformPoint(wx - this.cam.scrollX, wy - this.cam.scrollY, { x: 0, y: 0 } as Phaser.Math.Vector2);
    return { x: p.x, y: p.y };
  }
}
