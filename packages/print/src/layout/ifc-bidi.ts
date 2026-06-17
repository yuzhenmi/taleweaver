// Per-paragraph bidi resolution helper for the IFC.
//
// UAX #9 bidi is inherently per-PARAGRAPH: a run's resolved embedding level
// depends on the surrounding text, so the engine must run on the FULL paragraph
// source (assembled by the IFC in logical order), then callers query "what
// level is the character at UTF-16 offset N".
//
// The subtlety this module exists to solve: `resolveBidiLevels` indexes by
// CODEPOINT (1:1 with `[...source]`), but layout offsets (cluster start/end,
// token bases) are UTF-16 code-UNIT offsets. For astral characters (emoji,
// Plane-1 scripts) a UTF-16 offset is NOT equal to the codepoint index, so the
// query MUST convert via `cpIndexAtUtf16`, never assume 1:1.

import { resolveBidiLevels, type BaseDirection } from "@taleweaver/core";

export interface ParagraphBidi {
  /** Per-codepoint embedding levels (from resolveBidiLevels). */
  readonly levels: Uint8Array;
  /** Per-codepoint ORIGINAL bidi class (for L1 in reorder, P4-C). */
  readonly types: Uint8Array;
  readonly paragraphLevel: number;
  /**
   * Internal: UTF-16 offset → codepoint index. Length is `source.length + 1`
   * (the final entry is the end sentinel = total codepoint count). A UTF-16
   * offset landing on an astral char's low surrogate clamps to that codepoint's
   * start index. Use {@link bidiLevelAtSourceOffset}, not this directly.
   */
  readonly cpIndexAtUtf16: Int32Array;
}

export function resolveParagraphBidi(
  source: string,
  base: BaseDirection,
): ParagraphBidi {
  const { levels, types, paragraphLevel } = resolveBidiLevels(source, base);

  // Walk by codepoint in lockstep with UTF-16 offsets, recording the codepoint
  // index that owns each UTF-16 offset.
  const cpIndexAtUtf16 = new Int32Array(source.length + 1);
  let cp = 0;
  let u = 0;
  for (const ch of source) {
    const codePoint = ch.codePointAt(0);
    cpIndexAtUtf16[u] = cp;
    if (codePoint !== undefined && codePoint > 0xffff) {
      // Astral codepoint occupies two UTF-16 units; the low surrogate offset
      // clamps to this codepoint's start index.
      cpIndexAtUtf16[u + 1] = cp;
      u += 2;
    } else {
      u += 1;
    }
    cp += 1;
  }
  // End sentinel: total codepoint count.
  cpIndexAtUtf16[source.length] = cp;

  return { levels, types, paragraphLevel, cpIndexAtUtf16 };
}

export function bidiLevelAtSourceOffset(
  pb: ParagraphBidi,
  utf16Offset: number,
): number {
  const maxIndex = pb.cpIndexAtUtf16.length - 1;
  const clamped = utf16Offset < 0 ? 0 : utf16Offset > maxIndex ? maxIndex : utf16Offset;
  // `clamped` is constrained to `[0, maxIndex]` = a valid index of the
  // (always-nonempty, end-sentinel-terminated) `cpIndexAtUtf16` array, so the
  // read is always present; the throw is an unreachable invariant guard.
  const cpIndex = pb.cpIndexAtUtf16[clamped];
  if (cpIndex === undefined) {
    throw new Error(`ifc-bidi: cpIndexAtUtf16[${clamped}] missing (unreachable)`);
  }
  // The end sentinel (or empty source) points past the last level — no
  // character there, so report the paragraph level.
  if (cpIndex >= pb.levels.length) {
    return pb.paragraphLevel;
  }
  const level = pb.levels[cpIndex];
  if (level === undefined) {
    throw new Error(`ifc-bidi: levels[${cpIndex}] missing (unreachable)`);
  }
  return level;
}
