import type { EditorState } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import type { EditorAction } from "../editor-action";
import {
  getBlock,
  resolveBlock,
  productionAllocator,
  createPosition,
  createSpan,
  spanStart,
  deleteRange,
  bookmarkDeletionSpan,
  insertText,
  splitBlockAtPosition,
  insertBlocksAfter,
  replaceWithSuggestedFragment,
  decodeFragmentClip,
  decodeHtml,
  insertFragment,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  isFormattingSuggestionKey,
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
import { getTypingAttrs } from "../typing-attrs";

/**
 * Build the inline content for one pasted line: a single text run carrying the
 * typing attrs `attrs` (plain text pastes in the formatting at the caret, like
 * typing), or an empty leaf when the line is empty.
 */
function lineToInlineContent(lineText: string, attrs: ReadonlyAttrs): InlineContent {
  return lineText.length > 0
    ? { items: [{ kind: "text", text: lineText, attrs }] }
    : { items: [] };
}

/** Is `key` suggestion provenance (stripped from carried items in suggesting mode)? */
function isCarriedSuggestionAttr(key: string): boolean {
  return key === INSERTION_SUGGESTION_ATTR || key === DELETION_SUGGESTION_ATTR || isFormattingSuggestionKey(key);
}

/**
 * Strip ALL carried suggestion provenance from a fragment leaf's inline items
 * — a suggesting-mode paste IGNORES the carried suggestion state and
 * re-tracks the whole paste as the CURRENT author's fresh insertion. The carried
 * fragment (from a lossless clip via `extractFragment`) can hold any of:
 *   - text-run attrs INSERTION/DELETION_SUGGESTION_ATTR + every formatting tag
 * All of these reference suggestion ids in the SOURCE document and would leak a
 * foreign / dangling id into the destination. We remove those attrs from
 * every text run (`replaceWithSuggestedFragment` tags fresh insertion ids; a
 * fragment never carries boundary tags — `extractFragment` omits them). Content
 * embeds (image/tab/hard-break) are left as-is here — `filterLineContentItems`
 * drops them downstream; this helper is solely about clearing carried SUGGESTION
 * state, not content shape.
 */
function stripCarriedSuggestionState(items: ReadonlyArray<InlineItem>): InlineItem[] {
  const out: InlineItem[] = [];
  for (const item of items) {
    if (item.kind === "text") {
      let cleared: Record<string, unknown> | null = null;
      for (const key of Object.keys(item.attrs)) {
        if (isCarriedSuggestionAttr(key)) {
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
 * the suggesting-mode paste path. Containers (tables) are FLATTENED
 * to their leaf paragraphs (block-level structural-insertion tracking is not
 * built). Un-trackable content embeds are
 * handled downstream by `filterLineContentItems` inside
 * `replaceWithSuggestedFragment`.
 *
 * Each leaf's items are run through {@link stripCarriedSuggestionState} so any
 * carried suggestion provenance (from a lossless clip) is cleared before the
 * paste is re-tracked as the current author's fresh insertion.
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
      // Leaf: emit with its own type/attrs (paragraph, heading, list-item …).
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
 * Resolve the paste fragment by priority:
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
    const decoded = decodeFragmentClip(clip, config.componentRegistry, config.attrRegistry);
    if (decoded !== null) return decoded;
    // null → malformed → fall through to html/text below
  }

  // Priority 2: rich html when a parser is configured.
  if (html !== undefined && html.length > 0 && config.htmlParser !== undefined) {
    return decodeHtml(html, productionAllocator, config.htmlParser, config.componentRegistry);
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
      // Carried suggestion state is IGNORED; re-track the whole paste as
      // ONE new insertion by the current author. Containers are flattened to their
      // leaf paragraphs (structural-insertion tracking is not built).
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

  // ── Plain-text path ─────────────────────────
  // Used when: no clip / malformed clip, AND (no html OR no config.htmlParser), OR
  // explicit paste-without-formatting (action carries only `text`).
  // This body is VERBATIM from the original handler (behavior preserved exactly).
  const rawText = action.text ?? "";
  if (rawText.length === 0) return editor;

  // Normalize line endings: strip \r so \r\n becomes \n.
  const text = rawText.replace(/\r/g, "");
  // Plain text takes the typing attrs at the caret / selection start, like typing.
  const attrs = getTypingAttrs(editor);

  // Suggesting mode: insert the paste as ONE tracked suggestion instead of mutating
  // destructively. The fragment is a tracked INSERTION (inter-line breaks are split
  // tags on the new paragraph marks); a paste OVER a selection ALSO soft-deletes it
  // (cross-block: a join tag per crossed boundary) — accept lands the
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
      .map((line) => ({ type: sourceType, attrs: sourceAttrs, inlineContent: lineToInlineContent(line, attrs) }));
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
    const start = bookmarkDeletionSpan(state, selection).span.anchor;
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
    const r = insertText(state, pos, firstLine, attrs);
    state = r.state;
    for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(pos.blockId, pos.offset + firstLine.length);
  }

  // Multi-line paste: split the boundary block ONCE, prepend the last line
  // to the freshly created suffix block, and bulk-insert any MIDDLE lines as
  // sibling blocks between the two — a CONSTANT number of `applyOperation`
  // calls regardless of line count (replacing the legacy O(k) per-line
  // split+insert chain).
  if (k > 1) {
    const block = getBlock(state, pos.blockId);
    // Match the legacy guard: a null-parent / null-inlineContent / missing
    // boundary block STOPS the multi-line path (cursor stays after L0).
    if (block !== null && block.inlineContent !== null && block.parentId !== null) {
      const sourceType = block.type;
      const sourceAttrs = block.attrs;
      const sourceId = block.id;

      // (a) Split B at pos: a NEW head H takes `prefix⊕L0` and
      //     B keeps `suffix` + its ¶ — so B is the last pasted line's block.
      const splitResult = splitBlockAtPosition(state, pos, productionAllocator);
      state = splitResult.state;
      for (const id of splitResult.dirtyIds) accumulatedDirtyIds.add(id);
      const headId = splitResult.newBlockId;
      const lastNewBlockId = sourceId;
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
          attrs,
        );
        state = r.state;
        for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
      }

      // (c) Bulk-insert the MIDDLE lines L1…L_{k-2} between H and B in
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
            inlineContent: lineToInlineContent(middleLine, attrs),
          });
        }
        const bulkResult = insertBlocksAfter(
          state,
          headId,
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

  // Chained ops accumulate dirtyIds manually. Use
  // state-equality check (the identity-no-op contract) for consistency with
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
