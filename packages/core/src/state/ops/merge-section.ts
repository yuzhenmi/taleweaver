import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId } from "../block-id";
import { getBlocksMap, getYBlock, allTreeBlockCount } from "../yjs-doc";
import {
  computeReparentWrites,
  reparentChildrenInTx,
  type ReparentPlan,
} from "./reparent-children";
import { STATE_INTERNAL } from "../state-internal";

/**
 * Remove a section break by merging a FLAT doc-root `section` into its
 * previous `section` sibling, in ONE Y.Doc transaction. The exact INVERSE of
 * `applySectionBreak`: where the break splits a section's tail into a fresh
 * trailing section, this appends a section's whole body onto the END of the
 * preceding section, then drops the now-empty section and re-stitches the
 * doc-root sibling chain.
 *
 * Sections are FLAT (`parentId === rootId`, never nested) and contain content
 * blocks directly, so "previous sibling" is unambiguous and is itself a
 * section (the flat-section invariant; a non-section before it ⇒ corrupt
 * state ⇒ throw).
 *
 * No-op (T7 identity): if `sectionId` is the FIRST doc-root section
 * (`prevSiblingId === null`) there is nothing before it to merge into, so the
 * input `state` reference is returned UNCHANGED with empty `dirtyIds`.
 *
 * Atomicity: the body reparent + doc-root relink + section delete all happen
 * inside a single `applyOperation` (one transaction, one `dirtyIds` set),
 * mirroring `applySectionBreak`.
 *
 * Throws when:
 *   - `sectionId` does not exist,
 *   - the block is not a `section`, or is not a flat doc-root section
 *     (`parentId !== state.rootId`),
 *   - the previous doc-root sibling is missing or is not a `section`.
 */
export function mergeSectionWithPrevious(
  state: State,
  sectionId: BlockId,
): OperationResult {
  // --- Step A: validate the target section (pre-tx, against the snapshot) ---
  const section = getBlock(state, sectionId);
  if (section === null) {
    throw new Error(
      `mergeSectionWithPrevious: section "${sectionId}" not found`,
    );
  }
  if (section.type !== "section" || section.parentId !== state.rootId) {
    throw new Error(
      `mergeSectionWithPrevious: block "${sectionId}" is not a flat doc-root section`,
    );
  }

  // --- Step B: no-op guard (no previous section to merge into) ---
  const P = section.prevSiblingId;
  if (P === null) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const prevSection = getBlock(state, P);
  if (prevSection === null || prevSection.type !== "section") {
    throw new Error(
      `mergeSectionWithPrevious: previous doc-root sibling "${P}" of section "${sectionId}" is not a section (corrupt flat-section invariant)`,
    );
  }

  // --- Step C: capture pre-tx pointers (one pass over the snapshot) ---
  // Walk the section's child run [first .. last], cycle-guarded by the total
  // all-tree block count + 1 (same bound `applySectionBreak` and every other
  // cycle-guarded traversal use; see yjs-doc.ts `allTreeBlockCount`).
  const movedChildren: BlockId[] = [];
  {
    let cur: BlockId | null = section.firstChildId;
    let guard = 0;
    const maxSteps = allTreeBlockCount(state[STATE_INTERNAL].doc) + 1;
    while (cur !== null) {
      if (++guard > maxSteps) {
        throw new Error(
          "mergeSectionWithPrevious: cycle detected walking section child chain",
        );
      }
      movedChildren.push(cur);
      const b = getBlock(state, cur);
      if (b === null) {
        throw new Error(
          `mergeSectionWithPrevious: child "${cur}" of section "${sectionId}" not found`,
        );
      }
      cur = b.nextSiblingId;
    }
  }

  const sectionFirstChildId = section.firstChildId;
  const sectionLastChildId = section.lastChildId;
  const sectionNextSiblingId = section.nextSiblingId;
  const prevSectionLastChildId = prevSection.lastChildId;

  // --- Step D: build the reparent plan (only if the section has children) ---
  // Append the whole child run to the END of `prevSection`:
  //   - the run is the section's ENTIRE child list → movedPrev/Next = null,
  //   - append into a (possibly NON-empty) parent → beforeSiblingId = null,
  //     newParentLastChildId = prevSection's current last child.
  // `beforeSiblingPrevId` is unread on the append branch of
  // `computeReparentWrites` (see its docstring) — pass null for honesty.
  let plan: ReparentPlan | null = null;
  if (movedChildren.length > 0) {
    plan = {
      writes: computeReparentWrites({
        moved: movedChildren,
        sourceParentId: sectionId,
        sourceFirstChildId: sectionFirstChildId,
        sourceLastChildId: sectionLastChildId,
        movedPrevSiblingId: null,
        movedNextSiblingId: null,
        newParentId: P,
        newParentLastChildId: prevSectionLastChildId,
        beforeSiblingId: null,
        beforeSiblingPrevId: null,
      }),
    };
  }

  // --- Step E: mutate (one applyOperation) ---
  const captured = plan;
  return applyOperation(state, (doc) => {
    if (captured !== null) {
      reparentChildrenInTx(doc, captured);
    }

    // Re-stitch the doc-root sibling chain to drop `sectionId`.
    const yPrev = getYBlock(doc, P, "mergeSectionWithPrevious");
    yPrev.set("nextSiblingId", sectionNextSiblingId);
    if (sectionNextSiblingId !== null) {
      const yNext = getYBlock(doc, sectionNextSiblingId, "mergeSectionWithPrevious");
      yNext.set("prevSiblingId", P);
    } else {
      const yRoot = getYBlock(doc, state.rootId, "mergeSectionWithPrevious");
      yRoot.set("lastChildId", P);
    }

    // Drop the now-empty section.
    getBlocksMap(doc).delete(sectionId);
  });
}
