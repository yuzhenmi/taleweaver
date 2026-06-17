# 3 — `@taleweaver/digital`

`digital` is the **DOM-flow (browser-native) backend**. It drives the same
`core` document model as the `print` backend, but instead of computing print
geometry it materializes the styled tree into real DOM and lets the **browser**
flow it to any width. It owns no document state — that lives in `core`. It owns
the *presentation* of state as browser-flowed DOM; it ships **NO layout engine**
(its dependency closure includes none of `print`'s geometric layout, no
pagination, no caret/hit-test geometry).

Where `print` answers "where does every box sit on the page?" by computing a
positioned `LayoutBox`/`PageBox` tree, `digital` answers "what DOM should the
browser render?" and hands flow back to the browser's own box-model. The two
backends are peers over the same `core` brain: a host picks whichever flow model
it needs (paginated print geometry, or continuous browser-flowed DOM).

## Top-level modules

`packages/digital/src/` has two halves: a read-only DOM viewer and an interactive
contenteditable controller. Both materialize the SAME `core` styled tree into DOM
(`render()` → `cascadePass()` → a node-walk); the controller adds input adaptation
and an incremental reconciler on top.

- **`dom-view/`** (files: `render-to-dom.ts`, `computed-style-to-css.ts`) — the
  read-only DOM viewer. `renderDocumentToDom` runs `render()` → `cascadePass()`
  → a recursive node-walk that materializes the cascaded styled tree into real
  DOM, mapping each node's `display` to the matching tag and its `ComputedStyle`
  to inline CSS (logical → physical resolution, list grouping, the optional
  `suggestionView`). It produces the same styled tree the `print` layout engine
  consumes — rendered the digital way, with no engine geometry and no pages. See
  [`3.1-dom-view.md`](3.1-dom-view.md).
- **`editor-digital/`** (files: `digital-controller.ts`, `digital-reconciler.ts`,
  `digital-selection-bridge.ts`, `map-before-input.ts`, `map-digital-key.ts`) —
  the interactive `contenteditable` editing controller. `createDigitalController`
  drives the same `core` reducer, maps native `beforeinput` / `keydown` /
  `selectionchange` events to geometry-free `EditorAction`s, reconciles the DOM
  to each new `EditorState`, and bridges the browser `Selection` to core
  `Position`s. The browser owns caret geometry and flow; the controller imports
  `core` only (never `print`). See [`3.2-digital-controller.md`](3.2-digital-controller.md).

## How modules connect

The host application drives the same `core` reducer it would for `print`, then
hands the resulting state to the DOM viewer instead of a geometric layout
driver:

    host application
          │
          │ EditorAction ──► core.reduceEditor ──► EditorState (.state)
          ▼
    ┌──────────────────────────────┐
    │ dom-view                     │
    │                              │
    │  renderDocumentToDom(state)  │
    │    render() ──► cascadePass()│
    │      └─► styled-tree walk ──► real DOM (browser flows it)
    └──────────────────────────────┘

State flows down (`EditorState`); the viewer re-materializes DOM the browser
lays out. Because `digital` imports `core` only — never `print` — the same
headless brain can power a browser-native flow without pulling in the geometric
layout engine.

The **interactive** controller (`editor-digital/`) inverts the top of this loop:
instead of the host driving `reduceEditor` and handing state to a viewer, the
controller owns the reducer and the contenteditable input — native events become
`EditorAction`s internally, and the reconciler keeps the DOM in sync with each new
state (see [`3.2-digital-controller.md`](3.2-digital-controller.md)).

## Reading order

1. [`3.1-dom-view.md`](3.1-dom-view.md) — `renderDocumentToDom`: styled-tree →
   DOM walk, node/display tag mapping, logical → physical inline styling, list
   grouping, the `suggestionView` option.
2. [`3.2-digital-controller.md`](3.2-digital-controller.md) — `createDigitalController`:
   the contenteditable editing backend — the `dispatch` chokepoint + `onChange`,
   native-event → `EditorAction` input adaptation, the reconciler (state-diff →
   DOM), the DOM ⟷ `Position` selection bridge, and the `digital ↛ print` boundary.

## Public API surface

`@taleweaver/digital` exports:

- `renderDocumentToDom`, `renderNodeToDom`, `RenderDocumentToDomOptions` — the
  read-only DOM viewer (styled-tree → browser-flowed DOM; see `3.1-dom-view.md`).
- `computedStyleToInlineStyle` — the `ComputedStyle` → inline-CSS mapping the
  viewer applies per node.
- `createDigitalController`, `DigitalController`, `DigitalControllerOptions` — the
  interactive contenteditable editing controller (see `3.2-digital-controller.md`).
