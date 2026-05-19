import {
  positionsEqual,
  getBlock,
  iterateSpan,
  type EditorState,
} from "@taleweaver/core";

export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  blockType: string;
  headingLevel: number | null;
  canUndo: boolean;
  canRedo: boolean;
}

const ATTR_KEYS = {
  bold: "fontWeight",
  italic: "fontStyle",
  underline: "textDecoration",
} as const;

/**
 * Check whether the inline-content span has a non-default value for `attrKey`
 * present in EVERY text item that overlaps the span. Returns false for empty
 * spans, embed-only spans, or any text item missing the attribute.
 *
 * Mirrors the legacy `getStyleInRange(state, selection, attrKey) !== undefined`
 * semantics, scoped to the new inline-content shape (each TextItem carries
 * its own `attrs`).
 */
function selectionHasAttr(
  editor: EditorState,
  attrKey: string,
): boolean {
  let sawTextItem = false;
  for (const { block, rangeStart, rangeEnd } of iterateSpan(
    editor.state,
    editor.selection,
  )) {
    if (!block.inlineContent) continue;
    let cursor = 0;
    for (const item of block.inlineContent.items) {
      const len = item.kind === "text" ? item.text.length : 1;
      const itemStart = cursor;
      const itemEnd = cursor + len;
      cursor = itemEnd;
      if (itemEnd <= rangeStart) continue;
      if (itemStart >= rangeEnd) break;
      if (item.kind !== "text") continue;
      sawTextItem = true;
      if (item.attrs[attrKey] === undefined) return false;
    }
  }
  return sawTextItem;
}

/**
 * Check whether the cursor's containing text item carries `attrKey`. Used for
 * collapsed selections (single cursor position).
 */
function cursorHasAttr(editor: EditorState, attrKey: string): boolean {
  const { blockId, offset } = editor.selection.focus;
  const block = getBlock(editor.state, blockId);
  if (!block || !block.inlineContent) return false;
  let cursor = 0;
  for (const item of block.inlineContent.items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemEnd = cursor + len;
    // Cursor lands at the boundary between items. By convention check the
    // item to the LEFT of the cursor (mirrors typical word-processor
    // behavior: typing inherits the style of the character to the left).
    // For cursor at offset 0 of a block, check the first item.
    if (offset === 0 && cursor === 0) {
      return item.kind === "text" && item.attrs[attrKey] !== undefined;
    }
    if (offset > cursor && offset <= itemEnd) {
      return item.kind === "text" && item.attrs[attrKey] !== undefined;
    }
    cursor = itemEnd;
  }
  return false;
}

export function getFormatState(editor: EditorState): FormatState {
  const { state, selection, history } = editor;

  // Block type and heading level from the focus block.
  const focusBlock = getBlock(state, selection.focus.blockId);
  let blockType = "paragraph";
  let headingLevel: number | null = null;
  if (focusBlock) {
    blockType = focusBlock.type;
    if (focusBlock.type === "heading") {
      const level = focusBlock.attrs.level;
      if (typeof level === "number") headingLevel = level;
    }
  }

  // Inline formatting (bold / italic / underline).
  const collapsed = positionsEqual(selection.anchor, selection.focus);
  const bold = collapsed
    ? cursorHasAttr(editor, ATTR_KEYS.bold)
    : selectionHasAttr(editor, ATTR_KEYS.bold);
  const italic = collapsed
    ? cursorHasAttr(editor, ATTR_KEYS.italic)
    : selectionHasAttr(editor, ATTR_KEYS.italic);
  const underline = collapsed
    ? cursorHasAttr(editor, ATTR_KEYS.underline)
    : selectionHasAttr(editor, ATTR_KEYS.underline);

  return {
    bold,
    italic,
    underline,
    blockType,
    headingLevel,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
  };
}
