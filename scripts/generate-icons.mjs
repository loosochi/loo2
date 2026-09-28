// Generates the PWA PNG icons procedurally (no image tools needed): node scripts/generate-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const BG = hex(0x1b2130);
const HOUSING = hex(0x2c3345);
const LAMPS = [hex(0xff4d4f), hex(0xffc53d), hex(0x2ee59d)];

function roundRect(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** Colour of a point in unit coordinates (0..1) for the given safe-area padding. */
function shade(u, v, pad, rounded) {
  let c = null;
  if (!rounded || roundRect(u, v, 0, 0, 1, 1, 0.22)) c = BG;
  const s = 1 - pad * 2;
  const tx = (x) => pad + x * s;
  // Traffic light housing (vertical) with three lamps.
  if (roundRect(u, v, tx(0.33), tx(0.1), 0.34 * s, 0.8 * s, 0.12 * s)) c = HOUSING;
  LAMPS.forEach((col, i) => {
    const cy = tx(0.25 + i * 0.25);
    const d = Math.hypot(u - tx(0.5), v - cy);
    if (d <= 0.105 * s) c = col;
  });
  return c;
}

function png(size, pad, rounded) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, pad, rounded);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const cov = a / n / 255;
      raw[o] = cov ? Math.round(r / n / cov) : 0;
      raw[o + 1] = cov ? Math.round(g / n / cov) : 0;
      raw[o + 2] = cov ? Math.round(b / n / cov) : 0;
      raw[o + 3] = Math.round(a / n);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = 'public/icons';
writeFileSync(`${out}/icon-192.png`, png(192, 0.06, true));
writeFileSync(`${out}/icon-512.png`, png(512, 0.06, true));
// Maskable icons need the artwork inside the central safe zone and a full-bleed background.
writeFileSync(`${out}/maskable-512.png`, png(512, 0.16, false));
writeFileSync(`${out}/apple-touch-icon.png`, png(180, 0.1, false));
console.log('icons written to', out);
