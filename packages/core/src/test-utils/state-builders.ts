import type { TextItem, EmbedItem, InlineContent } from "../state/inline-content";
import type { ReadonlyAttrs } from "../state/attrs";
import type { BlockId } from "../state/block-id";
import type { Block } from "../state/block";
import { createState, type State } from "../state/state";
import { runTransaction, getBlocksMap, getEmbedContentsMap } from "../state/yjs-doc";
import { buildYBlock } from "../state/y-block";

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
 */
export function buildState(args: {
  rootId: string;
  blocks: ReadonlyArray<Block>;
  embedContents?: ReadonlyArray<Block>;
}): State {
  const state = createState({ rootId: args.rootId as BlockId });
  runTransaction(state.doc, () => {
    const yBlocks = getBlocksMap(state.doc);
    for (const block of args.blocks) {
      yBlocks.set(
        block.id,
        buildYBlock({
          type: block.type,
          attrs: block.attrs,
          parentId: block.parentId,
          prevSiblingId: block.prevSiblingId,
          nextSiblingId: block.nextSiblingId,
          firstChildId: block.firstChildId,
          lastChildId: block.lastChildId,
          inlineContent: block.inlineContent,
        }),
      );
    }
    if (args.embedContents !== undefined) {
      const yEmbeds = getEmbedContentsMap(state.doc);
      for (const block of args.embedContents) {
        yEmbeds.set(
          block.id,
          buildYBlock({
            type: block.type,
            attrs: block.attrs,
            parentId: block.parentId,
            prevSiblingId: block.prevSiblingId,
            nextSiblingId: block.nextSiblingId,
            firstChildId: block.firstChildId,
            lastChildId: block.lastChildId,
            inlineContent: block.inlineContent,
          }),
        );
      }
    }
  });
  return state;
}
