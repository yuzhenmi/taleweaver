import type { TextItem, EmbedItem, InlineContent, ReadonlyAttrs, BlockId, Block, State } from "../state";
import { buildStateFromBlocks } from "../state/build-state-from-blocks";

const EMPTY_ATTRS: ReadonlyAttrs = Object.freeze({});

export function text(content: string, attrs?: ReadonlyAttrs): TextItem {
  return Object.freeze({
    kind: "text",
    text: content,
    attrs: attrs ? Object.freeze({ ...attrs }) : EMPTY_ATTRS,
  });
}

export function embed(
  embedType: string,
  properties?: Readonly<Record<string, unknown>>,
  attrs?: ReadonlyAttrs,
): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType,
    attrs: attrs ? Object.freeze({ ...attrs }) : EMPTY_ATTRS,
    properties: Object.freeze({ ...(properties ?? {}) }),
  });
}

/**
 * Build a frozen InlineContent fixture from a list of items. Test-only
 * wrapper around the bare `{ items }` shape — production code constructs
 * InlineContent directly via Y.Doc helpers, not through a factory.
 */
export function inlineContent(items: ReadonlyArray<TextItem | EmbedItem>): InlineContent {
  return Object.freeze({ items: Object.freeze([...items]) });
}

export function buildBlock(args: {
  id: string;
  type: string;
  attrs?: Record<string, unknown>;
  parentId?: string | null;
  prevSiblingId?: string | null;
  nextSiblingId?: string | null;
  firstChildId?: string | null;
  lastChildId?: string | null;
  inlineContent?: InlineContent | null;
}): Block {
  return Object.freeze({
    id: args.id as BlockId,
    type: args.type,
    attrs: args.attrs ? Object.freeze({ ...args.attrs }) : EMPTY_ATTRS,
    parentId: (args.parentId ?? null) as BlockId | null,
    prevSiblingId: (args.prevSiblingId ?? null) as BlockId | null,
    nextSiblingId: (args.nextSiblingId ?? null) as BlockId | null,
    firstChildId: (args.firstChildId ?? null) as BlockId | null,
    lastChildId: (args.lastChildId ?? null) as BlockId | null,
    inlineContent: args.inlineContent ?? null,
  });
}

/**
 * Build a Y.Doc-backed State from a list of Block-shape fixtures.
 * Each block is materialized into the Y.Doc's blocks map.
 *
 * Optional `embedContents` parameter materializes embed-content blocks
 * (footnote bodies, etc.) into the Y.Doc's embedContents map instead.
 * Per Decision A, embed-content blocks live in a separate map from
 * main-tree blocks so the "only root has null parentId" invariant
 * holds for state.blocks. Embed-content blocks typically have parentId
 * === null (no parent — they're referenced via EmbedItem.properties.contentBlockId).
 *
 * Optional `templateContents` parameter materializes template-content
 * blocks (header/footer bodies, etc.) into the Y.Doc's templateContents
 * map. Like embed-content blocks, they live in their own top-level map
 * and typically have parentId === null.
 *
 * Delegates to `buildStateFromBlocks` (state-module-internal); the
 * indirection is what keeps the Y.Doc-direct writes inside `state/`.
 */
export function buildState(args: {
  rootId: string;
  blocks: ReadonlyArray<Block>;
  embedContents?: ReadonlyArray<Block>;
  templateContents?: ReadonlyArray<Block>;
}): State {
  return buildStateFromBlocks({
    rootId: args.rootId as BlockId,
    blocks: args.blocks,
    embedContents: args.embedContents,
    templateContents: args.templateContents,
  });
}
