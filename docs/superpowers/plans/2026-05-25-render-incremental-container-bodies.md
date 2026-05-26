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

## Task 1 — Gap A: make ALL render block-tree walks multi-tree (CORRECTNESS; closes #221)

**Files:** `packages/core/src/render/render.ts`; tests `render.test.ts`.

**The unifying fix:** EVERYWHERE the render module walks the block tree by id (parentId / childId /
nextSiblingId), use `resolveBlock(state, id)?.block` instead of `getBlock(state, id)`. `resolveBlock`'s
FIRST arm is `getBlock` (state.ts:157), so main-tree behavior is byte-identical; the extra arms
(embed, template) make body-internal walks work. The plan-review found that fixing only the
invalidation walk is INSUFFICIENT — once the body root is invalidated, the body RE-RENDER then fetches
children via main-tree-only `getBlock` and THROWS for multi-level container bodies. So swap ALL of
these call sites (verify exact lines — approximate):

1. **`computeInvalidatedBlocks`** (~687): ancestor walk `getBlock(state,cursor) ?? getBlock(prevState,cursor)`
   → `resolveBlock(state,cursor)?.block ?? resolveBlock(prevState,cursor)?.block`. The walk then climbs
   parentId THROUGH the body and ADDS the body-root id to `invalidated`. Terminates when parentId is
   null / resolveBlock returns null (registry root not a block) → stop. Keep any existing cycle/step guard.
2. **`addDescendantsToInvalidated`** — BOTH `getBlock` calls (~705 the id fetch AND ~713 the
   `child`/nextSibling-advance fetch). Both → `resolveBlock(...)?.block`.
3. **`renderBlockIncremental`** child iteration — the child-fetch (~619) AND the sibling-advance
   (~637) `getBlock(state, childId)` → `resolveBlock(state, childId)?.block`. (This is the second
   barrier the plan-review caught: without it, re-rendering a multi-level body throws.)
4. **`renderBlock`** (full-render path) child iteration — the same two sites (~265, ~281). (Same latent
   bug on the full path; multi-level bodies have never been full-rendered in tests.)

- Null-guard: where a swapped site previously threw "not found" on null, keep a throw with a message
  like "block <id> not found in any tree" (don't silently `break`/skip — a missing child is a real
  corruption). Match the existing throw/guard style at each site.
- Import `resolveBlock` from the state barrel. No change to the container-body reuse loop — once the
  body root is in `invalidated`, the existing `!invalidated.has(id)` branch re-renders it.

**TDD (write FIRST — `render.test.ts`, real `render()` then `renderIncremental` with dirtyIds):**
- **Multi-level template body, dirty CHILD (the bug):** template body = a `kind: "container"` root
  `tpl-body` with child paragraphs `tpl-p1`,`tpl-p2` — **all three registered in the `templateContents`
  array** (children live in the templateContents Y.Map, NOT the main blocks map; `tpl-body` MUST be a
  CONTAINER component so the child-iteration path runs — the existing single-level test uses a leaf and
  won't exercise the bug). Full render; mutate `tpl-p1`'s text; `renderIncremental` with
  `dirtyIds={tpl-p1}`. Assert `templateContents.get("tpl-body")` REFLECTS the change (re-rendered p1
  text matches new state). FAILS today (stale body reused) — and would THROW with only the
  invalidation-walk swap, proving sites 3/4 are needed.
- **Same for a multi-level EMBED container body** (dirty child → change reflected).
- **FULL-RENDER multi-level body (no prev):** a `render()` (not incremental) of a multi-level container
  template/embed body produces the children correctly — pins the full-path sites (4) too.
- **Unchanged OTHER body reused by ref:** a second template/embed body not in dirtyIds is returned
  reference-equal to the prev render.
- **#221 grandchild ancestor reach:** root → child → grandchild; dirty grandchild → body root
  invalidated → change propagates.
- **NO-REGRESSION:** existing single-level body test still passes; main-tree incremental + full render
  unchanged (resolveBlock's getBlock-first arm ⇒ identical for main-tree ids).

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
