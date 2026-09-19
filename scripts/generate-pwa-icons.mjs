// scripts/generate-pwa-icons.mjs
// Deterministic PWA icon generator — writes real 192/512 PNGs (solid brand
// base + simple "T" glyph) + SVG copies so public/manifest.json icon entries
// resolve. Uses only Node zlib (no deps). Safe: pure file out to public/icons/.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "icons");
mkdirSync(OUT_DIR, { recursive: true });

// Minimal PNG encoder (RGBA, 8-bit, non-interleaved) using zlib for IDAT.
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function png(size, bg, fg, glyph) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 4;
      // Safe-zone: keep glyph inside inner 80% region so maskable padding works.
      const relaxed =
        x >= size * 0.1 &&
        x < size * 0.9 &&
        y >= size * 0.1 &&
        y < size * 0.9 &&
        glyph(x - size * 0.5, y - size * 0.5);
      raw[o] = relaxed ? fg[0] : bg[0];
      raw[o + 1] = relaxed ? fg[1] : bg[1];
      raw[o + 2] = relaxed ? fg[2] : bg[2];
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Brand blue base, white glyph, blue accent.
const BRAND = [0x25, 0x63, 0xeb];
const WHITE = [0xff, 0xff, 0xff];
// "T" as two bars (vertical stem + horizontal cap).
function tGlyph(tx, ty, w, thinW, tallH) {
  return (x, y) => {
    // cap: horizontal bar across top
    const inCap = y >= -tallH * 0.45 && y <= -tallH * 0.45 + thinW && Math.abs(x) <= w / 2;
    // stem: vertical bar center
    const inStem = Math.abs(x) <= thinW / 2 && y >= -tallH * 0.45 && y <= tallH * 0.55;
    return inCap || inStem;
  };
}
// maskable = bigger safe zone, glyph centered smaller.
function maskableGlyph(tx, ty, w, thinW, tallH) {
  return (x, y) => {
    const inCap = y >= -tallH * 0.4 && y <= -tallH * 0.4 + thinW && Math.abs(x) <= w / 2;
    const inStem = Math.abs(x) <= thinW / 2 && y >= -tallH * 0.4 && y <= tallH * 0.6;
    return inCap || inStem;
  };
}

const CARDS = [
  { file: "icon-192.png", size: 192, glyph: tGlyph(96, 0, 92, 20, 176) },
  { file: "icon-512.png", size: 512, glyph: maskableGlyph(256, 0, 240, 56, 470) },
  { file: "icon-512-maskable.png", size: 512, glyph: maskableGlyph(256, 0, 240, 56, 470) },
];
for (const c of CARDS) {
  writeFileSync(join(OUT_DIR, c.file), png(c.size, BRAND, WHITE, c.glyph));
  console.log(`✔ ${c.file} (${c.size}x${c.size})`);
}

// SVG copies for non-maskable/any entries + favicon source.
const svg512 = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#2563eb"/><rect x="196" y="96" width="120" height="320" rx="16" fill="#ffffff"/><rect x="128" y="80" width="256" height="64" rx="18" fill="#ffffff"/></svg>`;
const svgMask = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#2563eb"/><rect x="218" y="140" width="88" height="232" rx="12" fill="#ffffff"/><rect x="166" y="128" width="180" height="48" rx="14" fill="#ffffff"/></svg>`;
writeFileSync(join(OUT_DIR, "icon.svg"), svg512);
writeFileSync(join(OUT_DIR, "icon-maskable.svg"), svgMask);
console.log("✔ icon.svg + icon-maskable.svg");
console.log("DONE — 5 icon assets written to public/icons/");
