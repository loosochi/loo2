import { ROAD } from '../config/balanceConfig';
import type { RoadDef } from '../types';

/** Rendering/geometry helper around a straight, axis-aligned road definition. */
export class Road {
  readonly def: RoadDef;

  constructor(def: RoadDef) {
    this.def = def;
  }

  get horizontal(): boolean {
    return Math.abs(this.def.to.y - this.def.from.y) < Math.abs(this.def.to.x - this.def.from.x);
  }

  /** Total asphalt width across all lanes. */
  get width(): number {
    const dirs = this.def.oneWay ? 1 : 2;
    return this.def.lanes * dirs * ROAD.laneWidth;
  }

  /** Axis-aligned rectangle of the asphalt, optionally expanded by `pad`. */
  rect(pad = 0): { x: number; y: number; w: number; h: number } {
    const { from, to } = this.def;
    const half = this.width / 2 + pad;
    if (this.horizontal) {
      const x0 = Math.min(from.x, to.x);
      const x1 = Math.max(from.x, to.x);
      return { x: x0, y: from.y - half, w: x1 - x0, h: half * 2 };
    }
    const y0 = Math.min(from.y, to.y);
    const y1 = Math.max(from.y, to.y);
    return { x: from.x - half, y: y0, w: half * 2, h: y1 - y0 };
  }

  containsPoint(x: number, y: number, pad = 0): boolean {
    const r = this.rect(pad);
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
}
