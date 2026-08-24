// Generates the two PNG icons a Teams app package requires, with no image
// dependency: `color.png` (192x192, full-bleed) and `outline.png` (32x32,
// transparent with a white glyph). Written by hand because adding an image
// library for two solid-colour placeholders would be absurd, and because the
// package cannot be zipped without them.
//
// Run: node make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** `pixel(x, y)` returns [r, g, b, a]; colourType 6 = RGBA. */
function png(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const here = new URL(".", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

// color.png — 192x192, full-bleed. Teal, with a lighter inset square so it
// reads as an intentional mark rather than a blank tile at small sizes.
const TEAL = [20, 138, 122];
const LIGHT = [214, 245, 240];
writeFileSync(
  join(here, "color.png"),
  png(192, 192, (x, y) => {
    const inset = x >= 56 && x < 136 && y >= 56 && y < 136;
    const bar = x >= 56 && x < 136 && y >= 84 && y < 108;
    if (bar) return [...TEAL, 255];
    if (inset) return [...LIGHT, 255];
    return [...TEAL, 255];
  }),
);

// outline.png — 32x32, MUST be transparent with a white glyph. Teams renders
// this monochrome in the activity rail; a solid square would look wrong.
writeFileSync(
  join(here, "outline.png"),
  png(32, 32, (x, y) => {
    const onBorder =
      (x >= 4 && x < 28 && (y === 4 || y === 27)) ||
      (y >= 4 && y < 28 && (x === 4 || x === 27));
    const onBar = x >= 10 && x < 22 && y >= 14 && y < 18;
    return onBorder || onBar ? [255, 255, 255, 255] : [0, 0, 0, 0];
  }),
);

console.log("wrote color.png (192x192) and outline.png (32x32)");
