/** Visual palette and typography. */
export const COLORS = {
  bg: 0x1b2130,
  bgDeep: 0x121722,
  panel: 0x252d40,
  panelLight: 0x303a52,
  panelStroke: 0x3d4866,
  text: 0xf4f6fb,
  textDim: 0x9aa4bf,
  accent: 0x4cc9f0,
  accentDark: 0x2a8fb0,
  good: 0x3ddc97,
  warn: 0xffc94a,
  bad: 0xff5a5f,
  star: 0xffd166,
  starOff: 0x3a4460,

  ground: 0x9cc58a,
  groundDark: 0x8ab678,
  sidewalk: 0xd8d3c5,
  curb: 0xbdb7a6,
  asphalt: 0x3e4452,
  asphaltLight: 0x474e5e,
  lane: 0xf1f1ea,
  center: 0xf4c542,
  stopLine: 0xffffff,
  shadow: 0x000000,

  lightRed: 0xff4d4f,
  lightYellow: 0xffc53d,
  lightGreen: 0x2ee59d,
  lightOff: 0x1a1f2b,
  lightHousing: 0x222733,
} as const;

export const CAR_COLORS = [0xef476f, 0x118ab2, 0xffd166, 0x06d6a0, 0xf78c6b, 0x8d6cf0, 0xf1f1f1, 0x3a86ff, 0xff9f1c];

export const FONT = {
  family: '"Segoe UI", "Helvetica Neue", Roboto, Arial, sans-serif',
  mono: '"SF Mono", "Consolas", "Roboto Mono", monospace',
} as const;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
