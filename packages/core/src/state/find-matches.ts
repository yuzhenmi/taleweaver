import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import { createPosition, createSpan } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { extractText, builtinEmbedSerializer } from "./extract-text";
import { firstLeafBlock, nextBlockInDocOrder } from "./block-traversal";

/**
 * A single occurrence of the search query inside one block.
 *
 * `start`/`end` are offsets into the block's EXTRACTED TEXT
 * (see {@link extractText}). The extraction used here serializes each embed
 * to exactly one character (via {@link builtinEmbedSerializer} — hard-break →
 * "\n", tab → "\t", other embeds → U+FFFC), so every embed contributes a
 * length of 1 to the extracted text, identically to how it contributes a
 * length of 1 to the Position-model offset (see `inlineContentLength`, which
 * counts each embed as 1). Consequently these offsets correspond 1:1 to
 * `{ blockId, offset }` Position offsets: a `TextMatch` can be turned into a
 * pair of `Position`s directly via
 * `createPosition(blockId, start)` / `createPosition(blockId, end)`. (This 1:1
 * correspondence holds ONLY because the serializer is length-preserving; the
 * default `extractText` serializer is also 1-char-per-embed, so either would
 * preserve the mapping. We use the builtin one so that `\n`/`\t` text is
 * matchable.)
 */
export interface TextMatch {
  readonly blockId: BlockId;
  /** Offset in the block's extracted text (inclusive). */
  readonly start: number;
  /** Offset in the block's extracted text (exclusive); `end - start === query.length`. */
  readonly end: number;
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

    // Extract the whole block's text. The builtin embed serializer keeps each
    // embed at length 1 (see TextMatch docstring), preserving the 1:1
    // offset↔Position mapping.
    const span = createSpan(
      createPosition(blockId, 0),
      createPosition(blockId, length),
    );
    const haystackOriginal = extractText(state, span, builtinEmbedSerializer);
    const haystack = caseSensitive ? haystackOriginal : haystackOriginal.toLowerCase();

    let from = 0;
    while (from <= haystack.length - queryLen) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + queryLen;
      if (!wholeWord || isWholeWordMatch(haystackOriginal, idx, end)) {
        matches.push({ blockId, start: idx, end });
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
  // Document-order leaf walk: start at the leftmost leaf of the root subtree
  // and follow `nextBlockInDocOrder`. This visits every block (containers and
  // leaves alike) in document order; `findMatches` skips the containers. The
  // walk is the same primitive cursor/render use for doc-order traversal.
  let cursor = firstLeafBlock(state, state.rootId);
  while (cursor !== null) {
    yield cursor;
    cursor = nextBlockInDocOrder(state, cursor);
  }
}
