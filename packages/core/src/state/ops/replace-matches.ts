import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import {
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  attrsAtOffset,
  type InlineItem,
} from "../inline-content";
import type { BlockTreeKind } from "../yjs-doc";
import { getEmbedContentsMap } from "../yjs-doc";
import { collectEmbedContentSubtreeFromInlineContent } from "../embed-content-cascade";
import { insertTextInTx } from "./insert-text";
import type { TextMatch } from "../find-matches";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * One block's post-replacement inline content. `kind` is the tree the block
 * lives in (always `"block"`/main for `findMatches`-sourced matches, but
 * threaded for symmetry with `replaceRange`'s tree-awareness so this primitive
 * is correct if a future caller passes embed/template-body matches).
 */
export interface BlockWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Pre-computed plan for `replaceAllMatches` (the REPLACE_ALL editor action's
 * state primitive). `blockWrites` holds one entry per affected block — its
 * FINAL inline content with ALL the block's matches applied. Composing N
 * per-match `replaceRangeInTx` calls in the same block would not work: each
 * full-replaces the block from its own pre-computed plan, clobbering the prior
 * call. So REPLACE_ALL batches PER BLOCK — compute the block's final content
 * once, then write it once.
 *
 * `embedContentIdsToDelete` is the set of embed-content subtree roots referenced
 * by removed inline slices. Dropping an `EmbedItem` carrying a
 * `properties.contentBlockId` (e.g. a footnote anchor) without deleting its
 * body orphans the body, which the dev invariant `assertNoOrphanedEmbedContent`
 * (run in `applyOperation`) would flag. `findMatches` serializes embeds to
 * U+FFFC so a real text query never spans one, but the planner must still be
 * correct: it cascades these bodies in the same transaction as the block writes.
 */
export interface ReplaceAllPlan {
  readonly blockWrites: ReadonlyArray<BlockWrite>;
  readonly embedContentIdsToDelete: ReadonlySet<BlockId>;
}

/**
 * Replace `[start, end)` of `items` with a single text item carrying `attrs`
 * (omit the text item when `text === ""` → pure deletion). A thin composition
 * over the existing inline-content helpers — no new offset-walking. The
 * `mergeAdjacentTextItems` normalize pass merges adjacent same-attrs runs and
 * drops empty text items, the same canonicalization `insertText`/`deleteRange`
 * apply.
 */
function spliceRun(
  items: ReadonlyArray<InlineItem>,
  start: number,
  end: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InlineItem[] {
  const left = splitInlineContentAtOffset({ items }, start)[0];
  const right = splitInlineContentAtOffset({ items }, end)[1];
  const mid: InlineItem[] = text === "" ? [] : [{ kind: "text", text, attrs }];
  return mergeAdjacentTextItems([...left, ...mid, ...right], registry);
}

/**
 * Pure planner for REPLACE_ALL. Groups `matches` by block, applies each block's
 * matches RIGHT-TO-LEFT (descending `start`) so each splice's offsets stay
 * valid against the still-unmodified prefix, and emits one `BlockWrite` per
 * affected block plus the cascaded embed-content ids.
 *
 * `matches` MUST be in document order and, within a block, ascending +
 * non-overlapping (the `findMatches` contract). The within-block ascending /
 * non-overlapping property is asserted.
 *
 * Pure — no mutation; reads the immutable `State` snapshot.
 */
export function planReplaceMatches(
  state: State,
  matches: readonly TextMatch[],
  replacement: string,
  registry?: AttrRegistry,
): ReplaceAllPlan {
  // Group matches by blockId, preserving first-seen block order. (Within a
  // group, matches keep their input order.)
  const groups = new Map<BlockId, TextMatch[]>();
  for (const m of matches) {
    const existing = groups.get(m.blockId);
    if (existing === undefined) {
      groups.set(m.blockId, [m]);
    } else {
      existing.push(m);
    }
  }

  const blockWrites: BlockWrite[] = [];
  const embedContentIdsToDelete = new Set<BlockId>();

  for (const [blockId, blockMatches] of groups) {
    const resolved = resolveBlock(state, blockId);
    if (resolved === null) {
      throw new Error(`planReplaceMatches: block "${blockId}" not found`);
    }
    const { block, kind } = resolved;
    if (block.inlineContent === null) {
      throw new Error(
        `planReplaceMatches: block "${blockId}" is not a leaf (no inlineContent)`,
      );
    }

    // Assert ascending + non-overlapping within the block (findMatches guarantees
    // it; a violation means malformed input that would corrupt the splice).
    for (let i = 1; i < blockMatches.length; i++) {
      const prev = blockMatches[i - 1];
      const curr = blockMatches[i];
      if (prev === undefined || curr === undefined) continue;
      if (curr.start < prev.end) {
        throw new Error(
          `planReplaceMatches: matches in block "${blockId}" must be ascending and ` +
            `non-overlapping (got [${prev.start},${prev.end}) then [${curr.start},${curr.end}))`,
        );
      }
    }

    let items: ReadonlyArray<InlineItem> = block.inlineContent.items;

    // Apply RIGHT-TO-LEFT: an earlier match's [start,end) is unaffected by a
    // later match's splice. We iterate the (ascending) array in reverse.
    for (let i = blockMatches.length - 1; i >= 0; i--) {
      const m = blockMatches[i];
      if (m === undefined) {
        throw new Error(`planReplaceMatches: match ${i} missing (unreachable)`);
      }
      // Collect embed-content subtree ids referenced by the slice being removed
      // (items[m.start .. m.end)). Split twice to isolate that exact slice.
      const afterStart = splitInlineContentAtOffset({ items }, m.start)[1];
      const removedSlice = splitInlineContentAtOffset(
        { items: afterStart },
        m.end - m.start,
      )[0];
      collectEmbedContentSubtreeFromInlineContent(
        state,
        { items: removedSlice },
        embedContentIdsToDelete,
      );

      // attrs for the replacement = the run containing the match's FIRST char
      // (Google Docs behavior; `findItemAtOffset`'s following-run boundary
      // semantics). NOT `getActiveFormatting`/`cursorTextItem`, which use
      // left-of-cursor caret semantics (the opposite direction).
      const attrs = attrsAtOffset({ items }, m.start);
      items = spliceRun(items, m.start, m.end, replacement, attrs, registry);
    }

    blockWrites.push({ blockId, kind, items });
  }

  return { blockWrites, embedContentIdsToDelete };
}

/**
 * Apply a `ReplaceAllPlan` to `state` in ONE `applyOperation` (= ONE Y
 * transaction = ONE undo step, per brief D5). Each block write is a
 * full-replace of that block's `inlineContent` — `insertTextInTx`'s
 * full-replace branch does exactly `getYBlock(...).set("inlineContent", ...)`,
 * so reuse it directly. Embed bodies referenced by removed slices are
 * cascade-deleted from the embedContents map inside the same transaction.
 *
 * No-op (returns the input state reference, empty dirtyIds) when there are no
 * block writes (e.g. empty `matches`) — `applyOperation` already short-circuits
 * an empty transaction, so the identity contract holds.
 */
export function replaceAllMatches(
  state: State,
  matches: readonly TextMatch[],
  replacement: string,
  registry?: AttrRegistry,
): OperationResult {
  const plan = planReplaceMatches(state, matches, replacement, registry);
  if (plan.blockWrites.length === 0 && plan.embedContentIdsToDelete.size === 0) {
    return { state, dirtyIds: new Set<BlockId>() };
  }
  return applyReplaceAllPlan(state, plan);
}

/**
 * Apply a pre-computed `ReplaceAllPlan` in one transaction. Exposed separately
 * from `replaceAllMatches` so the REPLACE_ALL editor handler can plan once
 * (reading the result for cursor placement) and apply.
 */
export function applyReplaceAllPlan(
  state: State,
  plan: ReplaceAllPlan,
): OperationResult {
  return applyOperation(state, (doc) => {
    for (const w of plan.blockWrites) {
      insertTextInTx(doc, {
        blockId: w.blockId,
        kind: w.kind,
        mode: "full-replace",
        items: w.items,
      });
    }
    if (plan.embedContentIdsToDelete.size > 0) {
      const yEmbeds = getEmbedContentsMap(doc);
      for (const id of plan.embedContentIdsToDelete) {
        yEmbeds.delete(id);
      }
    }
  });
}
