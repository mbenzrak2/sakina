// Renders icons/icon-192.png and icons/icon-512.png (same drawing as icons/icon.svg) with no dependencies.
// Usage: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG_IN = [0x17, 0x35, 0x2d], BG_OUT = [0x08, 0x10, 0x0e];
const GOLD_A = [0xef, 0xdc, 0xab], GOLD_B = [0xc9, 0xa5, 0x5c];

// coordinates in the 512 design space
function goldCoverage(x, y) {
  const dx = x - 256, dy = y - 256;
  // distance to the outline of an axis-aligned square (half side 110) and of the same square rotated 45°
  const sq = (px, py) => Math.abs(Math.max(Math.abs(px), Math.abs(py)) - 110);
  const r = Math.SQRT1_2;
  const d = Math.min(sq(dx, dy), sq((dx + dy) * r, (dy - dx) * r));
  return d <= 9 || Math.hypot(dx, dy) <= 34;
}
function render(size) {
  const SS = 4;
  const k = 512 / size;
  return png(size, (px, py) => {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) * k, y = (py + (sy + 0.5) / SS) * k;
      const bg = mix(BG_IN, BG_OUT, Math.min(1, Math.hypot(x - 256, y - 215) / 384));
      const c = goldCoverage(x, y) ? mix(GOLD_A, GOLD_B, Math.min(1, Math.max(0, (x + y - 290) / 440))) : bg;
      acc = acc.map((v, i) => v + c[i]);
    }
    return acc.map((v) => Math.round(v / (SS * SS)));
  });
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), render(size));
  console.log('wrote icon-' + size + '.png');
}
