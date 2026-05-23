# Render Incremental — Design Spec

> Spec for R-D of the render-module cleanup plan
> (`docs/superpowers/plans/2026-05-22-render-module-cleanup-plan.md`).
> Status: brainstorming. Open questions at bottom need user input
> before implementation.

## Goal

The render module is currently O(N) on every call — full tree rebuild
regardless of how little state changed. The state module produces
`dirtyIds: Set<BlockId>` at every Layer 3 operation precisely so
downstream stages can rebuild only what changed. Layout already
consumes this via `layoutTreeIncremental` + `LayoutBoxCache`. **Render
must do the same.**

Target contract:

- **Reference equality on unchanged subtrees.** `render(state, prev)`
  returns a `RenderOutput` whose RenderNode subtree for any unchanged
  block is **`===`-equal** to the previous output's subtree for that
  block. Layout's reuse cache, painter caches, paint scheduling — all
  benefit from this.
- **Work is O(dirty-subtree-size + dirty-ancestor-chain)**, not O(N).
  Walking a 10,000-block doc shouldn't happen on every keystroke.

## What changes need to land together

Render incremental cannot ship alone. `cascadePass` walks the
post-render tree and overwrites every node's `computedStyle`,
producing new frozen objects — which breaks the reference-equality
chain render is preserving. So R-D requires:

1. **Render incremental** — the new piece (`RenderCache`, dirty-driven
   walk, ref-preservation on unchanged blocks).
2. **Cascade incremental wired into the new pipeline.** The cascade
   module already has `cascadePassIncremental` (built for the legacy
   renderer) but it's not currently called by anything. The new
   pipeline calls plain `cascadePass` via `layoutTree` (auto-cascade)
   and via `layoutTreeIncremental`. We need to plumb the old cascaded
   root through and call `cascadePassIncremental` on the incremental
   path.
3. **Layout's auto-cascade callsites updated.** `layoutTree` and
   `layoutTreeIncremental` need to know to use the incremental cascade
   when given a prior cascaded result.

Without #2 and #3, render's reference preservation is undone
immediately by `cascadePass` regenerating every node.

## Proposed architecture

### `RenderCache`

Per-document cache; the editor holds one alongside `EditorState`.

```ts
interface RenderCache {
  readonly previousOutput: RenderOutput | null;
  readonly previousState: State | null;
  readonly previousCascaded: RenderNode | null;
  readonly previousEmbedCascaded: ReadonlyMap<BlockId, RenderNode>;
}
```

The cache stores BOTH the raw render output and the post-cascade
output, so the next call's cascade incremental has both `oldRoot` and
`oldCascadedRoot` (the two args `cascadePassIncremental` needs).

### `render` API extension

```ts
function render(
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  options?: {
    readonly prev?: RenderOutput;
    readonly prevState?: State;
    readonly dirtyIds?: ReadonlySet<BlockId>;
  },
): RenderOutput;
```

All new params optional → existing callers keep working with full
rebuild. When `prev`, `prevState`, and `dirtyIds` are all supplied,
render takes the incremental path.

### Incremental walk

```
renderIncremental(state, prev, prevState, dirtyIds, registries):
  if dirtyIds.size === 0:
    # No state change at all — return prev as-is.
    return prev

  # Walk main tree from rootId. For each block:
  #   - If getBlock(state, id) === getBlock(prevState, id) AND no
  #     descendant is in dirtyIds, return prev's RenderNode for id.
  #   - Else, re-walk this block. Recurse into children; reuse cached
  #     RenderNodes for unchanged children.
  #   - Compose computedStyle as today; build BlockView; dispatch
  #     component.

  # Same for embed-contents.
```

The "no descendant is in dirtyIds" check needs care. Naive options:

- **O(D × depth)**: for each dirty id, walk up to root marking
  ancestors dirty too. Build a `dirtyAncestors: Set<BlockId>`. Then in
  the walk, "this subtree is dirty" === "id ∈ dirtyIds ∪
  dirtyAncestors".
- **Top-down**: walk the tree top-down; at each block, check if id ∈
  dirtyIds; if not, check if it has any dirty descendants by recursing
  with short-circuit on no-dirty-descendants. This is O(unchanged
  subtree size) once but cleaner.

Naive option 1 is simpler; pre-computing dirtyAncestors is O(D × avg
depth), which at depth 5 and D=1 keystroke is ~5 hops. Trivial.

### Cascade incremental wiring

`layoutTree` and `layoutTreeIncremental` currently auto-run plain
`cascadePass(root)`. New signature option:

```ts
function layoutTreeIncremental(
  newRoot: RenderNode,
  oldRoot: RenderNode | null,
  oldLayout: LayoutBox | null,
  containerWidth: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  pageConfig?: PageConfig,
  options?: {
    readonly oldCascadedRoot?: RenderNode;
  },
): LayoutBox;
```

When `oldCascadedRoot` and `oldRoot` are both supplied, layout uses
`cascadePassIncremental(newRoot, oldRoot, oldCascadedRoot)` instead of
plain `cascadePass(newRoot)`.

Alternatively the entire layout-incremental block could be reworked to
make the cascade step explicit at the editor level (editor calls
cascade, then passes the cascaded tree to layout). That's cleaner
architecturally but a bigger surface change.

### Editor reducer change

```ts
function reduceEditor(state, action, config) {
  const opResult = applyAction(state, action, config);
  const renderOutput = render(opResult.state, ..., {
    prev: prevRenderOutput,
    prevState: state,
    dirtyIds: opResult.dirtyIds,
  });
  const cascaded = cascadePassIncremental(renderOutput.root, prevRenderOutput?.root ?? null, prevCascaded);
  const layoutResult = layoutTreeIncremental(cascaded, prevCascaded, prevLayout, width, shaper);
  // Store renderOutput, cascaded, layoutResult for next call.
}
```

The editor holds the chain of `prev*` references. This is similar to
how the existing reducer already threads `prevRender` / `prevLayout`
for layout incremental.

## Tests

1. **Reference-equality regression test.** Render twice with identical
   state, assert root reference is preserved.
2. **Single-dirty-block test.** Mutate one block, render incrementally,
   assert siblings' RenderNodes are `===`-equal across calls.
3. **Dirty-ancestor invalidation.** Mutating a deep block should
   invalidate its ancestor chain (their children arrays change) but
   not their siblings.
4. **Drift test (property-based).** For a random sequence of edits,
   incremental render output equals non-incremental render output
   (structural equality after a final cascade).
5. **Cascade incremental wiring test.** Confirm cascade-pass-incremental
   preserves ref-equality on the unchanged subtrees that render
   preserved.
6. **End-to-end pipeline test.** Single-keystroke edit on a 100-block
   doc; assert only the touched block's render+cascade+layout subtrees
   are recomputed.
7. **Empty-dirty-ids test.** `dirtyIds.size === 0` short-circuits to
   `prev` as-is.

## Performance acceptance

- **Per-keystroke render at 1,000 blocks: < 1 ms.** (Current full-walk
  baseline: ~10 ms for a 1,000-block doc with text-shaping; incremental
  should be ~100× faster since the work is proportional to the touched
  subtree, not the whole doc.)
- **Per-keystroke render at 10,000 blocks: < 5 ms.**
- **Memory overhead of `RenderCache`: O(total tree size) — same as
  the output it caches, just retained one cycle longer.**

(Exact numbers calibrated when benchmarks land.)

## What's NOT in R-D's scope

- Painter cache integration (consumes ref-equality but lives in
  `@taleweaver/dom`).
- Property-based fuzz over the full reducer (separate work).
- Reworking `cascadePassIncremental`'s parent-style equality check
  beyond what already exists.
- Removing the legacy `cascadePass` (still needed for non-incremental
  callers).

## Open questions for user input

These are the genuine forks where I want your call before
implementation:

### Q1 — API shape: stateless or stateful?

**Option A (stateless, recommended).** `render(state, ..., options?: { prev, prevState, dirtyIds })`.
Editor threads the prev chain manually. Matches `layoutTreeIncremental`'s
pattern. Easier to test in isolation.

**Option B (stateful).** `createRenderer(): { render(state, dirtyIds?) }`.
Internal cache. Hidden state but ergonomic.

I recommend A — symmetry with layout, simpler test surface, no hidden
state.

### Q2 — Cascade incremental: hide inside layout, or pull up to editor?

**Option A (hide inside layout).** `layoutTreeIncremental` calls
`cascadePassIncremental` internally when `oldCascadedRoot` is provided.
Editor only deals with layout. Cascade step is invisible.

**Option B (pull up to editor).** Editor calls render → cascade →
layout explicitly. Each stage is incremental. More verbose but the
pipeline shape is explicit in the reducer.

Option B is cleaner architecturally (each pipeline stage is a
top-level decision); A is less code change.

### Q3 — Dirty-ancestor pre-computation: pre-compute set, or walk top-down?

**Option A.** Pre-compute `dirtyAncestors: Set<BlockId>` from
`dirtyIds` by walking each dirty id up to root. O(D × depth) one-time
cost. Then the render walk is a simple `id ∈ dirtyOrAncestor` check.

**Option B.** Walk top-down; at each block, recursively check "does
this subtree contain any dirty id?" Same O(unchanged subtree size)
worst case but stops early when the answer is no.

Option A is simpler to reason about and read; B is slightly more
efficient on highly localized edits. Probably A.

### Q4 — When to ship R-D?

The cleanup plan's R-D is the only remaining render-cleanup item. It
is also a substantial multi-commit subseries that touches render +
cascade + layout. **Should we land R-D before moving on to the next
foundation layer (cascade or layout audit pass), or should we audit
the lower layers first and tackle their issues, THEN come back to
R-D's cross-cutting work?**

The strict foundations-first ordering says: audit cascade and layout
NOW, fix their surviving-code issues, then come back to R-D when all
the pieces R-D touches are clean. The pragmatic argument says: R-D is
the keystone performance work — ship it first while the design is
fresh.

I'd lean: **audit cascade and layout first** (their cleanup passes are
each smaller than R-D; they'll surface issues we need to know about
before R-D's cross-cutting commits). R-D becomes the capstone after
each piece is solid.

## Decisions (recorded 2026-05-22)

Decided by controller per first principles; user notified in chat.
Reversible by user direction.

- **Q1 → A: stateless.** Mirrors state and layout. No hidden state.
- **Q2 → B: pull pipeline stages up to the editor reducer.** Each
  pipeline stage's incrementality becomes a top-level reducer
  decision, not a side-effect of the next stage. Restores legibility
  to the render/cascade/layout boundary — the same boundary that got
  obscured pre-R-A.
- **Q3 → A: pre-compute `dirtyAncestors`.** At target scale (depth
  3–5), the cost is trivial; the control-flow simplification is
  worth it.
- **Q4 → audit cascade and layout layers first, defer R-D.**
  Foundations-first ordering: R-D touches render + cascade + layout
  simultaneously. Auditing the lower layers BEFORE R-D means R-D
  integrates against clean code. This spec's content is on disk
  (durability rule), so reviving the R-D design later is cheap.

## Implementation plan

Gated on the cascade and layout audit + cleanup work. R-D becomes
the capstone, scheduled after both audits' findings are addressed.
At that point, this spec is reviewed for currency and a per-task
plan is written under `docs/superpowers/plans/`.
