import type { EditorState, EditorConfig } from "../editor-state";
import { iterateSpan, findItemAtOffset } from "../../state";
import type { State, Span } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";

const STYLE_KEYS: Record<"bold" | "italic" | "underline" | "strikethrough", string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikethrough",
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
  style: "bold" | "italic" | "underline" | "strikethrough",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  const attrKey = STYLE_KEYS[style];
  const all = selectionAllHaveAttr(editor.state, selection, attrKey);
  // When all items have the attr → toggle OFF (remove). Else toggle ON.
  const incoming = all ? { [attrKey]: undefined } : { [attrKey]: true };
  const result = applyAttrsOrSuggest(editor.state, selection, incoming, config);
  if (result.state === editor.state) {
    return editor;
  }

  // An attr-only edit shifts no offsets (no block-tree restructure, no item-
  // count change in the cursor-position sense — attrs apply atomically to the
  // existing ranges), so the selection is unchanged — committed and rebuilt
  // AS-IS, preserving both endpoints and the anchor/focus DIRECTION (a backward
  // drag-selection stays backward — Google-Docs parity). Normalizing via
  // spanStart/spanEnd would silently flip a backward selection to forward, so a
  // following Shift+Arrow would extend from the wrong end.
  editor.history.commit(result, {
    before: selection,
    after: selection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection },
    editor,
    config,
    result.dirtyIds,
  );
}
