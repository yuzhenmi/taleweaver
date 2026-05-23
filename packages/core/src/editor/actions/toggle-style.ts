import type { EditorState, EditorConfig } from "../editor-state";
import type { State } from "../../state/state";
import type { Span } from "../../state/block-position";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart, spanEnd } from "../../state/block-compare";
import { iterateSpan } from "../../state/span-iteration";
import { findItemAtOffset } from "../../state/inline-content";
import { applyAttrsToRange } from "../../state/apply-attrs";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

const STYLE_KEYS: Record<"bold" | "italic" | "underline", string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
};

/**
 * True iff every text item intersecting the span's per-block ranges has
 * the given attr set to a truthy value. Returns false for an empty range
 * (no items to check). Embed items (kind === "embed") in the range do
 * NOT contribute to the determination — they're neither required to have
 * the attr nor blocked from contributing if they do.
 */
function selectionAllHaveAttr(
  state: State,
  span: Span,
  attrKey: string,
): boolean {
  let sawText = false;
  for (const seg of iterateSpan(state, span)) {
    const content = seg.block.inlineContent;
    if (content === null) continue;
    // Skip directly to the first item containing rangeStart; iterate
    // forward only while the item's start is still before rangeEnd.
    // The prior implementation walked every item in the block — O(N)
    // per segment regardless of span size.
    const startInfo = findItemAtOffset(content, seg.rangeStart);
    let cursor = seg.rangeStart - startInfo.withinItem;
    for (let i = startInfo.itemIndex; i < content.items.length; i++) {
      const item = content.items[i];
      if (item === undefined) break;
      const itemLen = item.kind === "text" ? item.text.length : 1;
      const itemEnd = cursor + itemLen;
      if (cursor >= seg.rangeEnd) break;
      if (item.kind === "text") {
        // Within rangeEnd by the loop guard; itemEnd may exceed but the
        // overlap is non-empty since cursor < rangeEnd.
        sawText = true;
        if (!item.attrs[attrKey]) {
          // Early exit: a single non-attr text item is enough to know
          // the result is false. No need to keep scanning.
          return false;
        }
      }
      cursor = itemEnd;
    }
  }
  return sawText;
}

export function handleToggleStyle(
  editor: EditorState,
  style: "bold" | "italic" | "underline",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  const attrKey = STYLE_KEYS[style];
  const all = selectionAllHaveAttr(editor.state, selection, attrKey);
  // When all items have the attr → toggle OFF (remove). Else toggle ON.
  const incoming = all ? { [attrKey]: undefined } : { [attrKey]: true };
  const result = applyAttrsToRange(editor.state, selection, incoming);
  if (result.state === editor.state) {
    return editor;
  }

  // Selection is invariant under attribute changes (no block tree
  // restructure, no item count change in the cursor-position sense —
  // attrs apply atomically to the existing ranges). Preserve the
  // original anchor/focus positions but rebuild span ordering from the
  // normalized start/end so consumers see consistent shape.
  const start = spanStart(editor.state, selection);
  const end = spanEnd(editor.state, selection);
  const newSelection = createSpan(
    createPosition(start.blockId, start.offset),
    createPosition(end.blockId, end.offset),
  );

  editor.history.commit(result, {
    before: selection,
    after: newSelection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
  );
}
