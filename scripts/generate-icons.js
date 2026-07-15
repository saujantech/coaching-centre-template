// scripts/generate-icons.js
//
// Generates the PWA app icons (public/icons/icon-*.png) from
// centre.config.js: the centre name's first letter, centered in white
// on a solid brandColor square. No image libraries are used — this
// hand-rolls a valid PNG (zlib + a tiny built-in 5x7 bitmap font) so the
// template stays dependency-free.
//
// THIS IS A PLACEHOLDER, not a permanent design choice. Every new client
// cloned from this template starts with a letter-on-a-colour icon because
// they usually don't have real app-icon artwork yet. Once a client
// supplies a real logo, replace public/icons/icon-*.png directly with
// exported icons from that logo (192x192, 512x512, and 180x180 for
// apple-touch-icon) instead of re-running this script.
//
// Run after editing centre.config.js for a new client:
//   node scripts/generate-icons.js

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const centreConfig = require("../public/centre.config");

const SIZES = [192, 512, 180]; // 180 = apple-touch-icon's recommended size
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

// Classic blocky 5-wide x 7-tall dot-matrix font, just enough (A-Z) to
// render a single initial. Anything else (a digit, emoji, symbol) falls
// back to a blank tile — still a valid icon, just without a letter.
const FONT_5X7 = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) throw new Error(`Invalid brandColor hex: ${hex}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// CRC32, per the PNG spec (Appendix D) — used to checksum each chunk.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

// Builds a size x size RGB icon: brandColor background, the given letter
// (if we have a glyph for it) rendered in white, scaled up and centered.
function renderIconPng(size, letter, rgb) {
  const pixels = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = rgb[0];
    pixels[i * 3 + 1] = rgb[1];
    pixels[i * 3 + 2] = rgb[2];
  }

  const glyph = FONT_5X7[letter];
  if (glyph) {
    const cell = Math.floor(size / 9); // 5 cols + margin, 7 rows + margin
    const glyphWidth = cell * 5;
    const glyphHeight = cell * 7;
    const offsetX = Math.floor((size - glyphWidth) / 2);
    const offsetY = Math.floor((size - glyphHeight) / 2);

    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] !== "#") continue;
        for (let dy = 0; dy < cell; dy++) {
          const y = offsetY + row * cell + dy;
          if (y < 0 || y >= size) continue;
          for (let dx = 0; dx < cell; dx++) {
            const x = offsetX + col * cell + dx;
            if (x < 0 || x >= size) continue;
            const idx = (y * size + x) * 3;
            pixels[idx] = 255;
            pixels[idx + 1] = 255;
            pixels[idx + 2] = 255;
          }
        }
      }
    }
  }

  // Each scanline needs a leading filter-type byte (0 = none).
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function main() {
  const letter = (centreConfig.centreName || "").trim().charAt(0).toUpperCase();
  const rgb = hexToRgb(centreConfig.brandColor);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const png = renderIconPng(size, letter, rgb);
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`Wrote ${outPath} (${letter || "no letter glyph"}, ${centreConfig.brandColor})`);
  }
}

main();
