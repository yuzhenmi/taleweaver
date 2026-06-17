/**
 * Shared DEFLATE tables (RFC 1951): the canonical-Huffman code builder (§3.2.2),
 * the fixed-Huffman code-length assignments (§3.2.6), and the length/distance
 * base+extra-bit tables (§3.2.5). Used by both `deflate` (encode) and `inflate`
 * (decode), so the same spec data has exactly one source of truth.
 */

/**
 * Assign canonical Huffman codes from a per-symbol bit-length array (RFC 1951
 * §3.2.2). A symbol with length 0 is absent (code 0, never emitted). Returns one
 * code per symbol (the integer value of the code's bits, MSB-first).
 */
export function buildCanonicalCodes(lengths: readonly number[]): number[] {
  let maxLen = 0;
  for (const l of lengths) if (l > maxLen) maxLen = l;
  // 1. Count codes of each length.
  const blCount = new Array<number>(maxLen + 1).fill(0);
  for (const l of lengths) if (l > 0) blCount[l] = (blCount[l] ?? 0) + 1;
  // 2. Find the numerical value of the smallest code for each length.
  const nextCode = new Array<number>(maxLen + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + (blCount[bits - 1] ?? 0)) << 1;
    nextCode[bits] = code;
  }
  // 3. Assign each symbol the next code of its length.
  const codes = new Array<number>(lengths.length).fill(0);
  for (let n = 0; n < lengths.length; n++) {
    const len = lengths[n] ?? 0;
    if (len > 0) {
      codes[n] = nextCode[len] ?? 0;
      nextCode[len] = (nextCode[len] ?? 0) + 1;
    }
  }
  return codes;
}

/** Fixed literal/length code lengths (RFC 1951 §3.2.6), 288 entries. */
export const FIXED_LITLEN_LENGTHS: readonly number[] = (() => {
  const l = new Array<number>(288);
  for (let i = 0; i < 288; i++) {
    l[i] = i <= 143 ? 8 : i <= 255 ? 9 : i <= 279 ? 7 : 8;
  }
  return l;
})();

/** Fixed distance code lengths (RFC 1951 §3.2.6): 30 codes, all 5 bits. */
export const FIXED_DIST_LENGTHS: readonly number[] = new Array<number>(30).fill(5);

/** Length codes 257..285 → base length (RFC 1951 §3.2.5). Index 0 = code 257. */
export const LENGTH_BASE: readonly number[] = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
export const LENGTH_EXTRA: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

/** Distance codes 0..29 → base distance (RFC 1951 §3.2.5). */
export const DIST_BASE: readonly number[] = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
export const DIST_EXTRA: readonly number[] = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
