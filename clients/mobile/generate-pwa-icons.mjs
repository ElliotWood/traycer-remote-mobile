#!/usr/bin/env node
/**
 * Sprint 5 (B): generates the PWA manifest's 192×192 and 512×512 icons as
 * real, valid PNGs — a solid `colors.accent` (`#4a9eff`) square placeholder.
 * No image-processing dependency: PNG is a simple enough format (signature +
 * length-prefixed chunks + a zlib-deflated scanline stream) to hand-encode
 * with Node's built-in `zlib`. Visual polish is not this sprint's job;
 * installability (a real, decodable PNG at the required sizes) is.
 *
 * Run: `node generate-pwa-icons.mjs` (writes into `public/icons/`). Re-run
 * whenever the accent color changes; the output is committed, not generated
 * at build time, so `vite build` never depends on this script.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ACCENT_RGB = [0x4a, 0x9e, 0xff]; // views/ui.ts `colors.accent`

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Standard CRC-32 (ISO 3309 / ITU-T V.42), table-based — the PNG spec's
// checksum for every chunk's (type + data).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Encodes a solid-color `size`×`size` truecolor (no alpha) PNG. */
function solidColorPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: truecolor (RGB)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Each scanline: a filter-type byte (0 = none) + size*3 RGB bytes.
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x += 1) {
    row.writeUInt8(r, 1 + x * 3);
    row.writeUInt8(g, 1 + x * 3 + 1);
    row.writeUInt8(b, 1 + x * 3 + 2);
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = deflateSync(raw);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Structural decode check (round-trip verified, not just "bytes were
 * written") — a zlib/CRC mistake here would otherwise silently ship a broken
 * icon that fails PWA installability without any build-time signal.
 */
function assertDecodable(png, expectedSize) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("generated PNG is missing the signature");
  }
  let offset = 8;
  let sawIHDR = false;
  let sawIEND = false;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = png.subarray(dataStart, dataEnd);
    const storedCrc = png.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
    if (storedCrc !== actualCrc) {
      throw new Error(`CRC mismatch in chunk ${type}`);
    }
    if (type === "IHDR") {
      sawIHDR = true;
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      if (width !== expectedSize || height !== expectedSize) {
        throw new Error(`IHDR size mismatch: got ${width}x${height}`);
      }
    }
    if (type === "IEND") {
      sawIEND = true;
    }
    offset = dataEnd + 4;
  }
  if (!sawIHDR || !sawIEND) {
    throw new Error("generated PNG is missing IHDR or IEND");
  }
}

export { crc32, solidColorPng, assertDecodable, ACCENT_RGB };

// Only run the generation side-effect when executed directly (`node
// generate-pwa-icons.mjs`), not when imported by a test for its pure helpers.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "public", "icons");
  mkdirSync(outDir, { recursive: true });

  for (const size of [192, 512]) {
    const png = solidColorPng(size, ACCENT_RGB);
    assertDecodable(png, size);
    const path = join(outDir, `icon-${size}.png`);
    writeFileSync(path, png);
    console.log(`wrote ${path} (${png.length} bytes, verified decodable)`);
  }
}
