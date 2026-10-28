import type * as Y from "yjs";
import { requireBlockText } from "../block-text";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  type EmbedItem,
} from "../inline-content";
import { requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { insertInlineItems } from "../y-inline";
import { PAGE_FIELD_EMBED_TYPE, type PageFieldKind, type PageFieldNumberStyle } from "../page-field";

// Re-export the root-level constants so consumers can import either location.
export { PAGE_FIELD_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS, type PageFieldKind } from "../page-field";

/**
 * Pre-computed plan for `insertPageField`: the host leaf's
 * tree provenance, the insertion offset and the embed — one offset
 * `insertEmbed` into the leaf's inline `Y.Text` (no other character moves).
 */
interface PageFieldInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly offset: number;
  readonly embed: EmbedItem;
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
 * Validate `position` and produce the insertion plan (the embed +
 * offset for
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

  return { blockId: position.blockId, kind, offset: position.offset, embed: field };
}

/**
 * In-transaction primitive: insert the embed into the host leaf's inline
 * `Y.Text` at `plan.offset` (field spliced in). Caller owns the surrounding
 * transaction.
 */
function insertPageFieldInTx(doc: Y.Doc, plan: PageFieldInsertPlan): void {
  requireInTransaction(doc, "insertPageField");
  insertInlineItems(requireBlockText(doc, plan.blockId, "insertPageField"), plan.offset, [plan.embed]);
}
