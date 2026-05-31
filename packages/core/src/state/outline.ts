import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import { createPosition, createSpan } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { extractText, builtinEmbedSerializer } from "./extract-text";
import { firstLeafBlock, nextBlockInDocOrder } from "./block-traversal";

/**
 * One heading in the document outline — the result rows of {@link getOutline}.
 * Mirrors the entries Google Docs lists in its outline panel (View ▸ Show
 * outline): a flat, document-ordered list of headings with their level.
 */
export interface OutlineEntry {
  /** The heading block's id. */
  readonly blockId: BlockId;
  /**
   * The heading's level, 1–6 (h1–h6). Read with the same rule the heading
   * component uses: a value of 1–6 is taken as-is; anything else (missing /
   * out-of-range / non-numeric) defaults to 1.
   */
  readonly level: number;
  /** The heading's extracted text (empty string for an empty heading). */
  readonly text: string;
}

export interface OutlineOptions {
  /**
   * Restrict the outline to these blocks, in the order given. Blocks without
   * inline content (containers / non-leaf blocks) and non-heading blocks are
   * skipped silently. Default: every main-tree leaf block, in document order.
   */
  readonly blockIds?: Iterable<BlockId>;
}

/**
 * Read the document outline of `state` — the flat, document-ordered list of
 * heading blocks behind Google Docs' outline panel (View ▸ Show outline).
 *
 * Read-only query over state; no mutation, no paint. Walks the MAIN document
 * tree only (embedContents / templateContents — footnote and header/footer
 * bodies — are out of scope, identical to `getWordCount` / `findMatches`).
 *
 * For each heading block (`type === "heading"`) the level is read with the
 * SAME rule as the heading component's `levelFromAttrs` (value 1–6 → that;
 * otherwise → 1) and the text via {@link extractText} with
 * {@link builtinEmbedSerializer} (consistent with the sibling queries —
 * headings rarely carry embeds, but the serializer keeps behavior uniform).
 * Non-heading blocks (paragraph, list-item, …) are skipped.
 *
 * The list is FLAT and in document order: nesting (an outline tree built from
 * the `level` field) is a consumer concern. An empty document, or one with no
 * headings, yields `[]`.
 */
export function getOutline(state: State, options?: OutlineOptions): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  for (const blockId of iterateTargetBlocks(state, options?.blockIds)) {
    const block = getBlock(state, blockId);
    // Only leaf blocks carry inline content; skip containers / non-leaf blocks.
    if (!block || block.inlineContent === null) continue;
    if (block.type !== "heading") continue;

    const length = inlineContentLength(block.inlineContent);
    const text =
      length === 0
        ? ""
        : extractText(
            state,
            createSpan(createPosition(blockId, 0), createPosition(blockId, length)),
            builtinEmbedSerializer,
          );

    entries.push({ blockId, level: levelOf(block.attrs.level), text });
  }

  return entries;
}

/**
 * Validate a heading `level` attr exactly as the heading component's
 * `levelFromAttrs` does: 1–6 is taken as-is, anything else defaults to 1.
 */
function levelOf(level: unknown): number {
  if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5 || level === 6) {
    return level;
  }
  return 1;
}

/**
 * Yield the target blocks: the caller-supplied `blockIds` (in the given order)
 * when present, otherwise every main-tree leaf block in document order. Mirrors
 * `getWordCount` / `findMatches`' traversal (a parallel small walk — the
 * siblings do not expose this as a shared helper, and refactoring them to do so
 * is out of scope for a pure-query addition). Containers / non-heading blocks
 * are NOT filtered here; `getOutline` skips them.
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
