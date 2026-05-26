# Render-incremental for embed/template container bodies (#285, closes #221) — Plan

> **For agentic workers:** subagent-driven-development; one implementer per task; independent
> code-reviewer gate before each commit; TDD through the real `render`/`renderIncremental` path.

**Goal:** incremental render correctly invalidates and reuses children INSIDE embed/template container
bodies. Today a change to a block nested in an `embedContents`/`templateContents` body is silently
SWALLOWED (the stale body is reused wholesale), and even a correctly-re-rendered body rebuilds all its
children. This is the hard prerequisite for C.2c (headers/footers are template content edited per
keystroke) and the deepest-layer (render) foundational item on the board.

**Root cause (from code-explorer, file:line in `packages/core/src/render/render.ts`):**
- **Gap A (CORRECTNESS):** `computeInvalidatedBlocks` (~675-698) and `addDescendantsToInvalidated`
  (~700-717) walk the `parentId` ancestor chain (and descendants) via `getBlock(state, cursor) ??
  getBlock(prevState, cursor)`. `getBlock` reads ONLY the main `blocks` Y.Map. For a dirty block living
  in `embedContents`/`templateContents`, the first lookup returns `null` → the walk breaks immediately
  → the body ROOT id is never added to `invalidated` → the container-body reuse loop (~494-549) sees
  `!invalidated.has(rootId)` and reuses the stale body. The edit is lost (multi-level bodies). Same
  root cause as #221 (viewed from the state-walk angle).
- **Gap B (EFFICIENCY):** `prevByKey = indexRenderNodesByKey(prev.root)` (~461) indexes ONLY the main
  tree. When a dirty body IS re-rendered via `renderBlockIncremental`, its children's reuse lookups
  miss `prevByKey` for every embed/template node → all children rebuilt even if unchanged.

**Key fact:** block ids are globally unique across all three maps; `resolveBlock(state, id): { block,
kind } | null` (state.ts:156) searches block → embed → template. RenderNode keys derive from block ids,
so a single combined `prevByKey` across the three trees has no key collisions.

---

## Task 1 — Gap A: multi-tree invalidation walk (CORRECTNESS; closes #221)

**Files:** `packages/core/src/render/render.ts` (`computeInvalidatedBlocks`, `addDescendantsToInvalidated`);
tests `render.test.ts`.

- In `computeInvalidatedBlocks`, replace the ancestor-chain block lookup `getBlock(state, cursor) ??
  getBlock(prevState, cursor)` with the multi-tree `resolveBlock(state, cursor)?.block ??
  resolveBlock(prevState, cursor)?.block`. The walk then climbs `parentId` THROUGH the embed/template
  body and ADDS the body-root id to `invalidated` (so the reuse loop re-renders it). Confirm the walk
  terminates correctly (body root's `parentId` is null or the registry root — verify it doesn't loop;
  keep the existing cycle/step guard if present).
- In `addDescendantsToInvalidated`, replace its `getBlock(state, id)` with `resolveBlock(state, id)?.block`
  (and prevState fallback if it uses one) so descendants of a dirty embed/template block are walked too.
- Import `resolveBlock` from the state barrel. No change to the container-body reuse loop itself — once
  the body root is correctly in `invalidated`, the existing `!invalidated.has(id)` branch re-renders it.

**TDD (write FIRST — `render.test.ts`, real `render()` then `renderIncremental` with dirtyIds):**
- **Multi-level template body, dirty CHILD (the bug):** a template body = container root `tpl-body`
  with child paragraphs `tpl-p1`,`tpl-p2`. Full render; then mutate `tpl-p1`'s text, `renderIncremental`
  with `dirtyIds={tpl-p1}`. Assert the new `templateContents.get("tpl-body")` REFLECTS the change (NOT
  the stale node) — e.g. the re-rendered p1's text matches the new state. This FAILS today (stale body
  reused).
- **Same for a multi-level EMBED body** (dirty child → change reflected).
- **Unchanged OTHER body reused by ref:** a second template/embed body not in dirtyIds is returned
  reference-equal to the prev render (no spurious rebuild).
- **#221 ancestor reach:** assert that after a dirty grandchild (root → child → grandchild) the body
  root is invalidated and the change propagates.
- **NO-REGRESSION:** the existing single-level body test (dirty body root) still passes; main-tree
  incremental behavior unchanged (dirty main block → only it + ancestors/descendants invalidated).

## Task 2 — Gap B: fine-grained reuse within a re-rendered body (EFFICIENCY)

**Files:** `packages/core/src/render/render.ts` (`renderIncremental` ~461 `prevByKey` construction);
tests `render.test.ts`.

- Build `prevByKey` from the main root PLUS every `prev.embedContents` value PLUS every
  `prev.templateContents` value (one combined flat `Map<string, RenderNode>` — keys are globally unique
  so no collision; OR a small helper that indexes all three). So when a dirty body is re-rendered via
  `renderBlockIncremental`, its UNCHANGED children are found in `prevByKey` and reused by reference.
- Keep it allocation-reasonable: index the content maps once up front (same place `indexRenderNodesByKey(prev.root)`
  is called), not per-body.

**TDD (write FIRST):**
- **Fine-grained sibling reuse:** multi-level template body `tpl-body` with children `tpl-p1`,`tpl-p2`;
  full render; mutate only `tpl-p1`; `renderIncremental`. Assert the re-rendered body's `tpl-p2` child
  RenderNode is REFERENCE-EQUAL to the prev render's `tpl-p2` node (reused), while `tpl-p1`'s node is
  new. This FAILS before T2 (all children rebuilt). Same for an embed body.
- **NO-REGRESSION:** main-tree fine-grained reuse unchanged; T1's correctness tests still pass.

## Verify (each task)
- `npm run build --workspace=packages/core` clean (tsc). FULL `npm test --workspace=packages/core` +
  `npm test --workspace=packages/dom` green. Reviewer gate, then commit.

## Out of scope / follow-up
- C.2c itself (wiring template content into per-page headers/footers) — this plan only fixes the
  incremental-render foundation it needs.
- Deeper embed-in-embed / template-in-embed nesting beyond what the tests cover — note if the walk
  needs depth handling; the resolveBlock walk should be depth-agnostic, but add a test if cheap.

## Status
- [ ] T1 — multi-tree invalidation walk (correctness; closes #221).
- [ ] T2 — combined prevByKey for fine-grained body reuse (efficiency).
