import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { InlineItem } from "./inline-content";
import { inlineContentLength } from "./inline-content";
import { builtinEmbedSerializer } from "./extract-text";
import { iterateLeafBlocksInDocumentOrder } from "./document-order";

/**
 * A single occurrence of the search query inside one block.
 *
 * `start`/`end` are POSITION offsets — they index the block exactly as a
 * `{ blockId, offset }` Position does, so a `TextMatch` can be turned into a
 * pair of `Position`s directly via `createPosition(blockId, start)` /
 * `createPosition(blockId, end)` and handed to `replaceRange` / selection /
 * highlight code without any remapping.
 *
 * This is NOT the same as an offset into the block's extracted text. An embed
 * contributes exactly ONE Position offset (see `inlineContentLength`, which
 * counts each embed as 1) but its EXTRACTED text length varies: a hard-break
 * serializes to "\n" (1 char), a tab to "\t" (1 char), but a zero-width
 * comment/suggestion/page-field marker serializes to "" (0 chars). Matching on
 * raw extracted text would therefore drift left by one Position for every
 * zero-width marker before the match (B1 / #463 — a data-loss bug, since a
 * left-shifted offset splices `replaceRange` at the wrong place). To stay exact,
 * the search walks the inline items building a VISIBLE haystack (markers emit no
 * char, so a query still matches transparently across an invisible marker —
 * Google-Docs parity) alongside a `posByIdx` map from each haystack index to its
 * Position offset. See {@link buildBlockHaystack}.
 */
export interface TextMatch {
  readonly blockId: BlockId;
  /** Position offset of the match start (inclusive). */
  readonly start: number;
  /** Position offset of the match end (exclusive). NOTE: across a zero-width
   * marker, `end - start` exceeds `query.length` by the marker count. */
  readonly end: number;
}

/**
 * Walk a block's inline items, building the VISIBLE search haystack and a
 * parallel `posByIdx` map of length `haystack.length`: `posByIdx[h]` is the
 * Position offset of haystack char `h`. A match at haystack `[idx, end)` maps to
 * the Position span `[posByIdx[idx], posByIdx[end - 1] + 1)` — start = the first
 * matched char's Position; end = the LAST matched char's Position + 1 (i.e. the
 * Position immediately AFTER the last matched char).
 *
 * Using `posByIdx[end - 1] + 1` rather than `posByIdx[end]` is load-bearing: if
 * the match is immediately followed by one or more zero-width markers (e.g. a
 * comment that wraps exactly the matched word, `[start]word[end]`),
 * `posByIdx[end]` would be the NEXT VISIBLE char's Position — past those markers
 * — and absorb them into the match span, so `replaceRange` would delete the
 * marker and corrupt the comment. "Last matched char + 1" stops exactly at the
 * content edge, leaving trailing markers intact.
 *
 * - A text item contributes each of its characters to the haystack, each mapped
 *   to a running Position offset incremented by 1 per code unit.
 * - An embed contributes its `builtinEmbedSerializer` string to the haystack
 *   (hard-break → "\n", tab → "\t", zero-width markers → ""), but ALWAYS
 *   advances the Position offset by exactly 1 (an embed is one cursor position).
 *   A zero-width embed therefore adds nothing to the haystack yet still consumes
 *   one Position offset — which is exactly why a separate `posByIdx` map is
 *   needed rather than treating the haystack index as the Position offset.
 */
function buildBlockHaystack(items: readonly InlineItem[]): {
  haystackOriginal: string;
  posByIdx: number[];
} {
  let pos = 0;
  let haystackOriginal = "";
  const posByIdx: number[] = [];
  for (const item of items) {
    if (item.kind === "text") {
      for (let i = 0; i < item.text.length; i++) {
        haystackOriginal += item.text[i];
        posByIdx.push(pos);
        pos += 1;
      }
    } else {
      const serialized = builtinEmbedSerializer(item);
      for (let i = 0; i < serialized.length; i++) {
        // A multi-char embed serialization would map every char to the embed's
        // single Position offset; the builtin serializer is 0- or 1-char, so in
        // practice this loops 0 or 1 time.
        haystackOriginal += serialized[i];
        posByIdx.push(pos);
      }
      pos += 1;
    }
  }
  return { haystackOriginal, posByIdx };
}

export interface FindMatchesOptions {
  /** Default false — case-insensitive search. */
  readonly caseSensitive?: boolean;
  /** Default false — when true, a match must be bounded by word boundaries. */
  readonly wholeWord?: boolean;
  /**
   * Restrict the search to these blocks, in the order given. Blocks without
   * inline content (containers / non-leaf blocks) are skipped silently.
   * Default: every main-tree leaf block, in document order.
   */
  readonly blockIds?: Iterable<BlockId>;
}

// ASCII word-character class. Full Unicode word-segmentation (UAX #29) is a
// later concern; for whole-word search this matches Google Docs' practical
// behavior on Latin text. `_` is treated as a word char (matches /\w/).
const WORD_CHAR = /[A-Za-z0-9_]/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * Find all non-overlapping occurrences of `query` across the target blocks of
 * `state`, returned in the iteration order of those blocks.
 *
 * Read-only query over state — the forkless foundation of Find & Replace.
 * Searches the MAIN document tree only (embedContents / templateContents —
 * footnote and header/footer bodies — are a deferred scope decision).
 *
 * - `query === ""` → `[]`. A whitespace query (e.g. `" "`) IS a valid search;
 *   only the empty string is excluded.
 * - Case-insensitive by default (`caseSensitive: true` → exact).
 * - `wholeWord: true` → a match counts only when the char before `start` and
 *   the char at `end` are word boundaries (a non-word char, or a string edge).
 * - Non-overlapping: after a match at `i`, the scan continues from
 *   `i + query.length`, so "aa" in "aaa" yields ONE match.
 */
export function findMatches(
  state: State,
  query: string,
  options?: FindMatchesOptions,
): TextMatch[] {
  if (query === "") return [];

  const caseSensitive = options?.caseSensitive ?? false;
  const wholeWord = options?.wholeWord ?? false;

  // Case-folding strategy: when case-insensitive, compare on lowercased copies
  // of both haystack and needle but emit offsets into the ORIGINAL haystack.
  // `String.prototype.toLowerCase` is length-preserving for the scripts we
  // target (ASCII/BMP), so an index into the lowercased string is also a valid
  // index into the original. KNOWN LIMITATION: a few Unicode code points are
  // not length-preserving under case folding (e.g. U+0130 LATIN CAPITAL LETTER
  // I WITH DOT ABOVE → "i̇"); on such input the emitted offsets could drift.
  // Full case-folding-aware search is a later concern.
  const needle = caseSensitive ? query : query.toLowerCase();
  const queryLen = query.length;

  const matches: TextMatch[] = [];

  for (const blockId of iterateTargetBlocks(state, options?.blockIds)) {
    const block = getBlock(state, blockId);
    // Only leaf blocks carry searchable inline content.
    if (!block || block.inlineContent === null) continue;

    const length = inlineContentLength(block.inlineContent);
    if (length < queryLen) continue;

    // Build the search haystack AND a haystack-index → Position-offset map. The
    // haystack is the VISIBLE text (a zero-width comment/suggestion marker emits
    // NO char, so a query still matches ACROSS an invisible marker — Google-Docs
    // parity), while `posByIdx[h]` is the Position offset of haystack char `h`.
    // Every embed occupies exactly ONE Position offset (`inlineContentLength`
    // counts it as 1) regardless of its serialized length, so a match after a
    // zero-width marker maps to the correct Position — NOT the marker-collapsed
    // haystack index (B1: the builtin serializer is length-0 for those markers, so
    // raw haystack indices are NOT Position offsets).
    const { haystackOriginal, posByIdx } = buildBlockHaystack(block.inlineContent.items);
    const haystack = caseSensitive ? haystackOriginal : haystackOriginal.toLowerCase();

    let from = 0;
    while (from <= haystack.length - queryLen) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + queryLen;
      if (!wholeWord || isWholeWordMatch(haystackOriginal, idx, end)) {
        // Position span = first matched char's Position .. last matched char's
        // Position + 1. The `end - 1 + 1` form (NOT `posByIdx[end]`) stops at the
        // content edge so trailing zero-width markers stay outside the match.
        const startPos = posByIdx[idx];
        const lastCharPos = posByIdx[end - 1];
        if (startPos === undefined || lastCharPos === undefined) {
          // Unreachable: posByIdx is dense over [0, haystack.length) and the
          // match span [idx, end) lies within the haystack, so both indices
          // (idx and end - 1) are in bounds.
          throw new Error(
            `findMatches: posByIdx lookup out of range (idx=${idx}, end=${end}, len=${posByIdx.length})`,
          );
        }
        matches.push({
          blockId,
          start: startPos,
          end: lastCharPos + 1,
        });
      }
      // Non-overlapping: skip past the whole match. (When a whole-word check
      // rejects a candidate we still advance by the full match length — the
      // next non-overlapping occurrence can only start at or after `end`.)
      from = end;
    }
  }

  return matches;
}

/**
 * A match at [start, end) is a whole word iff the char immediately before
 * `start` and the char at `end` are both word boundaries (non-word char or a
 * string edge). Uses the ASCII {@link WORD_CHAR} definition.
 */
function isWholeWordMatch(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : undefined;
  const after = end < text.length ? text[end] : undefined;
  return !isWordChar(before) && !isWordChar(after);
}

/**
 * Yield the target blocks: the caller-supplied `blockIds` (in the given order)
 * when present, otherwise every main-tree leaf block in document order. Blocks
 * without inline content are NOT filtered here — `findMatches` skips them — so
 * an explicit `blockIds` list is honored verbatim.
 */
function* iterateTargetBlocks(
  state: State,
  blockIds: Iterable<BlockId> | undefined,
): Iterable<BlockId> {
  if (blockIds !== undefined) {
    yield* blockIds;
    return;
  }
  // Cycle-safe document-order leaf walk. The previous `firstLeafBlock` +
  // `while (cursor = nextBlockInDocOrder(...))` sweep was unbounded at the call
  // site and could spin forever on a malformed two-parents topology; routing
  // through `iterateLeafBlocksInDocumentOrder` inherits the recursive walker's
  // active-path cycle guard. `findMatches` only matches inline content, so
  // yielding leaves only is identical to the old leaf walk here.
  for (const block of iterateLeafBlocksInDocumentOrder(state)) {
    yield block.id;
  }
}
