import type { ReadonlyAttrs } from "./attrs";
import type { BlockId } from "./block-id";
import type { InlineContent } from "./inline-content";
import type { BreakSuggestion } from "./break-tags";

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
  /**
   * Pending paragraph-break / section-break suggestion tags stored on this block's
   * mark (see `break-tags.ts`). Absent when the block carries none. Only text blocks
   * and section marks carry tags; a derived duplicate copy (`X@client:clock`) reads
   * without them. Raw ids: consumers that SHOW a tag filter it by record presence.
   */
  readonly breakSuggestion?: BreakSuggestion;
  /**
   * The character props of this paragraph's ¶ (Word's ¶ rPr): the
   * inclusive formatting keys only. Used for an empty paragraph's line metrics, typing
   * into an emptied paragraph and the list marker's formatting. Absent when empty.
   */
  readonly markAttrs?: ReadonlyAttrs;
}
