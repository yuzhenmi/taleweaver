# P1.C.1a — `display: contents` (box suppression) layout foundation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans.
> TDD; geometry-level equivalence tests. Independent review before commit.

**Goal:** A block whose computed `display` is `contents` generates NO layout box;
its children participate in layout + pagination exactly as if they were direct
children of the box-suppressed element's parent. This is the foundation that lets
a `section` block (P1.C.1b) be transparent to the BFC — no extra nesting box, no
single unbreakable fit-meta — so a section's body paginates normally.

**Architecture / mechanism (decided):** Flatten `display: contents` elements in
`groupChildren` (`packages/core/src/layout/group-children.ts`) — the SHARED
child-grouping consumed by BOTH `bfc.layoutBlock` and `build-fit-metas`
(`buildMetasForChildren`). One change makes both the positioned-layout path and
the measure/paginate path treat a `contents` element transparently. The element
keeps its render/cascade identity (style inheritance flows through it via the
normal parent chain — cascade already computes children's styles against their
real parent, so no cascade change is needed for inheritance); it simply produces
no box. Use the computed `display: "contents"` value (CSS Display 3 §3.2),
NOT a `type === "section"` special-case — CSS-faithful and reusable.

**Scope:** block-level `display: contents` only (the section use case). Inline-context
`display: contents` (suppressing an inline wrapper) is out of scope for C.1a;
note it as a future extension. `display: contents` with margins/padding/border:
those are correctly DROPPED (the box they'd apply to is suppressed) — assert this.

**Tech stack:** existing layout pipeline (group-children, bfc, build-fit-metas,
measure-pass, dispatch); mock-shaper geometry tests.

---

### Task 1: Add `"contents"` to the `Display` vocabulary

**Files:**
- Modify: `packages/core/src/styles/style.ts` (`Display` union)
- Test: `packages/core/src/styles/style.test.ts`

- [ ] **Step 1 — find every exhaustive consumer of `Display`.** Grep
  `display ===`, `switch (…display)`, and `establishesNewBFC` / default-display
  logic in cascade + layout. List each spot that must handle `"contents"`
  (most compare against specific values like `"block"`/`"table"` and fall
  through — verify `"contents"` lands in a safe default, NOT mis-treated as a
  box-generating display). **Known consumers to patch (from plan review):**
  `intrinsic-sizes-pass.ts` `computeUncached`'s `switch (cs.display)` (today its
  `default` returns `{0,0}` — a contents element would surface ZERO intrinsic
  size for its whole subtree) AND `computeBlockIntrinsicSizes`'s direct
  `node.children` loop (bypasses `groupChildren` entirely) — see Task 2.5.
  `dispatch.ts` / `layout-incremental.ts` THROW on a non-`block`/`table` root —
  a `contents` element is never the root in C.1a, but note this latent footgun
  so a test never uses a contents root and gets a confusing throw.
- [ ] **Step 2 — add `| "contents"` to the `Display` union.** Run
  `npm run build --workspace=packages/core`; fix any non-exhaustive-switch
  TS errors surfaced (each is a consumer from Step 1).
- [ ] **Step 3 — test:** a `ComputedStyle`/`UsedStyle` with `display: "contents"`
  constructs and round-trips; `logicalToPhysical` / `establishesNewBFC` treat it
  sanely (a `contents` element establishes no BFC — it has no box).

### Task 2: `groupChildren` flattens `display: contents` children

**Files:**
- Modify: `packages/core/src/layout/group-children.ts`
- Test: `packages/core/src/layout/group-children.test.ts`

- [ ] **Step 1 — failing test.** `groupChildren(P)` where `P`'s children are
  `[para, contentsEl([paraA, paraB]), para2]` must yield the SAME groups as
  `groupChildren(P')` where `P'`'s children are `[para, paraA, paraB, para2]`.
  Add a nested case: `contentsEl([ contentsEl([paraX]) ])` flattens to `[paraX]`.
  Empty `contentsEl([])` contributes nothing.
- [ ] **Step 2 — verify it fails** (contents element currently grouped as a
  block group of its own).
- [ ] **Step 3 — implement.** Before grouping, build the parent's EFFECTIVE
  child list: walk `parent.children`; for each child with
  `child.type === "element" && child.computedStyle.display === "contents"`,
  recursively substitute its (effective) children in place; otherwise keep the
  child. Group the effective list with the existing logic. Keep it allocation-
  lean (only allocate a new list when a contents child is present — common case
  unchanged). Preserve child order.
  **Anonymous-block-key alignment (plan review):** the grouped output's
  `positionalIndex` (used by `anonymousBlockKey(parentKey, index)`) MUST reflect
  position in the FLATTENED effective sequence, not the contents element's
  internal position — so a doc with a contents wrapper produces the SAME
  anonymous keys as the wrapper-removed doc (otherwise Task 3's equivalence test
  fails for a correct impl). Verify the grouping index is computed over the
  effective list.
- [ ] **Step 4 — defensive guard in `build-fit-metas.ts`.** Post-flatten,
  `classifyChild`/`buildChildMeta` should NEVER receive a `contents` element. Add
  a dev-mode `if (childCs.display === "contents") throw` at the top of
  `buildChildMeta` (and mirror in `bfc.layoutBlock`'s per-block dispatch if it
  reads a child's display directly) so any flatten escape — which would silently
  leak the contents element's margins/breaks (`build-fit-metas.ts` reads
  `marginBlockStart`/`breakBefore`/… off the child) — fails loudly at test time.
- [ ] **Step 5 — tests pass.**

### Task 2.5: Intrinsic sizing flattens `display: contents` (plan-review critical)

**Files:**
- Modify: `packages/core/src/layout/intrinsic-sizes-pass.ts`
- Test: `packages/core/src/layout/intrinsic-sizes-pass.test.ts`

`intrinsic-sizes-pass.ts` is a SECOND child-walk independent of `groupChildren`:
`computeBlockIntrinsicSizes` loops `node.children` directly, and
`computeUncached`'s `switch (cs.display)` has no `"contents"` case (`default`
returns `{minContent:0, maxContent:0}`). So without this task a contents element
contributes ZERO intrinsic size — its children's min/max-content never surface.

- [ ] **Step 1 — failing test:** `computeIntrinsicSizes` of a contents element
  wrapping paragraphs equals the max/sum (per axis, per CSS) of those paragraphs
  as if direct children; and a parent containing a contents wrapper has the same
  intrinsic sizes as the wrapper-removed parent.
- [ ] **Step 2 — implement:** in `computeBlockIntrinsicSizes`, flatten contents
  children (same effective-children walk as `groupChildren` — extract a shared
  `flattenContents(children)` helper used by both to avoid drift), so a contents
  child contributes its children's intrinsic sizes with NO box-model of its own.
  Ensure `computeUncached` never returns the `{0,0}` default for `"contents"`
  (either handled by the flatten upstream, or an explicit delegating case).
- [ ] **Step 3 — tests pass.**

### Task 3: Layout equivalence (the load-bearing guard)

**Files:**
- Test: `packages/core/src/layout/display-contents.test.ts` (Create)

- [ ] **Step 1 — non-paginated equivalence.** Build a cascaded doc with a
  `display:contents` wrapper element around N paragraphs; `layoutTree(...)` deep-
  equals `layoutTree(...)` of the same doc with the wrapper removed (children
  hoisted). Use the mock shaper; assert structural + geometric equality (the
  contents element's key appears in NO `LayoutBox` in the output).
- [ ] **Step 2 — paginated equivalence.** With a `pageConfig` that splits the
  paragraphs across pages, the `VirtualLayoutTree`'s `plan` (page boundaries /
  entry offsets) AND `materializeAll()` deep-equal the wrapper-removed doc's.
  This proves `build-fit-metas` + `measure-pass` flow through transparently.
- [ ] **Step 3 — margins dropped.** A `display:contents` wrapper with
  `marginTop`/`padding`/`border` set lays out IDENTICALLY to one without them
  (the suppressed box's box-model properties have no effect) — matches CSS.

### Task 4: No stray box anywhere downstream

**Files:**
- Test: same `display-contents.test.ts`

- [ ] Assert the `contents` element's key never appears in: the positioned
  layout tree (`layoutTree`), `getPage(i)` output, `collectLineBoxes` / the
  cursor `LineIndex`, and intrinsic-sizing results. (Walk the output box tree and
  assert no box `.key === contentsKey`.) This catches any code path that
  instantiates a box bypassing `groupChildren`. If one is found, route it through
  the same effective-children flatten or skip-if-contents guard, and note it.

---

## Verification
- `npm test --workspace=packages/core` + `--workspace=packages/dom` green; both build clean.
- Equivalence tests (Task 3) verified to FAIL before Task 2's flatten lands
  (a contents wrapper currently produces an extra nesting box / fit-meta).
- Independent code-reviewer approves.
- (No browser smoke needed for C.1a — no user-visible change yet; C.1b/C.2 will
  browser-verify once sections are authorable + paint.)

## Open questions for the plan reviewer
1. Is `groupChildren` truly the ONLY box-generating child walk, or does
   `bfc.layoutBlock` / intrinsic-sizing / float-collection iterate
   `parent.children` directly somewhere (bypassing `groupChildren`) such that a
   `contents` element would still get a box? (Task 4 is the safety net; the
   reviewer should confirm by reading bfc.ts + intrinsic-size.ts.)
2. Does any `Display` consumer treat an unknown/`contents` value as box-
   generating by DEFAULT (e.g. `display !== "inline"` ⇒ block) in a way that
   re-introduces a box before `groupChildren` runs? (Task 1 Step 1 must enumerate.)
3. Cascade: confirm `display` is NOT inherited (it isn't in CSS) and that a
   `contents` parent doesn't corrupt children's computed styles (children inherit
   inheritable props THROUGH the contents element from its parent — standard).
