// Generate the PWA PNG icons. Android will not offer "install to home screen"
// — and therefore will not show the Share Target — without PNGs in the
// manifest, so they are checked in rather than built on deploy.
//
//   node tools/make-icons.mjs
//
// The mark is the list itself: three ruled lines, the first one starred.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const INK = [0x14, 0x18, 0x1f];
const PAPER = [0xee, 0xf0, 0xf3];
const STAR = [0xb5, 0x61, 0x0b];

const BARS = [
  { x: 128, y: 150, w: 256, h: 26 },
  { x: 128, y: 243, w: 200, h: 26 },
  { x: 128, y: 336, w: 232, h: 26 },
];

/**
 * @param {number} size
 * @param {{rounded?: boolean, markScale?: number}} options
 *   markScale shrinks the mark inside a full-bleed background, which is what
 *   a maskable icon needs: the launcher may crop the corners to a circle.
 */
function draw(size, { rounded = true, markScale = 1 } = {}) {
  const pixels = new Uint8Array(size * size * 4);
  const radius = rounded ? 0.219 * size : 0;
  const mark = size * markScale;
  const offset = (size - mark) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, radius)) continue;

      let color = INK;
      // Design-space coordinates (the 512 grid the SVG uses).
      const dx = ((x + 0.5 - offset) / mark) * 512;
      const dy = ((y + 0.5 - offset) / mark) * 512;

      for (const bar of BARS) {
        if (inRoundedRect(dx, dy, bar.x, bar.y, bar.w, bar.h, bar.h / 2)) color = PAPER;
      }
      if ((dx - 96) ** 2 + (dy - 163) ** 2 <= 20 ** 2) color = STAR;

      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  if (r <= 0) return true;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2 + 1e-9;
}

function png(pixels, size) {
  // One filter byte (0 = none) per scanline, then deflate. No dependencies.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT, { recursive: true });

for (const [name, size, options] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // Maskable icons are cropped by the launcher: keep the mark inside the
  // safe area and let the background bleed to the edges.
  ['icon-maskable-512.png', 512, { rounded: false, markScale: 0.72 }],
]) {
  writeFileSync(join(OUT, name), png(draw(size, options), size));
  console.log(`icons/${name}`);
}
