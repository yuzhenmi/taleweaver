# P7 — Render module rewrite

**Subject:** Build a new render module that consumes `State` (block-tree-of-ropes) and produces `RenderNode` trees, dispatching through the components registry. Run parallel to the existing render module (which consumes `StateNode`); old render stays callable until consumers cut over.

**Reference:** Strategy doc Decision 1 (Path B), master spec migration step 8.

## Goal

The current renderer (`packages/core/src/render/render.ts`) consumes the legacy `StateNode` tree and produces `RenderNode` (RenderNode = `ElementBox | TextBox`). Phase 5+ requires a new renderer that consumes the new `State` (rootId + blocks map) and the BlockView interface defined in the master spec (lines 385-410), dispatching components via the registry.

Under Path B, the new renderer is added in PARALLEL with the existing one. Editor + components cut over later (P8 components, P11.x editor) to use it. Legacy renderer stays in place for any consumer that hasn't migrated yet.

## Dependencies

- P3 (cascade interpreter pipeline) — done.
- P4 (Layer 3 ops) — done.
- P6 (`state.embedContents`) — needed because the renderer enumerates ALL blocks including embed-content (footnote bodies render in their own zones).

## Current state

- `/Users/hansyu/code/taleweaver/packages/core/src/render/render.ts` — current renderer. Consumes `StateNode`, recursively dispatches to component definitions.
- `/Users/hansyu/code/taleweaver/packages/core/src/render/render-node.ts` — barrel that re-exports `render-node-v2.ts`.
- `/Users/hansyu/code/taleweaver/packages/core/src/render/render-node-v2.ts` — the actual `RenderNode` type (`ElementBox | TextBox`). Already migrated; the "v2" suffix is from an earlier migration.
- The renderer interacts with `cascade/cascade-pass.ts`, `components/component-registry.ts`, `components/factories.ts`.

## Files involved

**Created (parallel new render module):**
- `packages/core/src/render/render-block-state.ts` (or `render-v2-state.ts` — naming TBD) — entry point taking `State`.
- Possibly internal helpers for: walking from rootId, looking up registered components, assembling RenderNode tree.
- Likely also a helper for rendering embed-content zones (footnote bodies as separate RenderNode trees alongside the main document).

**Untouched (in this phase):**
- `render.ts` (the old version) — stays callable.
- `render-node.ts`, `render-node-v2.ts` — the RenderNode type itself doesn't change. Stays.
- All component files (`components/*.ts`) — stay on legacy interface. P8 migrates them.

## Key technical considerations

1. **BlockView interface — see `decisions.md` decision B (2026-05-15, survey-confirmed).** Push-model rendering with split container/leaf interfaces:
   - `ContainerBlockView` — id, type, attrs, computedStyle, `kind: "container"`. Has child blocks; children rendered first and handed in.
   - `LeafBlockView` — id, type, attrs, computedStyle, `kind: "leaf"`, `inlineContent: InlineContent` (possibly empty for image/horizontal-line). Inline items expanded by the renderer into `inlineRenderNodes` and handed in.
   - No `childIds`, no `parent` on either — traversal is the renderer's job; cross-block lookups go through `RenderContext`.

   The renderer walks the underlying State (using `firstChildId` / `nextSiblingId` on Block), dispatches to the right component kind based on the registry, and hands each component its pre-rendered children or inline items. BlockView is a frozen snapshot facade over the underlying Y.Map (post-Phase 4e); the renderer caches and invalidates them via dirtyIds.

2. **Cascade integration.** The renderer's first responsibility is to apply the cascade interpreter pipeline (Phase 3) to each block's `attrs` to produce `Style → ComputedStyle`. This is per-block and produces the `computedStyle` field on BlockView.

3. **Embed-content zones.** With P6 introducing `state.embedContents`, the renderer must enumerate them too (per spec lines 141-152). Footnote-anchor embeds in the main body reference content blocks; the renderer assembles a separate "footnote layer" of RenderNodes that pagination consumes.

4. **Dispatch via components registry.** The components registry (`component-registry.ts`) is keyed by `block.type`. The renderer asks the registry for a definition and calls its `render` method with the BlockView + children.

5. **Parallel implementation discipline.** New renderer DOES NOT delete or modify the old one. The new file is named distinctly (e.g., `render-block-state.ts`). Both compile. The user (editor) chooses which one to call. Components in P8 migrate handler-by-handler; the registry dispatches based on which type is registered. Eventually P15 deletes the old renderer entirely.

6. **`text` and `span` components.** Per master spec line 509: `componentRegistry.has("text") === false`, `componentRegistry.has("span") === false`. These two component types go away — the renderer (this phase) generates inline runs directly from `block.inlineContent.items` without dispatching to a "text" component. This is a behavior change from the old renderer; ensure the new renderer's inline-rendering logic handles this directly.

## Risks and patterns to apply

- **Leaky-abstraction error contracts.** When the renderer delegates to component definitions, errors should preserve component-name context. Pattern from Phase 4c-1 / 4c-4 / 4c-5.
- **Cycle defense.** Walking the block tree could in principle hit cycles (malformed state). Visited set defends. Pattern from Phase 4d.
- **DRY.** If the new renderer needs helpers that overlap with existing render helpers (e.g., a "build child BlockView" function), extract first or carefully share.
- **Browser smoke test.** Per Strategy doc quality gate 4: any UI-touching phase must run `npm run dev --workspace=examples/react` and exercise. P7 is the first phase that genuinely changes pixels — smoke test critical here.

## Test strategy

The new renderer is a producer of RenderNodes; tests assert structural correctness:
- Empty document → empty/minimal RenderNode tree.
- Single paragraph → renders to expected ElementBox + TextBox shape.
- Multi-paragraph document → block-level RenderNode children.
- Inline mixed-attrs runs → text runs flowed into a single block's RenderNode.
- Embed items (image, footnote-anchor) → renders correctly.
- Footnote bodies (in `state.embedContents`) → render as a separate zone.
- Cascade integration: a block with `attrs: { bold: true }` produces a TextBox with `fontWeight: "bold"` in its computedStyle.

Estimated test count: 15-25 tests across the new render module's test files.

## Open questions

1. **File naming convention** for parallel implementations under Path B. `render-block-state.ts` vs `render-v3.ts` vs subdirectory `render/v3/render.ts`? The strategy doc punts to per-phase plan.

2. ✅ **BlockView shape — resolved in `decisions.md` decision B (2026-05-15).** Push model, minimal surface, RenderContext escape hatch. Per-phase plan still defines internal walker structure and snapshot facade implementation, but the public interface is locked.

3. **Component registry split.** Do the old and new components both register under the same registry instance? Or two registries? Likely same registry with type discrimination (since `block.type === "paragraph"` should resolve to whichever paragraph component is current).

4. **Footnote rendering destination.** Per pagination spec P1.C, footnote bodies render into per-page footnote zones. The new renderer probably emits them as a separate RenderNode array alongside the main RenderNode tree. Pagination then composes them. P7 plan needs to define the data shape.

## Success criteria

- New render entry point exists, takes `State`, returns RenderNode tree (+ embed-content RenderNode array).
- Builds on top of cascade interpreter pipeline correctly.
- Dispatches through components registry.
- Has its own test file with ≥15 tests.
- Old `render.ts` still compiles and works (parallel implementation).
- Browser smoke (call new renderer through a test harness, verify pixels in browser) works for at least the simplest document.

## Review cycle expectations

Pre-execution: yes. Post-execution: yes. Browser smoke as part of post-execution gate.

## Estimated commits

~7-10.
