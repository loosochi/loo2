import Phaser from 'phaser';
import { VEHICLE_SPECS } from '../config/balanceConfig';
import { paletteFor } from '../config/theme';
import type { VehicleKind } from '../types';

/** Textures are drawn at this multiple of world size so they stay crisp when zoomed in. */
export const TEX_SCALE = 3;

export const carKey = (kind: VehicleKind, color: number): string => `car-${kind}-${color.toString(16)}`;
export const CAR_SHADOW = 'car-shadow';
export const CAR_BRAKE = 'car-brake';
export const CAR_BLINK = 'car-blink';
export const SPARK = 'spark';
export const SOFT_DOT = 'soft-dot';

function shade(color: number, f: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const k = (v: number) => Phaser.Math.Clamp(Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)), 0, 255);
  return Phaser.Display.Color.GetColor(k(c.red), k(c.green), k(c.blue));
}

/** Procedurally generate every texture used by the game (no external image assets). */
export function generateTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const S = TEX_SCALE;

  for (const spec of VEHICLE_SPECS) {
    for (const color of paletteFor(spec.kind)) {
      const key = carKey(spec.kind, color);
      if (scene.textures.exists(key)) continue;
      drawVehicle(g, spec.kind, spec.length * S, spec.width * S, color);
      g.generateTexture(key, Math.ceil(spec.length * S) + 2, Math.ceil(spec.width * S) + 2);
      g.clear();
    }
  }

  // Soft shadow: stacked translucent rounded rects.
  const sw = 26 * S;
  const sh = 15 * S;
  for (let i = 0; i < 5; i++) {
    g.fillStyle(0x000000, 0.07);
    g.fillRoundedRect(i * 2, i * 2, sw - i * 4, sh - i * 4, 8 + i);
  }
  g.generateTexture(CAR_SHADOW, sw, sh);
  g.clear();

  // Brake light glow (two dots at the rear, drawn for a car pointing +x).
  g.fillStyle(0xff2a2a, 0.45);
  g.fillCircle(6, 6, 6);
  g.fillCircle(6, 30, 6);
  g.fillStyle(0xff5050, 1);
  g.fillCircle(6, 6, 3);
  g.fillCircle(6, 30, 3);
  g.generateTexture(CAR_BRAKE, 12, 36);
  g.clear();

  // Turn indicator dot.
  g.fillStyle(0xffb020, 0.5);
  g.fillCircle(6, 6, 6);
  g.fillStyle(0xffd060, 1);
  g.fillCircle(6, 6, 3);
  g.generateTexture(CAR_BLINK, 12, 12);
  g.clear();

  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 8);
  g.generateTexture(SPARK, 16, 16);
  g.clear();

  for (let i = 8; i > 0; i--) {
    g.fillStyle(0xffffff, 0.14);
    g.fillCircle(32, 32, i * 4);
  }
  g.generateTexture(SOFT_DOT, 64, 64);
  g.destroy();
}

function drawVehicle(g: Phaser.GameObjects.Graphics, kind: VehicleKind, L: number, W: number, color: number): void {
  switch (kind) {
    case 'bus':
      return drawBus(g, L, W, color);
    case 'truck':
      return drawTruck(g, L, W, color, 0xeef1f4);
    case 'fire':
      return drawFireEngine(g, L, W, color);
    case 'ambulance':
    case 'police':
    case 'taxi':
      return drawCar(g, 'sedan', L, W, color, kind);
    default:
      return drawCar(g, kind, L, W, color);
  }
}

function lights(g: Phaser.GameObjects.Graphics, L: number, W: number): void {
  g.fillStyle(0xfff6d0, 1);
  g.fillRoundedRect(1 + L - 5, 1 + 3, 4, W * 0.2, 1.5);
  g.fillRoundedRect(1 + L - 5, 1 + W - 3 - W * 0.2, 4, W * 0.2, 1.5);
  g.fillStyle(0xb3262b, 1);
  g.fillRect(2, 4, 3, W * 0.18);
  g.fillRect(2, W - 2 - W * 0.18, 3, W * 0.18);
}

/** City bus: long body, side window strips, roof units. */
function drawBus(g: Phaser.GameObjects.Graphics, L: number, W: number, color: number): void {
  const dark = shade(color, -0.35);
  g.fillStyle(dark, 1);
  g.fillRoundedRect(1, 1, L, W, 8);
  g.fillStyle(color, 1);
  g.fillRoundedRect(2.5, 2.5, L - 3, W - 3, 7);
  // Roof panel and window strips along both sides.
  g.fillStyle(shade(color, 0.3), 1);
  g.fillRoundedRect(L * 0.06, W * 0.22, L * 0.84, W * 0.56, 5);
  g.fillStyle(0x1e2a3a, 1);
  for (let i = 0; i < 7; i++) {
    const wx = L * 0.08 + i * L * 0.115;
    g.fillRect(wx, 4, L * 0.09, W * 0.13);
    g.fillRect(wx, W - 2 - W * 0.13, L * 0.09, W * 0.13);
  }
  g.fillRoundedRect(L - L * 0.07, W * 0.12, L * 0.055, W * 0.76, 4); // windscreen
  // Roof air-conditioning units.
  g.fillStyle(0xdfe4ea, 1);
  g.fillRoundedRect(L * 0.3, W * 0.32, L * 0.16, W * 0.36, 3);
  g.fillRoundedRect(L * 0.58, W * 0.32, L * 0.12, W * 0.36, 3);
  lights(g, L, W);
}

/** Truck: coloured cab at the front, light cargo box behind. */
function drawTruck(g: Phaser.GameObjects.Graphics, L: number, W: number, cab: number, cargo: number): void {
  const cabL = L * 0.26;
  g.fillStyle(0x2b2f38, 1);
  g.fillRoundedRect(L - cabL - 4, W * 0.3, 8, W * 0.4, 2); // hitch
  g.fillStyle(shade(cargo, -0.25), 1);
  g.fillRoundedRect(1, 1, L - cabL - 3, W, 4);
  g.fillStyle(cargo, 1);
  g.fillRoundedRect(2.5, 2.5, L - cabL - 6, W - 3, 3);
  g.fillStyle(shade(cargo, -0.1), 1);
  for (let i = 1; i < 5; i++) g.fillRect(2.5 + (i * (L - cabL - 6)) / 5, 3, 2, W - 4);
  g.fillStyle(shade(cab, -0.35), 1);
  g.fillRoundedRect(L - cabL + 1, 1, cabL, W, 6);
  g.fillStyle(cab, 1);
  g.fillRoundedRect(L - cabL + 2.5, 2.5, cabL - 3, W - 3, 5);
  g.fillStyle(0x1e2a3a, 1);
  g.fillRoundedRect(L - cabL * 0.35, W * 0.14, cabL * 0.22, W * 0.72, 3);
  g.fillStyle(shade(cab, 0.3), 1);
  g.fillRoundedRect(L - cabL * 0.85, W * 0.2, cabL * 0.42, W * 0.6, 3);
  lights(g, L, W);
}

/** Fire engine: red body with a ladder on the roof. */
function drawFireEngine(g: Phaser.GameObjects.Graphics, L: number, W: number, color: number): void {
  drawTruck(g, L, W, color, color);
  g.fillStyle(0xc9ced6, 1);
  g.fillRect(L * 0.06, W * 0.3, L * 0.62, 3);
  g.fillRect(L * 0.06, W * 0.7 - 3, L * 0.62, 3);
  for (let i = 0; i < 9; i++) g.fillRect(L * 0.07 + i * L * 0.07, W * 0.3, 2.5, W * 0.4);
  g.fillStyle(0xffffff, 0.9);
  g.fillRect(2.5, W * 0.46, L * 0.7, W * 0.08);
}

/** Top-down car, nose pointing to +x. Ambulance and police variants get their livery. */
function drawCar(g: Phaser.GameObjects.Graphics, kind: VehicleKind, L: number, W: number, color: number, livery?: 'ambulance' | 'police' | 'taxi'): void {
  const x = 1;
  const y = 1;
  const dark = shade(color, -0.35);
  const light = shade(color, 0.28);
  const glass = 0x1e2a3a;
  const r = W * 0.32;

  g.fillStyle(dark, 1);
  g.fillRoundedRect(x, y, L, W, r);
  g.fillStyle(color, 1);
  g.fillRoundedRect(x + 1.5, y + 1.5, L - 3, W - 3, r * 0.85);

  // Cabin proportions per body style.
  const cabins: Record<string, number[]> = { compact: [0.3, 0.78], sedan: [0.28, 0.72], hatch: [0.22, 0.8], sport: [0.36, 0.74] };
  const cabin = cabins[kind] ?? cabins.sedan;
  const c0 = x + L * cabin[0];
  const c1 = x + L * cabin[1];
  const inset = W * 0.14;

  // Windscreen (front) and rear window.
  g.fillStyle(glass, 1);
  g.fillRoundedRect(c1 - L * 0.13, y + inset, L * 0.14, W - inset * 2, 3);
  g.fillRoundedRect(c0, y + inset + 1, L * 0.1, W - inset * 2 - 2, 3);
  // Roof.
  g.fillStyle(light, 1);
  g.fillRoundedRect(c0 + L * 0.1, y + inset + 1, c1 - c0 - L * 0.23, W - inset * 2 - 2, 4);
  g.fillStyle(0xffffff, 0.18);
  g.fillRoundedRect(c0 + L * 0.12, y + inset + 3, (c1 - c0 - L * 0.27) * 0.6, (W - inset * 2) * 0.25, 2);

  if (kind === 'sport') {
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(x + 4, y + W / 2 - 2, L - 8, 4);
  }
  if (livery === 'ambulance') {
    g.fillStyle(0xe63946, 1);
    g.fillRect(x + 3, y + 1.5, L * 0.3, W * 0.12);
    g.fillRect(x + 3, y + W - 1.5 - W * 0.12, L * 0.3, W * 0.12);
    g.fillRect(x + L * 0.08, y + W / 2 - W * 0.07, L * 0.18, W * 0.14);
    g.fillRect(x + L * 0.17 - W * 0.07, y + W / 2 - L * 0.09, W * 0.14, L * 0.18);
  }
  if (livery === 'taxi') {
    // Checker stripe along both sides and a roof sign.
    for (let i = 0; i < 6; i++) {
      g.fillStyle(i % 2 ? 0x111111 : 0xffffff, 1);
      g.fillRect(x + L * 0.18 + i * L * 0.07, y + 1.5, L * 0.07, W * 0.1);
      g.fillStyle(i % 2 ? 0xffffff : 0x111111, 1);
      g.fillRect(x + L * 0.18 + i * L * 0.07, y + W - 1.5 - W * 0.1, L * 0.07, W * 0.1);
    }
    g.fillStyle(0x222222, 1);
    g.fillRoundedRect(x + L * 0.46, y + W * 0.32, L * 0.1, W * 0.36, 2);
    g.fillStyle(0xfff3b0, 1);
    g.fillRoundedRect(x + L * 0.475, y + W * 0.36, L * 0.07, W * 0.28, 1.5);
  }
  if (livery === 'police') {
    g.fillStyle(0xffffff, 1);
    g.fillRect(x + L * 0.3, y + 1.5, L * 0.36, W * 0.16);
    g.fillRect(x + L * 0.3, y + W - 1.5 - W * 0.16, L * 0.36, W * 0.16);
  }

  // Headlights / tail lights.
  g.fillStyle(0xfff6d0, 1);
  g.fillRoundedRect(x + L - 5, y + 3, 4, W * 0.22, 1.5);
  g.fillRoundedRect(x + L - 5, y + W - 3 - W * 0.22, 4, W * 0.22, 1.5);
  g.fillStyle(0xb3262b, 1);
  g.fillRect(x + 1, y + 3, 3, W * 0.2);
  g.fillRect(x + 1, y + W - 3 - W * 0.2, 3, W * 0.2);

  // Mirrors.
  g.fillStyle(dark, 1);
  g.fillRect(c1 - L * 0.1, y - 0.5, 4, 2.5);
  g.fillRect(c1 - L * 0.1, y + W - 2, 4, 2.5);
}
