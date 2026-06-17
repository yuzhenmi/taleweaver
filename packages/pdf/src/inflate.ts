/**
 * DEFLATE decoder (RFC 1951). Decodes stored (BTYPE=00), fixed-Huffman
 * (BTYPE=01), and dynamic-Huffman (BTYPE=10, RFC 1951 §3.2.7) blocks. (The
 * companion `deflate` encoder still emits fixed-Huffman only; dynamic decode
 * exists to read third-party streams, e.g. PNG IDAT and other FlateDecode
 * sources.) The reserved type (11), a bad stored NLEN, an out-of-range
 * back-reference distance, a malformed dynamic header, and truncation all
 * throw — never silent garbage.
 */

import { BitReader } from "./bit-io";
import {
  buildCanonicalCodes,
  FIXED_LITLEN_LENGTHS,
  FIXED_DIST_LENGTHS,
  LENGTH_BASE,
  LENGTH_EXTRA,
  DIST_BASE,
  DIST_EXTRA,
} from "./flate-tables";

/**
 * RFC 1951 §3.2.7 — the order in which the (up to 19) code-length code lengths
 * are written, so common ones (16/17/18 repeat, 0, 8, 7…) come first and absent
 * trailing ones can be omitted.
 */
const CL_ORDER: readonly number[] = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/** A symbol-decode table over canonical codes: walk bits MSB-first to a symbol. */
interface DecodeTable {
  readonly maxLen: number;
  /** Map of `(len << 16) | code` → symbol, for every assigned code. */
  readonly map: Map<number, number>;
}

function buildDecodeTable(lengths: readonly number[]): DecodeTable {
  const codes = buildCanonicalCodes(lengths);
  const map = new Map<number, number>();
  let maxLen = 0;
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym] ?? 0;
    if (len > 0) {
      map.set((len << 16) | (codes[sym] ?? 0), sym);
      if (len > maxLen) maxLen = len;
    }
  }
  return { maxLen, map };
}

/** Read one symbol: accumulate bits MSB-first until `(len<<16)|code` is known. */
function decodeSymbol(r: BitReader, table: DecodeTable): number {
  let code = 0;
  for (let len = 1; len <= table.maxLen; len++) {
    code = (code << 1) | r.readBit(); // Huffman codes arrive MSB-first
    const sym = table.map.get((len << 16) | code);
    if (sym !== undefined) return sym;
  }
  throw new Error("inflate: invalid Huffman code");
}

const FIXED_LITLEN_TABLE = buildDecodeTable(FIXED_LITLEN_LENGTHS);
const FIXED_DIST_TABLE = buildDecodeTable(FIXED_DIST_LENGTHS);

/**
 * Decode one Huffman-coded block body (fixed OR dynamic) into `out` until the
 * end-of-block symbol (256). Identical for both block types — only the two
 * decode tables differ. Back-references may overlap the output tail, so the
 * copy is byte-by-byte (RLE-correct).
 */
function decodeHuffmanBlock(
  r: BitReader,
  litlen: DecodeTable,
  dist: DecodeTable,
  out: number[],
): void {
  for (;;) {
    const sym = decodeSymbol(r, litlen);
    if (sym === 256) break; // end of block
    if (sym < 256) {
      out.push(sym); // literal byte
    } else {
      const li = sym - 257;
      if (li >= LENGTH_BASE.length) throw new Error("inflate: invalid length code");
      const length = (LENGTH_BASE[li] ?? 0) + r.readBits(LENGTH_EXTRA[li] ?? 0);
      const dsym = decodeSymbol(r, dist);
      if (dsym >= DIST_BASE.length) throw new Error("inflate: invalid distance code");
      const distance = (DIST_BASE[dsym] ?? 0) + r.readBits(DIST_EXTRA[dsym] ?? 0);
      if (distance > out.length) throw new Error("inflate: distance past start of output");
      const start = out.length - distance;
      for (let k = 0; k < length; k++) out.push(out[start + k] ?? 0);
    }
  }
}

/**
 * Read a dynamic-Huffman block header (RFC 1951 §3.2.7) and return the
 * literal/length + distance decode tables it encodes. Throws on a malformed
 * header (bad repeat code, repeat overrun, invalid code-length symbol) — never
 * silently produces a wrong table.
 */
function readDynamicTables(r: BitReader): { litlen: DecodeTable; dist: DecodeTable } {
  const hlit = r.readBits(5) + 257; // # literal/length codes (257..286)
  const hdist = r.readBits(5) + 1; // # distance codes (1..32)
  const hclen = r.readBits(4) + 4; // # code-length codes (4..19)

  // 1. The code-length code lengths, read in CL_ORDER (the rest stay 0).
  const clLengths = new Array<number>(19).fill(0);
  for (let i = 0; i < hclen; i++) {
    clLengths[CL_ORDER[i] ?? 0] = r.readBits(3);
  }
  const clTable = buildDecodeTable(clLengths);

  // 2. Decode HLIT + HDIST code lengths using the code-length table. Symbols
  //    0..15 are literal lengths; 16/17/18 are run-length repeat codes.
  const total = hlit + hdist;
  const lengths = new Array<number>(total).fill(0);
  let i = 0;
  while (i < total) {
    const sym = decodeSymbol(r, clTable);
    if (sym < 16) {
      lengths[i++] = sym;
    } else if (sym === 16) {
      // Repeat the PREVIOUS length 3..6 times.
      if (i === 0) {
        throw new Error("inflate: dynamic block repeat code 16 with no previous length");
      }
      const prev = lengths[i - 1] ?? 0;
      let n = r.readBits(2) + 3;
      while (n-- > 0) {
        if (i >= total) throw new Error("inflate: dynamic block code-length repeat overruns the table");
        lengths[i++] = prev;
      }
    } else if (sym === 17) {
      // Repeat ZERO 3..10 times.
      let n = r.readBits(3) + 3;
      while (n-- > 0) {
        if (i >= total) throw new Error("inflate: dynamic block code-length repeat overruns the table");
        lengths[i++] = 0;
      }
    } else if (sym === 18) {
      // Repeat ZERO 11..138 times.
      let n = r.readBits(7) + 11;
      while (n-- > 0) {
        if (i >= total) throw new Error("inflate: dynamic block code-length repeat overruns the table");
        lengths[i++] = 0;
      }
    } else {
      throw new Error("inflate: invalid code-length symbol");
    }
  }

  // 3. Split into literal/length + distance lengths and build the two tables.
  return {
    litlen: buildDecodeTable(lengths.slice(0, hlit)),
    dist: buildDecodeTable(lengths.slice(hlit, total)),
  };
}

export function inflate(data: Uint8Array): Uint8Array {
  const r = new BitReader(data);
  const out: number[] = [];

  for (;;) {
    const bfinal = r.readBit();
    const btype = r.readBits(2);

    if (btype === 0) {
      // Stored block: align, LEN (u16 LE), NLEN (= ~LEN), then LEN raw bytes.
      r.alignToByte();
      const lenBytes = r.takeBytes(4);
      const len = (lenBytes[0] ?? 0) | ((lenBytes[1] ?? 0) << 8);
      const nlen = (lenBytes[2] ?? 0) | ((lenBytes[3] ?? 0) << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error("inflate: stored block bad NLEN");
      for (const b of r.takeBytes(len)) out.push(b);
    } else if (btype === 1) {
      decodeHuffmanBlock(r, FIXED_LITLEN_TABLE, FIXED_DIST_TABLE, out);
    } else if (btype === 2) {
      const { litlen, dist } = readDynamicTables(r);
      decodeHuffmanBlock(r, litlen, dist, out);
    } else {
      throw new Error("inflate: reserved block type (BTYPE=11)");
    }

    if (bfinal === 1) break;
  }
  return Uint8Array.from(out);
}
