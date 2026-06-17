import type { State } from "./state";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";
import { createPosition, createSpan } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { extractText, captionEmbedSerializer } from "./extract-text";
import type { SuggestionView } from "./suggestions";
import { iterateLeafBlocksInDocumentOrder } from "./document-order";

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
  /**
   * Preview-view projection of pending tracked changes ({@link SuggestionView}),
   * forwarded to {@link extractText} per heading. `"final"` reads each heading as
   * if all suggestions were accepted, `"original"` as if rejected, so the outline
   * panel matches the previewed document. Default `"suggesting"` (the literal
   * document). Mirrors `getWordCount`'s `suggestionView` option.
   */
  readonly suggestionView?: SuggestionView;
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
 * {@link captionEmbedSerializer} — the outline is DISPLAY text, so a structural
 * break collapses to a space and any embed (a footnote anchor / cross-reference
 * in a heading) contributes nothing, rather than leaking `\n` / `\t` / U+FFFC
 * into the panel (unlike the clipboard `builtinEmbedSerializer` the
 * counting-oriented sibling `getWordCount` uses). Non-heading blocks (paragraph,
 * list-item, …) are skipped.
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
            captionEmbedSerializer,
            options?.suggestionView ?? "suggesting",
          );

    entries.push({ blockId, level: levelOf(block.attrs.level), text });
  }

  return entries;
}

/**
 * One heading entry in an {@link OutlineSignature}'s ordered `signature` list —
 * the exact inputs a TOC's entry lines derive from (heading id, level, display
 * text).
 */
export interface OutlineSigEntry {
  readonly blockId: BlockId;
  readonly level: number;
  readonly text: string;
}

/**
 * A cache key for "has the document outline (+ which blocks are TOC anchors)
 * changed?" `signature` is the ordered heading list (id, level, display text) —
 * the exact inputs a TOC's entry lines derive from (the heading id set is the
 * `signature`'s `blockId`s, so it is not stored separately); `tocAnchorIds` is
 * every main-tree `table-of-contents` block. Cached on RenderOutput so the
 * incremental render can (a) reuse it O(1) when no heading changed and (b)
 * force-rebuild TOC anchors when it did.
 */
export interface OutlineSignature {
  readonly tocAnchorIds: ReadonlySet<BlockId>;
  readonly signature: readonly OutlineSigEntry[];
}

/**
 * The empty outline signature (no headings, no TOC anchors) — a frozen default
 * for any `RenderOutput` literal that needs one before a real signature is
 * computed (mirrors `EMPTY_FOOTNOTE_ANCHORS` / `EMPTY_LIST_COUNTERS`).
 */
export const EMPTY_OUTLINE_SIGNATURE: OutlineSignature = Object.freeze({
  tocAnchorIds: Object.freeze(new Set<BlockId>()),
  signature: Object.freeze([] as OutlineSigEntry[]),
});

/**
 * Compute the {@link OutlineSignature} for `state` under `suggestionView`.
 *
 * Reuses {@link getOutline} for the heading entries so the signature text is
 * EXACTLY the text a TOC renders (same `extractText` + `suggestionView`
 * projection) — this guarantees "signature unchanged" ⟺ "TOC entry text
 * unchanged". A second light walk over the SAME main-tree leaf traversal
 * collects the `table-of-contents` anchor ids (getOutline skips them — they
 * carry no inlineContent).
 */
export function computeOutlineSignature(
  state: State,
  suggestionView: SuggestionView,
): OutlineSignature {
  const entries = getOutline(state, { suggestionView });
  const signature: OutlineSigEntry[] = entries.map((e) => ({
    blockId: e.blockId,
    level: e.level,
    text: e.text,
  }));
  const tocAnchorIds = new Set<BlockId>();
  for (const block of iterateLeafBlocksInDocumentOrder(state)) {
    if (block.type === "table-of-contents") tocAnchorIds.add(block.id);
  }
  return Object.freeze({
    tocAnchorIds,
    signature: Object.freeze(signature),
  });
}

/**
 * Whether two outline signatures describe the SAME outline (same headings, in
 * the same order, with the same levels + display text). `tocAnchorIds` is NOT
 * compared — a TOC added/removed is in `dirtyIds` and invalidated directly; this
 * answers "did the OUTLINE change", driving whether to re-derive existing TOCs.
 */
export function outlineSignaturesEqual(a: OutlineSignature, b: OutlineSignature): boolean {
  if (a === b) return true;
  if (a.signature.length !== b.signature.length) return false;
  for (let i = 0; i < a.signature.length; i++) {
    const x = a.signature[i];
    const y = b.signature[i];
    if (x === undefined || y === undefined) {
      // Unreachable: both signatures have equal length (checked above) and i is
      // bounded by that length, so both lookups are in range.
      throw new Error(`outlineSignaturesEqual: signature index ${i} out of range`);
    }
    if (x.blockId !== y.blockId || x.level !== y.level || x.text !== y.text) return false;
  }
  return true;
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
  for (const block of iterateLeafBlocksInDocumentOrder(state)) {
    yield block.id;
  }
}
