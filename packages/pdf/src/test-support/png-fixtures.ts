/**
 * Build REAL minimal PNG files in-process for tests. The IDAT zlib stream is
 * produced by the IN-PACKAGE `zlibCompress` (valid fixed-Huffman zlib that
 * `zlibDecompress` reads back) — no Node `zlib` dependency. `crc32` lives HERE
 * (test-support), NOT in the decoder, which skips CRC verification by design.
 *
 * `scanlines` are the FILTERED scanlines exactly as a PNG encoder emits them:
 * `height` rows, each row = 1 filter-type byte (0..4) followed by `rowBytes`
 * filtered bytes. The builder zlib-wraps them into the IDAT chunk.
 */
import { zlibCompress } from "../zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** CRC-32 (ISO 3309 / PNG Annex D), table-free. Test-support only. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] ?? 0;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** One PNG chunk: length(u32) + type(4) + data + crc32(type+data)(u32). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const crc = crc32(concat([typeBytes, data]));
  return concat([u32be(data.length), typeBytes, data, u32be(crc)]);
}

export interface BuildPngParams {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  /** Filtered scanlines: height rows of (1 filter byte + rowBytes bytes). */
  readonly scanlines: Uint8Array;
  readonly palette?: Uint8Array; // PLTE bytes (RGB triplets)
  readonly trns?: Uint8Array;    // tRNS bytes
  readonly interlace?: number;       // default 0
  readonly compressionMethod?: number; // default 0
  readonly filterMethod?: number;    // default 0
  readonly splitIdatInto?: number;   // default 1 — emit the IDAT data across N consecutive IDAT chunks
}

/** Assemble a complete, valid PNG byte stream. */
export function buildPng(p: BuildPngParams): Uint8Array {
  const ihdr = concat([
    u32be(p.width),
    u32be(p.height),
    Uint8Array.of(
      p.bitDepth,
      p.colorType,
      p.compressionMethod ?? 0,
      p.filterMethod ?? 0,
      p.interlace ?? 0,
    ),
  ]);
  const parts: Uint8Array[] = [SIGNATURE, chunk("IHDR", ihdr)];
  if (p.palette !== undefined) parts.push(chunk("PLTE", p.palette));
  if (p.trns !== undefined) parts.push(chunk("tRNS", p.trns));
  // The full zlib stream is split across `splitIdatInto` consecutive IDAT chunks
  // (default 1) — PNG allows the IDAT data to be fragmented; the decoder must
  // concatenate them back into one stream.
  const idat = zlibCompress(p.scanlines);
  const n = Math.max(1, p.splitIdatInto ?? 1);
  const partLen = Math.ceil(idat.length / n);
  for (let i = 0; i < n; i++) {
    const slice = idat.subarray(i * partLen, Math.min((i + 1) * partLen, idat.length));
    parts.push(chunk("IDAT", slice));
  }
  parts.push(chunk("IEND", new Uint8Array(0)));
  return concat(parts);
}
