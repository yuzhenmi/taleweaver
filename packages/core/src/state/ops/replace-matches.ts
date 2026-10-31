import type { Document, OperationResult } from "../state";
import { attrRegistryOf } from "../mark-attrs";
import { requireBlockText } from "../block-text";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import {
  splitInlineContentAtOffset,
  attrsAtOffset,
  type InlineItem,
} from "../inline-content";
import type { BlockTreeKind } from "../yjs-doc";
import { removeBlockStorage, deleteUnits } from "../flow-ops";
import { inlineItemsFromYText, writeReplacementText } from "../y-inline";
import { bookmarkDeletionSpan } from "./delete-range";
import { createPosition, createSpan } from "../block-position";
import { collectEmbedContentSubtreeFromInlineContent } from "../embed-content-cascade";
import type { TextMatch } from "../find-matches";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).

/**
 * One match replacement inside a block: delete `[start, end)` — the match's span as a
 * deletion acts on it ({@link bookmarkDeletionSpan}), removing `removedBookmarks` —
 * then insert `text` (with `attrs`) at `start` (as typing over a selection).
 */
export interface MatchReplacement {
  readonly start: number;
  readonly end: number;
  readonly removedBookmarks: ReadonlySet<string>;
  readonly text: string;
  readonly attrs: ReadonlyAttrs;
}

/**
 * One block's replacements, in DESCENDING `start` order (so each offset write
 * leaves the earlier matches' offsets valid). `kind` is the tree the block lives
 * in (always `"block"`/main for `findMatches`-sourced matches, but threaded for
 * symmetry with `replaceRange`'s tree-awareness so this primitive is correct if a
 * future caller passes embed/template-body matches).
 */
export interface BlockWrite {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly replacements: ReadonlyArray<MatchReplacement>;
}

/**
 * Pre-computed plan for `replaceAllMatches` (the REPLACE_ALL editor action's
 * state primitive). `blockWrites` holds one entry per affected block with ALL
 * the block's match replacements as offset writes (descending), applied in ONE
 * transaction — no other character in the block is touched.
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
 * Pure planner for REPLACE_ALL. Groups `matches` by block, applies each block's
 * matches RIGHT-TO-LEFT (descending `start`) so each replacement's offsets stay
 * valid against the still-unmodified prefix, and emits one `BlockWrite` per
 * affected block plus the cascaded embed-content ids.
 *
 * `matches` MUST be in document order and, within a block, ascending +
 * non-overlapping (the `findMatches` contract). The within-block ascending /
 * non-overlapping property is asserted.
 *
 * Pure — no mutation; reads the immutable `Document` snapshot.
 */
export function planReplaceMatches(
  state: Document,
  matches: readonly TextMatch[],
  replacement: string,
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
    // it; a violation means malformed input that would corrupt the replacements).
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

    const items: ReadonlyArray<InlineItem> = block.inlineContent.items;
    const replacements: MatchReplacement[] = [];

    // Apply RIGHT-TO-LEFT: an earlier match's [start,end) is unaffected by a
    // later match's replacement. We iterate the (ascending) array in reverse.
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
      const { span, removed } = bookmarkDeletionSpan(state, createSpan(createPosition(blockId, m.start), createPosition(blockId, m.end)));
      replacements.push({ start: span.anchor.offset, end: span.focus.offset, removedBookmarks: removed, text: replacement, attrs });
    }

    blockWrites.push({ blockId, kind, replacements });
  }

  return { blockWrites, embedContentIdsToDelete };
}

/**
 * Apply a `ReplaceAllPlan` to `state` in ONE `applyOperation` (= ONE Y
 * transaction = ONE undo step). Each replacement is an offset
 * delete + insert on the block's inline `Y.Text`. Embed bodies referenced by removed slices are
 * cascade-deleted from the embedContents map inside the same transaction.
 *
 * No-op (returns the input state reference, empty dirtyIds) when there are no
 * block writes (e.g. empty `matches`) — `applyOperation` already short-circuits
 * an empty transaction, so the identity contract holds.
 */
export function replaceAllMatches(
  state: Document,
  matches: readonly TextMatch[],
  replacement: string,
): OperationResult {
  const plan = planReplaceMatches(state, matches, replacement);
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
  state: Document,
  plan: ReplaceAllPlan,
): OperationResult {
  return applyOperation(state, (doc) => {
    const registry = attrRegistryOf(doc);
    for (const w of plan.blockWrites) {
      const yText = requireBlockText(doc, w.blockId, "replaceAllMatches");
      // ONE read per block; replacements are descending, so its offsets stay valid.
      // `yText.id`: the first write into an implicit run materializes it under a new id.
      const live = inlineItemsFromYText(yText);
      for (const r of w.replacements) {
        deleteUnits(doc, { spans: [{ id: yText.id, from: r.start, to: r.end, items: live }], removedBookmarks: r.removedBookmarks });
        writeReplacementText(yText, live, r.start, r.end, r.text, r.attrs, registry);
      }
    }
    for (const id of plan.embedContentIdsToDelete) removeBlockStorage(doc, id);
  });
}
