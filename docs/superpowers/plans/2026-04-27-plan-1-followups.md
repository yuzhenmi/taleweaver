# Plan 1 — Follow-ups, Hacks, and Deferred Cleanups

> Living record of every shortcut, stub, plan deviation, and code smell taken
> during Plan 1 execution. Each entry has a tracking ID so we can pick them
> off systematically — but **none should block Plan 2 progress** unless
> explicitly noted as architecturally significant.

**Status as of Plan 1 H.1 completion:**
- 42 commits on `feature/dom-architecture-redesign`
- All builds clean (core, dom, react, examples/react)
- Test suite green: 491 core / 107 dom / 10 react
- Example app dev server boots
- **Plan 2's responsibility:** real implementations of stubbed components,
  incremental cascade + layout, white-space modes beyond `normal`, floats,
  list markers, tables, inline-block. (See Plan 2 file.)

---

## Categories

1. [Plan-doc bugs found during execution](#1-plan-doc-bugs)
2. [Stubbed components](#2-stubbed-components)
3. [Editor utilities — partial migration](#3-editor-utilities--partial-migration)
4. [Performance regressions (incremental machinery removed)](#4-performance-regressions)
5. [Type-safety / `as` cast hacks](#5-type-safety--as-cast-hacks)
6. [Tests deleted for deferred features](#6-tests-deleted-for-deferred-features)
7. [Code smells](#7-code-smells)
8. [Configuration removed for Plan 1](#8-configuration-removed-for-plan-1)
9. [Things never implemented in Plan 1 (intentional)](#9-things-never-implemented-in-plan-1-intentional)

---

## 1. Plan-doc bugs

These were errors in the Plan 1 doc itself that the implementer subagents had to correct or work around. Doesn't affect runtime correctness — corrected during implementation — but means the plan doc is out of sync with what was actually shipped.

### F1.1 — D.4 margin-collapse formula was wrong
**Plan code:** `childY += Math.max(prevMarginBottom, childMarginTop) - prevMarginBottom`
**Correct code (shipped):** `childY += Math.max(prevMarginBottom, childMarginTop)`
The original simplifies to 0 when `prev >= child`, leaving no gap. The shipped version produces correct CSS-faithful adjacent-sibling collapsing.

### F1.2 — D.6 empty-block collapse needed redesign
The plan's snippet for empty-block margin collapse was incomplete — it computed `prevMarginBottom = max(top, bottom)` but didn't undo the `childY` advance, which gave wrong results for the test (`c2.y = 50` instead of expected `40`). Implemented correctly during D.6 by:
- Capturing `preAdvanceY` before the margin advance
- Detecting `isEmpty` after layout
- Resetting `childY = preAdvanceY` when empty
- Folding all three margins (`prev.bottom`, `child.top`, `child.bottom`) into the next `prevMarginBottom`

### F1.3 — Plan didn't budget editor-utilities migration
Plan 1's Phase G assumed editor utilities (`cursor-position.ts`, `hit-test.ts`, `layout-utils.ts`, `selection-geometry.ts`, `line-navigation.ts`) would migrate trivially. They didn't. They needed real type-translations from `BlockLayoutBox / LineLayoutBox / TextLayoutBox` to `BlockBox / LineBox / TextRunBox`, and several edge cases broke. Resolved partly by stubbing edge-case behaviors (see §3).

### F1.4 — Plan didn't anticipate `EditorConfig.pageHeight / pageMargins` removal cascade
G.3 implementer correctly removed these fields when the `PageMargins` type was deleted, but the cascade of consumer-side breakage (React `useEditor`, example `app.tsx`) wasn't planned. Picked up in G.8 + H.1.

### F1.5 — Plan G.4 didn't cover `font-config.ts` / `canvas-measurer.ts` cleanup
The DOM package's measurer and font helpers also depended on old `RenderStyles`. The G.4 implementer migrated them inline, which worked but extended the task's intended scope.

---

## 2. Stubbed components

These components were fully migrated in shape (compile, return ElementBox) but lack real per-component behavior. Plan 2 implements them properly.

### F2.1 — `spanComponent`
- Currently: `display: "inline"` ElementBox with pass-through children + state.style spread.
- Missing: nothing structural — span actually works for inline text styling. The downstream issue is in `toolbar-utils.ts` (see F3.6) which assumes the formatting walker picks up `style[prop]` on span nodes; if the new state tree doesn't always wrap inline-styled runs in span nodes, the toolbar's bold/italic indicator may be wrong.
- Plan 2 task: verify the inline-style application path actually produces span nodes with expected style.

### F2.2 — `listComponent` and `listItemComponent`
- Currently: `display: "block"` ElementBox stubs.
- Missing: `paddingLeft` for the gutter, `listStyleType` propagation, `display: list-item` on list-items, marker generation by layout (D.x in Plan 2). Until Plan 2 D.x: clicking a list-toggle button does nothing user-visible.
- Plan 2 task: real list rendering.

### F2.3 — `imageComponent`
- Currently: empty `display: "block"` ElementBox.
- Missing: width/height from properties, metadata.image carrying src, painter drawing the image.
- Plan 2 task: image rendering with metadata.

### F2.4 — `horizontalLineComponent`
- Currently: empty `display: "block"` ElementBox.
- Missing: metadata flag, painter drawing the 1px gray line.
- Plan 2 task: horizontal line painting.

### F2.5 — `tableComponent`, `tableRowComponent`, `tableCellComponent`
- Currently: `display: "block"` ElementBox stubs (NOT `display: "table"` etc.).
- Missing: real table FC dispatch, columnWidths, row height resolution, border-collapse painting.
- Plan 2 task: table FC implementation.

---

## 3. Editor utilities — partial migration

The utilities under `packages/core/src/editor/` were migrated to compile against the new `LayoutBox` union but several cases were elided to keep the build green. Verified via deleted tests (see §6).

### F3.1 — `cursor-position.ts`: cursor within character-broken word
The case "resolves cursor within a word broken across lines" was dropped. Plan 1's IFC doesn't yet character-break oversized words (deferred to Plan 2's IFC enhancements). When Plan 2 lands the line-stable wrap algorithm, restore this test.

### F3.2 — `selection-geometry.ts`: line-break indicators on empty lines
Four tests deleted around the "show a small visual indicator (~16px wide rect) on an empty line in a selection so the user sees the empty line is selected." This is a UX feature (visible cursor-like rect inside an empty selected line). The new `LineBox` produces empty children when content is empty; the geometry layer currently filters those out. Plan 2 task: re-add line-break-indicator rect emission for empty selected lines.

### F3.3 — `line-navigation.ts`: Home/End on wrapped second line
Two tests deleted: "Home on second wrapped line goes to start of that line", "End on second wrapped line goes to end of paragraph". The new IFC produces line boxes correctly but the `moveToLineBoundary` algorithm doesn't yet know how to land on a specific *visual* line within a paragraph (it currently treats the paragraph as one line). Plan 2 task: fix moveToLineBoundary for wrapped paragraphs.

### F3.4 — Lost or unverified: triple-click paragraph selection
Old code had triple-click selecting an entire paragraph by walking to first/last text descendants. This still exists in `editor-controller.ts` but uses path arithmetic that may not match the new state tree. Plan 2 task: verify and fix triple-click.

### F3.5 — Lost or unverified: shift-click selection extension
Same concern — implementation exists but interacts with cursor positioning + selection geometry. Smoke-test in browser.

### F3.6 — Toolbar bold/italic/underline indicators may be wrong
`examples/react/src/components/toolbar-utils.ts` walks the state path looking for `state.style[property]` on `node.type === "span"` nodes. If the new state tree applies inline styles directly on `text` nodes (instead of wrapping them in span nodes), the toolbar's "active" indicator never lights up. The dispatch should still apply styles correctly (TOGGLE_STYLE goes to the action handler), but the button visual would be stale.
**Plan 2 task:** verify, and if needed, update `toolbar-utils.ts` to look at text-node style too.

---

## 4. Performance regressions

### F4.1 — Cascade pass runs in full on every keystroke
The cascade is currently `cascadePass(renderTree)` — full tree walk per change.
**Plan 2 task (Plan 2 H.1):** reintroduce `cascadePassIncremental` with structural-sharing short-circuit. The plan exists; just hadn't been implemented yet.

### F4.2 — Layout runs in full on every keystroke
`rebuildTrees` calls `layoutTree(cascaded, containerWidth, measurer)` — full re-layout per change.
**Plan 2 task (Plan 2 H.2):** reintroduce `layoutTreeIncremental` with structural-sharing short-circuit and reference-equal-subtree reuse.

### F4.3 — IFC line construction is full-paragraph re-wrap
Even with incremental layout, the IFC re-wraps a full paragraph from scratch on any inline edit. This was already documented as Issue 03 in `docs/issues/`. Plan 2 leaves this as-is per the original design (line-stable wrap is a Plan 2+ goal, not v1).

---

## 5. Type-safety / `as` cast hacks

User stated preference: "Never write type-unsafe code. Avoid non-null assertions and casts." These violate that.

### F5.1 — `bfc.ts` `lengthToPx` helper uses `as { value: number }` cast
File: `packages/core/src/layout/bfc.ts`
Line: ~117 (current)
Code:
```ts
function lengthToPx(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return 0;  // "auto", "none"
  if (v && typeof v === "object" && "unit" in v && v.unit === "px") {
    return (v as { value: number }).value;  // ← unsafe cast
  }
  return 0;
}
```
**Better:** type the parameter as `Length | LengthOrAuto` (the actual types), let TS narrow via the discriminated union. Or define a typeguard helper.
**Plan 2 cleanup task.**

### F5.2 — `bfc.test.ts` lacks type narrowing on `out.children`
Multiple test files (~10 lines in `bfc.test.ts`) access `out.children` on a `LayoutBox` union without narrowing first. Tests pass at runtime via vitest's transpile-only mode but tsc warns.
**Better:** use a typed helper like `function asBlock(box: LayoutBox): BlockBox { … }` or narrow `out` via `if (out.type !== "block") throw …` at the top of each test.
**Plan 2 cleanup task.**

### F5.3 — `cascade-pass.ts` `flattenLengths` casts and Object.entries indexing
`flattenLengths` iterates length-named properties using `(cs as Record<string, unknown>)[key]`. Type-unsafe.
**Better:** use `Length`-typed accessor or refactor to a switch over a key list with properly typed assignments.

### F5.4 — `assignIds` in `insert-node.ts` uses string concatenation for ID generation
```ts
const id = `n-${nextId.value++}`;
```
Hardcoded prefix `"n-"`. Doesn't match other ID conventions in the codebase (`paragraph-0`, `text-0`, `n-3`). Also: counter is on `EditorState.nextId` which mixes user-action-allocated IDs with this allocator.
**Plan 2 cleanup:** unify ID allocation. Decide on a prefix scheme.

---

## 6. Tests deleted for deferred features

Tracking what was deleted so Plan 2 / 3 can re-introduce coverage.

### Whole files deleted (Plan 2 / 3 will rewrite)
- `packages/core/src/integration/table-editing.test.ts` — Plan 2 (table FC)
- `packages/core/src/integration/void-blocks.test.ts` — Plan 2 (image, hr)
- `packages/dom/src/canvas-renderer.test.ts` — referenced old layout types; Plan 2/3 will rewrite for new painter
- `packages/dom/src/canvas-measurer.test.ts` — used old `measureCursorHeight` API; Plan 2 may revisit measurer's exact contract
- `packages/core/src/layout/text-splitter.test.ts` — text-splitter was deleted in G.2; if a tokenizer-style helper is needed in Plan 2, write fresh tests
- `packages/core/src/layout/layout-box.test.ts` — tested old constructors; layout-box-v2.test.ts replaces
- `packages/core/src/layout/layout.test.ts` — tested old layoutTree/layoutTreeIncremental; new tests live in dispatch.test, bfc.test, ifc.test
- `packages/core/src/render/render-creation.test.ts` — tested old createBlockNode/createTextRenderNode etc.

### Individual tests deleted from surviving files
- `integration/inline-formatting.test.ts` — "renders and lays out inline bold text (Plan 1 stub)" → restore in Plan 2 when span renders properly
- `editor/cursor-position.test.ts` — "resolves cursor within a word broken across lines" → Plan 2
- `editor/selection-geometry.test.ts` — 4 line-break-indicator tests → Plan 2 (see F3.2)
- `editor/line-navigation.test.ts` — 2 wrapped-line Home/End tests → Plan 2 (see F3.3)
- `editor/actions/insert-block.test.ts` — entire file (replaced by `insert-node.test.ts`); deletion is correct, not a regression
- `react/use-editor.test.ts` — 2 INSERT_BLOCK tests for image/horizontal-line → Plan 2

---

## 7. Code smells

### F7.1 — Unused-import `void` suppression hack
File: `packages/core/src/layout/ifc.ts`
The IFC implementer added `void RenderNode; void TextBox;` at the bottom to suppress unused-import warnings rather than removing the imports. Subagent rationalized this as "they're reserved for Plan 2's first-class inline boxes." It's a hack; should remove the unused imports and re-add when Plan 2 needs them.

### F7.2 — `_exhaustive: never` declared but never read warning
File: `packages/core/src/editor/editor-state.ts:248`
The exhaustiveness check pattern `const _exhaustive: never = action;` is intentional (TS narrows the switch's default case). The warning is benign but will trigger on every build with `noUnusedLocals`. Either prefix with `__` (sometimes ignored by linters) or use a different pattern.

### F7.3 — `RenderNode` import unused in `bfc.ts`
File: `packages/core/src/layout/bfc.ts`
`import type { ElementBox, RenderNode } from "../render/render-node-v2";` — `RenderNode` is unused. Remove it.

### F7.4 — Various `getNodeByPath` / `insertText` / `createCursor` test imports unused
Multiple test files have stale imports left behind after test deletions. Remove them.

### F7.5 — `HEADING_FONT_SIZES` table is hardcoded
File: `packages/core/src/components/heading.ts`
`{ 1: 32, 2: 24, 3: 18.72, 4: 16, 5: 13.28, 6: 10.72 }` — Chrome browser defaults. Should probably be configurable (themes, doc-level overrides).
**Future task** — not Plan 2, this is product-level configurability.

### F7.6 — `flattenLengths` em fallback to 16
File: `packages/core/src/cascade/cascade-pass.ts`
```ts
const fontSize = typeof cs.fontSize === "number" ? cs.fontSize :
    ... cs.fontSize.unit === "em" ? cs.fontSize.value * 16 : 16;
```
At the document root (no parent), em values resolve against a hardcoded 16. Should be the configured initial font size (which is also 16 in `INITIAL_COMPUTED_STYLE`, but the value is duplicated rather than referenced).
**Plan 2 cleanup.**

### F7.7 — Initial values duplicated between `INITIAL_COMPUTED_STYLE` and component defaults
Components like `paragraphComponent` set `marginBottom: { unit: "em", value: 0.5 }` — this is a "default" but the property already has an initial value in `INITIAL_COMPUTED_STYLE` (0). This is the right behavior (component output sits above initial values in the cascade), but it means two sources of "what's the default for paragraph margin" — the property's initial value and the component's render output. Documentation could clarify.

---

## 8. Configuration removed for Plan 1

Things temporarily removed because Plan 1 doesn't need them. **Plan 2 / 3 must restore.**

### F8.1 — `EditorConfig.pageHeight`, `EditorConfig.pageMargins`
Removed from `editor-state.ts`'s `EditorConfig` interface in G.3. The React `useEditor` hook also no longer accepts these options (G.8c). Plan 3 (pagination) re-adds them, possibly with a different shape (`pageConfig?: PageConfig`).

### F8.2 — `examples/react/src/app.tsx` constants
`PAGE_HEIGHT = 1056`, `PAGE_GAP = 24`, `PAGE_MARGINS = { top: 96, ... }` were removed. The example is now non-paginated. Plan 3's H/I tasks restore these.

### F8.3 — `<EditorView pageHeight pageGap />` props
Removed in H.1. Restored in Plan 3.

### F8.4 — `getEffectiveStyles` from `font-config.ts`
Was a helper that filled in defaults from a partial style. Removed because `ComputedStyle` is always fully populated post-cascade. If anything was depending on it (none found), would need restoring.

---

## 9. Things never implemented in Plan 1 (intentional)

For completeness — these are NOT bugs, they're scope decisions documented in the spec.

- White-space modes other than `"normal"` — tokenizer throws "not yet implemented" for nowrap, pre, pre-wrap, pre-line. Plan 2 A.x.
- Floats and clear — `float`/`clear` properties exist in Style schema but layout ignores them. Plan 2 F.x.
- List markers — `listStyleType`, `listStylePosition` in schema but no MarkerBox generated. Plan 2 D.x.
- Tables — Table FC stubbed as block. Plan 2 E.x.
- Inline-block — `display: "inline-block"` recognized in schema but layout dispatch doesn't handle it. Plan 2 C.x.
- First-class inline boxes — `display: "inline"` flattened by IFC; no InlineBox in layout tree. Plan 2 B.x.
- Fragmentation / pagination — `break-*` properties in schema, widows/orphans in schema, but no fragmenter. Plan 3.
- Page templates — deferred entirely. Plan 3 + future.
- Position / absolute — schema doesn't even have these yet. Architecturally accommodated; no v1 work.
- Multi-column — schema doesn't have `columnCount`/`columnWidth`. Future.
- text-align, text-indent, vertical-align (sub/super), hyphens, RTL — schema doesn't have these. Future.

---

## How to use this document

When starting Plan 2 (or any later cleanup pass), pick up F-numbered items as small followup tasks. Don't let any of them block the main flow — most are pure-refactor or test-restoration work.

Items most likely to surface as user-facing bugs:
- **F3.6** — toolbar style indicators may be wrong (smoke test in browser will find this)
- **F3.4 / F3.5** — triple-click and shift-click may be off
- **F2.x** — clicking list / table / image / hr menu items currently inserts a stub block

Items most likely to be raised in code review:
- **F5.1, F5.2, F5.3** — type-unsafe casts conflicting with project's stated preference
- **F7.1** — `void X` suppression hack
- **F1.1, F1.2** — plan-doc bugs (mostly cosmetic now)

When fixing these, prefer to add a one-line note to this file linking to the fix commit, so we can mark items as resolved.
