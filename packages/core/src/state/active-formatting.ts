import type { State } from "./state";
import { getBlock } from "./state";
import type { Selection } from "./block-position";
import { positionsEqual } from "./block-position";
import type { Block } from "./block";
import type { TextItem } from "./inline-content";
import { iterateSpan, iterateBlocksInSpan } from "./span-iteration";
import type { TextTransform } from "../styles";

/**
 * The active inline + block formatting at a selection — the read-side
 * counterpart to the SET_* / TOGGLE_STYLE editor actions, surfaced to drive a
 * formatting toolbar's pressed-states and value controls (Google Docs reflects
 * the cursor's / selection's current formatting in its toolbar this way).
 *
 * Each field is one of:
 *  - a concrete value — the formatting is uniform across the selection;
 *  - `"mixed"` — the selection spans differing values for that property;
 *  - the "unset" sentinel (`false` for toggles, `null` for values) — no item
 *    in the selection carries the property.
 *
 * INLINE properties (`bold`…`fontFamily`) are read from the selection's TEXT
 * items (the item to the LEFT of a collapsed cursor; every text item
 * overlapping a range). BLOCK properties (`blockType`…`marginBlockEnd`) are
 * read from the selection's LEAF blocks (the focus block when collapsed; every
 * leaf block a range touches).
 */
export interface ActiveFormatting {
  /** Bold toggle — `true` (all bold) / `false` (none) / `"mixed"`. */
  bold: boolean | "mixed";
  /** Italic toggle. */
  italic: boolean | "mixed";
  /** Underline toggle. */
  underline: boolean | "mixed";
  /** Strikethrough toggle. */
  strikethrough: boolean | "mixed";
  /** Link URL inline value — `null` when unset. */
  link: string | null | "mixed";
  /** Text color inline value (hex) — `null` when unset. */
  color: string | null | "mixed";
  /** Highlight (background) inline value (hex) — `null` when unset. */
  backgroundColor: string | null | "mixed";
  /** Font size inline value (px) — `null` when unset. */
  fontSize: number | null | "mixed";
  /** Font family inline value — `null` when unset. */
  fontFamily: string | null | "mixed";
  /** Text-transform inline value (CSS keyword) — `null` when unset. */
  textTransform: TextTransform | null | "mixed";
  /**
   * The block `type` common across the selection's leaf blocks (e.g.
   * `"paragraph"`, `"heading"`), or `"mixed"`. Falls back to the focus block's
   * type — `"paragraph"` if even that is missing — when the selection has no
   * leaf blocks.
   */
  blockType: string | "mixed";
  /**
   * Heading level (`attrs.level`, a number) common across the selection's
   * heading blocks; `null` when the (common) block carries no numeric level —
   * e.g. a paragraph. `"mixed"` when levels differ.
   */
  headingLevel: number | null | "mixed";
  /** Block text alignment — `null` when unset (CSS initial is logical-start). */
  textAlign: "start" | "center" | "end" | "justify" | null | "mixed";
  /** Block line height (unitless multiplier) — `null` when unset. */
  lineHeight: number | null | "mixed";
  /** Block start indent (px) — `null` when unset. */
  marginInlineStart: number | null | "mixed";
  /** Block space-before (px) — `null` when unset. */
  marginBlockStart: number | null | "mixed";
  /** Block space-after (px) — `null` when unset. */
  marginBlockEnd: number | null | "mixed";
}

// The inline toggle / value attr keys read below mirror toggle-style.ts
// STYLE_KEYS (`bold`/`italic`/`underline`/`strikethrough`, each set as
// `attrs[key] = true`) and the value handlers (`link`/`color`/
// `backgroundColor`/`fontSize`/`fontFamily`) — these are inline-content attr
// names, NOT ComputedStyle property names; the read is `item.attrs[key]`. The
// block-attr keys (`textAlign`/`lineHeight`/`marginInlineStart`/
// `marginBlockStart`/`marginBlockEnd`, plus `level` for headings) are read off
// `block.attrs[key]`. Each field is assembled explicitly below so its
// per-field coercion stays type-safe.

/** A distinct marker for "no value yet seen" (so `undefined`/`null` are real). */
const UNSEEN = Symbol("unseen");

/**
 * Compute the active inline + block formatting at `selection` over `state` — a
 * pure, read-only query (no mutation, no paint). The read-side counterpart to
 * the SET_* / TOGGLE_STYLE actions; see {@link ActiveFormatting}.
 *
 * INLINE resolution:
 *  - collapsed → the cursor's containing text item (the item to the LEFT of the
 *    cursor; the first item when the cursor is at offset 0);
 *  - range → every text item overlapping the span; a running common value that
 *    becomes `"mixed"` the moment a later item differs. No overlapping text
 *    items → unset (toggles `false`, values `null`).
 *  Toggles read per-item PRESENCE (a truthy attr): all-true → `true`,
 *  all-false → `false`, varying → `"mixed"`. Values read the common concrete
 *  value, `null` when all-unset, `"mixed"` when varying.
 *
 * BLOCK resolution: over the selection's LEAF blocks (the focus block when
 * collapsed and a leaf; every `inlineContent !== null` block a range touches).
 * Common attr value across them → that value, `null` when all-unset, `"mixed"`
 * when varying. `blockType` is the common `type`; `headingLevel` the common
 * numeric `attrs.level` (else `null`).
 *
 * Degenerate selections (focus block missing, or no leaf blocks at all) yield
 * toggles `false`, values `null`, and `blockType` the focus block's type
 * (falling back to `"paragraph"`).
 */
export function getActiveFormatting(state: State, selection: Selection): ActiveFormatting {
  const collapsed = positionsEqual(selection.anchor, selection.focus);

  // ── Inline: gather the text items the selection reads. ──────────────────
  const inlineItems = collapsed
    ? cursorTextItem(state, selection)
    : spanTextItems(state, selection);

  const bold = toggleOf(inlineItems, "bold");
  const italic = toggleOf(inlineItems, "italic");
  const underline = toggleOf(inlineItems, "underline");
  const strikethrough = toggleOf(inlineItems, "strikethrough");

  const link = asStringOrNull(inlineValueOf(inlineItems, "link"));
  const color = asStringOrNull(inlineValueOf(inlineItems, "color"));
  const backgroundColor = asStringOrNull(inlineValueOf(inlineItems, "backgroundColor"));
  const fontSize = asNumberOrNull(inlineValueOf(inlineItems, "fontSize"));
  const fontFamily = asStringOrNull(inlineValueOf(inlineItems, "fontFamily"));
  const textTransform = asTextTransformOrNull(inlineValueOf(inlineItems, "textTransform"));

  // ── Block: gather the leaf blocks the selection reads. ──────────────────
  const leafBlocks = collapsed
    ? collapsedLeafBlocks(state, selection)
    : rangeLeafBlocks(state, selection);

  const blockType = blockTypeOf(state, selection, leafBlocks);
  const headingLevel = asNumberOrNull(blockAttrCommon(leafBlocks, "level"));

  const textAlign = asTextAlignOrNull(blockAttrCommon(leafBlocks, "textAlign"));
  const lineHeight = asNumberOrNull(blockAttrCommon(leafBlocks, "lineHeight"));
  const marginInlineStart = asNumberOrNull(blockAttrCommon(leafBlocks, "marginInlineStart"));
  const marginBlockStart = asNumberOrNull(blockAttrCommon(leafBlocks, "marginBlockStart"));
  const marginBlockEnd = asNumberOrNull(blockAttrCommon(leafBlocks, "marginBlockEnd"));

  return {
    bold,
    italic,
    underline,
    strikethrough,
    link,
    color,
    backgroundColor,
    fontSize,
    fontFamily,
    textTransform,
    blockType,
    headingLevel,
    textAlign,
    lineHeight,
    marginInlineStart,
    marginBlockStart,
    marginBlockEnd,
  };
}

// ── Inline item gathering ─────────────────────────────────────────────────

/**
 * The cursor's containing text item, as a single-element list (empty when the
 * cursor is not inside a text item). By convention the item to the LEFT of the
 * cursor is read (typing inherits the style of the character to the left); for
 * a cursor at offset 0 the first item is read.
 */
function cursorTextItem(state: State, selection: Selection): TextItem[] {
  const { blockId, offset } = selection.focus;
  const block = getBlock(state, blockId);
  if (!block || !block.inlineContent) return [];
  let cursor = 0;
  for (const item of block.inlineContent.items) {
    const len = item.kind === "text" ? item.text.length : 1;
    const itemEnd = cursor + len;
    if (offset === 0 && cursor === 0) {
      return item.kind === "text" ? [item] : [];
    }
    if (offset > cursor && offset <= itemEnd) {
      return item.kind === "text" ? [item] : [];
    }
    cursor = itemEnd;
  }
  return [];
}

/**
 * Every text item that overlaps the span's per-block ranges, in document
 * order. Embed items do not contribute.
 */
function spanTextItems(state: State, selection: Selection): TextItem[] {
  const out: TextItem[] = [];
  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, selection)) {
    if (!block.inlineContent) continue;
    let cursor = 0;
    for (const item of block.inlineContent.items) {
      const len = item.kind === "text" ? item.text.length : 1;
      const itemStart = cursor;
      const itemEnd = cursor + len;
      cursor = itemEnd;
      if (itemEnd <= rangeStart) continue;
      if (itemStart >= rangeEnd) break;
      if (item.kind === "text") out.push(item);
    }
  }
  return out;
}

// ── Inline reducers ───────────────────────────────────────────────────────

/**
 * Toggle state over `items` for `attrKey`: `true` when EVERY item carries a
 * truthy attr, `false` when none do (or there are no items), `"mixed"` when
 * presence varies.
 */
function toggleOf(items: ReadonlyArray<TextItem>, attrKey: string): boolean | "mixed" {
  if (items.length === 0) return false;
  let sawTrue = false;
  let sawFalse = false;
  for (const item of items) {
    if (item.attrs[attrKey]) sawTrue = true;
    else sawFalse = true;
    if (sawTrue && sawFalse) return "mixed";
  }
  return sawTrue;
}

/**
 * The common value of `attrKey` over `items`: the shared value when all items
 * agree, `"mixed"` when they differ, `undefined` when there are no items.
 */
function inlineValueOf(items: ReadonlyArray<TextItem>, attrKey: string): unknown | "mixed" {
  let common: unknown = UNSEEN;
  for (const item of items) {
    const value = item.attrs[attrKey];
    if (common === UNSEEN) common = value;
    else if (common !== value) return "mixed";
  }
  return common === UNSEEN ? undefined : common;
}

// ── Block gathering ───────────────────────────────────────────────────────

/** The focus block as a single-element list when it's a leaf, else empty. */
function collapsedLeafBlocks(state: State, selection: Selection): Block[] {
  const block = getBlock(state, selection.focus.blockId);
  if (!block || block.inlineContent === null) return [];
  return [block];
}

/** Every leaf block (inlineContent !== null) the range touches, in doc order. */
function rangeLeafBlocks(state: State, selection: Selection): Block[] {
  const out: Block[] = [];
  for (const block of iterateBlocksInSpan(state, selection)) {
    if (block.inlineContent !== null) out.push(block);
  }
  return out;
}

// ── Block reducers ────────────────────────────────────────────────────────

/**
 * The common block `type` across `leafBlocks`: the shared type, or `"mixed"`.
 * When there are no leaf blocks, falls back to the focus block's type, then to
 * `"paragraph"`.
 */
function blockTypeOf(
  state: State,
  selection: Selection,
  leafBlocks: ReadonlyArray<Block>,
): string | "mixed" {
  if (leafBlocks.length === 0) {
    const focusBlock = getBlock(state, selection.focus.blockId);
    return focusBlock ? focusBlock.type : "paragraph";
  }
  let common: string | undefined;
  for (const block of leafBlocks) {
    if (common === undefined) common = block.type;
    else if (common !== block.type) return "mixed";
  }
  return common ?? "paragraph";
}

/**
 * The common value of block-attr `attrKey` across `leafBlocks`: the shared
 * value when all agree, `"mixed"` when they differ, `undefined` when none
 * carry it (or there are no blocks).
 */
function blockAttrCommon(
  leafBlocks: ReadonlyArray<Block>,
  attrKey: string,
): unknown | "mixed" {
  let common: unknown = UNSEEN;
  for (const block of leafBlocks) {
    const value = block.attrs[attrKey];
    if (common === UNSEEN) common = value;
    else if (common !== value) return "mixed";
  }
  return common === UNSEEN ? undefined : common;
}

// ── Coercions ─────────────────────────────────────────────────────────────

/** Pass `"mixed"` through; coerce a finite number to itself, else `null`. */
function asNumberOrNull(value: unknown | "mixed"): number | null | "mixed" {
  if (value === "mixed") return "mixed";
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Pass `"mixed"` through; coerce a string to itself, else `null`. */
function asStringOrNull(value: unknown | "mixed"): string | null | "mixed" {
  if (value === "mixed") return "mixed";
  return typeof value === "string" ? value : null;
}

/** Pass `"mixed"` through; narrow a valid text-transform keyword, else `null`. */
function asTextTransformOrNull(value: unknown | "mixed"): TextTransform | null | "mixed" {
  if (value === "mixed") return "mixed";
  if (
    value === "none" ||
    value === "capitalize" ||
    value === "uppercase" ||
    value === "lowercase"
  ) {
    return value;
  }
  return null;
}

/** Pass `"mixed"` through; narrow a valid alignment keyword, else `null`. */
function asTextAlignOrNull(
  value: unknown | "mixed",
): "start" | "center" | "end" | "justify" | null | "mixed" {
  if (value === "mixed") return "mixed";
  if (value === "start" || value === "center" || value === "end" || value === "justify") {
    return value;
  }
  return null;
}
