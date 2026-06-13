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

/** The `embedType` discriminant for a tab. */
export const TAB_EMBED_TYPE = "tab";

/**
 * Pre-computed plan for `insertTab`: the host leaf's tree provenance plus the new
 * `items[]` with the `tab` EmbedItem spliced in at `position.offset`. An embed is
 * a merge barrier, so this is always a full-replace of the leaf's inlineContent.
 */
interface TabInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Insert a tab at `position`, atomically (ONE `applyOperation` transaction → one
 * undo entry, one collab event). Splices the existing atomic `tab` `EmbedItem`
 * into the cursor leaf's `inlineContent`.
 *
 * A tab is a BODYLESS atomic embed (mirrors `insertCrossReference` minus the
 * pointer properties): it OWNS NOTHING — no `embedContents` body, no
 * `contentBlockId` — so the embed-cascade scanners ignore it. It occupies exactly
 * ONE position-offset unit; the IFC resolves its position-dependent advance at
 * layout time (S3+), not in state.
 *
 * `dirtyIds` covers the host leaf block (its inlineContent changed) —
 * `captureDirtyIds` tracks the tree maps automatically.
 *
 * Throws if:
 *   - `position.blockId` does not resolve to a block.
 *   - the host is not a leaf (no `inlineContent`).
 *   - `position.offset` is outside `[0, inlineContentLength(content)]`.
 */
export function insertTab(state: State, position: Position): OperationResult {
  const plan = planTabInsert(state, position);
  return applyOperation(state, (doc) => {
    insertTabInTx(doc, plan);
  });
}

/**
 * Validate `position` and produce the insertion plan (the new leaf `items[]` with
 * a `tab` EmbedItem spliced in at `position.offset`). All snapshot reads +
 * validation happen here, BEFORE the surrounding `applyOperation` opens.
 */
function planTabInsert(state: State, position: Position): TabInsertPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertTab: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(
      `insertTab: block "${position.blockId}" is not a leaf (no inlineContent)`,
    );
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertTab: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const tab: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: TAB_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({}),
  });

  const [left, right] = splitInlineContentAtOffset(block.inlineContent, position.offset);
  // An embed is a merge barrier, so `mergeAdjacentTextItems` only normalizes the
  // split halves around it — it never merges across the tab.
  const items = mergeAdjacentTextItems([...left, tab, ...right]);

  return { blockId: position.blockId, kind, items };
}

/**
 * In-transaction primitive: full-replace the host leaf's inlineContent with the
 * pre-computed `plan.items` (tab spliced in). Caller owns the surrounding
 * transaction. Routes the write to the leaf's owning tree (`plan.kind`) so a tab
 * inside a header/footer or a footnote body mutates the correct Y.Map.
 */
function insertTabInTx(doc: Y.Doc, plan: TabInsertPlan): void {
  requireInTransaction(doc, "insertTab");
  const yBlock = getYBlock(doc, plan.blockId, "insertTab", plan.kind);
  yBlock.set("inlineContent", buildYInlineContent({ items: plan.items }));
}
