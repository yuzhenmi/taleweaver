import type { Document, OperationResult } from "../document";
import { applyOperation, getBlock } from "../document";
import type { BlockId } from "../block-id";
import { deleteUnits, joinWithNext } from "../flow-ops";
import { liveMarks } from "../mark-index";

/**
 * Delete the section break that ENDS section `sectionId` (Word), in
 * ONE step: the break is the ¶ of the section's last paragraph P, so deleting it
 * merges P with the next paragraph by the paragraph rule (`joinWithNext`: a non-empty
 * P's formatting is applied to the survivor; an empty P is removed) and the sections
 * merge — the content joins the FOLLOWING section and takes its attrs (no section-attr
 * copy). Next to an object the ¶ goes through `deleteUnits`, whose invariant-I skip
 * may keep it.
 *
 * Identity no-op (input `document`, empty `dirtyIds`) for the final section (it has no
 * break) and when invariant I keeps the break. Throws when `sectionId` does not exist
 * or is not a doc-root section.
 */
export function deleteSectionBreak(document: Document, sectionId: BlockId): OperationResult {
  const section = getBlock(document, sectionId);
  if (section === null) throw new Error(`deleteSectionBreak: section "${sectionId}" not found`);
  if (section.type !== "section" || section.parentId !== document.rootId) {
    throw new Error(`deleteSectionBreak: block "${sectionId}" is not a section`);
  }
  const last = section.lastChildId;
  if (section.nextSiblingId === null || last === null) return { document, dirtyIds: new Set<BlockId>() };
  let changed = false;
  const r = applyOperation(document, (doc) => {
    if (joinWithNext(doc, last) !== null) {
      changed = true;
      return;
    }
    changed = deleteUnits(doc, { items: [...liveMarks(doc, sectionId)] }).size > 0;
  });
  return changed ? r : { document, dirtyIds: new Set<BlockId>() };
}
