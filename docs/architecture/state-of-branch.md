# State of the Branch

This is the audit of current implementation against the target
architecture. Each module is annotated with a status flag:

- **`[implemented]`** — present, working, broadly aligned with the
  target architecture.
- **`[partial]`** — present, but with known gaps or shortcuts.
- **`[broken]`** — present but failing one of its declared invariants.
- **`[missing]`** — absent from the codebase.

When the architecture docs and the code disagree, the architecture is
the source of truth; the gap is logged here.

---

## `core`

### `styles/` `[implemented]`

Full vocabulary present: `Style`, `ComputedStyle`, `UsedStyle`, `Length`,
`Color`, `Display`, `WritingMode`, `Direction`, etc. Every other module
imports from here.

Schema gaps deferred for later plans:
- `widows`, `orphans` — not yet on `Style`. Required by pagination.
- `text-align`, `hyphens`, `text-wrap` — not yet on `Style`. Required
  by typography.
- `overflow` — not yet on `Style`. Required by `establishesNewBFC`'s
  full check.
- `position: absolute / fixed`, `transform`, `opacity`, etc. — not yet
  on `Style`. Required by positioning + visual-chrome work.

### `state/` `[implemented]`

`StateNode`, immutable tree, path-based operations, transformations,
formatting, normalize, history. Reference-equality preservation across
edits works correctly.

### `components/` `[partial]`

Built-in components register and render. Plugin registry works.

Gaps in built-in component behavior:
- `imageComponent`, `horizontalLineComponent`, `tableComponent`,
  `tableRowComponent`, `tableCellComponent` are present but several
  paint paths and editor-action paths are stubs from the foundation
  rewrite. Insert / delete / edit operations on tables, images, and
  horizontal lines may not produce correct end-to-end behavior.

### `render/` `[implemented]`

`renderTree`, `renderTreeIncremental` working. Render-tree
reference-equality preserved across edits.

A legacy `render-node.ts` exists alongside the active `render-node-v2.ts`
for migration; the legacy types are not consumed by current core code
but remain exported.

### `cascade/` `[implemented]`

`cascadePass`, `cascadePassIncremental` working. The subtree
short-circuit fires correctly when render-tree references are
preserved upstream. Length flattening (`em` → px) works at cascade time;
`%`, `auto`, intrinsic keywords correctly pass through symbolic.

### `layout/` `[partial]`

Most of the layout pass is implemented and working:
- BFC: margin collapsing, clearance, list markers, anonymous block
  runs. Subtree reuse works including the "rebuilt parent with
  unchanged children" gate.
- IFC: line wrap, baseline alignment, uniform-direction bidi reorder,
  hyphen splitting, inline-block sizing, paragraph-level reuse.
- Table FC: auto-layout column widths from intrinsic sizes,
  anonymous row/cell synthesis.
- Float environment: full CSS 9.5 placement with push-below-if-needed,
  clearance integrated with margin-collapse, dirty-offset tracking.
- Intrinsic sizing pass: `min-content` and `max-content` per render
  node, cached.
- Layout-box reuse: `LayoutBoxCache`, `isLayoutBoxReusable`,
  `renderNodesLayoutEquivalent`.

Known gaps:
- **Inline-block shrink-to-fit** does not clamp `max-content` to
  available width, diverging from CSS Sizing 3 §10.3.5. Long inline-
  blocks overflow horizontally instead of clamping.
- **Mixed-direction bidi within a single shaped run** is not yet
  implemented. Hebrew embedded in English (or vice versa) renders in
  source order rather than visual order. Closes when the canvas shaper
  emits per-cluster bidi levels and the IFC's reorder consumes them.
- **Convergence detection for incremental wrap** is implemented in
  `wrap-incremental.ts` but not yet wired into the IFC's main wrap
  loop. The paragraph cache provides 90%+ of the expected benefit
  even without it.
- **Auto-table rowspan / colspan** — schema doesn't yet have
  `rowSpan`/`colSpan`; column-width algorithm uses sequential
  `colIdx++`.

### Pagination `[missing]`

No `PageBox` type. No fragmenter. No page templates. No
headers/footers/footnotes. No widows/orphans logic. The `editor-controller`
in `dom` has dormant per-page-canvas code that activates when paginated
output is present, but the layout pass never produces `PageBox`es.

This is a regression vs the pre-redesign main branch (which had naive
whole-block pagination, though no within-block fragmentation either).
The redesign deleted the prior `PageLayoutBox` / `paginateDocument`
during the foundation rewrite with the expectation that a future plan
would re-implement under the new architecture.

### Text `[partial]`

`TextShaper` interface defined; `text-tokenize` produces wrap-units
with stable IDs and break opportunities; canvas shaper supplies font
metrics, cluster boundaries, and (uniform-direction) bidi levels.

Known gaps:
- **UAX #14 line-break algorithm** is heuristic-based (whitespace +
  dash) rather than the full Unicode line-break property table.
  Sufficient for Latin and most CJK; corners for languages with
  unusual break behavior.
- **UAX #29 grapheme clusters** are partially correct (basic combining
  marks via canvas measurement) but cluster boundaries for emoji ZWJ
  sequences may be imperfect.
- **Hyphenation dictionaries** are not loaded; `hyphens: auto` falls
  back to no-hyphenation regardless of language.

A legacy `TextMeasurer` interface exists alongside `TextShaper` for
backwards compatibility; new code uses `TextShaper`.

### `cursor/` `[implemented]`

Selection types, `moveByCharacter`, `moveByWord`, `selectWord`,
`expandSelection`. Pure operations; consumed correctly by editor
action handlers.

### `editor/` `[partial]`

Reducer, action handlers, geometry queries, line navigation all
present. Action coverage is broad: insert text, delete (backward,
forward, by word, by line), move (char, word, line, document boundary),
expand selection, apply inline style, set block type, insert node.

Known gaps:
- **Editor-utility edge cases** (cursor placement within a word
  broken across lines, empty-line indicator on empty selected lines,
  Home/End on the second wrapped line of a paragraph) — disabled by
  earlier test deletions; require restoration when typography work
  ships.
- **Triple-click paragraph selection** and **shift-click extension**
  exist but use path arithmetic that hasn't been re-verified against
  the current state-tree shape.
- **Toolbar bold/italic/underline indicators** in the example app
  query state nodes for inline styles in a way that may produce
  incorrect "active" indicators if the state tree applies styles
  directly on text nodes rather than wrapping them in span nodes.

### `perf/` `[implemented]`

Flag-gated `markStart` / `markEnd` / `recordSample` / `report` /
`resetPerfTrace`. Markers installed across cascade, layout, paint, and
read-path functions. React example exposes `window.__perfReport()` /
`window.__perfReset()` when a perf fixture is loaded.

---

## `dom`

### `editor-controller` `[partial]`

Single-canvas mode, paginated multi-canvas mode (dormant — activates
when given `pageHeight` and `PageBox`-shaped layout children, neither
of which the engine currently produces), input listeners, key-handler
integration, cursor blink, scroll syncing, image-cache integration.

### `canvas-renderer` `[implemented]`

`paintCanvas` and `paintPage` both work. Viewport culling works. Two
paint paths (with cache, without cache) both correct. Root short-circuit
in `walkAndDetectChanges` fires correctly when wired in via the
controller's paint cache.

Paint strategy is "clear-dirty + full-repaint" rather than true
per-box compositing — the v1 ceiling without a layer compositor.
Selective compositing for cursor + selection layers is a candidate
follow-up.

### `paint-cache` `[implemented]`

`createPaintCache`, per-`LayoutBox` hash storage via `WeakMap`,
last-root tracking, `hashPaintInputs`. Wired into the editor controller.

### `canvas-shaper` `[partial]`

Canvas-based default text shaper. Uniform-direction bidi, basic
cluster boundaries, font metrics, break-opportunity heuristics. Paired
with a legacy `canvas-measurer` for callers that still consume the
older `TextMeasurer` interface.

Gaps as documented under `core`'s text section: full UAX #14, full
grapheme-cluster boundaries, hyphenation dictionaries.

### Other dom helpers `[implemented]`

`key-handler` (DOM keyboard event → `EditorAction` mapping),
`image-cache` (async image loading with re-paint trigger),
`font-config` (font defaults).

---

## `react`

### `use-editor` `[implemented]`

Hook returns the documented record. Reducer wiring works. Config
construction stable across renders.

### `editor-view` `[implemented]`

Mount / update / unmount lifecycle works. Controller wiring works.
React.Profiler instrumentation works.

---

## Examples

### `examples/react/` `[partial]`

Loads, renders the default empty document, accepts input. Toolbar and
menu bar work for basic operations.

Known issues:
- Pagination not active. The example app does not pass `pageHeight`
  or `pageGap` to `<EditorView>`, even though `dom`'s controller
  supports it. Activates once the engine produces `PageBox` outputs.
- Several editor utilities (triple-click, shift-click, toolbar
  bold/italic indicators) need verification against the current
  state-tree shape.
- The example's perf fixture loader (activated via `?perfFixture=N`
  URL parameter) builds large synthetic documents; combined with the
  lack of canvas paging, this exposes the canvas overflow at ~800
  paragraphs as a dev-environment usability issue.

### `examples/dom/` `[partial]`

Vanilla integration demo. Same status profile as `examples/react/`
minus the React-specific pieces.
