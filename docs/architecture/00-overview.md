# 00 — Architectural Overview

Taleweaver is a **canvas-based rich text editor engine**. It deliberately
avoids `contentEditable` and the browser's text-layout pipeline, owning its
own document model, rendering, and layout in order to expose precise layout
information (line breaks, page breaks, hit-test geometry) to consumers. The
goal is word-processor-grade pagination and editing.

## Packages

```
taleweaver/
├── packages/
│   ├── core/      ← engine: pure logic, no DOM dependency
│   ├── dom/       ← canvas painting, DOM event glue
│   └── react/     ← <EditorView> + useEditor()
└── examples/
    ├── dom/       ← vanilla integration demo
    └── react/     ← Google-Docs-style demo (toolbar, pagination)
```

| Package | Public role | Source size |
|---|---|---|
| `@taleweaver/core` | Document model, components, render tree, layout, reducer | ~12k LOC across `packages/core/src` |
| `@taleweaver/dom` | `createEditorController`, canvas painter, key/mouse handlers | ~1.5k LOC across `packages/dom/src` |
| `@taleweaver/react` | `useEditor`, `<EditorView>` | ~130 LOC across `packages/react/src` |

### Dependency graph

```
  examples/react ──┐
                   ▼
                 react ──► dom ──► core
  examples/dom ──────────► dom ──► core
```

Strictly one-way. `core` imports nothing DOM-shaped. `react` re-exports a
chunk of `core`'s public API for consumer convenience (see
`packages/react/src/use-editor.ts` and `packages/dom/src/index.ts`).

## The single most important diagram — the 3-tree pipeline

Every keystroke (and every layout-affecting action) walks this path:

```
┌──────────────┐   render()    ┌──────────────┐   layout()   ┌──────────────┐
│  STATE TREE  │ ────────────► │ RENDER TREE  │ ───────────► │ LAYOUT TREE  │
│              │               │              │              │              │
│  immutable   │               │  + styles    │              │  + x,y,w,h   │
│  semantic    │               │  + markers   │              │  + lines     │
│  StateNode   │               │  RenderNode  │              │  + pages     │
│  (id, type,  │               │  (key, type, │              │   LayoutBox  │
│  properties, │               │   styles,    │              │              │
│  styles,     │               │   children)  │              │              │
│  children)   │               │              │              │              │
└──────────────┘               └──────────────┘              └──────────────┘
        ▲                              ▲                              ▲
        │                              │                              │
   what user                    what to draw                    where to draw
   typed                        (with what styles)              (at which pixel)
```

- **State tree** — semantic, immutable, frozen at creation. `packages/core/src/state/state-node.ts`.
- **Render tree** — derived from state via the component registry. Adds
  layout-relevant styles (paddings, margins) and per-node metadata (image
  src, list marker). `packages/core/src/render/`.
- **Layout tree** — derived from render via `layoutTree`. Resolves widths,
  heights, line wrapping, and pagination into absolute boxes.
  `packages/core/src/layout/`.

Each tree is **immutable, structurally shared, and incrementally
rebuildable**. See [09-data-flow](09-data-flow.md) for the full keystroke
trace.

## Where state lives

The full pipeline output is stored together inside `EditorState`:

```ts
// packages/core/src/editor/editor-state.ts (lines 122–131)
interface EditorState {
  state: StateNode;        // semantic
  selection: Selection;    // semantic
  history: EditorHistory;  // semantic
  renderTree: RenderNode;  // derived cache
  layoutTree: LayoutBox;   // derived cache
  containerWidth: number;  // input
  nextId: number;          // allocator
  targetX: number | null;  // ephemeral UI state for vertical motion
}
```

This shape has implications — see [issue 05](../issues/05-editor-state-mixed-concerns.md).

## Concurrency / collab

There is none. State is a single-user, single-document, in-memory tree with
local undo/redo. See [issue 11](../issues/11-no-collaboration-architecture.md).

## Reading order

1. This file.
2. [01 state layer](01-state-layer.md) — the document model.
3. [02 components](02-components.md) — extensibility surface.
4. [03 render](03-render-layer.md) and [04 layout](04-layout-layer.md) — the derivation pipeline.
5. [05 editor reducer](05-editor-reducer.md) — how mutations are dispatched.
6. [06 cursor & selection](06-cursor-selection.md) — coordinate system.
7. [07 DOM controller](07-dom-controller.md) — pixels and events.
8. [08 React bindings](08-react-bindings.md) — the framework adapter.
9. [09 data flow](09-data-flow.md) — end-to-end trace.
