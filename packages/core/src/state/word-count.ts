import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { Selection } from "./block-position";
import { createPosition, createSpan } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { extractText, builtinEmbedSerializer } from "./extract-text";
import type { SuggestionView } from "./suggestions";
import { iterateLeafBlocksInDocumentOrder } from "./document-order";

/**
 * Document statistics — the result of {@link getWordCount}. Mirrors the
 * figures Google Docs surfaces under Tools ▸ Word count.
 */
export interface WordCount {
  /**
   * Count of whitespace-delimited non-empty tokens, summed PER BLOCK.
   * Words never straddle a block (paragraph) boundary — "foo" ending one
   * paragraph and "bar" starting the next are two words, matching Google Docs.
   */
  readonly words: number;
  /**
   * Total characters across all target blocks, including spaces, using
   * UTF-16 code-unit length (`String.prototype.length`). Each embed counts as
   * one character (the builtin serializer emits one char per embed — hard-break
   * → "\n", tab → "\t"). Paragraph breaks contribute NOTHING: the model
   * extracts each block independently, so there is no character "between"
   * blocks. Google Docs' character count is approximately this.
   *
   * KNOWN LIMITATION: this counts UTF-16 code units, not grapheme clusters, so
   * astral-plane code points (emoji) and combining-mark sequences over-count
   * relative to user-perceived characters. Grapheme-cluster counting (UAX #29)
   * is a later concern — consistent with `findMatches`' Unicode note.
   */
  readonly characters: number;
  /**
   * {@link characters} minus every whitespace character (chars matching
   * `/\s/` — spaces, tabs, newlines from hard-break embeds, etc.).
   */
  readonly charactersExcludingSpaces: number;
}

export interface WordCountOptions {
  /**
   * Restrict the count to these blocks, in the order given. Blocks without
   * inline content (containers / non-leaf blocks) are skipped silently. The
   * result (a sum of per-block counts) is independent of the order.
   * Default: every main-tree leaf block, in document order.
   */
  readonly blockIds?: Iterable<BlockId>;
  /**
   * Preview-view projection of pending tracked changes ({@link SuggestionView}),
   * forwarded to {@link extractText} per block. `"final"` counts the document as
   * if all suggestions were ACCEPTED (deletion text excluded), `"original"` as if
   * all were REJECTED (insertion text excluded). Default `"suggesting"` counts the
   * literal document (both shown). NOTE: `getWordCount` counts PER BLOCK by design
   * (words never straddle a paragraph break — Google-Docs behavior), so a projected
   * count at a MERGED boundary (an accepted-join / rejected-split, which
   * `blockBoundaryMergesInView` collapses) is NOT reduced — each block is counted
   * independently. That structural merge IS applied by the multi-block extractors
   * (`extractText` / `getSelectionWordCount`); only this per-block whole-doc count
   * is unaffected, and deliberately so.
   */
  readonly suggestionView?: SuggestionView;
}

const WHITESPACE_SPLIT = /\s+/;
const WHITESPACE_CHAR = /\s/;

/**
 * Count words / characters / characters-excluding-spaces over a single plain-
 * text string — the shared counting kernel behind {@link getWordCount} (per
 * block) and {@link getSelectionWordCount} (per selected text).
 *
 * - `words`: the number of non-empty tokens from `text.split(/\s+/)` — i.e.
 *   maximal runs of non-whitespace. Leading / trailing / repeated whitespace
 *   produce empty tokens that are dropped, so they never inflate the count.
 *   A PARTIAL token counts as a word: counting "lo wor" (a slice of
 *   "hello world") yields 2 words.
 * - `characters`: `text.length` (UTF-16 code units; see {@link WordCount} for
 *   the grapheme-cluster limitation note).
 * - `charactersExcludingSpaces`: the count of characters NOT matching `/\s/`.
 *
 * `countText("")` → `{ words: 0, characters: 0, charactersExcludingSpaces: 0 }`.
 */
export function countText(text: string): WordCount {
  let words = 0;
  for (const token of text.split(WHITESPACE_SPLIT)) {
    if (token !== "") words += 1;
  }

  let charactersExcludingSpaces = 0;
  for (const ch of text) {
    if (!WHITESPACE_CHAR.test(ch)) charactersExcludingSpaces += 1;
  }

  return { words, characters: text.length, charactersExcludingSpaces };
}

/**
 * Compute word / character / character-excluding-spaces counts over the target
 * blocks of `state` — the read-only query behind Google Docs' Tools ▸ Word
 * count.
 *
 * Read-only query over state; no mutation, no paint. Counts the MAIN document
 * tree only (embedContents / templateContents — footnote and header/footer
 * bodies — are a deferred scope decision, identical to `findMatches`).
 *
 * Each block's text is obtained via {@link extractText} with
 * {@link builtinEmbedSerializer}, so hard-break embeds become "\n" and tab
 * embeds become "\t" — both whitespace, so they neither inflate the word count
 * nor count toward `charactersExcludingSpaces`. Counts are accumulated PER
 * BLOCK and summed: words cannot straddle a paragraph break (Google-Docs
 * behavior).
 *
 * An empty document / all-empty blocks → `{ words: 0, characters: 0,
 * charactersExcludingSpaces: 0 }`.
 */
export function getWordCount(state: State, options?: WordCountOptions): WordCount {
  let words = 0;
  let characters = 0;
  let charactersExcludingSpaces = 0;

  for (const blockId of iterateTargetBlocks(state, options?.blockIds)) {
    const block = getBlock(state, blockId);
    // Only leaf blocks carry countable inline content; skip containers.
    if (!block || block.inlineContent === null) continue;

    const length = inlineContentLength(block.inlineContent);
    if (length === 0) continue;

    const span = createSpan(
      createPosition(blockId, 0),
      createPosition(blockId, length),
    );
    const blockText = extractText(
      state,
      span,
      builtinEmbedSerializer,
      options?.suggestionView ?? "suggesting",
    );

    // Count this block in isolation and sum the three fields. Counting PER
    // BLOCK (rather than over a single concatenated string) is what makes
    // words never straddle a block boundary and what keeps `characters` free of
    // any inter-block separator — each block's text is extracted independently,
    // so there is no character "between" blocks. (Contrast
    // `getSelectionWordCount`, which extracts a single multi-block string whose
    // inter-block "\n" separators ARE part of the selected text.)
    const blockCounts = countText(blockText);
    words += blockCounts.words;
    characters += blockCounts.characters;
    charactersExcludingSpaces += blockCounts.charactersExcludingSpaces;
  }

  return { words, characters, charactersExcludingSpaces };
}

/**
 * Compute word / character / character-excluding-spaces counts over the text
 * currently SELECTED in `state` — the per-selection figure Google Docs shows
 * alongside the document total in Tools ▸ Word count.
 *
 * Read-only query over state; no mutation, no paint. The selection (a directed
 * anchor→focus pair, possibly BACKWARDS) is normalized to a document-ordered
 * span and its plain text is obtained via {@link extractText} with
 * {@link builtinEmbedSerializer} (hard-break → "\n", tab → "\t"); the result is
 * `countText(selectedText)`.
 *
 * SEPARATOR NOTE: for a multi-block selection, `extractText` joins each block's
 * fragment with "\n". That "\n" is genuinely part of the selected text — the
 * selection spans the paragraph break — so it is counted toward `characters`
 * (and, being whitespace, it splits the adjacent words rather than merging
 * them). This is WHY a selection covering the whole document can report a
 * larger `characters` than {@link getWordCount}: the latter counts each block
 * independently with NO inter-block separators, the former includes the
 * paragraph-break newlines the selection actually crosses.
 *
 * A COLLAPSED selection (anchor === focus → empty span) extracts "" →
 * `{ words: 0, characters: 0, charactersExcludingSpaces: 0 }`.
 */
export function getSelectionWordCount(
  state: State,
  selection: Selection,
  suggestionView: SuggestionView = "suggesting",
): WordCount {
  // `extractText` normalizes the span internally (it iterates via
  // `iterateSpan`, which calls `normalizeSpan`), so a backwards anchor→focus
  // selection yields the same text as the forward one. Passing the selection
  // through directly avoids a redundant normalize here. `suggestionView` projects
  // pending tracked changes (default `"suggesting"` = the literal selection).
  const selectedText = extractText(state, selection, builtinEmbedSerializer, suggestionView);
  return countText(selectedText);
}

/**
 * Yield the target blocks: the caller-supplied `blockIds` (in the given order)
 * when present, otherwise every main-tree leaf block in document order via the
 * cycle-safe {@link iterateLeafBlocksInDocumentOrder} (see its docstring for why
 * the old `firstLeafBlock` + `nextBlockInDocOrder` cursor sweep could hang on a
 * malformed two-parents topology). `getWordCount` skips blocks without inline
 * content, so yielding leaves only is identical to the old behavior here.
 */
function* iterateTargetBlocks(
  state: State,
  blockIds: Iterable<BlockId> | undefined,
): Iterable<BlockId> {
  if (blockIds !== undefined) {
    yield* blockIds;
    return;
  }
  for (const block of iterateLeafBlocksInDocumentOrder(state)) {
    yield block.id;
  }
}
