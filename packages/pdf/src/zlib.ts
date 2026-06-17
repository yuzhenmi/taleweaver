/**
 * The zlib container (RFC 1950) for PDF FlateDecode: `adler32` (the RFC 1950
 * §9 checksum), `zlibCompress` (2-byte header + DEFLATE body + big-endian
 * Adler-32 trailer), and `zlibDecompress` (header validation + inflate +
 * Adler-32 verification).
 */

import { deflate } from "./deflate";
import { inflate } from "./inflate";

const ADLER_MOD = 65521; // largest prime < 2^16

/** Adler-32 (RFC 1950 §9) over `data`, returned as a uint32. */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  // Process in chunks so a+=byte accumulations stay well within 2^32 before the
  // modulo (5552 is the largest n with 255*n*(n+1)/2 + (n+1)*(2^16-1) < 2^32).
  const CHUNK = 5552;
  let i = 0;
  while (i < data.length) {
    const end = Math.min(i + CHUNK, data.length);
    for (; i < end; i++) {
      a += data[i] ?? 0; // i < data.length, so in-bounds; ?? 0 satisfies the checker
      b += a;
    }
    a %= ADLER_MOD;
    b %= ADLER_MOD;
  }
  return (((b % ADLER_MOD) << 16) | (a % ADLER_MOD)) >>> 0;
}

/**
 * Wrap a raw DEFLATE stream in the zlib container (RFC 1950 / PDF FlateDecode):
 * the 2-byte header [0x78, 0x9C] (CINFO=7 → 32K window, CM=8 → deflate,
 * FLEVEL=2, FCHECK valid since (0x78*256+0x9C) % 31 == 0), the DEFLATE data,
 * and the 4-byte big-endian Adler-32 of the UNCOMPRESSED data.
 */
export function zlibCompress(data: Uint8Array): Uint8Array {
  const body = deflate(data);
  const sum = adler32(data);
  const out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(body, 2);
  const t = 2 + body.length;
  out[t] = (sum >>> 24) & 0xff;
  out[t + 1] = (sum >>> 16) & 0xff;
  out[t + 2] = (sum >>> 8) & 0xff;
  out[t + 3] = sum & 0xff;
  return out;
}

/** Validate the zlib header, inflate, and verify the trailing Adler-32. */
export function zlibDecompress(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new Error("zlib: stream too short for header + checksum");
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  if ((cmf & 0x0f) !== 8) throw new Error("zlib: unsupported compression method (CM != 8)");
  if ((flg & 0x20) !== 0) throw new Error("zlib: preset dictionary (FDICT) unsupported");
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error("zlib: bad header check (FCHECK)");
  const body = data.subarray(2, data.length - 4);
  const result = inflate(body);
  const t = data.length - 4;
  const expected =
    (((data[t] ?? 0) << 24) | ((data[t + 1] ?? 0) << 16) | ((data[t + 2] ?? 0) << 8) | (data[t + 3] ?? 0)) >>> 0;
  if (adler32(result) !== expected) throw new Error("zlib: Adler-32 checksum mismatch (corrupt stream)");
  return result;
}
