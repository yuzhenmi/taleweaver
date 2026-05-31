import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import { createPosition, createSpan } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { extractText, builtinEmbedSerializer } from "./extract-text";
import { firstLeafBlock, nextBlockInDocOrder } from "./block-traversal";

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
}

const WHITESPACE_SPLIT = /\s+/;
const WHITESPACE_CHAR = /\s/;

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
    const blockText = extractText(state, span, builtinEmbedSerializer);

    // Words: split on Unicode whitespace and drop the empty strings that
    // leading/trailing/repeated whitespace produces. Per-block so words never
    // straddle a block boundary.
    for (const token of blockText.split(WHITESPACE_SPLIT)) {
      if (token !== "") words += 1;
    }

    characters += blockText.length;
    for (const ch of blockText) {
      if (!WHITESPACE_CHAR.test(ch)) charactersExcludingSpaces += 1;
    }
  }

  return { words, characters, charactersExcludingSpaces };
}

/**
 * Yield the target blocks: the caller-supplied `blockIds` (in the given order)
 * when present, otherwise every main-tree leaf block in document order. Mirrors
 * `findMatches`' traversal exactly (a parallel small walk — `findMatches` does
 * not expose this as a shared helper, and refactoring it to do so is out of
 * scope for a pure-query addition). Containers are NOT filtered here;
 * `getWordCount` skips blocks without inline content.
 */
function* iterateTargetBlocks(
  state: State,
  blockIds: Iterable<BlockId> | undefined,
): Iterable<BlockId> {
  if (blockIds !== undefined) {
    yield* blockIds;
    return;
  }
  let cursor = firstLeafBlock(state, state.rootId);
  while (cursor !== null) {
    yield cursor;
    cursor = nextBlockInDocOrder(state, cursor);
  }
}
