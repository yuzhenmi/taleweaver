import { createTextItem, createEmbedItem } from "../state/inline-content";
import type { TextItem, EmbedItem } from "../state/inline-content";
import type { ReadonlyAttrs } from "../state/attrs";

/**
 * Convenience wrappers around createTextItem / createEmbedItem for use in
 * tests. Identical behavior; shorter call sites.
 */
export function text(content: string, attrs?: ReadonlyAttrs): TextItem {
  return createTextItem(content, attrs);
}

export function embed(
  embedType: string,
  properties?: Readonly<Record<string, unknown>>,
  attrs?: ReadonlyAttrs,
): EmbedItem {
  return createEmbedItem(embedType, properties, attrs);
}

import { createBlock, type Block, type CreateBlockArgs } from "../state/block";
import { createPersistentMap } from "../state/persistent-map";
import { createState, type State } from "../state/state";
import type { BlockId } from "../state/block-id";

/**
 * Convenience wrapper around createBlock. Accepts plain string ids
 * (cast to BlockId) so test code reads naturally.
 */
export function buildBlock(args: {
  id: string;
  type: string;
  attrs?: Record<string, unknown>;
  parentId?: string | null;
  prevSiblingId?: string | null;
  nextSiblingId?: string | null;
  firstChildId?: string | null;
  lastChildId?: string | null;
  inlineContent?: import("../state/inline-content").InlineContent | null;
}): Block {
  const opts: CreateBlockArgs = {
    id: args.id as BlockId,
    type: args.type,
    attrs: args.attrs,
    parentId: (args.parentId ?? null) as BlockId | null,
    prevSiblingId: (args.prevSiblingId ?? null) as BlockId | null,
    nextSiblingId: (args.nextSiblingId ?? null) as BlockId | null,
    firstChildId: (args.firstChildId ?? null) as BlockId | null,
    lastChildId: (args.lastChildId ?? null) as BlockId | null,
    inlineContent: args.inlineContent,
  };
  return createBlock(opts);
}

/**
 * Convenience wrapper that constructs a State from a list of blocks plus
 * a root id. Tests pass blocks in any order; the helper builds the
 * persistent map.
 */
export function buildState(args: { rootId: string; blocks: ReadonlyArray<Block> }): State {
  const entries = args.blocks.map((b) => [b.id, b] as [BlockId, Block]);
  return createState({
    rootId: args.rootId as BlockId,
    blocks: createPersistentMap(entries),
  });
}
