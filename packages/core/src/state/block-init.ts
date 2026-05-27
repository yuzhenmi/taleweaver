import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";

/**
 * Public input shape for inserting a new block. Mirrors `Block` minus the
 * structural pointers (parentId / prevSiblingId / nextSiblingId /
 * firstChildId / lastChildId) — those are derived by the insertion op
 * from the insertion-site arguments.
 *
 * Semantics by block kind (see `block-kinds.ts`):
 *   - inline-bearing-leaf (paragraph, heading, list-item):
 *     `inlineContent` carries the items; `children` MUST be undefined or
 *     empty.
 *   - atomic-leaf (image, horizontal-line):
 *     neither `inlineContent` nor `children` is populated (both
 *     null/undefined/empty).
 *   - container (document, list, table, table-row, table-cell, etc.):
 *     `children` carries the BlockInit subtree; `inlineContent` MUST be
 *     null or undefined.
 *
 * The INSERT_NODE handler dispatches on `resolver.getBlockKind(type)` and
 * validates that the inlineContent / children fields match the kind;
 * mismatches throw.
 */
export interface BlockInit {
  readonly type: string;
  readonly attrs?: ReadonlyAttrs;
  readonly inlineContent?: InlineContent;
  readonly children?: ReadonlyArray<BlockInit>;
}
