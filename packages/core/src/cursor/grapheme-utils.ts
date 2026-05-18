/**
 * Grapheme cluster + UAX #29 word-boundary helpers, shared between the
 * legacy and new cursor-ops modules during the P9–P15 parallel window.
 * Survives the cutover.
 *
 * All functions are pure: input is a string + offset, output is a
 * boundary offset. Offsets count UTF-16 code units (matching String.length
 * / String.charAt indexing).
 */

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
const wordSegmenter = new Intl.Segmenter(undefined, {
  granularity: "word",
});

/** Find the next grapheme cluster boundary after `offset` in `text`. */
export function nextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const seg of graphemeSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (end > offset) return end;
  }
  return text.length;
}

/** Find the previous grapheme cluster boundary before `offset` in `text`. */
export function prevGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastStart = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index >= offset) return lastStart;
    lastStart = seg.index;
  }
  return lastStart;
}

/**
 * Find the next word boundary after `offset` in `text`. Always lands at
 * the END of a word, skipping any whitespace/punctuation between.
 */
export function nextWordBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.isWordLike && end > offset) {
      return end;
    }
  }
  return text.length;
}

/**
 * Iterate UAX #29 word segments of `text`, exposing each segment's
 * boundaries and whether it's a word-like token (vs whitespace/punct).
 * Wraps `Intl.Segmenter` so cursor-ops doesn't reach for the segmenter
 * directly. Used by `selectWord`.
 */
export function* iterateWordSegments(
  text: string,
): Iterable<{ start: number; end: number; isWordLike: boolean }> {
  for (const seg of wordSegmenter.segment(text)) {
    yield {
      start: seg.index,
      end: seg.index + seg.segment.length,
      isWordLike: seg.isWordLike ?? false,
    };
  }
}

/** Find the previous word boundary before `offset` in `text`. */
export function prevWordBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let lastWordStart = 0;
  let foundWord = false;
  for (const seg of wordSegmenter.segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.isWordLike) {
      if (end >= offset) {
        if (seg.index < offset && seg.index > 0) {
          return seg.index;
        }
        if (seg.index >= offset) {
          return foundWord ? lastWordStart : 0;
        }
      }
      lastWordStart = seg.index;
      foundWord = true;
    }
  }
  return foundWord ? lastWordStart : 0;
}
