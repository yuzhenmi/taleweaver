import type { ReadonlyAttrs } from "./attrs";
import type { BlockId } from "./block-id";
import type { InlineContent } from "./inline-content";

/**
 * A single block in the document tree.
 *
 * Container blocks (section, list, table, etc.) hold child blocks via
 * the firstChildId/lastChildId linked list and have no inlineContent.
 * Leaf blocks (paragraph, list-item, heading, table-cell) carry
 * inlineContent and have no children.
 *
 * `Block` is a frozen snapshot view produced by `getBlock(state, id)`;
 * mutations go through Layer 3 ops, not by editing this interface.
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
