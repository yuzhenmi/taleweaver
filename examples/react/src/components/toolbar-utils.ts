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
  strikethrough: boolean;
  blockType: string;
  headingLevel: number | null;
  /**
   * The focus block's effective text alignment ("start" when the block carries
   * no `textAlign` attr — the CSS initial value). Drives the active state of the
   * alignment toolbar buttons.
   */
  textAlign: "start" | "center" | "end" | "justify";
  /**
   * Active inline `fontSize` attr value (px) at the cursor / common across the
   * selection. `null` when unset or mixed — the size control shows its blank
   * placeholder in that case.
   */
  fontSize: number | null;
  /** Active inline `fontFamily` attr value; `null` when unset or mixed. */
  fontFamily: string | null;
  /** Active inline `color` attr value (hex); `null` when unset or mixed. */
  color: string | null;
  /** Active inline `backgroundColor` (highlight) attr value (hex); `null` when unset or mixed. */
  backgroundColor: string | null;
  /** Focus block's `lineHeight` attr (unitless multiplier); `null` when unset. */
  lineHeight: number | null;
  /** Focus block's `marginInlineStart` attr (current indent px); `null` when unset. */
  marginInlineStart: number | null;
  /** Focus block's `marginBlockStart` attr (space before, px); `null` when unset. */
  spaceBefore: number | null;
  /** Focus block's `marginBlockEnd` attr (space after, px); `null` when unset. */
  spaceAfter: number | null;
  canUndo: boolean;
  canRedo: boolean;
}

// These are the INLINE ATTR keys `handleToggleStyle` writes (STYLE_KEYS in
// toggle-style.ts), NOT ComputedStyle keys — the pressed-state reads
// `item.attrs[attrKey]`. (Previously bold/italic/underline pointed at
// ComputedStyle keys like fontWeight/fontStyle/underline, which are never set
// as inline attrs, so those buttons' highlight was dead.)
const ATTR_KEYS = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikethrough",
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

/**
 * Value-returning analogue of `selectionHasAttr`: the COMMON value of `attrKey`
 * across every text item that overlaps the span. Returns:
 *  - the shared value when ALL overlapping text items carry the same value;
 *  - `"mixed"` when they carry different values;
 *  - `undefined` when the span has no text items.
 * Mirrors `selectionHasAttr`'s span iteration.
 */
function selectionCommonAttrValue(
  editor: EditorState,
  attrKey: string,
): unknown | "mixed" {
  let sawTextItem = false;
  let common: unknown;
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
      const value = item.attrs[attrKey];
      if (!sawTextItem) {
        sawTextItem = true;
        common = value;
      } else if (common !== value) {
        return "mixed";
      }
    }
  }
  return sawTextItem ? common : undefined;
}

/**
 * Value-returning analogue of `cursorHasAttr`: the value of `attrKey` on the
 * cursor's containing text item (the item to the LEFT of the cursor; the first
 * item when the cursor is at offset 0). Returns `undefined` when there is no
 * such text item.
 */
function cursorAttrValue(editor: EditorState, attrKey: string): unknown {
  const { blockId, offset } = editor.selection.focus;
  const block = getBlock(editor.state, blockId);
  if (!block || !block.inlineContent) return undefined;
  let cursor = 0;
  for (const item of block.inlineContent.items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemEnd = cursor + len;
    if (offset === 0 && cursor === 0) {
      return item.kind === "text" ? item.attrs[attrKey] : undefined;
    }
    if (offset > cursor && offset <= itemEnd) {
      return item.kind === "text" ? item.attrs[attrKey] : undefined;
    }
    cursor = itemEnd;
  }
  return undefined;
}

/**
 * Read a BLOCK-level attr from the focus block (e.g. `lineHeight`,
 * `marginInlineStart`, `marginBlockStart`, `marginBlockEnd`). Returns
 * `undefined` when the focus block is missing or carries no such attr.
 */
function focusBlockAttr(editor: EditorState, attrKey: string): unknown {
  const block = getBlock(editor.state, editor.selection.focus.blockId);
  if (!block) return undefined;
  return block.attrs[attrKey];
}

/** Coerce an attr value (or `"mixed"`/`undefined`) to a finite number, else null. */
function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Coerce an attr value (or `"mixed"`/`undefined`) to a string, else null. */
function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function getFormatState(editor: EditorState): FormatState {
  const { state, selection, history } = editor;

  // Block type and heading level from the focus block.
  const focusBlock = getBlock(state, selection.focus.blockId);
  let blockType = "paragraph";
  let headingLevel: number | null = null;
  // Alignment defaults to "start" (the CSS initial textAlign) when the focus
  // block carries no `textAlign` attr.
  let textAlign: FormatState["textAlign"] = "start";
  if (focusBlock) {
    blockType = focusBlock.type;
    if (focusBlock.type === "heading") {
      const level = focusBlock.attrs.level;
      if (typeof level === "number") headingLevel = level;
    }
    const align = focusBlock.attrs.textAlign;
    if (align === "start" || align === "center" || align === "end" || align === "justify") {
      textAlign = align;
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
  const strikethrough = collapsed
    ? cursorHasAttr(editor, ATTR_KEYS.strikethrough)
    : selectionHasAttr(editor, ATTR_KEYS.strikethrough);

  // Active inline VALUES (font size/family, text color, highlight). For a
  // collapsed cursor read the item to its left; for a range read the value
  // common to every overlapping text item ("mixed"/undefined → null → blank).
  const inlineAttrValue = (attrKey: string): unknown =>
    collapsed
      ? cursorAttrValue(editor, attrKey)
      : selectionCommonAttrValue(editor, attrKey);
  const fontSize = asNumberOrNull(inlineAttrValue("fontSize"));
  const fontFamily = asStringOrNull(inlineAttrValue("fontFamily"));
  const color = asStringOrNull(inlineAttrValue("color"));
  const backgroundColor = asStringOrNull(inlineAttrValue("backgroundColor"));

  // Active BLOCK-level VALUES (line spacing, indent, paragraph spacing) from
  // the focus block's attrs.
  const lineHeight = asNumberOrNull(focusBlockAttr(editor, "lineHeight"));
  const marginInlineStart = asNumberOrNull(
    focusBlockAttr(editor, "marginInlineStart"),
  );
  const spaceBefore = asNumberOrNull(focusBlockAttr(editor, "marginBlockStart"));
  const spaceAfter = asNumberOrNull(focusBlockAttr(editor, "marginBlockEnd"));

  return {
    bold,
    italic,
    underline,
    strikethrough,
    blockType,
    headingLevel,
    textAlign,
    fontSize,
    fontFamily,
    color,
    backgroundColor,
    lineHeight,
    marginInlineStart,
    spaceBefore,
    spaceAfter,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
  };
}
