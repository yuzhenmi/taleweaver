/**
 * Parallel-window bridge between the legacy StateNode tree and the
 * canonical Y.Doc-backed State.
 *
 * Per Decision D, the P11.0+ editor carries both representations.
 * `rebuildStateFromLegacy` is called after every legacy action mutation
 * to refresh `state` from the post-mutation `stateLegacy`.
 * `downgradeToStateNode` is the inverse — P11.0 doesn't call it (no
 * migrated handlers yet), but it ships so P11.1+ handlers can pick it up
 * immediately.
 *
 * At P11.4 cutover the rebuild direction goes away (state becomes
 * canonical); at P15 the downgrade direction goes away (stateLegacy is
 * deleted).
 */
import * as Y from "yjs";
import type { StateNode } from "../state/state-node-legacy";
import { createNode, createTextNode } from "../state/create-node-legacy";
import type { State } from "../state/state";
import { createState, getBlock } from "../state/state";
import { getBlocksMap } from "../state/yjs-doc";
import { buildYBlock } from "../state/y-block";
import { pathToBlockId } from "../state/path-to-block-id";
import {
  mergeAdjacentTextItems,
  type InlineItem,
  type TextItem,
} from "../state/inline-content";
import type { BlockId } from "../state/block-id";
import type { ReadonlyAttrs } from "../state/attrs";
import type { Style, FontWeight, FontStyle, TextDecoration } from "../styles";

// ----- Rebuild: legacy StateNode → new State -----

/**
 * Rebuild a new-shape `State` from a legacy `StateNode` tree.
 *
 * Walks the StateNode tree top-down; for each StateNode at path P,
 * constructs a Block with id = `pathToBlockId(P)`. Container StateNodes
 * become Container blocks. Inline-bearing leaves (paragraph, heading,
 * list-item, table-cell) collect inline content from their text/span
 * descendants. `text` and `span` StateNodes themselves do NOT become
 * blocks — they collapse into the parent leaf's inline content.
 *
 * Per Decision D, this is called after every legacy-action mutation
 * during the parallel window. BlockIds are path-derived so selection
 * paths translate directly to BlockIds; calling rebuild twice on the
 * same legacy state produces blocks with the same ids.
 *
 * UNDO-STACK PROTECTION: this function uses `doc.transact(fn, "rebuild")`
 * directly. In the current P11.0 wiring this is defensive rather than
 * load-bearing — each call creates a fresh Y.Doc (via createState),
 * and EditorState.history is bound to the original state.doc from
 * createInitialEditorState. The History's Y.UndoManager observes only
 * the original Y.Doc, never the rebuild-output Y.Docs, so even without
 * a tagged origin, rebuild transactions could not reach the undo stack.
 *
 * The tagged origin is kept as a defensive invariant for future
 * refactors where the rebuild output might share a Y.Doc with the
 * History wrapper (e.g., a hypothetical optimization that mutates an
 * existing Y.Doc rather than creating a fresh one). The Y.UndoManager
 * tracks only origin=null per state/history.ts:62, so the "rebuild"
 * tag opts out of tracking regardless of Y.Doc relationship.
 *
 * Throwaway: each call produces a fresh `State` with its own `Y.Doc`;
 * the prior State is GC'd.
 */
export function rebuildStateFromLegacy(legacy: StateNode): State {
  const rootId = pathToBlockId([]);
  const state = createState({ rootId });
  // Tagged origin: "rebuild" — opted out of Y.UndoManager tracking.
  state.doc.transact(() => {
    const yBlocks = getBlocksMap(state.doc);
    walkRebuild(legacy, [], null, null, null, yBlocks);
  }, "rebuild");
  return state;
}

/**
 * Recursively walk the legacy node `node` at `path`, with the given
 * parent / sibling context, and populate `yBlocks` for each block-level
 * StateNode encountered. Inline-bearing leaf nodes (paragraph etc.)
 * collect their text/span children into a single block's inline content.
 */
function walkRebuild(
  node: StateNode,
  path: readonly number[],
  parentId: BlockId | null,
  prevSiblingId: BlockId | null,
  nextSiblingId: BlockId | null,
  yBlocks: Y.Map<Y.Map<unknown>>,
): void {
  const blockId = pathToBlockId(path);
  const kind = classifyLegacyNode(node);

  if (kind === "inlineBearingLeaf") {
    // Collect inline items; drop zero-length text items (legacy uses
    // text("") as a placeholder inside otherwise-empty paragraphs; the
    // new model represents "no content" as items: []). After dropping,
    // merge adjacent text items with equal attrs.
    const collected = collectInlineItems(node, {});
    const nonEmpty = collected.filter(
      (item) => item.kind !== "text" || item.text.length > 0,
    );
    const items = mergeAdjacentTextItems(nonEmpty);
    yBlocks.set(
      blockId,
      buildYBlock({
        type: node.type,
        attrs: legacyPropertiesToAttrs(node),
        parentId,
        prevSiblingId,
        nextSiblingId,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items },
      }),
    );
    return;
  }

  // Container: recurse into block children, wiring sibling/parent
  // pointers.
  const children = node.children;
  const firstChildId =
    children.length === 0 ? null : pathToBlockId([...path, 0]);
  const lastChildId =
    children.length === 0
      ? null
      : pathToBlockId([...path, children.length - 1]);

  yBlocks.set(
    blockId,
    buildYBlock({
      type: node.type,
      attrs: legacyPropertiesToAttrs(node),
      parentId,
      prevSiblingId,
      nextSiblingId,
      firstChildId,
      lastChildId,
      inlineContent: null,
    }),
  );

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childPath = [...path, i];
    const childPrev = i === 0 ? null : pathToBlockId([...path, i - 1]);
    const childNext =
      i === children.length - 1 ? null : pathToBlockId([...path, i + 1]);
    walkRebuild(child, childPath, blockId, childPrev, childNext, yBlocks);
  }
}

/**
 * Classify a legacy StateNode for the rebuild walker.
 *
 * - `inlineBearingLeaf`: a paragraph/heading/list-item/table-cell style
 *   node whose children are text or span StateNodes (or that has no
 *   children, but whose type is inline-bearing).
 * - `container`: a node whose children are blocks (document, list,
 *   table, table-row, section, etc.).
 *
 * For nodes with mixed children (would be a malformed legacy tree), we
 * throw with a clear error.
 */
type LegacyNodeKind = "inlineBearingLeaf" | "container";

const INLINE_CHILD_TYPES = new Set(["text", "span"]);

function classifyLegacyNode(node: StateNode): LegacyNodeKind {
  if (node.type === "text" || node.type === "span") {
    // text/span should never reach the walker as a block — they're
    // collapsed into their parent's inline content. This is a defensive
    // guard against malformed input.
    throw new Error(
      `rebuildStateFromLegacy: encountered top-level "${node.type}" node ` +
        `(text/span should be children of an inline-bearing leaf, not blocks)`,
    );
  }

  if (node.children.length === 0) {
    // No children — classification by type. Inline-bearing leaf types
    // produce empty inline content; container types produce empty
    // children.
    return isInlineBearingLeafType(node.type) ? "inlineBearingLeaf" : "container";
  }

  let sawInline = false;
  let sawBlock = false;
  for (const child of node.children) {
    if (INLINE_CHILD_TYPES.has(child.type)) {
      sawInline = true;
    } else {
      sawBlock = true;
    }
  }
  if (sawInline && sawBlock) {
    throw new Error(
      `rebuildStateFromLegacy: legacy node type="${node.type}" has mixed ` +
        `inline (text/span) and block children — malformed tree`,
    );
  }
  return sawInline ? "inlineBearingLeaf" : "container";
}

/**
 * Type-level hint: which legacy types are inline-bearing leaves when
 * they happen to have zero children. Used as a tiebreaker only when
 * children.length === 0; non-empty nodes are classified by their actual
 * children's types in `classifyLegacyNode`.
 */
function isInlineBearingLeafType(type: string): boolean {
  return (
    type === "paragraph" ||
    type === "heading" ||
    type === "list-item" ||
    type === "table-cell"
  );
}

/**
 * Collect inline items from an inline-bearing leaf node's children.
 * Spans contribute their `style`-translated attrs (and recurse into
 * their own children); text nodes produce TextItems carrying the
 * accumulated attrs from any enclosing spans.
 *
 * Each text item is left un-merged here; the caller passes the result
 * through `mergeAdjacentTextItems` to normalize.
 */
function collectInlineItems(
  node: StateNode,
  ambientAttrs: ReadonlyAttrs,
): InlineItem[] {
  const out: InlineItem[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const content = readTextContent(child);
      const merged = mergeReadonlyAttrs(ambientAttrs, legacyStyleToAttrs(child.style));
      const item: TextItem = {
        kind: "text",
        text: content,
        attrs: merged,
      };
      out.push(item);
    } else if (child.type === "span") {
      const spanAttrs = legacyStyleToAttrs(child.style);
      const merged = mergeReadonlyAttrs(ambientAttrs, spanAttrs);
      // Recurse — span children are text/span. Append their items.
      const inner = collectInlineItems(child, merged);
      for (const item of inner) out.push(item);
    } else {
      // We shouldn't reach here — classifyLegacyNode rejected mixed
      // children. Defensive throw.
      throw new Error(
        `collectInlineItems: unexpected child type "${child.type}" inside ` +
          `inline-bearing leaf "${node.type}"`,
      );
    }
  }
  return out;
}

function readTextContent(textNode: StateNode): string {
  const raw = textNode.properties.content;
  return typeof raw === "string" ? raw : "";
}

/**
 * Translate a legacy `Style` (CSS-shaped fields) to the new attrs model.
 *
 * Boolean-toggle attrs (recognized by the built-in cascade
 * interpreters):
 *   - fontWeight: "bold" → attrs.bold: true
 *   - fontStyle: "italic" → attrs.italic: true
 *   - textDecoration: "underline" → attrs.underline: true
 *
 * Pass-through attrs (same key as the cascade interpreter):
 *   - fontFamily, fontSize, color, backgroundColor
 *
 * Other legacy Style fields are copied verbatim under their original
 * key. The new cascade will no-op unknown keys.
 */
function legacyStyleToAttrs(style: Readonly<Style>): ReadonlyAttrs {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (key === "fontWeight") {
      if (isBoldFontWeight(value as FontWeight)) {
        out.bold = true;
      } else {
        // non-bold weights pass through verbatim
        out.fontWeight = value;
      }
      continue;
    }
    if (key === "fontStyle") {
      if ((value as FontStyle) === "italic" || (value as FontStyle) === "oblique") {
        out.italic = true;
      } else {
        out.fontStyle = value;
      }
      continue;
    }
    if (key === "textDecoration") {
      if ((value as TextDecoration) === "underline") {
        out.underline = true;
      } else {
        out.textDecoration = value;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

function isBoldFontWeight(value: FontWeight): boolean {
  if (value === "bold" || value === "bolder") return true;
  if (typeof value === "number") return value >= 600;
  return false;
}

function mergeReadonlyAttrs(
  a: ReadonlyAttrs,
  b: ReadonlyAttrs,
): ReadonlyAttrs {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length === 0) return b;
  if (bKeys.length === 0) return a;
  const out: Record<string, unknown> = { ...a };
  for (const key of bKeys) {
    out[key] = b[key];
  }
  return out;
}

/**
 * Translate non-style legacy node properties into Block.attrs. Excludes
 * the `content` key (which belongs on text items, not blocks). Spans of
 * `style` are handled separately via `legacyStyleToAttrs`.
 *
 * For block-level nodes the `properties` bag carries arbitrary metadata
 * (e.g. heading level, listType). We copy it verbatim — the new cascade
 * will pick up whatever it recognizes.
 */
function legacyPropertiesToAttrs(node: StateNode): ReadonlyAttrs {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.properties)) {
    if (key === "content") continue; // text-only field; not a block attr
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  // Block-level styling — same translation as inline (e.g. heading
  // styles, table cell backgrounds). Merge style-derived attrs on top of
  // properties-derived attrs.
  const styleAttrs = legacyStyleToAttrs(node.style);
  for (const key of Object.keys(styleAttrs)) {
    out[key] = styleAttrs[key];
  }
  return out;
}

// ----- Downgrade: new State → legacy StateNode -----

/**
 * Reduce a new-shape `State` to a legacy `StateNode` tree. Inverse of
 * `rebuildStateFromLegacy`. Walks the block tree starting at
 * `state.rootId`; for each Block constructs a StateNode of the same
 * type with children = recurse into child blocks (containers) or
 * expanded text/span StateNodes from inlineContent.items (leaves).
 *
 * For each TextItem: produces a `text` StateNode with
 * `properties.content = item.text`. If the item has any
 * style-equivalent attrs (bold/italic/underline/etc.), wraps the text
 * in a `span` StateNode whose `style` translates those attrs back to
 * the legacy CSS-shaped fields.
 *
 * For each EmbedItem: throws — P11.0 does not yet support embed
 * round-tripping; P11.x will add it.
 *
 * P11.0 ships this helper but does NOT call it (no migrated handlers
 * yet). P11.1+ migrated handlers will call `downgradeToStateNode` after
 * their Layer 3 ops to refresh `stateLegacy` so the legacy renderer
 * keeps rendering the up-to-date document.
 */
export function downgradeToStateNode(state: State): StateNode {
  return walkDowngrade(state, state.rootId, 0);
}

function walkDowngrade(
  state: State,
  blockId: BlockId,
  idCounter: number,
): StateNode {
  const block = getBlock(state, blockId);
  if (block === null) {
    throw new Error(
      `downgradeToStateNode: block id "${blockId}" missing from State`,
    );
  }

  if (block.inlineContent !== null) {
    // Inline-bearing leaf: expand items into text/span StateNode
    // children.
    const children = expandInlineItemsToStateNodes(
      block.inlineContent.items,
      `${block.id}-it`,
    );
    return createNode(
      block.id,
      block.type,
      attrsToLegacyProperties(block.attrs),
      children,
      attrsToLegacyStyle(block.attrs),
    );
  }

  // Container: recurse into firstChildId/sibling chain.
  const children: StateNode[] = [];
  let cursor: BlockId | null = block.firstChildId;
  let childCounter = idCounter;
  while (cursor !== null) {
    const child = walkDowngrade(state, cursor, childCounter++);
    children.push(child);
    const childBlock = getBlock(state, cursor);
    if (childBlock === null) {
      throw new Error(
        `downgradeToStateNode: child id "${cursor}" missing mid-walk`,
      );
    }
    cursor = childBlock.nextSiblingId;
  }

  return createNode(
    block.id,
    block.type,
    attrsToLegacyProperties(block.attrs),
    children,
    attrsToLegacyStyle(block.attrs),
  );
}

/**
 * Build legacy text/span StateNode children from an inline-content
 * items array. Items with empty attrs become plain `text` nodes; items
 * with style-equivalent attrs are wrapped in a `span` carrying the
 * translated style.
 */
function expandInlineItemsToStateNodes(
  items: ReadonlyArray<InlineItem>,
  idBase: string,
): StateNode[] {
  const out: StateNode[] = [];
  let counter = 0;
  for (const item of items) {
    if (item.kind === "embed") {
      throw new Error(
        `downgradeToStateNode: embed items not supported in P11.0 round-trip`,
      );
    }
    const textId = `${idBase}-t${counter++}`;
    const styleFromAttrs = attrsToLegacyStyle(item.attrs);
    const hasStyle = Object.keys(styleFromAttrs).length > 0;
    if (hasStyle) {
      const text = createTextNode(textId, item.text);
      const spanId = `${idBase}-s${counter++}`;
      const span = createNode(spanId, "span", {}, [text], styleFromAttrs);
      out.push(span);
    } else {
      // Empty-attrs text item → plain text node.
      out.push(createTextNode(textId, item.text));
    }
  }
  return out;
}

/**
 * Translate a new attrs bag back to a legacy Style. Inverse of
 * `legacyStyleToAttrs` for the common cases. Boolean attrs are
 * deliberately not propagated when false (the absence convention).
 */
function attrsToLegacyStyle(attrs: ReadonlyAttrs): Readonly<Style> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "bold") {
      if (value === true) out.fontWeight = "bold";
      continue;
    }
    if (key === "italic") {
      if (value === true) out.fontStyle = "italic";
      continue;
    }
    if (key === "underline") {
      if (value === true) out.textDecoration = "underline";
      continue;
    }
    if (
      key === "fontFamily" ||
      key === "fontSize" ||
      key === "color" ||
      key === "backgroundColor" ||
      key === "fontWeight" ||
      key === "fontStyle" ||
      key === "textDecoration"
    ) {
      out[key] = value;
      continue;
    }
    // Unknown keys — drop, since they belong to block.properties, not
    // block.style. attrsToLegacyProperties picks them up.
  }
  return out as Readonly<Style>;
}

/**
 * Extract the non-style attrs (block metadata like heading level,
 * listType) into a legacy properties bag.
 */
function attrsToLegacyProperties(
  attrs: ReadonlyAttrs,
): Readonly<Record<string, unknown>> {
  const STYLE_ATTR_KEYS = new Set([
    "bold",
    "italic",
    "underline",
    "fontFamily",
    "fontSize",
    "color",
    "backgroundColor",
    "fontWeight",
    "fontStyle",
    "textDecoration",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (STYLE_ATTR_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
