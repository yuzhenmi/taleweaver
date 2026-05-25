# Section-break removal (Backspace / Delete) — Implementation Plan

> **For agentic workers:** subagent-driven-development; one implementer per task;
> reviewer gate before each commit; TDD with behavior-level editor tests.

**Goal:** Backspace at the start of a section's first block (and Delete at the end of
the previous section's last block) REMOVES the section break — the section's blocks
rejoin the previous section — WITHOUT merging the two boundary paragraphs. Matches
Word / Google Docs, where a section/page break is a discrete deletable unit (a second
Backspace then merges the paragraphs via the normal same-parent path).

**Decision (user, 2026-05-25):** "Remove break, keep paragraphs." NOT "remove break +
merge paragraphs," NOT "leave as no-op."

## Why this is needed (the gap)
`applySectionBreak` wraps the doc into FLAT `section` siblings under the root (each
section holds content blocks directly; sections never nest — see
`packages/core/src/state/section-break.ts`). After a break, the block right after it is
the FIRST child of a DIFFERENT `section` container than the block before it. Both delete
handlers bail on cross-parent merges:
- `delete-backward.ts:84-90` — `if (prevBlock.parentId !== currentBlock.parentId || …) return editor;`
- `delete-forward.ts` — symmetric same-parent guard.
There is no inverse of `applySectionBreak`, so the break can't be removed → no-op.

## Structure (post-break)
`doc > [ … sectionP{ …, pLast }, sectionX{ xFirst, … } … ]` — flat section siblings,
content blocks directly under each section. "Remove the break before X" = move X's
children to the end of P, remove the empty X.

---

## Task 1: `mergeSectionWithPrevious` Layer-3 op

**Files:** Create `packages/core/src/state/merge-section.ts` (+ test); export from
`packages/core/src/state/operations.ts`.

**Signature:**
```ts
export function mergeSectionWithPrevious(
  state: State,
  sectionId: BlockId,
): OperationResult;
```

**Semantics (ONE Y.Doc transaction, mirroring applySectionBreak's atomic structure):**
- Validate `sectionId` is a `section` block with `parentId === rootId` (throw otherwise —
  it's a structural op on a flat doc-root section).
- Find its previous sibling `P = section.prevSiblingId`. If `P === null` (sectionId is the
  first child of root) → NO-OP: return the input `state` ref unchanged, empty dirtyIds
  (T7 identity). `P` MUST also be a `section` (assert; flat-section invariant guarantees
  it). If `P`'s type isn't `section`, throw (corrupt state).
- In one `applyOperation`:
  - Reparent ALL of `sectionId`'s children (the run `firstChildId..lastChildId`) to be
    APPENDED at the end of `P` (after `P.lastChildId`), preserving order. Use the existing
    `computeReparentWrites` + `reparentChildrenInTx` (see how section-break.ts builds a
    `ReparentPlan`): moved = X's child id list; sourceParent = sectionId; newParent = P;
    beforeSiblingId = null (append); movedPrevSiblingId/NextSiblingId per X's chain;
    newParentLastChildId = P.lastChildId. Capture ALL pointers pre-tx.
  - Remove the now-empty `sectionId` from the doc-root sibling chain: rewire
    `P.nextSiblingId = sectionId.nextSiblingId`; if `sectionId.nextSiblingId !== null` set
    that block's `prevSiblingId = P`, else set `root.lastChildId = P`; delete `sectionId`
    from the blocks map. (Build these writes from the pre-tx snapshot.)
- Edge: `sectionId` with NO children (empty section) — reparenting an empty run is a no-op
  for the children; still remove the empty section + relink. (applySectionBreak never makes
  empty sections, but be defensive.)
- dirtyIds: auto-captured (X's children, P, sectionId, X's old next or root).

**TDD (write RED first):** doc with two sections [P{a,b}, X{c,d}] → mergeSectionWithPrevious(X)
→ doc has ONE section P{a,b,c,d}; X gone; a,b,c,d order + sibling chain correct; c.parentId === P;
P.lastChildId === d; root.lastChildId === P. Three-section [P,X,Y] → merge X → [P{...,X's},Y],
Y untouched, Y.prevSibling === P. First-section (prevSibling null) → same-State no-op. Throws on
non-section id / section not under root. dirtyIds exact.

## Task 2: wire into delete-backward + delete-forward

**Files:** Modify `packages/core/src/editor/actions/delete-backward.ts`,
`packages/core/src/editor/actions/delete-forward.ts`; behavior tests in the editor actions
test dir (mirror `section-break.test.ts` harness).

**delete-backward (offset 0, the cross-parent branch that currently bails):** before bailing,
detect the section-boundary case: `currentBlock` is the FIRST child of a `section` X
(`X.firstChildId === currentBlock.id`, `X.parentId === rootId`) AND X has a previous sibling
(a section P). If so → `mergeSectionWithPrevious(X)`; cursor stays at
`{ currentBlock.id, 0 }` (the block kept its id; it just reparented onto the previous page).
Commit + rebuildTrees. Otherwise keep the existing no-op (other cross-parent cases — list/table
boundaries — are separate, out of scope).
- Within-section backspace (cursor at start of a NON-first block of a section) is unchanged:
  prevBlock is the same-parent previous sibling → existing `mergeAdjacentBlocks` path. Only the
  section's FIRST child triggers the cross-section merge.

**delete-forward (offset === end of block, the symmetric cross-parent branch):** detect:
`currentBlock` is the LAST child of a section P (`P.lastChildId === currentBlock.id`,
`P.parentId === rootId`) AND P has a next sibling section X. If so → `mergeSectionWithPrevious(X)`;
cursor stays at `{ currentBlock.id, endOffset }` (end of P's last block). Else existing no-op.

**TDD (behavior-level, through reduceEditor):**
- Backspace at `{ X.firstChild, 0 }` → break removed: doc has one fewer section; X's blocks now
  follow P's; cursor at `{ formerXFirst, 0 }`; the two boundary paragraphs remain SEPARATE
  (not merged). A SECOND Backspace then merges them (normal same-parent path) — assert.
- Delete at `{ P.lastChild, endOffset }` → same structural result; cursor at
  `{ P.lastChild, endOffset }`.
- Backspace at the start of the FIRST section's first block → no-op (start of doc).
- Backspace at start of a non-first block WITHIN a section → unchanged same-parent merge.
- Undo restores the section break.
- Section-less doc: backspace/delete unchanged (no section → existing behavior).

## Out of scope
- Dissolving the LAST remaining lone section back to bare doc children: a single section is
  `display:contents` (transparent, no page break), so visually identical to no-section. Leave
  the lone section; revisit only if a real need appears.
- List/table cross-container backspace (separate gaps).

## Status — COMPLETE
- [x] T1 — mergeSectionWithPrevious op. Commit `8f13bff`.
- [x] T2 — delete-backward / delete-forward wiring + behavior tests. (this commit)

Browser-verify (user): Backspace at the start of a section's first block removes the
break (content rejoins the previous page, paragraphs stay separate; a second
Backspace then merges them); Delete at the end of the previous section does the same.
