# P8 — Components rewrite

**Subject:** Migrate container components (paragraph, document, section, list, list-item, table, table-row, table-cell, heading, image, horizontal-line) to the new BlockView interface. Delete `text` and `span` component definitions per master spec invariants.

**Reference:** Master spec migration step 9; spec lines 385-410 (BlockView interface) and 509 (text/span removal).

## Goal

The current components (`packages/core/src/components/*.ts`) consume the legacy `StateNode`/render interface. After P7 introduces a new renderer that consumes `BlockView`, P8 rewrites each component to consume `BlockView` instead. The result: the new renderer + new components form a complete pipeline parallel to the old one. Editor cutover (P11.x) then chooses the new pipeline.

## Dependencies

P7 (new renderer with BlockView interface). The BlockView shape must be defined and stable for P8 to build component implementations against it.

## Current state

- `/Users/hansyu/code/taleweaver/packages/core/src/components/` has these component files (per directory survey 2026-05-08):
  - `document.ts`, `paragraph.ts`, `heading.ts`, `list.ts`, `list-item.ts`
  - `table.ts`, `table-row.ts`, `table-cell.ts`
  - `image.ts`, `horizontal-line.ts`
  - `text.ts`, `span.ts` — to be deleted per master spec line 509.
  - `component-definition.ts` — the interface every component implements.
  - `component-registry.ts` — registers component definitions by `block.type`.
  - `factories.ts` — helpers for constructing default styles.
  - `index.ts` — barrel.
- Each file has a corresponding `.test.ts`.

## Files involved

**Modified (each container component):**
- `document.ts`, `paragraph.ts`, `heading.ts`, `list.ts`, `list-item.ts`, `table.ts`, `table-row.ts`, `table-cell.ts`, `image.ts`, `horizontal-line.ts` — rewrite each to consume BlockView.
- Their `.test.ts` files — update fixtures.

**Deleted:**
- `text.ts` and `text.test.ts` — text rendering moves into the new renderer's inline-content handling.
- `span.ts` and `span.test.ts` — same reasoning. (Per master spec invariant: `componentRegistry.has("text") === false`, `componentRegistry.has("span") === false`.)

**Modified (registry):**
- `component-registry.ts` — possibly the registration site changes if BlockView interface differs from the legacy interface; component definitions register with the same registry but with a new shape.
- `component-definition.ts` — the interface definition migrates from `StateNode`-consuming to `BlockView`-consuming.

## Key technical considerations

1. **Component definition interface.** The master spec at lines 385-410 sketches:
   ```typescript
   interface ComponentDefinition {
     type: string;
     render(view: BlockView, children: RenderNode[]): RenderNode;
     // possibly: defaultStyle, layout-hints, etc.
   }
   ```
   Per-phase plan formalizes the exact signature.

2. **`text` and `span` deletion.** These two components are unique: in the legacy world, text was a leaf "component" that produced TextBoxes from `node.properties.content`. In the new world, text rendering happens inside the renderer's inline-content walker (per `block.inlineContent.items` of the leaf block). There is no text component anymore. Same for `span` (which was a wrapping inline component). These two are deleted, not migrated.

3. **Each component's `render` method.** In legacy, the method received a StateNode and child RenderNodes. In new, it receives a BlockView and children. The structural shape of the render output (RenderNode tree) is unchanged from `render-node-v2.ts`.

4. **Default styles via cascade.** Components may declare default styles (e.g., paragraph has default font-size). These should integrate with the cascade interpreter pipeline (Phase 3) — the component's defaults register as base styles that the cascade resolves with `attrs`-derived overrides.

5. **List/list-item.** These have structural specifics (markers, level numbering). The migration should preserve all behaviors.

6. **Table/table-row/table-cell.** Most complex container family. Pay extra attention here.

## Risks and patterns to apply

- **DRY across components.** Many components share patterns (default style construction, child enumeration). Extract shared helpers to `factories.ts` or a new file BEFORE the second component duplicates the pattern.
- **Test fixture migration.** Each component's test file needs new BlockView-shaped fixtures. Use the test-utils builders from Phase 1 (`buildBlock`, `buildState`).
- **Browser smoke for each migrated component.** Per Strategy doc quality gate 4. Scenario per component family: render a document containing the component; verify pixels in a browser.
- **Implementer escalation:** if any component definition requires data the BlockView doesn't provide (per the spec sketch), STOP and escalate — the BlockView interface needs widening, which is P7's responsibility.

## Test strategy

Per Phase 4 pattern: subagent-driven, ~10 tasks with TDD per task. Each task migrates one component file + its test file:

- T1: paragraph (likely simplest)
- T2: document (root-level)
- T3-T4: list, list-item
- T5: heading
- T6-T8: table, table-row, table-cell
- T9: image, horizontal-line
- T10: delete text, span; update registry

Estimated test count delta: small (existing tests update; few net new tests).

## Open questions

1. **Component registration mechanism.** Is the registry singleton-based (`registerComponent(def)` mutates a global) or constructor-injected? Today it's likely singleton; verify and decide whether to keep.

2. **`defaultStyle` vs cascade interpreters.** Phase 3 added an attribute-interpreter pipeline. Does the component's `defaultStyle` go through interpreters too, or is it bypassed? Likely the latter — component defaults are baseline; interpreters add per-attr deltas. Per-phase plan clarifies.

3. **Image/horizontal-line as "leaf-like" components.** They have no inline content, but they're also not text. Decide how the renderer treats them: as block-level boxes with intrinsic sizing.

4. **List markers (bullets, numbering).** These were generated content in the legacy world. Per master spec, generated content + counters are P9a/P9b in the long-term roadmap (decomposition.md), not part of the state-redesign migration. P8 likely keeps the existing marker logic intact, just adapted to BlockView.

## Success criteria

- Every container component consumes BlockView and produces RenderNodes via the new renderer pipeline.
- `text.ts` and `span.ts` deleted; `componentRegistry.has("text")` returns false; `componentRegistry.has("span")` returns false.
- All migrated components have updated tests.
- Browser smoke: render a document with paragraph, list, heading, table — verify in browser.
- Old component files (no longer referenced) get deleted in P15 cleanup, not in P8.

## Review cycle expectations

Pre-execution: yes. Post-execution: yes. Browser smoke part of post-execution.

## Estimated commits

~7-10.
