# History cleanup — S-C6 (bounded undo depth) + S-C1 (dedupe isDevMode)

> TDD; test fails first. Independent review before commit.
> Source audit: `docs/superpowers/specs/2026-05-23-state-design-review.md`.
> Scope: `packages/core/src/state/history.ts` only (one coherent file). The other
> S-C items (S-C2 Selection alias, S-C3 maxSteps, S-C4 barrel, S-C5 leaf
> shortcut) are deferred to a later cosmetic sweep — see "Deferred" below.

---

## S-C6 — DESCOPED (plan review found the naive approach leaks)

**Status: NOT IMPLEMENTED this cycle — re-scoped as a design investigation (#234).**
The plan-review (well-cited to Yjs source) found that the proposed
`undoManager.undoStack.shift()` trim is WRONG: Yjs pins a StackItem's deleted
content from GC via `keepItem(item, true)` when the item is recorded, and only
RELEASES it (`keepItem(item, false)` via `clearUndoManagerStackItem`) when the
item is popped through `undo()` or discarded through the public `clear()`. A raw
array `.shift()` removes the StackItem reference but never releases the GC hold,
so the deleted content stays pinned FOREVER — the cap would bound the array
length while leaking the memory it was meant to reclaim (worse than no cap, since
it implies a fix that isn't there).

Yjs exposes no partial-clear / capacity API; `clear(true,false)` nukes the whole
undo stack (and triggers a redo-stack clear via its own transaction handler).
Proper bounded-undo needs to release `keepItem` on dropped items, which requires
unexported Yjs internals — fragile coupling not justified for a low-urgency
cleanup. Deferred to #234 pending a design that either (a) drives release through
a public Yjs path, (b) accepts + documents partial reclamation, or (c) confirms
whether `Y.Doc({gc:true})` actually pins this content in our usage. Original
(rejected) design retained below for the record.

### Original design (rejected — leaks GC-pinned content)

`History` accumulates `undoManager.undoStack` entries + aligned
`undoSelectionStack` entries without bound. A long editing session grows undo
memory (Yjs StackItems retain deleted-content references) unboundedly. Google
Docs / typical editors cap undo history. Yjs `UndoManager` has NO built-in
capacity option, so trim manually.

**Design:**
- Module const `DEFAULT_MAX_UNDO_DEPTH = 1000` (generous — bounds memory without
  limiting normal use; a focused session rarely exceeds it).
- `History` constructor takes `maxDepth: number = DEFAULT_MAX_UNDO_DEPTH`; store
  `private readonly maxDepth`. `createHistory(state, maxDepth?)` passes it
  through (backward-compatible default).
- At the END of `commit` (after the push + redo-clear + the existing alignment
  assertion), trim the OLDEST entries while over the cap, keeping the two undo
  stacks aligned:
  ```
  while (this.undoManager.undoStack.length > this.maxDepth) {
    this.undoManager.undoStack.shift(); // drop oldest StackItem (Yjs array)
    this.undoSelectionStack.shift();    // drop its aligned selection entry
  }
  ```
  Dropping the oldest StackItem just forgets the ability to undo PAST that point
  (the Y.Doc content is unaffected; only that undo step is no longer reachable).
  This is the accepted Yjs bounded-undo pattern (no public capacity API; the
  `undoStack` array is a documented public field). Redo stack is untouched, so
  redo alignment is unaffected.

- [ ] **Test (fail first):** `createHistory(state, 3)`; commit 5 distinct real
  ops (`setBlockAttrs` with 5 different bags). Assert: after the 5th commit only
  3 undo entries remain (`undo()` succeeds exactly 3 times, the 4th returns
  `null`); no alignment assertion throws; the 3 retained are the MOST RECENT
  (undo order returns the 5th, 4th, 3rd op's `before` selections). A separate
  assertion: default (no maxDepth arg) does NOT trim at small counts (existing
  multi-commit tests still pass unchanged).

- [ ] **Implement** per design above; document the trim + the "drop oldest =
  forget undo-past-this-point, content unaffected" rationale at the trim site.

## S-C1 — dedupe `isDevMode`

`history.ts:15-19` defines its own `isDevMode()` instead of importing the
identical one from `./dev-mode.ts`.

- [ ] **Implement:** delete the local `isDevMode` function; add
  `import { isDevMode } from "./dev-mode";`. No behavior change (the two
  implementations are byte-identical). Covered by the full existing history
  suite (every dev-mode assertion path still exercised).

---

## Deferred (tracked, not this cycle)
- **S-C2 (#230)** remove `Selection` alias — DEBATABLE value (Selection vs Span
  is a useful editor-vs-state semantic distinction; the alias is harmless) and
  HIGH churn (10+ files incl. the editor's public `EditorAction`/`EditorState`
  types + `index.ts` export). Re-scope #230 as low-value/high-churn; a dedicated
  rename can revisit. NOT a "wrong" call like S-B3 — just not worth the churn now.
- **S-C3 (#231)** hoist `maxSteps` — largely already hoisted (computed once per
  traversal-function call, before the loop). Near-zero value if `Y.Map.size` is
  O(1). Defer / verify in the cosmetic sweep.
- **S-C4 (#232)** move `clonePastedSubtree` out of the mutations barrel; **S-C5
  (#233)** `removeBlock` leaf shortcut — trivial, different files; fold into a
  later "state cosmetic sweep" so this cycle stays one coherent file.

## Verification
- `npm test --workspace=packages/core` green; `npm run build` clean.
- S-C6 test verified to FAIL before the trim is added.
- Independent code-reviewer approves.
