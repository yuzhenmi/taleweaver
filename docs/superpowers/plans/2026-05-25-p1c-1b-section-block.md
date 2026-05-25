# P1.C.1b — `section` block + `reparentChildren` + `SECTION_BREAK` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit `section` block type that is layout-transparent (computes
`display: contents`), a reusable `reparentChildren` Layer-3 state primitive that moves
N existing blocks between parents in one transaction, and a `SECTION_BREAK` editor
action that splits the document into flat sections at the cursor.

**Architecture:** A `section` is a *container* block whose component renders
`display: contents`, so C.1a's `flattenContents` already makes it transparent to the
BFC/IFC/paginator — a section in the tree lays out identically to its children spliced
into the document root. Sections are FLAT children of the document root (never nested,
Word/Docs rule). `SECTION_BREAK` is a single atomic Layer-3 op (`applySectionBreak`)
that creates section blocks and reparents body blocks in ONE Y.Doc transaction, mirroring
how `replaceRange` composes `deleteRangeInTx` + `insertTextInTx`. Page-break + per-section
page geometry + header/footer templates are explicitly DEFERRED to C.2 — in C.1b a section
is inert structural data with no visible effect on section-less documents.

**Tech Stack:** TypeScript, Yjs (`Y.Doc`/`Y.Map`), vitest. State module
`packages/core/src/state/`, components `packages/core/src/components/`, editor
`packages/core/src/editor/`.

---

## Decisions locked before implementation

These were settled during planning (recon: explorer report + `replaceRange`/`split-node`
read). They are NOT open questions for the implementer.

1. **`display: contents` comes from the section COMPONENT, not an attr interpreter.**
   The component's `render` calls `createElementBox(view.id, { display: "contents" }, children)`.
   No cascade/render/layout change is needed — C.1a's `flattenContents` already handles
   `display: contents` in `groupChildren`, `build-fit-metas`, `virtual-producer`,
   `paginate`, `intrinsic-sizes-pass`, and `ifc`. (Recon §A.)

2. **Section-attrs interpreter is DEFERRED to C.2.** The section page-geometry settings
   (`pageInlineSize`, `pageMargins`, `pageNumberStart`, …) are read by the PAGINATOR,
   which gains section-awareness in C.2. They are NOT `ComputedStyle` properties, so a
   cascade `AttrRegistry` interpreter is the wrong vehicle and nothing consumes them in
   C.1b (YAGNI). C.1b creates sections with an empty `attrs` bag; C.2 adds the interpreter
   + paginator wiring. **This narrows the spec's C.1b list — update the spec (Task 7).**

3. **`SECTION_BREAK` is ONE atomic transaction.** `applySectionBreak` is a single
   published Layer-3 op that internally creates the section container(s) and reparents
   bodies inside one `applyOperation` (mirrors `replaceRange` T12 atomicity). The editor
   handler calls this ONE op, so it has ONE `dirtyIds` set and no multi-transaction
   intermediate state (matters for future collab). `reparentChildren` is ALSO published as
   a standalone reusable op (spec R3) sharing the same `reparentChildrenInTx` core.

4. **Block-level boundary semantics (per spec §"SECTION_BREAK reducer").** The break does
   NOT split the cursor's paragraph. It operates on the **boundary block** = the
   document-root child at/under which the cursor sits (found via `ancestorChain`). Blocks
   before the boundary form section A; the boundary block + following siblings form section
   B. Cursor lands at `{ firstLeafBlock(B), 0 }`.

5. **Break-at-container-start is a NO-OP (avoids empty containers; gives a real T7 no-op
   path).** If the boundary is the FIRST child of its container (`containerId` = root for an
   implicit doc, or the enclosing section S for an explicit doc) — i.e. there are no blocks
   before the boundary to put in the "before" section — then `SECTION_BREAK` does nothing:
   `applySectionBreak` returns `{ state, dirtyIds: <empty>, newCursorBlockId: cursor.blockId }`
   with the input `state` reference unchanged (T7 identity). Rationale: splitting before the
   first block would create an empty leading section, which is pointless while sections are
   inert in C.1b (no page break yet) and violates the non-empty-container invariant. Applies
   to BOTH the implicit and explicit cases uniformly. (C.2 may revisit leading sections once a
   page break makes a blank leading section meaningful — note in the spec, Task 7.) **This is
   the ONLY no-op path; every other valid break always mutates** (so the handler's T7
   `result.state === editor.state` guard is meaningful, not dead code).

6. **Sections never nest (dev assert).** `applySectionBreak` asserts in dev mode that a
   created section's parent is the document root, and that the resolved enclosing container is
   either the document root or a single (non-nested) `section`.

---

## File structure

- Create `packages/core/src/components/section.ts` — `sectionComponent` (container, `display: contents`).
- Modify `packages/core/src/components/component-registry.ts` — register `sectionComponent`.
- Create `packages/core/src/state/reparent-children.ts` — `planReparentChildren`,
  `reparentChildrenInTx`, public `reparentChildren`.
- Create `packages/core/src/state/section-break.ts` — `applySectionBreak`,
  `SectionBreakResult`.
- Modify `packages/core/src/state/operations.ts` — re-export `reparentChildren`,
  `applySectionBreak`.
- Modify `packages/core/src/editor/editor-action.ts` — add `SECTION_BREAK` union member.
- Create `packages/core/src/editor/actions/section-break.ts` — `handleSectionBreak`.
- Modify `packages/core/src/editor/actions/index.ts` — export handler.
- Modify `packages/core/src/editor/editor-state.ts` — add `case "SECTION_BREAK"`.
- Tests alongside each (`*.test.ts`) + one editor-level integration test.

---

## Task 1: `section` component (display: contents) + registration

**Files:**
- Create: `packages/core/src/components/section.ts`
- Modify: `packages/core/src/components/component-registry.ts` (`createDefaultComponentRegistry`)
- Test: `packages/core/src/components/section.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// section.test.ts
import { describe, it, expect } from "vitest";
import { createDefaultComponentRegistry } from "./component-registry";
import { sectionComponent } from "./section";

describe("sectionComponent", () => {
  it("is registered as a container kind", () => {
    const reg = createDefaultComponentRegistry();
    expect(reg.getBlockKind("section")).toBe("container");
  });

  it("renders an ElementBox with display: contents", () => {
    const node = sectionComponent.render(
      { id: "sec1", type: "section", attrs: {} } as never,
      {} as never,
      [],
    );
    expect(node.type).toBe("element");
    if (node.type !== "element") throw new Error("?");
    expect(node.style).toEqual({ display: "contents" });
    expect(node.key).toBe("sec1");
  });
});
```

- [ ] **Step 2: Run it; confirm it fails** (`sectionComponent` undefined).
  Run: `npm test --workspace=packages/core -- --run section.test`

- [ ] **Step 3: Implement** — copy `packages/core/src/components/document.ts` shape exactly,
  changing `type`, and `display`:

```typescript
// packages/core/src/components/section.ts
import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * A `section` is a pagination-level grouping of body blocks. It is LAYOUT-
 * TRANSPARENT: it computes `display: contents` (CSS Display 3 §3.2), so its
 * children lay out as if they were direct children of the section's parent
 * (the document root). C.1a's `flattenContents` handles the transparency
 * across the whole layout pipeline; the paginator's per-section page-break +
 * geometry is layered on top in C.2 (keyed on `type === "section"`). In C.1b
 * a section is inert: a section-less document is unaffected, and an explicit
 * section reflows its body exactly as if its children were direct doc-root
 * children.
 */
export const sectionComponent: ContainerComponentDefinition = {
  type: "section",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "contents" }, childRenderNodes),
};
```

  Register it in `component-registry.ts` `createDefaultComponentRegistry` next to the other
  `reg.register(...)` calls (import `sectionComponent`). Verify the exact `render` signature
  matches `ContainerComponentDefinition` in `component-definition.ts` and adjust the test's
  `as never` casts to the real `view`/`ctx` types if the signature differs.

- [ ] **Step 4: Run tests; confirm pass.**

- [ ] **Step 5: Layout-transparency equivalence test (drive the REAL pipeline).** In a new
  `packages/core/src/components/section-layout.test.ts`: build two states via
  `buildStateFromBlocks` (`packages/core/src/state/build-state-from-blocks.ts`) — (1) doc root
  children `[para, section([paraA, paraB]), para]`, (2) doc root children `[para, paraA, paraB,
  para]`. Construct the registry with `createDefaultComponentRegistry()` (already includes
  `documentComponent`, `paragraphComponent`, and — after Step 3 — `sectionComponent`); get the
  attr registry the same way the editor does. Call `render(state, componentRegistry,
  attrRegistry)` for each, then `cascadePass(...)` then `layoutTree(...)` (match the arg order
  used in `packages/core/src/layout/display-contents.test.ts` / an existing render→layout
  integration test). Assert the two materialized layout trees are `toEqual` (geometry-identical),
  and that no box's `key` equals the section block's id. This exercises `sectionComponent.render`
  for real (not a hand-built RenderNode).

- [ ] **Step 6: Commit** (controller does this after review — do NOT commit in the implementer).

---

## Task 2: `reparentChildren` Layer-3 op

**Files:**
- Create: `packages/core/src/state/reparent-children.ts`
- Modify: `packages/core/src/state/operations.ts` (re-export)
- Test: `packages/core/src/state/reparent-children.test.ts`

**Signature:**
```typescript
/** A single resolved Y-block field write. `value: null` clears the pointer. */
export interface BlockFieldWrite {
  readonly blockId: BlockId;
  readonly field: "parentId" | "prevSiblingId" | "nextSiblingId" | "firstChildId" | "lastChildId";
  readonly value: BlockId | null;
}
/** Fully-resolved relink: a flat list of writes computed against pre-mutation state. */
export interface ReparentPlan {
  readonly writes: readonly BlockFieldWrite[];
}
/** Pure: compute the relink write-list. Used by BOTH callers. */
export function computeReparentWrites(opts: {
  moved: readonly BlockId[];                  // contiguous source-sibling run, doc order
  sourceParentId: BlockId;
  sourceFirstChildId: BlockId | null;         // source parent's current firstChildId
  sourceLastChildId: BlockId | null;
  movedPrevSiblingId: BlockId | null;         // sibling before moved[0] in source (null if moved[0] was first)
  movedNextSiblingId: BlockId | null;         // sibling after moved[last] in source (null if last)
  newParentId: BlockId;
  newParentFirstChildId: BlockId | null;      // null when the new parent is a fresh/empty container
  newParentLastChildId: BlockId | null;
  beforeSiblingId: BlockId | null;            // insert before this existing child of newParent (append if null)
  beforeSiblingPrevId: BlockId | null;        // that child's current prevSiblingId
}): readonly BlockFieldWrite[];
export function planReparentChildren(
  state: State,
  blockIds: readonly BlockId[],
  newParentId: BlockId,
  beforeSiblingId?: BlockId | null,
): ReparentPlan;                              // validates against pre-mutation state; throws on failure
/** PURE applier — reads nothing; applies each write via getYBlock(doc,id).set(field,value). */
export function reparentChildrenInTx(doc: Y.Doc, plan: ReparentPlan): void;
export function reparentChildren(
  state: State,
  blockIds: readonly BlockId[],
  newParentId: BlockId,
  beforeSiblingId?: BlockId | null,
): OperationResult;                           // applyOperation(state, () => reparentChildrenInTx(doc, plan))
```

**Semantics:** Move `blockIds` — an ordered, **contiguous run of siblings under a single
source parent** (M5: not an arbitrary set) — into `newParentId`, inserted before
`beforeSiblingId` (or appended if null). The moved blocks keep their relative document order.
One Y.Doc transaction; `dirtyIds` captured automatically (source parent, new parent, all moved
blocks, all touched siblings). `planReparentChildren` throws if the ids are not a contiguous
sibling run (each `blockIds[i+1]` must equal `getBlock(blockIds[i]).nextSiblingId`) — the
field-write spec below relies on this so it can unlink the run as a whole.

**Two callers, two paths (C1/I1 — read carefully):**
- The **public `reparentChildren`** op and its `planReparentChildren` are for moving into an
  **already-existing** `newParentId` (validated against the pre-mutation `state` snapshot).
  This is the reusable R3 primitive (future: outline drag-reorder).
- `applySectionBreak` (Task 3) moves blocks into **freshly-created** section containers that
  do NOT exist in the pre-mutation `state` snapshot. It therefore does **NOT** call
  `planReparentChildren` (which would `getBlock(state, freshSectionId) === null` → throw).
  Instead it builds the `ReparentPlan` inline. This is clean because the new sections are
  EMPTY: an empty new-parent's resolved writes are trivial (`newParent.firstChildId = moved[0]`,
  `newParent.lastChildId = moved[last]`, no existing children to splice among), so the whole
  plan is precomputable from the pre-tx `state` snapshot with no read of the not-yet-existing
  section's pointers.

**`reparentChildrenInTx` is a PURE WRITE-APPLIER (resolves C1/I1).** It reads NOTHING — not
the `state` snapshot, not the live Y.Doc. It takes a fully-resolved `ReparentPlan` (a list of
`{ blockId, field, value }` writes) and applies each via `getYBlock(doc, id).set(field, value)`.
All pointer values are computed BEFORE the transaction by the plan builder (`planReparentChildren`
for the public op; inline for `applySectionBreak`), against the pre-mutation state. This sidesteps
every mid-transaction read hazard — including the multi-move sequencing hazard where moving the
"before" run would leave the "atAfter" run's source pointers in an intermediate state (both runs'
writes are computed against the SAME pre-tx snapshot, then applied together). A shared pure helper
`computeReparentWrites(opts)` (exact field names in the signature below:
`moved, sourceParentId, sourceFirstChildId, sourceLastChildId, movedPrevSiblingId,
movedNextSiblingId, newParentId, newParentFirstChildId, newParentLastChildId, beforeSiblingId,
beforeSiblingPrevId`) produces the write list for both callers; for the fresh-empty-section
case the caller passes `newParentFirstChildId = newParentLastChildId = null`.

**Validation (`planReparentChildren`, against pre-mutation `state`):**
- **Empty `blockIds` → NO-OP** (M-NEW-1, locked): the public `reparentChildren` returns
  `{ state, dirtyIds: new Set() }` with `state` unchanged (consistent with T7 — `computeReparentWrites([])`
  yields an empty write-list). It does NOT throw. (Non-existent ids in a NON-empty list still throw, below.)
- Every `blockId` exists (`getBlock !== null`); else throw `reparentChildren: block <id> not found`.
- `newParentId` exists and is a container (`inlineContent === null`); else throw.
- No `blockId` is an ancestor of `newParentId` (would create a cycle); use `ancestorChain`.
  Throw `reparentChildren: cannot reparent a block under its own descendant`.
- `beforeSiblingId`, if non-null, is a current child of `newParentId`; else throw.
- **`beforeSiblingId` must NOT be a member of `blockIds`** (I-NEW-1): otherwise a same-parent
  move would write `mk.nextSiblingId = beforeSiblingId` where the target is itself a moved
  block, producing a cyclic/undefined sibling chain. Throw
  `reparentChildren: beforeSiblingId cannot be one of the moved blocks`.

**The relink write-list (`computeReparentWrites` — derived from `insert-block.ts:94–118`
+ `remove-block.ts:98–131`).** Because `moved = [m0..mk]` is a CONTIGUOUS source-sibling run,
its internal `prev/nextSiblingId` chain is preserved unchanged; only the run's ENDS, the run's
`parentId`, the source parent's pointers, and the new parent's insertion point are rewritten:
- *Detach run from source*: `sourceFirstChildId === m0` → write `sourceParent.firstChildId =
  movedNextSiblingId`; `sourceLastChildId === mk` → `sourceParent.lastChildId =
  movedPrevSiblingId`; if `movedPrevSiblingId` non-null → its `nextSiblingId = movedNextSiblingId`;
  if `movedNextSiblingId` non-null → its `prevSiblingId = movedPrevSiblingId`.
- *Re-parent the run*: each `mi.parentId = newParentId` (internal m0…mk sibling pointers
  untouched).
- *Attach run into new parent*:
  - append (`beforeSiblingId === null`): `m0.prevSiblingId = newParentLastChildId`,
    `mk.nextSiblingId = null`; if `newParentLastChildId` non-null → its `nextSiblingId = m0`,
    else `newParent.firstChildId = m0`; `newParent.lastChildId = mk`.
  - before an existing child B (`beforeSiblingId = B`): `m0.prevSiblingId = beforeSiblingPrevId`,
    `mk.nextSiblingId = B`, `B.prevSiblingId = mk`; if `beforeSiblingPrevId` non-null → its
    `nextSiblingId = m0`, else `newParent.firstChildId = m0`.

  (Emit each as a `BlockFieldWrite`; de-dup if a block gets two writes to the same field — last
  wins, but the algorithm above never conflicts.)

`reparentChildrenInTx` then applies the list: `for (const w of plan.writes)
getYBlock(doc, w.blockId, "reparentChildren").set(w.field, w.value)`. It never calls
`runTransaction` (not reentrant — recon §C) and never reads block state.

**Self-move guard:** if `newParentId === sourceParentId` AND the target position is the run's
current position, `computeReparentWrites` returns `[]` (no-op). The public `reparentChildren`
maps an empty write-list to the T7 no-op (`{ state, dirtyIds: ∅ }` with `state` unchanged).

- [ ] **Step 1: Write failing tests** covering, with explicit chain assertions (read back
  via `getBlock` and verify `parentId`/`prevSiblingId`/`nextSiblingId`/`firstChildId`/
  `lastChildId` on every affected block):
  - Move a single middle child from parent P to parent Q (append).
  - Move a contiguous run `[b2,b3]` from P to Q before an existing child of Q.
  - Move the FIRST child of P (updates P.firstChildId) and the LAST child (updates P.lastChildId).
  - Move into an empty container Q (Q.firstChildId/lastChildId become the run ends).
  - `dirtyIds` contains P, Q, all moved blocks, and the re-linked siblings.
  - Validation throws: missing block; newParent is a leaf; cycle (reparent ancestor under descendant); bad `beforeSiblingId`.
  - No-op contract: empty `blockIds` returns `result.state === state`.

- [ ] **Step 2: Run; confirm fail.**
  Run: `npm test --workspace=packages/core -- --run reparent-children.test`
- [ ] **Step 3: Implement** per the field-write spec; re-export from `operations.ts`.
- [ ] **Step 4: Run; confirm pass.** Run `npm run build --workspace=packages/core` (no TS errors).
- [ ] **Step 5: Commit** (controller, post-review).

---

## Task 3: `applySectionBreak` Layer-3 op (atomic)

**Files:**
- Create: `packages/core/src/state/section-break.ts`
- Modify: `packages/core/src/state/operations.ts` (re-export)
- Test: `packages/core/src/state/section-break.test.ts`

**Signature:**
```typescript
export interface SectionBreakResult extends OperationResult {
  /** Cursor target after the break: first leaf of the boundary block's subtree.
   *  Equals `cursor.blockId` when the break was a no-op (Decision 5). */
  readonly newCursorBlockId: BlockId;
}
export function applySectionBreak(
  state: State,
  cursor: Position,
  allocator: IdAllocator,    // mirror split-block's allocator param
): SectionBreakResult;
```

**Step A — resolve container + boundary (pre-tx; ONE unambiguous pass; resolves C2).**
1. `chain = ancestorChain(state, cursor.blockId)` (cursor block → … → root). If it does not
   reach `state.rootId`, throw `applySectionBreak: cursor block not under document root`.
2. Find the enclosing section: `S = chain.find(id => { const b = getBlock(state, id); return
   b !== null && b.type === "section" && b.parentId === state.rootId; }) ?? null`.
   (At most one — sections are flat doc-root children and never nest, Decision 6.)
3. `containerId = S ?? state.rootId`.
4. `boundary` = the element of `chain` whose `parentId === containerId` (the direct child of
   `containerId` that contains the cursor). Always exists given step 1.
   *(`isExplicit = S !== null`.)*

**Step B — no-op guard (Decision 5; resolves I2 + I3).** If `boundary` is `containerId`'s
FIRST child (`getBlock(state, containerId).firstChildId === boundary`), return
`{ state, dirtyIds: new Set(), newCursorBlockId: cursor.blockId }` — the input `state`
reference UNCHANGED (T7). No empty leading section is created, in BOTH the implicit and
explicit cases.

**Step C — collect the run + capture pre-tx pointers.** Walk `containerId`'s child chain;
`before = [first .. boundary)`, `atAfter = [boundary .. last]`. After Step B, `before` is
always non-empty. For the explicit case, ALSO capture `sOldNext` NOW (pre-tx): read
`const sBlock = getBlock(state, S); if (sBlock === null) throw …;` then
`const sOldNext = sBlock.nextSiblingId;` (narrowing, NOT a non-null assertion — the no-`!`
rule is load-bearing). It is needed in Step D to relink S' into the doc-root sibling chain, and
`reparentChildrenInTx` reads nothing so it cannot be read mid-transaction.

**Step D — mutate (ONE `applyOperation`).** Allocate section id(s) via `allocator`. Build
empty section container Y.Maps with `buildYBlock` (`type:"section"`, `attrs:{}`,
`inlineContent:null`, `firstChildId/lastChildId/prevSiblingId/nextSiblingId:null`,
`parentId: state.rootId`) and `getBlocksMap(doc).set(id, yBlock)` INSIDE the transaction. Then:
- **Implicit (`!isExplicit`):** create A and B. Reparent `before → A` and `atAfter → B` via
  `reparentChildrenInTx` (build each `ReparentPlan` inline via `computeReparentWrites` with
  `newParentFirst/Last = null` since A/B are fresh-empty; source = root). Set
  `root.firstChildId = A`, `root.lastChildId = B`, `A.nextSiblingId = B`, `B.prevSiblingId = A`,
  `A.prevSiblingId = null`, `B.nextSiblingId = null`.
- **Explicit (`isExplicit`):** create S'. Reparent `atAfter → S'`. `before` stays in S (so set
  `S.lastChildId = before[last]`, `before[last].nextSiblingId = null`). Insert S' as a flat
  doc-root sibling immediately AFTER S (using the pre-tx `sOldNext` from Step C):
  `S'.prevSiblingId = S`, `S'.nextSiblingId = sOldNext`, `S.nextSiblingId = S'`; if `sOldNext`
  non-null → `sOldNext.prevSiblingId = S'`, else `root.lastChildId = S'`.
- All writes go through `reparentChildrenInTx` (for the reparents) + a handful of direct
  `getYBlock(doc, id).set(...)` calls (for the section-chain links) — ALL inside the single
  `applyOperation` callback.

**Step E — dev assert (Decision 6):** each created section's `parentId === state.rootId`; the
resolved `S` (if any) was a direct, non-nested doc-root section.

**Step F — return cursor.** `newCursorBlockId = firstLeafBlock(result.state, boundary) ?? boundary`.
The boundary block keeps its id and subtree (only its parent moved), so this resolves on the
post-op state; the `?? boundary` fallback satisfies the `BlockId` (non-null) return type for the
defensive case where `firstLeafBlock` returns null (I-NEW-3). (Resolves I4 — single, unambiguous
computation.)

**Inherit attrs:** B inherits A's attrs (implicit) / S' inherits S's attrs (explicit). In
C.1b attrs are always `{}` (Decision 2), so all created sections get `attrs: {}`. Leave a
`// C.2: copy source-section attrs here` marker at the section-build site.

- [ ] **Step 1: Write failing tests** (build docs via `build-state-from-blocks` or direct
  Y.Doc seeding; assert structure via `getBlock` chains + `dirtyIds` + returned cursor):
  - Implicit doc `[p1,p2,p3,p4]`, cursor in p3 → root children become `[A,B]`; A children
    `[p1,p2]`, B children `[p3,p4]`; both A,B `type:"section"`, `parentId:root`; A.attrs={},
    B.attrs={}; `newCursorBlockId === firstLeaf(p3)`; `dirtyIds` ⊇ {root,A,B,p1,p2,p3,p4}.
  - **No-op at start (Decision 5):** implicit doc, cursor in p1 (the FIRST top-level block) →
    `result.state === state` (same reference), `dirtyIds` empty, `newCursorBlockId === p1`. No
    section created.
  - **Nested boundary (M2):** implicit doc `root → [p1, list([li1,li2]), p2]`, cursor in `li1`
    → boundary = `list`; root children `[A,B]`; A children `[p1]`, B children `[list, p2]`;
    cursor = `firstLeaf(list)` (= li1). Asserts the boundary is the top-level child, not the
    cursor's own block.
  - Explicit doc (already `[S([p1,p2,p3])]` from a prior break), cursor in p2 → root children
    `[S, S']`; S children `[p1]`; S' children `[p2,p3]`; cursor = firstLeaf(p2).
  - **Explicit no-op (I2):** doc `[S([p1,p2])]`, cursor in p1 (S's first child) → `result.state
    === state`, no S' created, `newCursorBlockId === p1`.
  - Dev assert fires if a malformed input would nest sections (e.g. construct and expect throw).
  - Atomicity: a single `applyOperation` — assert one `dirtyIds` set is returned (no second op).
- [ ] **Step 2: Run; confirm fail.**
  Run: `npm test --workspace=packages/core -- --run section-break.test`
- [ ] **Step 3: Implement** using `reparentChildrenInTx` + raw section creation; re-export from
  `operations.ts`. Reuse `firstLeafBlock`/`ancestorChain` from `block-traversal.ts`.
- [ ] **Step 4: Run; confirm pass + `npm run build`.**
- [ ] **Step 5: Commit** (controller, post-review).

---

## Task 4: `SECTION_BREAK` editor action + handler

**Files:**
- Modify: `packages/core/src/editor/editor-action.ts` (add `| { type: "SECTION_BREAK" }`)
- Create: `packages/core/src/editor/actions/section-break.ts` (`handleSectionBreak`)
- Modify: `packages/core/src/editor/actions/index.ts` (export)
- Modify: `packages/core/src/editor/editor-state.ts` (`case "SECTION_BREAK": return handleSectionBreak(editor, config);`)
- Test: `packages/core/src/editor/actions/section-break.test.ts`

**Handler (mirror `handleSplitNode` / `handleSetBlockType`):**
```typescript
export function handleSectionBreak(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const focus = editor.selection.focus;
  if (getBlock(editor.state, focus.blockId) === null) return editor;

  const result = applySectionBreak(editor.state, focus, productionAllocator);

  // T7 identity contract: a no-op op returns the same state reference.
  if (result.state === editor.state) return editor;

  const cursor = createPosition(result.newCursorBlockId, 0);
  const selectionAfter = createSpan(cursor, cursor);

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    result.dirtyIds,
  );
}
```

- [ ] **Step 1: Write failing test** (build an `EditorState` via the existing test harness —
  copy setup from `split-node.test.ts`): dispatch `{ type: "SECTION_BREAK" }` with the cursor
  in p3 of `[p1..p4]`; assert the new `editor.state` root children are two `section`s, the
  selection focus is `{ firstLeaf(p3), 0 }`, and the layout/render rebuilt without error.
- [ ] **Step 2: Run; confirm fail.**
  Run: `npm test --workspace=packages/core -- --run "actions/section-break"`
- [ ] **Step 3: Implement** the union member, handler, barrel export, and reducer case. Ensure
  the `reduceEditor` exhaustiveness `satisfies never` still type-checks.
- [ ] **Step 4: Run; confirm pass + `npm run build`.**
- [ ] **Step 5: Commit** (controller, post-review).

---

## Task 5: Editor-level behavior + undo/redo integration test

**Files:**
- Test: `packages/core/src/editor/section-break-integration.test.ts`

- [ ] **Step 1: Write the test** (real `EditorState` + `EditorConfig`, multi-paragraph doc):
  - **Transparency:** capture the `layoutTree` (materialized positioned tree via
    `resolvePositionedTree` if virtual) before the break; dispatch `SECTION_BREAK`; assert the
    materialized layout is geometrically IDENTICAL (paragraphs at the same y-positions) — a
    section is layout-transparent in C.1b (no page break yet).
  - **Cursor:** selection focus is at `{ firstLeaf(boundary), 0 }`.
  - **Undo:** `history.undo()` restores the pre-break structure (root children are the
    original paragraphs, no sections) AND restores the pre-break selection.
  - **Redo:** `history.redo()` re-applies (sections back, cursor at new section start).
- [ ] **Step 2: Run; confirm fail (or red where applicable).**
- [ ] **Step 3:** No new impl expected — this test validates Tasks 1–4 composed. Fix any gap it
  exposes in the relevant task's file.
- [ ] **Step 4: Run full suites:**
  `npm test --workspace=packages/core -- --run` and `--workspace=packages/dom`. Both green.
- [ ] **Step 5: Commit** (controller, post-review).

---

## Task 6: Architecture doc update

**Files:**
- Modify: `docs/architecture/1-core/1.1-state.md` — in the Layer-3 operations section (the
  list/table that enumerates `insertBlock`, `removeBlock`, `splitBlockAtPosition`, etc.), add
  `reparentChildren` (bulk-move a contiguous sibling run between parents, one transaction) and
  `applySectionBreak` (composite atomic op: create section(s) + reparent). If the doc has a
  block-type / block-kind taxonomy, add `section` as a container kind.
- Modify: whichever doc enumerates block types / components (grep `docs/architecture/` for
  "paragraph" / "block kind" / component registry; likely `1-core/overview.md` or a render
  doc) — add `section`: container, computes `display: contents`, a pagination-level grouping
  that is transparent to the BFC/IFC (its body lays out as direct children of the doc root);
  per-section page geometry + page break are a paginator concern (target state, not yet wired).

- [ ] **Step 1:** Update the docs to describe the target state (no roadmap/plan framing, no
  unstable numbers — per CLAUDE.md architecture-doc rules). Walk top-down from
  `docs/architecture/overview.md` for interface coherence (the state→render→layout seam now
  carries a `display: contents` element + a new Layer-3 op).
- [ ] **Step 2: Commit** (controller — this is a docs-only mechanical change; still bundle with
  the feature, but it does not itself require a code-review pass).

---

## Task 7: Spec reconciliation

**Files:**
- Modify: `docs/superpowers/specs/2026-05-25-p1c-block-model-remapping.md`

- [ ] **Step 1:** Update the "Revised buildable order" C.1b bullet to record Decision 2
  (section-attrs interpreter DEFERRED to C.2) and Decision 5 (empty-section-A edge rule), and
  note that `reparentChildren` (R3) landed in C.1b as both a public op and the
  `reparentChildrenInTx` core reused by `applySectionBreak`. Keep it a short addendum note.
- [ ] **Step 2: Commit** (controller, docs-only).

---

## Out of scope for C.1b (do NOT build here)

- Page break between sections / per-section page geometry / active-section tracking → **C.2**.
- `templateContents` Y.Map + `captureDirtyIds`/`findOwningBlockId`/UndoManager extension
  (state-review #270) + unified `resolveBlock` (R4) → **C.2** (sections live in `blocks` in C.1b).
- Header/footer/footnote bodies, PageBox slots, paint, hit-test → C.2/C.3/C.4.
- Section-attrs `AttrRegistry` interpreter → C.2.
- `setBlockType` no-op (#267), paste atomicity (#268) — independent; not on the C.1b path.

## Self-review (writing-plans)

- **Spec coverage:** section type ✓ (T1), `reparentChildren` R3 ✓ (T2), `SECTION_BREAK` ✓
  (T3+T4), transparent-no-page-break ✓ (T1 Step5 + T5), flat-never-nested ✓ (T3 Decision 6).
  Deferred items explicitly carved out ✓.
- **Type consistency:** `ReparentPlan`/`reparentChildrenInTx`/`reparentChildren` names
  consistent T2↔T3; `SectionBreakResult extends OperationResult` adds `newCursorBlockId`,
  used identically in T3 return and T4 handler.
- **Placeholder scan:** all code steps show concrete code or a precise field-write spec; test
  cases enumerated, not "write tests for the above."
