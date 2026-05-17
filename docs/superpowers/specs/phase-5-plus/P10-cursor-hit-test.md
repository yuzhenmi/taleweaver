# P10 — Cursor: hit-testing + selection-geometry on new types

**Subject:** Migrate hit-testing and selection-geometry to consume new `Position` and `State`. These are layout-coupled (require a stable RenderNode tree) so they migrate after P7-P9 land.

**Reference:** Master spec migration step 10c partial; `decisions.md` decision B (render interface).

Note on Decision B: hit-test consumes the RenderNode tree produced by the new renderer per Decision B. RenderNodes carry their owning `BlockId` so hit-test can produce `Position { blockId, offset }` directly without going through `RenderContext`. `RenderContext` is for render-time cross-block lookups within components; hit-test (a post-render consumer) doesn't need it.

## Goal

Hit-testing maps screen coordinates → `Position`. Selection geometry computes the visual rects for a `Span` (used to paint selection highlights). Both are layout-coupled — they consume the RenderNode tree produced by the renderer and need to know which RenderNode corresponds to which `Position`.

P10 builds parallel new versions of these. Old versions stay until P11.3 (selection action family) cuts over.

## Dependencies

- P9 (cursor types + position math). New `Position` in place.
- P7 (new renderer). RenderNodes have whatever shape they have post-P7.
- P8 (new components) — may affect RenderNode shape if components produce different boxes.

## Current state

- `/Users/hansyu/code/taleweaver/packages/core/src/editor/hit-test.ts` — current hit-test (despite directory placement, this is logically cursor-module). Maps `(x, y) → Selection`. Consumes legacy `Position`.
- `/Users/hansyu/code/taleweaver/packages/core/src/editor/selection-geometry.ts` — computes rects for a Selection. Consumes legacy Position; reads RenderNode tree.
- `/Users/hansyu/code/taleweaver/packages/core/src/editor/cursor-position.ts` — converts cursor Position → screen position (caret coords). Consumes legacy Position.
- `/Users/hansyu/code/taleweaver/packages/core/src/editor/line-navigation.ts` — moveByLine, moveByLineBoundary. Consumes legacy Position; reads RenderNode for line breaks.
- All have corresponding `.test.ts` files.

These four files form the layout-coupled subset of the cursor module. They depend on RenderNode tree for spatial information.

## Files involved

**Created (parallel new versions):**
- `cursor/hit-test-v2.ts` (or `cursor/v2/hit-test.ts`)
- `cursor/selection-geometry-v2.ts`
- `cursor/cursor-position-v2.ts`
- `cursor/line-navigation-v2.ts`
- (or directory-organized, per per-phase plan decision)
- Test files alongside.

**Untouched:**
- Legacy versions stay. P15 deletes.

## Key technical considerations

1. **RenderNode → Position mapping.** Hit-test resolves `(x, y)` to a Position by walking the RenderNode tree to find the leaf containing the point, then converting from RenderNode-local offset to `Position.offset`. The RenderNode→Block correspondence is provided by the renderer (P7) — the BlockView the renderer used to build each ElementBox carries its `block.id`.

2. **Selection geometry: per-block iteration.** For a multi-block Span, selection-geometry walks `iterateSpan(state, span)` (Layer 2 utility from Phase 2), asks the layout module for each block's selection rect for `[rangeStart, rangeEnd)`, and assembles the result. Plus inter-block "selection bridges" between adjacent blocks (selection extending to page edge).

3. **Caret position.** `cursorPositionFromState(state, position, layoutTree): {x, y, height}`. Walk the RenderNode tree to find the block referenced by `position.blockId`, then compute the caret coords within that block's RenderNode using `position.offset` and the inline shape.

4. **Line navigation.** `moveByLine(state, position, direction, layoutTree): Position`. Walks RenderNode tree to find current line, then moves to next/previous line, finding the closest x-coordinate match.

5. **Layout-tree shape.** P10 depends on the RenderNode tree structure produced by the new renderer (P7). If P7's RenderNode shape differs significantly from current, hit-test/geometry need updating. Most likely P7 keeps RenderNode (`ElementBox | TextBox`) unchanged; only the producer differs.

## Risks and patterns to apply

- **DRY:** hit-test and selection-geometry share spatial-walk logic. Extract shared helpers (e.g., `findRenderNodeForBlock`, `xToOffsetWithinTextBox`) before duplication.
- **Browser smoke:** hit-testing is hard to unit-test definitively (real browser is the truth). Smoke-test in browser by clicking text and verifying caret lands correctly.
- **Test fixture complexity:** these tests need fully-laid-out RenderNode trees. Use the existing test harness if it works for the new types, or build new fixtures.

## Test strategy

Per Phase 4 pattern. Tasks 1-7:
- Implementation + sanity test (hit-test single paragraph).
- Hit-test multi-block.
- Hit-test embed boundaries.
- Selection-geometry single-block.
- Selection-geometry multi-block.
- Cursor-position (caret coords).
- Line-navigation tests.
- Error cases.

Estimated test count: 30-50 (these are inherently more numerous than state operations).

## Open questions

1. **File boundary with P9** — was P10 supposed to include `cursor-position.ts` or is that part of P9? Decided in P9 plan; if not, P10 plan picks up.

2. **Layout tree access** — does the layout module expose a "find RenderNode by block id" helper, or does P10 walk the tree itself? Decision in plan.

3. **Selection bridges.** Per spec line 277, "the editor module computes inter-block 'selection bridges' separately." Where does this live — in selection-geometry or elsewhere? Plan decides.

## Success criteria

- New hit-test, selection-geometry, cursor-position, line-navigation files exist.
- All consume new `Position` / `State` / new RenderNode tree.
- Test parity with legacy versions.
- Browser smoke: clicking lands caret correctly; selecting highlights correctly.
- Old versions still callable.

## Review cycle expectations

Pre-execution: yes. Post-execution: yes. Browser smoke required.

## Estimated commits

~7-10.
