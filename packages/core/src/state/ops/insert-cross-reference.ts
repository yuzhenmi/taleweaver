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
import type { PageFieldNumberStyle } from "../page-field";

/** The `embedType` discriminant for a cross-reference field. */
export const CROSS_REFERENCE_EMBED_TYPE = "cross-reference";

/**
 * What a cross-reference DISPLAYS about its target. v1 modes resolve at RENDER
 * time (no layout dependency): `"number"` → the target's counter (a numbered
 * `list-item`); `"text"` → the target's text (a heading / paragraph / list-item).
 * `"page"` → the 1-based page number the target block lands on (a LAYOUT-dependent
 * value resolved after pagination, NOT at render time — it carries a
 * {@link PageFieldNumberStyle} for formatting, like a page-field). Heading-number /
 * footnote-number / bookmark targets are deferred to separate whole-feature follow-ups.
 */
export type CrossReferenceMode = "number" | "text" | "page";

/**
 * Pre-computed plan for `insertCrossReference`: the host leaf's tree provenance
 * plus the new `items[]` with the `cross-reference` EmbedItem spliced in at
 * `position.offset`. An embed is a merge barrier, so this is always a
 * full-replace of the leaf's inlineContent.
 */
interface CrossReferenceInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Insert a cross-reference field at `position`, atomically (ONE `applyOperation`
 * transaction → one undo entry, one collab event). Splices a `cross-reference`
 * `EmbedItem` carrying `properties: { targetId, refMode }` into the cursor leaf's
 * `inlineContent`. For `refMode === "page"` the properties additionally carry a
 * `numberStyle` (defaulting to `"decimal"`); other modes store no `numberStyle`.
 *
 * Unlike `insertFootnote`, a cross-reference OWNS NOTHING — `targetId` is a POINTER
 * to an existing block, not an owned embed body. So:
 *   - The pointer lives in `properties.targetId` (NOT `contentBlockId`), so the
 *     embed-cascade scanners (`assertNoOrphanedEmbedContent` /
 *     `assertNoSharedEmbedContent` / `anyDirtyBlockHasEmbedRef`), which all key on
 *     `contentBlockId`, correctly IGNORE it. No embedContents body is created.
 *   - Removing the reference removes only the inline item (existing inline delete
 *     handles atomic embeds); the target is untouched. Removing the TARGET leaves a
 *     dangling reference — a LEGAL state the renderer shows as a broken reference.
 *
 * The op TRUSTS a validated `targetId` (the editor handler validates that the
 * target resolves to a main-tree block of the right kind for `refMode`, BEFORE
 * calling — it has no render-time numbering map and does not validate the target
 * here). It DOES validate the host position.
 *
 * `dirtyIds` covers the host leaf block (its inlineContent changed) —
 * `captureDirtyIds` tracks the tree maps automatically.
 *
 * Throws if:
 *   - `position.blockId` does not resolve to a block.
 *   - the host is not a leaf (no `inlineContent`).
 *   - `position.offset` is outside `[0, inlineContentLength(content)]`.
 */
export function insertCrossReference(
  state: State,
  position: Position,
  targetId: BlockId,
  refMode: CrossReferenceMode,
  numberStyle: PageFieldNumberStyle = "decimal",
): OperationResult {
  const plan = planCrossReferenceInsert(state, position, targetId, refMode, numberStyle);
  return applyOperation(state, (doc) => {
    insertCrossReferenceInTx(doc, plan);
  });
}

/**
 * Validate `position` and produce the insertion plan (the new leaf `items[]` with
 * a `cross-reference` EmbedItem spliced in at `position.offset`). All snapshot
 * reads + validation happen here, BEFORE the surrounding `applyOperation` opens.
 */
function planCrossReferenceInsert(
  state: State,
  position: Position,
  targetId: BlockId,
  refMode: CrossReferenceMode,
  numberStyle: PageFieldNumberStyle,
): CrossReferenceInsertPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertCrossReference: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(
      `insertCrossReference: block "${position.blockId}" is not a leaf (no inlineContent)`,
    );
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertCrossReference: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  // `"page"` is a layout-dependent reference (resolved after pagination) and carries a
  // formatting `numberStyle`, like a page-field. `"number"`/`"text"` resolve at render
  // time with no number style — their `properties` stay byte-identical to before.
  const properties =
    refMode === "page"
      ? Object.freeze({ targetId, refMode, numberStyle })
      : Object.freeze({ targetId, refMode });
  const reference: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: CROSS_REFERENCE_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties,
  });

  const [left, right] = splitInlineContentAtOffset(block.inlineContent, position.offset);
  // An embed is a merge barrier, so `mergeAdjacentTextItems` only normalizes the
  // split halves around it — it never merges across the reference.
  const items = mergeAdjacentTextItems([...left, reference, ...right]);

  return { blockId: position.blockId, kind, items };
}

/**
 * In-transaction primitive: full-replace the host leaf's inlineContent with the
 * pre-computed `plan.items` (reference spliced in). Caller owns the surrounding
 * transaction. Routes the write to the leaf's owning tree (`plan.kind`) so a
 * reference inside a header/footer or a footnote body mutates the correct Y.Map.
 */
function insertCrossReferenceInTx(doc: Y.Doc, plan: CrossReferenceInsertPlan): void {
  requireInTransaction(doc, "insertCrossReference");
  const yBlock = getYBlock(doc, plan.blockId, "insertCrossReference", plan.kind);
  yBlock.set("inlineContent", buildYInlineContent({ items: plan.items }));
}
