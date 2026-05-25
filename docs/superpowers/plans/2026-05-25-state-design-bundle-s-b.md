# State-design Bundle S-B — correctness gaps (S-B1, S-B2, S-B4)

> TDD; each fix lands a failing test first. Independent review before commit.
> Source audit: `docs/superpowers/specs/2026-05-23-state-design-review.md`.

**Goal:** Close three state-layer correctness gaps from the S-design review.
S-B3 is deliberately EXCLUDED (see rationale) — its audit recommendation
conflicts with a load-bearing render-dirty contract.

---

## S-B1 — `setBlockAttrs` no-op short-circuit

**File:** `packages/core/src/state/set-block-attrs.ts`. Test:
`packages/core/src/state/__tests__/set-block-attrs.test.ts` (extend or create).

`setBlockAttrs` unconditionally does `yBlock.set("attrs", buildYAttrs(attrs))`,
dirtying the block even when `attrs` equals the existing bag — spurious dirty
events cascade into re-render/re-layout. Its sibling `mergeBlockAttrs` already
short-circuits via `attrsEqual`.

- [ ] **Test (fail first):** `setBlockAttrs(state, id, sameAttrs)` ⇒
  `result.state === state` AND `result.dirtyIds.size === 0`; with a DIFFERENT
  bag ⇒ `result.state !== state` and `dirtyIds` contains `id`.
- [ ] **Fix:** import `attrsEqual` from `./attrs`; inside the `applyOperation`
  callback, `if (attrsEqual(block.attrs, attrs)) return;` before the
  `yBlock.set`. Mirror `mergeBlockAttrs` exactly (which relies on
  `applyOperation`'s no-op identity contract to return the input `state`).

## S-B2 — `History.commit` checks its pre-condition BEFORE mutating

**File:** `packages/core/src/state/history.ts` (`commit`, ~158). Test:
`packages/core/src/state/__tests__/history.test.ts`.

`commit` mutates `currentState`, calls `stopCapturing`, and pushes the selection
stack BEFORE the dev-mode stack-alignment assertion. A no-op commit (the
forbidden misuse) throws only AFTER partial mutation, leaving the wrapper in a
half-updated state.

- [ ] **Test (fail first):** in dev mode, `commit` with a HAND-BUILT
  `OperationResult` of the form `{ state: history.currentState, dirtyIds: new Set() }`
  ⇒ throws AND `history.currentState` is UNCHANGED (no partial mutation),
  `canUndo()` unchanged. Use the hand-built result (NOT a same-value
  `setBlockAttrs`) so this test is independent of S-B1's correctness.
- [ ] **Fix:** at the TOP of `commit`, before any mutation:
  `if (isDevMode() && opResult.dirtyIds.size === 0) throw new Error("History.commit: refusing to commit a no-op operation (dirtyIds empty); handlers must short-circuit when opResult.dirtyIds.size === 0.");`
  Keep the existing post-mutation stack-alignment assertion as a
  belt-and-suspenders for other desync causes. `dirtyIds.size === 0` is exactly
  the no-op pre-condition (Yjs records no group ⟺ no dirty ids). **Assumption to
  document in a code comment:** this is sound because every action handler
  surfaces its full change set via the FINAL `OperationResult.dirtyIds` it passes
  to `commit`. A future compound action whose last `applyOperation` produces an
  empty dirty set while earlier ops mutated would be wrongly rejected — such
  authors must propagate a merged dirty set. (Dev-only guard; no production cost.)

## S-B4 — `clonePastedSubtree` collision check against the DESTINATION

**File:** `packages/core/src/state/clone-pasted-subtree.ts` (~94, 99). Test:
`packages/core/src/state/__tests__/clone-pasted-subtree.test.ts`.

The id-collision dev-assert runs against `sourceState`'s doc. Correct for
same-document paste (source === destination, the only current use) but wrong for
cross-document paste — a cloned id could collide with a DESTINATION id and
corrupt the merge. Fix backward-compatibly so the gap is closed before cross-doc
paste is built.

- [ ] **Test (fail first):** a destination doc that ALREADY contains the id the
  counter-allocator will mint ⇒ `clonePastedSubtree(src, root, allocator, dest)`
  throws (dev) the collision error referencing the destination. Same-doc call
  (omit `dest`, defaults to `src`) keeps working unchanged.
- [ ] **Fix:** add a trailing param `destinationState: State = sourceState`;
  replace both `assertNoIdCollision(sourceState[STATE_INTERNAL].doc, …)` calls
  with `destinationState[STATE_INTERNAL].doc`. Default preserves the current
  same-doc behavior (no caller breaks — there are no internal callers; barrel
  re-exports only). Update the phase-2 comment to state the check is against the
  destination namespace.

---

## EXCLUDED: S-B3 — `removeBlock` conditional parent writes (do NOT implement as audited)

The audit recommends writing the parent's `firstChildId`/`lastChildId` only when
changed, to avoid "dirtying the parent." But `remove-block.ts:119-125` writes
them unconditionally BY DESIGN: it computes `newFirstChildId`/`newLastChildId`
(which EQUAL the old values for a middle-child removal) and `.set`s them anyway.
**This is load-bearing.** Removing a MIDDLE child does not change the parent's
first/last, but it DOES change the parent's rendered child list (one fewer
child). `renderBlockIncremental` returns the cached RenderNode for a block NOT
in the invalidation set; the invalidation set is built by `computeInvalidatedBlocks`
walking `parentId` chains from `dirtyIds`. The parent only lands in `dirtyIds`
because the same-value `yParent.set("firstChildId", sameValue)` fires a Yjs
change event. **Making the writes conditional would suppress that event on
middle-child removals, so the parent would NOT be invalidated, and the render
would reuse a stale cached RenderNode whose child array still references the
deleted child.** The audit missed this.

So the parent-dirty contract genuinely RELIES on Yjs firing a change event for a
same-VALUE `.set`. (NOTE: the source comment at `remove-block.ts:114-118` is
inaccurate — it claims the contract is "not coupled to that internal Yjs detail,"
but the code IS coupled to it. Correct that comment if/when S-B3 is revisited.)
That coupling is a latent fragility worth a SEPARATE investigation (not this
cycle): a robust fix needs an explicit "mark block dirty" mechanism in the
Y.Doc-derived dirty tracking rather than relying on same-value-set semantics — a
design change beyond this bundle. Re-scope #227 accordingly.

---

## Verification
- `npm test --workspace=packages/core` green; `npm run build` clean.
- Each fix's test verified to FAIL before the fix.
- Independent code-reviewer approves.
