# P12 — Layout / styles consumer cleanup

**Subject:** Migrate any references to legacy `StateNode` types in the `layout/` and `styles/` modules. After P11.x has shipped, the remaining consumers of legacy types are mostly mechanical leftovers — assertion utilities, debugging helpers, anonymous-box construction, etc.

**Reference:** Master spec migration step 11.

## Goal

Bulk cleanup. After P11.x shipped, the editor talks to layout via the new RenderNode tree (post-render-rewrite). Layout itself has historically been mostly state-agnostic — it operates on RenderNodes, not StateNodes. But some helpers in layout (e.g., for anonymous-box generation, intrinsic-sizing) may still reference legacy types.

Styles module (`styles/style.ts`, `styles/computed-style.ts`, etc.) has been mostly state-agnostic too. Verify no legacy refs.

## Dependencies

P11.x complete. Editor doesn't pass legacy types to layout/styles anymore.

## Current state

Per directory survey:
- `layout/` has 27 source files. Mostly RenderNode-centric. Possible legacy refs in anonymous-box generation, fragmentation logic, BFC/IFC dispatch.
- `styles/` has color, length, computed-style, used-style, writing-mode, property-meta. All RenderNode/Style-centric.

Quick grep needed at P12 plan time: `grep -r "StateNode\|state-node\|state/operations\|state/position\|state/transformations\|state/formatting" packages/core/src/layout/ packages/core/src/styles/`

## Files involved

Cannot enumerate without grep run at P12 time. Likely a small number of files (< 5) with stale type imports.

## Key technical considerations

1. **Layout is the most thoroughly tested module.** 27 source files, many test files. Verify each migration doesn't change behavior — these tests should pass throughout.

2. **`__tests__` subdirectory.** Per directory survey, `layout/` has both `__tests__/` and inline `.test.ts`. Double-check test discovery rules; ensure all run.

3. **No design decisions needed.** This is mechanical: replace legacy type with new type at each reference; resolve any dependencies.

## Risks and patterns to apply

- **DRY:** any shared cleanup utility (e.g., legacy-to-new conversion that's no longer needed) should be deleted, not just left dead.
- **Test parity** ensured by the existing 100+ layout tests.

## Test strategy

No new tests. Existing tests serve as regression protection. Build + tests green at end of phase.

## Open questions

None known. P12 is bookkeeping after the major migrations.

## Success criteria

- `grep -r "StateNode\|state-node" packages/core/src/layout/ packages/core/src/styles/` returns nothing.
- Build + tests green.
- Browser smoke: documents render at all widths; floats, intrinsic sizing, fragmentation all work.

## Review cycle expectations

Pre-execution: yes (small plan, but verify scope). Post-execution: yes. Browser smoke required.

## Estimated commits

~5-7.
