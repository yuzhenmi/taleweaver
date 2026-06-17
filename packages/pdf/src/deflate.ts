/**
 * DEFLATE encoder (RFC 1951). v1: an LZ77 hash-chain greedy match finder (32 KB
 * window, min match 3, max 258, capped chain length) emitting fixed-Huffman
 * (BTYPE=01) symbols, with a whole-input stored (BTYPE=00) fallback when the
 * fixed-Huffman encoding would not be smaller. Dynamic-Huffman encode (better
 * ratio) and lazy matching are separable refinements (deferred).
 */

import { BitWriter } from "./bit-io";
import {
  buildCanonicalCodes,
  FIXED_LITLEN_LENGTHS,
  FIXED_DIST_LENGTHS,
  LENGTH_BASE,
  LENGTH_EXTRA,
  DIST_BASE,
  DIST_EXTRA,
} from "./flate-tables";

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const WINDOW = 32768; // max back-reference distance
const MAX_CHAIN = 128; // bounded hash-chain walk (speed vs ratio; internal tunable)
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;

const FIXED_LITLEN_CODES = buildCanonicalCodes(FIXED_LITLEN_LENGTHS);
const FIXED_DIST_CODES = buildCanonicalCodes(FIXED_DIST_LENGTHS);

/** Map a match length (3..258) to its (codeIndex, extraBits, extraValue). */
function lengthCode(len: number): { index: number; extra: number; bits: number } {
  // Linear scan over the 29 length codes (small, constant); index = code - 257.
  let i = LENGTH_BASE.length - 1;
  while (i > 0 && (LENGTH_BASE[i] ?? 0) > len) i--;
  return { index: i, extra: len - (LENGTH_BASE[i] ?? 0), bits: LENGTH_EXTRA[i] ?? 0 };
}

/** Map a distance (1..32768) to its (codeIndex, extraBits, extraValue). */
function distCode(dist: number): { index: number; extra: number; bits: number } {
  let i = DIST_BASE.length - 1;
  while (i > 0 && (DIST_BASE[i] ?? 0) > dist) i--;
  return { index: i, extra: dist - (DIST_BASE[i] ?? 0), bits: DIST_EXTRA[i] ?? 0 };
}

function hash3(data: Uint8Array, i: number): number {
  const a = data[i] ?? 0;
  const b = data[i + 1] ?? 0;
  const c = data[i + 2] ?? 0;
  return ((a << 10) ^ (b << 5) ^ c) & (HASH_SIZE - 1);
}

/** Emit `data` as a single final stored block (BTYPE=00) — for incompressible input. */
function storedBlock(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL=1
  w.writeBits(0, 2); // BTYPE=00
  w.alignToByte();
  const len = data.length & 0xffff; // (callers pass < 65536; whole-input streams here are small)
  w.writeBytes(Uint8Array.of(len & 0xff, (len >> 8) & 0xff, (~len) & 0xff, ((~len) >> 8) & 0xff));
  w.writeBytes(data);
  return w.finish();
}

export function deflate(data: Uint8Array): Uint8Array {
  // Stored blocks cap a single LEN at 65535; for inputs larger than that, the
  // fixed-Huffman path handles arbitrary size (one block), so the stored
  // fallback below is only chosen for small incompressible inputs. (Large
  // incompressible inputs still round-trip via fixed-Huffman of literals; the
  // per-stream writer guard in T7 is the ultimate no-expansion backstop.)
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL=1 (single block)
  w.writeBits(1, 2); // BTYPE=01 (fixed Huffman)

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(data.length).fill(-1);

  const emitLiteral = (byte: number): void => {
    w.writeHuffman(FIXED_LITLEN_CODES[byte] ?? 0, FIXED_LITLEN_LENGTHS[byte] ?? 0);
  };
  const emitMatch = (len: number, dist: number): void => {
    const lc = lengthCode(len);
    const sym = 257 + lc.index;
    w.writeHuffman(FIXED_LITLEN_CODES[sym] ?? 0, FIXED_LITLEN_LENGTHS[sym] ?? 0);
    if (lc.bits > 0) w.writeBits(lc.extra, lc.bits);
    const dc = distCode(dist);
    w.writeHuffman(FIXED_DIST_CODES[dc.index] ?? 0, FIXED_DIST_LENGTHS[dc.index] ?? 0);
    if (dc.bits > 0) w.writeBits(dc.extra, dc.bits);
  };

  let i = 0;
  while (i < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= data.length) {
      const h = hash3(data, i);
      let cand = head[h] ?? -1;
      let chain = 0;
      const maxLen = Math.min(MAX_MATCH, data.length - i);
      while (cand >= 0 && chain < MAX_CHAIN) {
        if (i - cand <= WINDOW) {
          let l = 0;
          while (l < maxLen && (data[cand + l] ?? -1) === (data[i + l] ?? -2)) l++;
          if (l > bestLen) {
            bestLen = l;
            bestDist = i - cand;
            if (l >= maxLen) break;
          }
        }
        cand = prev[cand] ?? -1;
        chain++;
      }
      // Insert the current position into the hash chain.
      prev[i] = head[h] ?? -1;
      head[h] = i;
    }

    if (bestLen >= MIN_MATCH) {
      emitMatch(bestLen, bestDist);
      // Insert the covered positions into the hash chain (so later matches find them).
      const end = i + bestLen;
      for (let j = i + 1; j < end; j++) {
        if (j + MIN_MATCH <= data.length) {
          const hj = hash3(data, j);
          prev[j] = head[hj] ?? -1;
          head[hj] = j;
        }
      }
      i = end;
    } else {
      emitLiteral(data[i] ?? 0);
      i++;
    }
  }

  // End-of-block code 256.
  w.writeHuffman(FIXED_LITLEN_CODES[256] ?? 0, FIXED_LITLEN_LENGTHS[256] ?? 0);
  const fixed = w.finish();

  // No-expansion fallback for small incompressible input: if a stored block of
  // the whole input (only valid when it fits one 65535-byte LEN) is smaller,
  // use it. (For larger input, fixed-Huffman is returned; the writer guard is
  // the outer no-expansion backstop.)
  if (data.length <= 0xffff) {
    const stored = storedBlock(data);
    if (stored.length < fixed.length) return stored;
  }
  return fixed;
}
