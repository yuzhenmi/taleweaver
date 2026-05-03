import type { ReadonlyAttrs } from "./attrs";
import type { BlockId } from "./block-id";
import type { InlineContent } from "./inline-content";

/**
 * A single block in the document tree.
 *
 * - Container blocks (section, list, table, table-row, etc.) hold child
 *   blocks via the firstChildId/lastChildId linked list and have no
 *   inlineContent of their own.
 * - Leaf blocks (paragraph, list-item, heading, table-cell, etc.) carry
 *   inlineContent (text runs + embed items) and have no children.
 *
 * All sibling/child links are by id; resolving them requires the parent
 * State.blocks map.
 */
export interface Block {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly parentId: BlockId | null;
  readonly prevSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
  readonly firstChildId: BlockId | null;
  readonly lastChildId: BlockId | null;
  readonly inlineContent: InlineContent | null;
}

export interface CreateBlockArgs {
  id: BlockId;
  type: string;
  attrs?: ReadonlyAttrs;
  parentId?: BlockId | null;
  prevSiblingId?: BlockId | null;
  nextSiblingId?: BlockId | null;
  firstChildId?: BlockId | null;
  lastChildId?: BlockId | null;
  inlineContent?: InlineContent | null;
}

export function createBlock(args: CreateBlockArgs): Block {
  return Object.freeze({
    id: args.id,
    type: args.type,
    attrs: Object.freeze({ ...(args.attrs ?? {}) }),
    parentId: args.parentId ?? null,
    prevSiblingId: args.prevSiblingId ?? null,
    nextSiblingId: args.nextSiblingId ?? null,
    firstChildId: args.firstChildId ?? null,
    lastChildId: args.lastChildId ?? null,
    inlineContent: args.inlineContent ?? null,
  });
}
