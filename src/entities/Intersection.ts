import type { IntersectionDef } from '../types';

/** An intersection box. Markings are suppressed inside it and crosswalks are drawn around it. */
export class Intersection {
  readonly def: IntersectionDef;

  constructor(def: IntersectionDef) {
    this.def = def;
  }

  get bounds(): { x: number; y: number; w: number; h: number } {
    const { x, y, halfW, halfH } = this.def;
    return { x: x - halfW, y: y - halfH, w: halfW * 2, h: halfH * 2 };
  }

  contains(px: number, py: number, pad = 0): boolean {
    const { x, y, halfW, halfH } = this.def;
    return Math.abs(px - x) <= halfW + pad && Math.abs(py - y) <= halfH + pad;
  }
}
