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

Schema reservations (present in `Style` and `ComputedStyle` but not yet consumed by any code path):
- `widows`, `orphans` — required by pagination.
- `textIndent`, `hyphens`, `letterSpacing`, `wordSpacing`, `textTransform`, `fontFeatureSettings`, `tabSize` — required by typography phase 1 (P5); resolved into `UsedStyle` but not yet read by any tokenizer/layout/paint consumer. (`textAlign` incl. justify and `textWrap`/`whiteSpace` are NOW consumed — shipped via #312/#333/#309/#314/#338 — so they are no longer schema-only.)
- Vertical writing-mode values (`vertical-rl`, `vertical-lr`) — typed but `logicalToPhysical` throws for them.

Schema items genuinely missing:
- `overflow` — required by `establishesNewBFC`'s full check.
- `position: absolute / fixed`, `transform`, `opacity` — required by positioning + visual-chrome work.

### `state/` `[implemented]`

Y.Doc-backed block-tree-of-styled-runs (the 2026-05-02 redesign; see
`1.1-state.md`): a `Map<BlockId, Block>` over a Yjs document, each block
carrying `inlineContent: InlineItem[]`, with ID-based positions
(`{ blockId, offset }`). Layered operations (Layer-1 Y-primitives →
Layer-2 read utilities → Layer-3 mutations: insertText, deleteRange,
replaceRange, splitBlock, mergeBlocks, set/mergeBlockAttrs, clonePastedSubtree).
History is a `Y.UndoManager` wrapper with an aligned selection-entry stack.
Dirty tracking is write-time: `dirtyIds` captured from Yjs's
`afterTransaction` change event (not tree diffing), consumed by the
incremental render/cascade/layout passes. `applyOperation` returns the input
`State` reference unchanged on a no-op, so `result.state === state` is an
O(1) "did anything change?" guard. The old path-based `StateNode` immutable
tree is fully removed.

Known follow-ups (low urgency): `Y.Map.set(key, sameValue)` fires
change events → scattered same-value-write guards in ops like
`reparent-children.ts` self-move; consolidate via a `setIfChanged`
Y-utils helper (#358).

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

### Pagination `[partial]`

Foundation shipped (P1.A): `PageBox` LayoutBox variant; `paginateRoot` whole-block fragmenter; `EditorConfig.pageConfig` wires through layoutTree / layoutTreeIncremental; the editor controller's per-page-canvas path activates when `PageBox`es appear in the layout tree.

Within-block fragmentation shipped (P1.B): `FragmentationContext` and `LayoutResult` types wired through `layoutBlock`, `layoutInlineContent`, and `layoutTable`; `paginateRoot` rewritten as a page-by-page coordinator driving `layoutBlock` with a break token per page; BFC break-aware child loop (`break-before`, `break-after`, `break-inside`, margin truncation top side, overflow rule, resume from `BlockBreakToken`); IFC orphans/widows/hyphen-pair constraints and resume from `IFCBreakToken`; Table FC row-boundary fragmentation and resume from `TableBreakToken`.

Page margins shipped: each `PageBox` contains a single wrapping content-area `BlockBox` positioned at `(margins.inlineStart, margins.blockStart)` within the page; the BFC's containing inline size is the page content width (page minus inline margins). Content visibly insets from the page edges per CSS Paged Media semantics. The editor's `SET_CONTAINER_WIDTH` action threads `pageConfig` through to its `layoutTree` call, preserving paginated mode across container resizes.

Per-page paint coordinates: `paintPage` and `walkAndDetectChanges` translate by `(-pageBox.x, -pageBox.y)` so each page paints in page-local coordinates against its own canvas. `acquireCanvas` resets canvas dimensions and the per-page `PaintCache` when a slot's canvas is freshly created or recycled from the pool, preventing blank renders from cache short-circuit.

Page templates designed (P1.C; spec at `docs/superpowers/specs/2026-05-02-p1c-pagination-templates-design.md`; not yet implemented). State-tree-backed editable headers/footers scoped to `section` nodes; footnotes as inline state-tree nodes with section-level numbering policy; six margin regions; first/odd/even page variants; iterative footnote-slot convergence; two-pass page-count resolution; cursor-scope extension for editing header/footer/footnote subtrees. Decomposes into 5 sub-pieces (P1.C.1 through P1.C.5).

Still missing (deferred to P1.C and later):
- All P1.C sub-pieces (headers/footers/footnotes/templates).
- Bottom-side margin truncation across breaks for the edge case where the parent has bottom padding/border on a partial fragment (top side already shipped in P1.B).
- Cross-page floats (P1.D-or-P12; current float environment is single-fragment-aware).
- Generated content / counters consumers (target-counter resolves only after P9b).
- Cross-page table header row (`<thead>`) repetition (requires `Display: "table-header-group"` schema addition).

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
- **Paste-then-select-all reverts content** (user-observed,
  unprofiled). Rapid paste followed by an immediate select-all
  causes some of the pasted content to disappear from the editor.
  Likely a reducer-level race or a state-tree mutation timing
  issue. Not investigated. No reproducer harness yet.

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

Visible bug: **inter-word spacing is wrong** for plain ASCII text in
the example app — adjacent words appear visually merged (e.g.
"Welcometo Taleweaver—a documenteditor" instead of properly-spaced
words). Caused by a measurement / paint mismatch between space tokens
and word tokens, surfacing as overlapping or dropped space advances.
Not investigated; observed during P1.B browser smoke testing.

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

Loads, renders the default empty document with two seed paragraphs,
accepts input. Toolbar and menu bar work for basic operations.
Pagination is active (US Letter at 96 DPI, 1-inch margins). Multi-page
documents fragment correctly across pages with content visibly inset
from the page edges.

Known issues:
- Several editor utilities (triple-click, shift-click, toolbar
  bold/italic indicators) need verification against the current
  state-tree shape.
- The visible word-spacing bug from `canvas-shaper` shows up most
  obviously here (adjacent words appear merged in seeded text).
- Paste-then-select-all reverts content (see editor `[partial]`).
- The example's perf fixture loader (activated via `?perfFixture=N`
  URL parameter) builds large synthetic documents; the per-page
  canvas-pool virtualization handles thousand-paragraph documents
  without the old single-canvas overflow.

### `examples/dom/` `[partial]`

Vanilla integration demo. Same status profile as `examples/react/`
minus the React-specific pieces.
