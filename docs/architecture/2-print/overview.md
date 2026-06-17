# 2 — `@taleweaver/print`

`print` is the browser-canvas host AND the **print backend**: it owns the
GEOMETRIC layout engine + geometric cursor math and the
render→cascade→layout geometry pipeline that core no longer holds. It runs the engine against an HTML container, building the layout tree
from core's state, painting it onto canvases, and translating DOM events into
engine actions. It owns no document state — that lives in `core`. It owns the
*presentation* of state, the *layout geometry*, and the *capture* of input.

Core's editor reducer is geometry-free (see
[`1-core/1.5-editor.md`](../1-core/1.5-editor.md)): a mutating action records
the changed block ids on `EditorState.lastDirtyIds`, and this backend's
**layout-driver** consumes that to rebuild the render→cascade→layout tree
incrementally. Geometric navigation (Arrow/Home/End/Cmd-Backspace) likewise
left core: the controller maps those keystrokes to a `NavIntent`, the backend's
**NavIntent resolver** reads the layout tree + measurer to compute the geometry,
and dispatches a geometry-free `SET_SELECTION` / `DELETE_RANGE` back to core.

## Top-level modules

`packages/print/src/` is organized around the controller and the
specialized helpers it composes.

- **`editor-controller/`** (file: `editor-controller.ts`) — the host
  orchestrator. Owns one HTML container. On every `update(state)` call,
  it diffs against the previous state, paints, syncs scroll, repositions
  the cursor, and fires the cursor-blink animation. It also installs DOM
  event listeners (keyboard, mouse, scroll, IME composition, resize) and
  translates them into `EditorAction`s that it forwards to the host's
  dispatch callback.

- **`layout/`** — the GEOMETRIC box-layout engine. Owns formatting-context
  dispatch (BFC / IFC / Table FC),
  anonymous-box generation, real CSS 9.5 floats, fragmentation/pagination, the
  virtual-layout-tree, used-style resolution, and the layout-tree node types
  (`LayoutBox`/`BlockBox`/`LineBox`/`TextRunBox`, `PageBox`). Consumes core's
  text-core (UAX line-break/bidi, the shaper/measurer interfaces, intrinsic
  sizes) across the package boundary. This is the geometry `core` no longer holds.
  See [`2.2-layout/overview.md`](./2.2-layout/overview.md) and its per-FC docs.

- **`cursor/`** — the GEOMETRIC cursor math. Owns hit-test
  (`resolvePositionFromPixel`), cursor-position
  (`resolvePixelPosition`/`PixelPosition`), selection-geometry
  (`computeSelectionRects`/`SelectionRect`), line-navigation (`moveToLine`/
  `moveToLineBoundary`), line-bidi, the line/atomic-box indices (`collectLineBoxes`/
  `AbsoluteLineBox`/`LineLeaf`/…), and the comment/suggestion rects. Reads the
  driver-built layout tree. (The geometry-free selection model — `moveByCharacter`,
  `isCollapsed`, object-selection, grapheme-utils — STAYS in `core/src/cursor/`.)

- **`layout-driver/`** (files: `layout-driver.ts`, `layout-config.ts`) —
  the print backend's geometry pipeline. `createLayoutDriver(layoutConfig)`
  returns a `LayoutDriver` whose `rebuild(state, containerWidth, lastDirtyIds)`
  runs render → cascade (main + template + embed bodies) → layout and returns
  the `LayoutBox | VirtualLayoutTree`. It RETAINS the prior cycle's six trees
  (render output, main/template/embed cascaded trees, layout tree) as closure
  state, so a non-null `lastDirtyIds` drives an INCREMENTAL rebuild that reuses
  unchanged subtrees by reference (`null` = full rebuild: initial / resize). It
  also runs the FN-6.4 restart-per-page footnote-numbering second pass (re-render
  the changed markers from the layout's anchor→page map until the page assignment
  converges). `LayoutConfig = { measurer, hyphenator?, pageConfig?,
  componentRegistry, attrRegistry }` — the print-mechanics capabilities (`measurer`
  / `hyphenator`) that left core's `EditorConfig` live here. See
  [`2.1-layout-driver.md`](./2.1-layout-driver.md).

- **`nav/`** (file: `nav-intent.ts`) — the geometric-navigation resolver. The
  seven `NavIntent` variants (`MOVE_CURSOR` / `MOVE_LINE` / `MOVE_LINE_BOUNDARY`
  / `EXPAND_SELECTION` / `EXPAND_LINE` / `EXPAND_LINE_BOUNDARY` / `DELETE_LINE`)
  are exactly the geometric editor handlers lifted out of core.
  `resolveNavIntent(intent, editorState, layoutTree, measurer, componentRegistry)`
  reads the driver-built layout tree + measurer (the geometry), applies the
  object-selection / visual-order / line-move / Home-End rules (reusing core's
  pure `cursor/` primitives + `seedAnchorAffinity`), and returns the geometry-free
  `EditorAction` to dispatch — a `SET_SELECTION` (threading
  `caretAffinity`/`anchorAffinity`/`targetX`) or `DELETE_RANGE` — or `null` for a
  no-op (document edge / off-object boundary). The `key-handler` returns
  `KeyResult = EditorAction | NavIntent`; the controller's `isNavIntent` guard
  routes a `NavIntent` through `resolveNavIntent`, an `EditorAction` straight to
  dispatch. See [`2.8-editor-controller.md`](./2.8-editor-controller.md).

- **`canvas-renderer/`** (file: `canvas-renderer.ts`) — the painter.
  Draws a `LayoutBox` tree onto a canvas, with viewport culling for
  offscreen content. Two entry points: `paintCanvas` for non-paginated
  rendering (single canvas) and `paintPage` for one canvas per page.
  Reads the optional paint cache; when supplied, it skips full
  repaints by detecting unchanged subtrees.

- **`paint-cache/`** (file: `paint-cache.ts`) — paint-side reuse.
  Records a hash per `LayoutBox` capturing all paint-relevant inputs
  (geometry, paint-relevant computed-style fields, paint-relevant
  used-style fields, type-specific fields like text content). The
  renderer compares hashes against the previous paint to compute dirty
  regions; reference-equal subtrees short-circuit without per-box
  hashing.

- **`canvas-shaper/`** (file: `canvas-shaper.ts`) — the default
  `TextShaper` implementation. Uses canvas `measureText` and `fillText`
  (which delegate to the browser's underlying text shaper) and
  supplements with the engine's own cluster, bidi, and break-opportunity
  computation. Exposed via `createCanvasShaper(canvas)`; the host wires
  this into the engine config.

- **`key-handler/`** (file: `key-handler.ts`) — DOM keyboard event
  translation. Pure mapping from `KeyboardEvent` to `KeyResult =
  EditorAction | NavIntent`. Owns the keymap (Enter, Backspace, Arrow keys,
  Cmd/Ctrl combinations); the GEOMETRIC keys (Arrow / Home / End /
  Cmd-Backspace) map to a `NavIntent`, every other key to a core
  `EditorAction`. The `isNavIntent` guard discriminates the two. The
  controller calls into it; the keymap has no DOM side effects of its own.

- **`html-parser.ts`** — the browser `HtmlParser` adapter (`browserHtmlParser`).
  The `taleweaver-html` `DocumentSerializer<string>` itself lives in `core`
  (`state/serialize/`); its DECODE half parses through an injected `HtmlParser`
  over the DOM-free `HtmlNode` interface, keeping core headless. This file is the
  thin DOM adapter a browser host supplies — it wraps `DOMParser` + DOM `Node`s
  as `HtmlNode`s. The host passes `browserHtmlParser` into
  `createHtmlDocumentSerializer({ allocator, parseHtml })`. See
  [`../1-core/1.7-serialization.md`](../1-core/1.7-serialization.md).

- **`dom-mirror/`** (file: `dom-mirror.ts`) — `buildDomMirror`, a pure structural
  transform from an `AccessibilityNode` tree (core's `buildAccessibilityTree`
  projection) to a detached, visually-hidden, AT-visible semantic DOM subtree.
  No side effects, no mounting, no controller coupling. The dom-side consumer of
  the core accessibility projection. The hidden-mirror MOUNTING + `Selection`-sync
  + focusable-input layer that consumes it is `dom-mirror-host` (below).

- **`dom-mirror-host/`** (files: `dom-mirror-host.ts`, `dom-mirror-selection.ts`)
  — `createDomMirrorHost`, the materialization layer over `buildDomMirror`. Mounts
  a hidden, AT-visible, focusable `contenteditable role=textbox` mirror into the
  editor container; incrementally reconciles it to the `AccessibilityNode` tree
  each paint (resolving page-valued field runs upstream of the diff);
  owns the controlled-contenteditable input wiring (engine owns all edits) and the
  engine `Position`/`Span` ⇄ browser-`Selection` mapping (`dom-mirror-selection.ts`,
  through the runs' `data-offset-start`/`data-offset-end` + blocks' `data-block-id`).
  The controller wires it in behind a default-off `accessibilityMirror` flag; when
  on, the mirror subsumes the `<textarea>` as the focus / IME / clipboard host.

The read-only DOM viewer (`renderDocumentToDom`) is NOT a `print` module — it is
the `@taleweaver/digital` backend, which drives the same `core` styled tree but
lets the browser flow it instead of computing print geometry. See
[`../3-digital/overview.md`](../3-digital/overview.md).

Smaller helpers — `font-config` (font defaults), `image-cache` (async
image loading), `canvas-measurer` (legacy `TextMeasurer` adapter) — are support
modules consumed by the renderer and the controller.

## How modules connect

The controller is the central hub. The host application instantiates one
controller per editor, and the controller composes the other modules.

    host application
          │
          │ createEditorController(container, options)
          ▼
    ┌──────────────────────────────┐
    │ editor-controller            │
    │                              │
    │  on input event              │
    │   key-handler ──► KeyResult                                          │
    │     ├─ NavIntent ──► nav.resolveNavIntent(…, layoutTree, measurer)   │
    │     │                  └─► SET_SELECTION / DELETE_RANGE ─┐           │
    │     └─ EditorAction ────────────────────────────────────┤           │
    │                                                          ▼           │
    │                         host's dispatch ──► core.reduceEditor        │
    │                                                          │           │
    │                                                          ▼           │
    │  on update(newState)                              new EditorState    │
    │   │                                              (.state, .lastDirtyIds)
    │   ├─► layout-driver.rebuild(state, width, lastDirtyIds) ─► layoutTree
    │   ├─► canvas-renderer ◄─── paint-cache                                │
    │   └─► layout queries on the DRIVER-built layoutTree (cursor pos,      │
    │       selection rects) — calls into core's geometry API              │
    └──────────────────────────────┘
          ▲
          │ TextShaper (also the layout-driver's measurer)
          │
    canvas-shaper

Two entry surfaces:
- **Up to the host** (`@taleweaver/react` or other consumers): the
  controller exposes `update(state)`, `focus()`, `destroy()`. The host
  drives the lifecycle.
- **Down to `core`**: the controller dispatches `EditorAction`s (resolving
  `NavIntent`s to them first), reads `EditorState` (`.state` +
  `.lastDirtyIds`), runs the layout-driver to build the layout tree, and
  queries core's geometry API against it. It supplies `canvas-shaper` as the
  engine's text shaper AND as the layout-driver's `measurer`.

The paint cache is internal to the controller — one instance per canvas,
created on construction and discarded on destroy.

## Reading order

1. [`2.8-editor-controller.md`](./2.8-editor-controller.md) — controller responsibilities, lifecycle, input flow.
2. [`2.5-canvas-renderer.md`](./2.5-canvas-renderer.md) — paint pipeline, viewport culling, dirty regions.
3. [`2.6-paint-cache.md`](./2.6-paint-cache.md) — paint-input hashing, root short-circuit.
4. [`2.7-canvas-shaper.md`](./2.7-canvas-shaper.md) — `TextShaper` implementation, Unicode algorithm integration.
5. [`2.9-html-serializer.md`](./2.9-html-serializer.md) — the `taleweaver-html` serializer (now in `core`'s `state/serialize/`): supported subset, lossiness boundary, and `print`'s `browserHtmlParser` DOM adapter that feeds core's DOM-free decode.
6. [`2.10-dom-mirror.md`](./2.10-dom-mirror.md) — `buildDomMirror`: pure `AccessibilityNode` → visually-hidden semantic DOM transform, role/run mapping.
7. [`2.11-dom-mirror-host.md`](./2.11-dom-mirror-host.md) — `createDomMirrorHost`: the materialization layer — mounting, incremental keyed reconciliation per paint, page-field resolved-text injection, controlled-contenteditable input, `Selection` mapping, the `accessibilityMirror` flag.
8. [`2.1-layout-driver.md`](./2.1-layout-driver.md) — `createLayoutDriver` (the print backend's render→cascade→layout pipeline consuming `lastDirtyIds`, retained-tree incremental reuse, FN-6.4 restart-per-page pass, `LayoutConfig`) and `resolveNavIntent` (the geometric-navigation resolver — `KeyResult`, `NavIntent`, layout-tree-reading geometry → `SET_SELECTION`/`DELETE_RANGE`).
9. [`2.2-layout/overview.md`](./2.2-layout/overview.md) — the geometric box-layout engine: formatting-context dispatch, anonymous boxes, floats, used-style resolution, the virtual-layout-tree, and its per-FC docs ([BFC](./2.2-layout/2.2.1-bfc.md) / [IFC](./2.2-layout/2.2.2-ifc.md) / [Table FC](./2.2-layout/2.2.3-table-fc.md)).
10. [`2.3-pagination.md`](./2.3-pagination.md) — fragmentation, page templates, headers/footers/footnotes, layout-dependent fields.
11. [`2.4-positioning.md`](./2.4-positioning.md) — `position: relative/absolute`, transforms, opacity, stacking contexts.

The read-only DOM viewer (`renderDocumentToDom`) is documented under
`@taleweaver/digital` — see [`../3-digital/3.1-dom-view.md`](../3-digital/3.1-dom-view.md).

## Public API surface

`@taleweaver/print` exports:

**Editor controller** — `EditorController`, `EditorControllerOptions`. `createEditorController`.

**Canvas renderer** — `CursorState`. `paintCanvas`, `paintPage`.

**Paint cache** — `PaintInputHash`, `PaintCache`. `createPaintCache`, `hashPaintInputs`.

**Default text shaper** — `createCanvasShaper`. (Plus the legacy `createCanvasMeasurer` for backwards compatibility.)

**HTML parser adapter** — `browserHtmlParser` (the browser `HtmlParser` a host passes into core's `createHtmlDocumentSerializer({ allocator, parseHtml })`; the `taleweaver-html` serializer itself lives in `@taleweaver/core`).

**Accessibility DOM mirror** — `buildDomMirror` (`AccessibilityNode` → detached visually-hidden semantic DOM; see `2.10-dom-mirror.md`). `createDomMirrorHost`, `DomMirrorHost`, `DomMirrorHostOptions` (the materialization host; see `2.11-dom-mirror-host.md`). `positionFromMirrorNode`, `locateOffsetInMirror`, `placeMirrorSelection`, `readMirrorSelection` (engine ⇄ browser-`Selection` mapping).

**Helpers** — `mapKeyEvent` (DOM keyboard event → `KeyResult = EditorAction | NavIntent`). `ImageCache`. `FONT_CONFIG`, `buildCssFontString`, `getEffectiveStyles` (font defaults).

The `layout-driver` (`createLayoutDriver`, `LayoutConfig`) and the `nav`
resolver (`resolveNavIntent`, `NavIntent`, `isNavIntent`, `KeyResult`) are
INTERNAL to the controller — composed during construction, not on the package
barrel (like the paint cache). See [`2.1-layout-driver.md`](./2.1-layout-driver.md).

**Geometric layout + cursor surface** (OWNED by `print`; consumers import them
from `@taleweaver/print`) —
layout: `LayoutBox`, `BlockBox`, `LineBox`, `TextRunBox`, `PageBox` (+ the `create*`
factories), `layoutTree`, `layoutTreeIncremental`, `VirtualLayoutTree`,
`establishesNewBFC`, `computeUsedStyle`, `computeIntrinsicSizes`, `IFCState`,
`sourceBlockIdOf`, `markerOwnerKey`, the goto-destination + `PdfOutlineNode`/
`buildPdfOutline` resolvers; cursor: `resolvePixelPosition`, `PixelPosition`,
`resolvePositionFromPixel`, `computeSelectionRects`, `SelectionRect`, `moveToLine`,
`moveToLineBoundary`, `getCommentRangeRects`, `getSuggestionRangeRects`,
`buildLineBidiView`/`moveVisually`, `getAtomicBoxIndex`, `AbsoluteLineBox`,
`LineLeaf`, `collectLineBoxes`, `collectLineLeaves`, `findLineForPosition`.

**Re-exports from core** (geometry-free engine surface) — `EditorAction`,
`EditorState`, `EditorConfig`, `History`, `SelectionEntry`, `UndoRedoResult`.
`createInitialEditorState`, `reduceEditor`. `CounterFormat`,
`FootnoteNumberingPolicy`, `documentFootnotePolicy`. (The old `AbsoluteTextBox` /
`EditorHistory` / `collectAllTextBoxes` / `findFirst|LastTextDescendant` names
predate the #172 LineBox-canonical refactor and no longer exist.)
