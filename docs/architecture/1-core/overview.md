# 1 — `@taleweaver/core`

`core` is the pure engine. It owns the document model, the rendering
pipeline, the editor reducer, and platform-agnostic geometry queries.
No DOM dependencies; runs in any JavaScript runtime.

## Top-level modules

`packages/core/src/` is organized by responsibility — each top-level
directory is one module.

- **`styles/`** — the type vocabulary. Defines `Style` (what users
  declare), `ComputedStyle` (post-cascade), `UsedStyle` (post-layout,
  fully numeric), and supporting primitives (`Length`, `Color`,
  `Display`, `WritingMode`, etc.). Every other module imports from here.

- **`state/`** — the document model. An immutable tree of `StateNode`s
  with path-based operations, text transformations, inline-style
  application, position primitives, and undo/redo history.

- **`components/`** — the plugin registry. Each component registers a
  render function for a node type. Lets downstream consumers add new
  document primitives (charts, equations, embeds) without forking core.

- **`render/`** — the render tree. Walks a state tree bottom-up and
  dispatches each node through the component registry to produce a
  `RenderNode` tree of layout-relevant elements with declared styles.

- **`cascade/`** — the value-resolution pass. Walks the render tree
  top-down applying inheritance, initial values, and length flattening
  (em → px). Output: render tree annotated with `ComputedStyle`.

- **`layout/`** — the layout pass. The largest module. Owns formatting-
  context dispatch (BFC, IFC, Table FC), anonymous-box generation, real
  CSS 9.5 floats, intrinsic sizing, line wrapping, fragmentation. Output:
  a `LayoutBox` tree with `ComputedStyle` + resolved `UsedStyle` per
  box. Defines the `TextShaper` interface that hosts implement.

- **`cursor/`** — cursor and selection primitives. Operations like
  `moveByCharacter`, `moveByWord`, `expandSelection`, `selectWord` —
  pure manipulations on positions that editor action handlers compose.

- **`editor/`** — the reducer and the geometry-query API. Wraps the
  entire pipeline behind a single function that takes `(state, action,
  config)` and returns new state. Owns one action handler per
  `EditorAction` type and the read-only geometry queries
  (`resolvePixelPosition`, `resolvePositionFromPixel`,
  `computeSelectionRects`).

- **`perf/`** — performance instrumentation. A flag-gated tracing API.
  Other modules call into it; when disabled, calls are zero-cost.

## How modules connect

The reducer in `editor/` is the orchestrator. Every state-mutating
action follows the same path: state operation → render tree → cascade
→ layout tree.

    ┌───────────────────┐
    │ editor/ reducer   │ ◄──── EditorAction (from host)
    └─────────┬─────────┘
              │ orchestrates pipeline (incremental at every stage)
              ▼
    state/  ──►  render/  ──►  cascade/  ──►  layout/  ──► LayoutBox tree
                   ▲                              │
                   │ component registry           │ TextShaper interface
                   │                              ▼
            components/                       host implements

The pipeline output (`LayoutBox` tree, plus the new state and selection)
is packaged into a fresh `EditorState` and returned to the host.

`cursor/` operations are invoked from inside action handlers to
manipulate selection. `perf/` cuts across all modules — markers in each
module record into a shared trace.

`styles/` is foundational and absent from the diagram: every other
module imports its type vocabulary.

## Reading order

1. [`1.1-state.md`](1.1-state.md) — document model, immutability, history, transformations.
2. [`1.2-render.md`](1.2-render.md) — components, render functions, the render tree.
3. [`1.3-cascade.md`](1.3-cascade.md) — value resolution, length flattening, computed-style equality.
4. [`1.4-layout/overview.md`](1.4-layout/overview.md) — formatting contexts, intrinsic sizing, anonymous boxes, real floats, line wrap.
5. [`1.5-pagination.md`](1.5-pagination.md) — fragmentation, page templates, headers/footers/footnotes.
6. [`1.6-text.md`](1.6-text.md) — text shaper interface, Unicode algorithms, hyphens, font metrics.
7. [`1.7-editor.md`](1.7-editor.md) — reducer, action handlers, geometry queries.
8. [`1.8-perf.md`](1.8-perf.md) — instrumentation.
