/**
 * S5 (B, F3): the hand-rolled PNG encoder must produce a genuinely decodable
 * file — a zlib/CRC mistake here would otherwise silently ship a broken icon
 * that fails PWA installability with no build-time signal. Exercises the
 * SAME structural decode check the generator script runs on itself, plus a
 * negative case proving the check actually catches corruption.
 */
import { describe, expect, it } from "vitest";
import {
  ACCENT_RGB,
  assertDecodable,
  solidColorPng,
} from "../../generate-pwa-icons.mjs";

describe("solidColorPng / assertDecodable", () => {
  it("produces a structurally valid, decodable PNG at 192 and 512", () => {
    for (const size of [192, 512]) {
      const png = solidColorPng(size, ACCENT_RGB);
      expect(() => assertDecodable(png, size)).not.toThrow();
      // PNG signature.
      expect(Array.from(png.subarray(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
    }
  });

  it("rejects a size mismatch (decoded IHDR must match the requested size)", () => {
    const png = solidColorPng(192, ACCENT_RGB);
    expect(() => assertDecodable(png, 512)).toThrow(/size mismatch/);
  });

  it("rejects a corrupted chunk (CRC check actually catches bit-flips)", () => {
    const png = solidColorPng(192, ACCENT_RGB);
    const corrupted = Buffer.from(png);
    // Flip a byte inside the IDAT chunk's data (well past the fixed header).
    corrupted[40] ^= 0xff;
    expect(() => assertDecodable(corrupted, 192)).toThrow(/CRC mismatch/);
  });
});
