/** Type declarations for the plain-JS icon generator, for the test that imports its pure helpers. */
export declare const ACCENT_RGB: readonly [number, number, number];
export declare function crc32(buf: Buffer): number;
export declare function solidColorPng(
  size: number,
  rgb: readonly [number, number, number],
): Buffer;
export declare function assertDecodable(png: Buffer, expectedSize: number): void;
