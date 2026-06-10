import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  type EmbedItem,
  type InlineItem,
} from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { buildYInlineContent } from "../y-block";
import { PAGE_FIELD_EMBED_TYPE, type PageFieldKind, type PageFieldNumberStyle } from "../page-field";

// Re-export the root-level constants so consumers can import either location.
export { PAGE_FIELD_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS, type PageFieldKind } from "../page-field";

/**
 * Pre-computed plan for `insertPageField`: the host leaf's tree provenance plus
 * the new `items[]` with the `page-field` EmbedItem spliced in at `position.offset`.
 * An embed is a merge barrier, so this is always a full-replace of the leaf's
 * inlineContent.
 */
interface PageFieldInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Insert a page-field (page-number / page-count) at `position`, atomically (ONE
 * `applyOperation` transaction → one undo entry). Splices a `page-field`
 * `EmbedItem` carrying `properties: { fieldKind, numberStyle }` into the cursor
 * leaf's `inlineContent`.
 *
 * Like a cross-reference (and unlike a footnote anchor), a page-field OWNS NOTHING
 * — it has NO `contentBlockId`, so the embed-cascade scanners ignore it and no
 * embedContents body is created. Its value is resolved LATER, from paginated
 * layout (the render-time placeholder is page-agnostic).
 *
 * Routes the write to the leaf's owning tree (`plan.kind`) via `resolveBlock`, so
 * a page-field inside a header / footer body mutates the correct Y.Map.
 *
 * Throws if `position.blockId` does not resolve to a block, the host is not a leaf
 * (no `inlineContent`), or `position.offset` is outside `[0, length]`.
 */
export function insertPageField(
  state: State,
  position: Position,
  fieldKind: PageFieldKind,
  numberStyle: PageFieldNumberStyle = "decimal",
): OperationResult {
  const plan = planPageFieldInsert(state, position, fieldKind, numberStyle);
  return applyOperation(state, (doc) => {
    insertPageFieldInTx(doc, plan);
  });
}

/**
 * Validate `position` and produce the insertion plan (the new leaf `items[]` with
 * a `page-field` EmbedItem spliced in). All snapshot reads + validation happen
 * here, BEFORE the surrounding `applyOperation` opens.
 */
function planPageFieldInsert(
  state: State,
  position: Position,
  fieldKind: PageFieldKind,
  numberStyle: PageFieldNumberStyle,
): PageFieldInsertPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertPageField: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(`insertPageField: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertPageField: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const field: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: PAGE_FIELD_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ fieldKind, numberStyle }),
  });

  const [left, right] = splitInlineContentAtOffset(block.inlineContent, position.offset);
  // An embed is a merge barrier, so `mergeAdjacentTextItems` only normalizes the
  // split halves around it — it never merges across the field.
  const items = mergeAdjacentTextItems([...left, field, ...right]);

  return { blockId: position.blockId, kind, items };
}

/**
 * In-transaction primitive: full-replace the host leaf's inlineContent with the
 * pre-computed `plan.items` (field spliced in). Caller owns the surrounding
 * transaction.
 */
function insertPageFieldInTx(doc: Y.Doc, plan: PageFieldInsertPlan): void {
  requireInTransaction(doc, "insertPageField");
  const yBlock = getYBlock(doc, plan.blockId, "insertPageField", plan.kind);
  yBlock.set("inlineContent", buildYInlineContent({ items: plan.items }));
}
