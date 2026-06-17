import { CC } from "./bidi";

/**
 * UAX #9 rules L1 and L2 — produce the visual-order permutation for a single
 * laid-out line.
 *
 * Operates on the line slice `[lineStart, lineEnd)` of the paragraph-wide
 * `levels` / `types` arrays returned by {@link resolveBidiLevels}. The returned
 * permutation lists positions in left-to-right VISUAL order, given as indices
 * **relative to `lineStart`** — i.e. values in `[0, lineEnd - lineStart)`. A
 * caller that wants paragraph-absolute indices adds `lineStart` to each entry.
 * (The conformance harness calls this with `lineStart = 0`, where relative ==
 * absolute.)
 *
 * L1 (resetting levels to the paragraph level). Per UAX #9 L1, "The types of
 * characters used here are the ORIGINAL types, not those modified by previous
 * phases" — which is exactly why {@link BidiResult.types} carries the original
 * bidi-class codes. On each line, reset to `paragraphLevel` the embedding level
 * of:
 *   i.   every character whose original type is `S` (segment separator),
 *   ii.  every character whose original type is `B` (paragraph separator),
 *   iii. any sequence of whitespace (`WS`) and/or isolate-formatting characters
 *        (`LRI`/`RLI`/`FSI`/`PDI`) preceding an `S` or `B`, and
 *   iv.  any sequence of `WS` and/or isolate-formatting characters at the end of
 *        the line.
 * L1 reads the original types but only ever WRITES levels (into a private copy),
 * so it never disturbs the shared `levels` array.
 *
 * L2 (reordering resolved levels). From the highest level found on the line down
 * to the lowest ODD level, reverse any contiguous run of characters at or above
 * that level. This is applied to the post-L1 levels.
 *
 * Retained BN / explicit-format positions (LRE/RLE/LRO/RLO/PDF and BN) carry
 * levels from the X pass and participate here like any other position; the
 * conformance oracle filters them out downstream via its removed-mask. They are
 * intentionally NOT special-cased here.
 *
 * @param levels         per-codepoint resolved embedding levels (paragraph-wide)
 * @param types          per-codepoint ORIGINAL bidi-class codes (paragraph-wide)
 * @param paragraphLevel the paragraph (base) embedding level
 * @param lineStart      inclusive start index of the line slice
 * @param lineEnd        exclusive end index of the line slice
 * @returns visual-order permutation, indices relative to `lineStart`
 */
export function reorderVisual(
  levels: Uint8Array,
  types: Uint8Array,
  paragraphLevel: number,
  lineStart: number,
  lineEnd: number,
): number[] {
  const n = lineEnd - lineStart;
  if (n <= 0) return [];

  // L1 → post-L1 line levels (lineStart-relative private copy).
  const lineLevels = applyL1(levels, types, paragraphLevel, lineStart, lineEnd);

  // L2 over the per-codepoint post-L1 levels. Each codepoint is its own
  // single-position "run"; reordering those runs by their levels yields the
  // per-codepoint visual permutation, indices relative to `lineStart`.
  return reorderRunsByLevel(Array.from(lineLevels));
}

/**
 * UAX #9 rule L1 — reset to `paragraphLevel` the embedding levels of segment
 * separators (`S`), paragraph separators (`B`), and runs of whitespace /
 * isolate-format characters that precede an `S`/`B` or end the line.
 *
 * Operates on the line slice `[lineStart, lineEnd)` of the paragraph-wide
 * `levels` / `types` arrays. Returns a NEW `Uint8Array` of length
 * `lineEnd - lineStart` holding the post-L1 levels, indexed RELATIVE to
 * `lineStart` (so `result[0]` is the level of codepoint `lineStart`). The
 * shared `levels` array is never mutated.
 *
 * Per UAX #9 L1, the character TYPES consulted here are the ORIGINAL bidi
 * classes (read from `types[lineStart + i]`), not those modified by earlier
 * phases — which is why {@link BidiResult.types} carries the original codes.
 *
 * @param levels         per-codepoint resolved embedding levels (paragraph-wide)
 * @param types          per-codepoint ORIGINAL bidi-class codes (paragraph-wide)
 * @param paragraphLevel the paragraph (base) embedding level
 * @param lineStart      inclusive start index of the line slice
 * @param lineEnd        exclusive end index of the line slice
 * @returns post-L1 levels for the slice, indices relative to `lineStart`
 */
export function applyL1(
  levels: Uint8Array,
  types: Uint8Array,
  paragraphLevel: number,
  lineStart: number,
  lineEnd: number,
): Uint8Array {
  const n = lineEnd - lineStart;
  if (n <= 0) return new Uint8Array(0);

  // Private mutable copy of the slice's levels — L1 must not touch `levels`.
  const lineLevels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const lvl = levels[lineStart + i];
    if (lvl === undefined) {
      throw new Error(`applyL1: levels[${lineStart + i}] missing (unreachable)`);
    }
    lineLevels[i] = lvl;
  }

  const isResetWhitespace = (code: number): boolean =>
    code === CC.WS ||
    code === CC.LRI ||
    code === CC.RLI ||
    code === CC.FSI ||
    code === CC.PDI;

  // i + ii: every S and every B resets to the paragraph level.
  // iii: a run of WS/isolate-format chars immediately preceding an S or B.
  // iv: a run of WS/isolate-format chars at the end of the line.
  // A single backward scan handles all four: track whether we are in a tail of
  // resettable whitespace that is anchored by end-of-line (iv) or by a following
  // S/B (iii); reset that tail, and reset S/B themselves (i/ii). Any non-S/B,
  // non-resettable character breaks the run.
  let inResetRun = true; // start true → handles the end-of-line tail (rule iv)
  for (let i = n - 1; i >= 0; i--) {
    const code = types[lineStart + i];
    if (code === undefined) {
      throw new Error(`applyL1: types[${lineStart + i}] missing (unreachable)`);
    }
    if (code === CC.S || code === CC.B) {
      lineLevels[i] = paragraphLevel;
      // Whitespace preceding this S/B is resettable (rule iii).
      inResetRun = true;
    } else if (inResetRun && isResetWhitespace(code)) {
      lineLevels[i] = paragraphLevel;
    } else {
      inResetRun = false;
    }
  }

  return lineLevels;
}

/**
 * UAX #9 rule L2 — generalized to an arbitrary array of per-RUN embedding
 * levels. From the highest level present down to the lowest ODD level, reverse
 * each maximal contiguous span of runs whose level is `>= level`.
 *
 * Returns the visual-order permutation of run indices: `perm[k]` is the index
 * (into `runLevels`) of the run that appears in visual position `k`. If no odd
 * level is present, the permutation is the identity.
 *
 * This is the same reversal {@link reorderVisual} applies to its per-codepoint
 * order array — each codepoint being a single-position run — lifted to operate
 * on any caller-supplied level array (e.g. one level per visual run).
 *
 * @param runLevels per-run embedding levels in logical order
 * @returns visual-order permutation of run indices `[0, runLevels.length)`
 */
export function reorderRunsByLevel(runLevels: readonly number[]): number[] {
  const n = runLevels.length;

  let maxLevel = 0;
  let minOdd = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < n; i++) {
    const lvl = runLevels[i];
    if (lvl === undefined) {
      throw new Error(`reorderRunsByLevel: runLevels[${i}] missing (unreachable)`);
    }
    if (lvl > maxLevel) maxLevel = lvl;
    if (lvl % 2 === 1 && lvl < minOdd) minOdd = lvl;
  }

  const perm: number[] = new Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;

  // No odd level → nothing to reverse (everything is left-to-right).
  if (minOdd === Number.MAX_SAFE_INTEGER) return perm;

  for (let level = maxLevel; level >= minOdd; level--) {
    let i = 0;
    while (i < n) {
      const lvlI = runLevels[i];
      if (lvlI === undefined) {
        throw new Error(`reorderRunsByLevel: runLevels[${i}] missing (unreachable)`);
      }
      if (lvlI < level) {
        i++;
        continue;
      }
      // [start, i) is a maximal run with level >= `level`.
      const start = i;
      let lvlNext = runLevels[i];
      while (i < n && lvlNext !== undefined && lvlNext >= level) {
        i++;
        lvlNext = runLevels[i];
      }
      // Reverse perm[start, i) in place.
      let lo = start;
      let hi = i - 1;
      while (lo < hi) {
        const tmpLo = perm[lo];
        const tmpHi = perm[hi];
        if (tmpLo === undefined || tmpHi === undefined) {
          throw new Error(`reorderRunsByLevel: perm swap index out of range (unreachable)`);
        }
        perm[lo] = tmpHi;
        perm[hi] = tmpLo;
        lo++;
        hi--;
      }
    }
  }

  return perm;
}
