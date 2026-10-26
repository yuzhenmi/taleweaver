import type { EditorState, EditorConfig } from "../editor-state";
import type { EditorAction } from "../editor-action";
import {
  getBlock,
  resolveBlock,
  productionAllocator,
  createPosition,
  createSpan,
  spanStart,
  deleteRange,
  insertText,
  splitBlockAtPosition,
  insertBlocksAfter,
  replaceWithSuggestedFragment,
  decodeFragmentClip,
  decodeHtml,
  insertFragment,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
} from "../../state";
import type {
  State,
  BlockId,
  Position,
  SiblingBlockInit,
  InlineContent,
  InlineItem,
  ReadonlyAttrs,
} from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { replaceSuggestionInputForBlock } from "./suggestion-mode";
import { isCrossContextSelection } from "./selection-guards";

/**
 * Build the inline content for one pasted line: a single empty-attrs text
 * run, or an empty leaf when the line is empty. Pasted runs carry EMPTY
 * attrs `{}` (matching the legacy per-line `insertText(..., {})` path).
 */
function lineToInlineContent(lineText: string): InlineContent {
  return lineText.length > 0
    ? { items: [{ kind: "text", text: lineText, attrs: {} }] }
    : { items: [] };
}

/** Suggestion-provenance attr keys stripped from carried items in suggesting mode. */
const CARRIED_SUGGESTION_ATTRS = [
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
] as const;

/**
 * Strip ALL carried suggestion provenance from a fragment leaf's inline items
 * (spec §3.3): a suggesting-mode paste IGNORES the carried suggestion state and
 * re-tracks the whole paste as the CURRENT author's fresh insertion. The carried
 * fragment (from a lossless clip via `extractFragment`) can hold any of:
 *   - text-run attrs INSERTION/DELETION/FORMATTING_SUGGESTION_ATTR
 *   - block-split / block-join suggestion EMBEDS (zero-width inter-line breaks)
 * All of these reference suggestion ids in the SOURCE document and would leak a
 * foreign / dangling id into the destination. We remove the three attrs from
 * every text run and DROP the break-suggestion embeds (`replaceWithSuggestedFragment`
 * mints FRESH inter-line break embeds and tags fresh insertion ids). Content
 * embeds (image/tab/hard-break) are left as-is here — T9's `filterLineContentItems`
 * drops them downstream; this helper is solely about clearing carried SUGGESTION
 * state, not content shape.
 */
function stripCarriedSuggestionState(items: ReadonlyArray<InlineItem>): InlineItem[] {
  const out: InlineItem[] = [];
  for (const item of items) {
    if (
      item.kind === "embed" &&
      (item.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE ||
        item.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE)
    ) {
      // Drop carried break-suggestion embeds — fresh ones are minted per inter-line break.
      continue;
    }
    if (item.kind === "text") {
      let cleared: Record<string, unknown> | null = null;
      for (const key of CARRIED_SUGGESTION_ATTRS) {
        if (key in item.attrs) {
          if (cleared === null) cleared = { ...item.attrs };
          delete cleared[key];
        }
      }
      out.push(cleared === null ? item : { kind: "text", text: item.text, attrs: cleared });
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Linearize a fragment State to a flat array of leaf `SiblingBlockInit[]` for
 * the suggesting-mode paste path (spec §7). Containers (tables) are FLATTENED
 * to their leaf paragraphs (block-level structural-insertion tracking is a
 * deferred feature — §7 "interim" behavior). Un-trackable content embeds are
 * handled downstream by `filterLineContentItems` inside
 * `replaceWithSuggestedFragment`.
 *
 * Each leaf's items are run through {@link stripCarriedSuggestionState} so any
 * carried suggestion provenance (from a lossless clip) is cleared before the
 * paste is re-tracked as the current author's fresh insertion (spec §3.3).
 *
 * Walk strategy: depth-first, document order. A block is a leaf when it has
 * `inlineContent !== null` and `firstChildId === null`; a block is a container
 * when `firstChildId !== null`. The fragment `document` root is skipped (it is
 * never emitted — only its descendants are).
 */
function linearizeFragmentForSuggesting(
  fragment: State,
  sourceType: string,
  sourceAttrs: ReadonlyAttrs,
): SiblingBlockInit[] {
  const result: SiblingBlockInit[] = [];
  const fragRoot = getBlock(fragment, fragment.rootId);
  if (fragRoot === null) return result;

  /** Recursively collect leaf blocks under `blockId` (inclusive). */
  function collectLeaves(blockId: BlockId): void {
    const block = getBlock(fragment, blockId);
    if (block === null) return;

    if (block.inlineContent !== null && block.firstChildId === null) {
      // Leaf: emit with its own type/attrs per spec §7 (paragraph, heading, list-item …).
      // Containers are FLATTENED, so this leaf may be a cell paragraph whose type
      // is "paragraph" — that is correct (cells contain leaves). Carried suggestion
      // provenance is stripped so the re-tracked insertion carries ONLY fresh ids.
      result.push({
        type: block.type,
        attrs: block.attrs,
        inlineContent: { items: stripCarriedSuggestionState(block.inlineContent.items) },
      });
    } else if (block.firstChildId !== null) {
      // Container: recurse into children in document order, collecting their leaves.
      let childId: BlockId | null = block.firstChildId;
      let guard = 0;
      while (childId !== null && guard++ < 100000) {
        collectLeaves(childId);
        const child = getBlock(fragment, childId);
        childId = child?.nextSiblingId ?? null;
      }
    }
    // Note: a block with both inlineContent === null AND firstChildId === null is
    // an unusual edge (container with no children, e.g. empty table). Skip it —
    // emitting a blank leaf would produce a surprising empty paragraph.
  }

  // Walk the fragment root's CHILDREN (not the root itself, which is the document node).
  let cur: BlockId | null = fragRoot.firstChildId;
  let guard = 0;
  while (cur !== null && guard++ < 100000) {
    collectLeaves(cur);
    const b = getBlock(fragment, cur);
    cur = b?.nextSiblingId ?? null;
  }

  // Fallback: if linearization produced nothing (e.g. empty fragment), produce
  // a single empty paragraph inheriting the caret block's type/attrs so
  // `replaceWithSuggestedFragment` always receives at least one line.
  if (result.length === 0) {
    result.push({
      type: sourceType,
      attrs: sourceAttrs,
      inlineContent: { items: [] },
    });
  }

  return result;
}

/**
 * Resolve the paste fragment by priority (spec §6.1):
 *   1. `clip` → `decodeFragmentClip(clip)` — null on malformed → fall through
 *   2. `html` AND `config.htmlParser` → `decodeHtml(html, allocator, parser)`
 *   3. Otherwise → null (caller uses the plain-text path)
 */
function resolveFragment(
  action: Extract<EditorAction, { type: "PASTE" }>,
  config: EditorConfig,
): State | null {
  const { clip, html } = action;

  // Priority 1: lossless clip flavor.
  if (clip !== undefined && clip.length > 0) {
    const decoded = decodeFragmentClip(clip);
    if (decoded !== null) return decoded;
    // null → malformed → fall through to html/text below
  }

  // Priority 2: rich html when a parser is configured.
  if (html !== undefined && html.length > 0 && config.htmlParser !== undefined) {
    return decodeHtml(html, productionAllocator, config.htmlParser);
  }

  // Priority 3 (plain text) is handled by the caller, not here.
  return null;
}

export function handlePaste(
  editor: EditorState,
  action: Extract<EditorAction, { type: "PASTE" }>,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  // A cross-CONTEXT span (anchor/focus in different trees) has no single-tree op, so
  // refuse it (no-op) BEFORE any `spanStart` / normalization — which throws "no common
  // ancestor" on such a span. This mirrors the INSERT_TEXT / SPLIT_NODE guard order
  // (SET_SELECTION already rejects cross-context spans, so this is defense-in-depth)
  // and is mode-independent: a cross-context span is equally a no-op on the direct path.
  if (isCrossContextSelection(editor.state, selection)) return editor;

  // ── Step 1: resolve fragment by priority (clip → html → text → nothing) ────
  const fragment = resolveFragment(action, config);

  if (fragment !== null) {
    // ── Rich path: clip or html decoded to a fragment State ─────────────────

    // Determine suggesting mode.
    const startBlockId = spanStart(editor.state, selection).blockId;
    const replaceInput = replaceSuggestionInputForBlock(editor.state, startBlockId, config);

    if (replaceInput !== null) {
      // ── Suggesting mode: linearize fragment → SiblingBlockInit[] ──────────
      // Spec §7: carried suggestion state is IGNORED; re-track the whole paste as
      // ONE new insertion by the current author. Containers are flattened to their
      // leaf paragraphs (structural-insertion tracking is a deferred feature).
      const sourceBlock = resolveBlock(editor.state, startBlockId)?.block ?? null;
      const sourceType = sourceBlock?.type ?? "paragraph";
      const sourceAttrs: ReadonlyAttrs = sourceBlock?.attrs ?? {};
      const lines = linearizeFragmentForSuggesting(fragment, sourceType, sourceAttrs);
      const result = replaceWithSuggestedFragment(
        editor.state,
        selection,
        lines,
        replaceInput,
        productionAllocator,
      );
      if (result.state === editor.state) return editor;
      const newSelection = createSpan(result.endPosition, result.endPosition);
      editor.history.commit(
        { state: result.state, dirtyIds: result.dirtyIds },
        { before: selection, after: newSelection },
      );
      return rebuildTrees(
        { ...editor, state: result.state, selection: newSelection },
        editor,
        config,
        result.dirtyIds,
      );
    }

    // ── Direct mode: insertFragment ──────────────────────────────────────────
    const result = insertFragment(editor.state, selection, fragment, productionAllocator);
    if (result.state === editor.state) return editor;
    const newSelection = createSpan(result.endPosition, result.endPosition);
    editor.history.commit(
      { state: result.state, dirtyIds: result.dirtyIds },
      { before: selection, after: newSelection },
    );
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
      result.dirtyIds,
    );
  }

  // ── Plain-text path (spec §6.1 arm 3 / fallback) ─────────────────────────
  // Used when: no clip / malformed clip, AND (no html OR no config.htmlParser), OR
  // explicit paste-without-formatting (action carries only `text`).
  // This body is VERBATIM from the original handler (behavior preserved exactly).
  const rawText = action.text ?? "";
  if (rawText.length === 0) return editor;

  // Normalize line endings: strip \r so \r\n becomes \n.
  const text = rawText.replace(/\r/g, "");

  // Suggesting mode: insert the paste as ONE tracked suggestion instead of mutating
  // destructively. The fragment is a tracked INSERTION (inter-line breaks are
  // block-split-suggestion embeds); a paste OVER a selection ALSO soft-deletes it
  // (cross-block: a block-join-suggestion per crossed boundary) — accept lands the
  // paste, reject restores the document. Tracking is ALL-CONTEXT (main + footnote /
  // header / footer bodies) via `replaceSuggestionInputForBlock`. When NOT suggesting
  // / no editing context, `replaceInput` is null → fall through to the direct path.
  const startBlockIdForText = spanStart(editor.state, selection).blockId;
  const replaceInputForText = replaceSuggestionInputForBlock(editor.state, startBlockIdForText, config);
  if (replaceInputForText !== null) {
    // New blocks inherit the caret block's TYPE + ATTRS (resolveBlock → all-tree, so a
    // footnote-body paste resolves too), matching the direct path's `sourceType` /
    // `sourceAttrs` clone — so accepting a multi-line paste into a heading keeps the
    // heading type AND level. (Only fragment[1..] are materialized as new blocks; the
    // first line merges into the existing block, which keeps its own type/attrs.)
    const sourceBlock = resolveBlock(editor.state, startBlockIdForText)?.block ?? null;
    const sourceType = sourceBlock?.type ?? "paragraph";
    const sourceAttrs = sourceBlock?.attrs ?? {};
    const fragment: SiblingBlockInit[] = text
      .split("\n")
      .map((line) => ({ type: sourceType, attrs: sourceAttrs, inlineContent: lineToInlineContent(line) }));
    const result = replaceWithSuggestedFragment(
      editor.state,
      selection,
      fragment,
      replaceInputForText,
      productionAllocator,
    );
    if (result.state === editor.state) return editor;
    const newSelection = createSpan(result.endPosition, result.endPosition);
    editor.history.commit(
      { state: result.state, dirtyIds: result.dirtyIds },
      { before: selection, after: newSelection },
    );
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
      result.dirtyIds,
    );
  }

  // Collapse selection (delete the existing range first).
  let state: State = editor.state;
  let pos: Position = editor.selection.focus;

  // Accumulate dirtyIds across every chained op so commit reflects the
  // full set of touched blocks for downstream consumers.
  const accumulatedDirtyIds = new Set<BlockId>();

  if (!isCollapsed(selection)) {
    const anchorBlock = getBlock(state, selection.anchor.blockId);
    const focusBlock = getBlock(state, selection.focus.blockId);
    if (anchorBlock === null || focusBlock === null) return editor;
    if (
      selection.anchor.blockId !== selection.focus.blockId &&
      anchorBlock.parentId !== focusBlock.parentId
    ) {
      return editor;
    }
    const start = spanStart(state, selection);
    const deleteResult = deleteRange(state, selection);
    state = deleteResult.state;
    for (const id of deleteResult.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(start.blockId, start.offset);
  }

  const lines = text.split("\n");
  const k = lines.length;
  // `String.prototype.split` always returns a non-empty array, so the first line
  // is always present (k >= 1).
  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new Error("handlePaste: text.split produced an empty array (invariant violation)");
  }

  // Insert the first line as text at the current position. (If L0 is empty,
  // skip; pos stays put — matching the legacy path.)
  if (firstLine.length > 0) {
    const r = insertText(state, pos, firstLine, {});
    state = r.state;
    for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(pos.blockId, pos.offset + firstLine.length);
  }

  // Multi-line paste: split the boundary block ONCE, prepend the last line
  // to the freshly created suffix block, and bulk-insert any MIDDLE lines as
  // sibling blocks between the two — a CONSTANT number of `applyOperation`
  // calls regardless of line count (replacing the legacy O(k) per-line
  // split+insert chain — Smell B / #291).
  if (k > 1) {
    const block = getBlock(state, pos.blockId);
    // Match the legacy guard: a null-parent / null-inlineContent / missing
    // boundary block STOPS the multi-line path (cursor stays after L0).
    if (block !== null && block.inlineContent !== null && block.parentId !== null) {
      const sourceType = block.type;
      const sourceAttrs = block.attrs;
      const sourceId = block.id;

      // (a) Split B at pos: B keeps `prefix⊕L0`; a new next sibling N_last
      //     holds `suffix`. New block inherits B's type/attrs (split clones).
      const splitResult = splitBlockAtPosition(state, pos, productionAllocator);
      state = splitResult.state;
      for (const id of splitResult.dirtyIds) accumulatedDirtyIds.add(id);

      // N_last is the suffix block split created. Both arms below are
      // contractually IMPOSSIBLE — split never deletes the source block and
      // always rewires its nextSiblingId to the new block — so we throw rather
      // than silently dropping lines 1..k-1 (which would make a multi-line
      // paste appear to succeed while losing content).
      const afterSplit = getBlock(state, sourceId);
      if (afterSplit === null) {
        throw new Error(
          `handlePaste: source block "${sourceId}" disappeared after split (invariant violation)`,
        );
      }
      const lastNewBlockId = afterSplit.nextSiblingId;
      if (lastNewBlockId === null) {
        throw new Error(
          `handlePaste: split of "${sourceId}" produced no next sibling (invariant violation)`,
        );
      }
      // k > 1 here, so index k-1 is in [1, length-1] and the last line exists.
      const lastLine = lines[k - 1];
      if (lastLine === undefined) {
        throw new Error(
          `handlePaste: last line index ${k - 1} out of range (length ${lines.length})`,
        );
      }

      // (b) Prepend the last line to N_last (offset 0).
      if (lastLine.length > 0) {
        const r = insertText(
          state,
          createPosition(lastNewBlockId, 0),
          lastLine,
          {},
        );
        state = r.state;
        for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
      }

      // (c) Bulk-insert the MIDDLE lines L1…L_{k-2} between B and N_last in
      //     ONE transaction.
      if (k > 2) {
        const middleInits: SiblingBlockInit[] = [];
        for (let i = 1; i < k - 1; i++) {
          // i ranges over [1, k-2], all valid indices of `lines` (length k).
          const middleLine = lines[i];
          if (middleLine === undefined) {
            throw new Error(
              `handlePaste: middle line index ${i} out of range (length ${lines.length})`,
            );
          }
          middleInits.push({
            type: sourceType,
            attrs: sourceAttrs,
            inlineContent: lineToInlineContent(middleLine),
          });
        }
        const bulkResult = insertBlocksAfter(
          state,
          sourceId,
          middleInits,
          productionAllocator,
        );
        state = bulkResult.state;
        for (const id of bulkResult.dirtyIds) accumulatedDirtyIds.add(id);
      }

      // (d) Cursor: end of the last pasted line in N_last.
      pos = createPosition(lastNewBlockId, lastLine.length);
    }
  }

  // E-B / #141: chained ops accumulate dirtyIds manually. Use
  // state-equality check (T7 identity contract) for consistency with
  // other handlers — `state` remains === editor.state iff every chained
  // op was a no-op.
  if (state === editor.state) return editor;

  const newSelection = createSpan(pos, pos);
  editor.history.commit(
    { state, dirtyIds: accumulatedDirtyIds },
    { before: selection, after: newSelection },
  );
  return rebuildTrees(
    { ...editor, state, selection: newSelection },
    editor,
    config,
    accumulatedDirtyIds,
  );
}
