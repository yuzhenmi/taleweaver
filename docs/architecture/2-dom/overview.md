# 2 — `@taleweaver/dom`

`dom` is the browser-canvas host. It runs the engine against an HTML
container, painting layout output onto canvases and translating DOM
events into engine actions. It owns no document state — that lives in
`core`. It owns the *presentation* of state and the *capture* of input.

## Top-level modules

`packages/dom/src/` is organized around the controller and the
specialized helpers it composes.

- **`editor-controller/`** (file: `editor-controller.ts`) — the host
  orchestrator. Owns one HTML container. On every `update(state)` call,
  it diffs against the previous state, paints, syncs scroll, repositions
  the cursor, and fires the cursor-blink animation. It also installs DOM
  event listeners (keyboard, mouse, scroll, IME composition, resize) and
  translates them into `EditorAction`s that it forwards to the host's
  dispatch callback.

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
  translation. Pure mapping from `KeyboardEvent` to `EditorAction`. Owns
  the keymap (Enter, Backspace, Arrow keys, Cmd/Ctrl combinations). The
  controller calls into it; the keymap has no DOM side effects of its
  own.

- **`html-serializer/`** (files: `html-serializer.ts`, `html-encode.ts`,
  `html-decode.ts`) — the human-friendly `taleweaver-html`
  `DocumentSerializer<string>`. ENCODE is a pure `State` → HTML-string walk;
  DECODE parses HTML with the browser-native `DOMParser` (which is why this lives
  in `dom`, not the platform-agnostic `core`) into a declarative `BlockNode` tree
  and lowers it with core's `buildDocumentFromTree`. A readable AUTHORING/seeding
  format over a Google-Docs-complete prose + list subset; the binary serializer
  in `core` owns lossless interchange.

Smaller helpers — `font-config` (font defaults), `image-cache` (async
image loading), `canvas-measurer` (legacy `TextMeasurer` adapter),
`dev-mode` (the dom-local `isDevMode()` gate) — are support modules consumed by
the renderer, the controller, and the serializer.

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
    │   key-handler ──► EditorAction ──► host's dispatch ──► core.reduceEditor
    │                                                              │
    │                                                              ▼
    │  on update(newState)                                   new EditorState
    │   │                                                          │
    │   ├─► canvas-renderer ◄─── paint-cache                      │
    │   │                                                          │
    │   └─► layout queries on newState.layoutTree (cursor pos,     │
    │       selection rects) — calls into core's geometry API      │
    └──────────────────────────────┘
          ▲
          │ TextShaper
          │
    canvas-shaper

Two entry surfaces:
- **Up to the host** (`@taleweaver/react` or other consumers): the
  controller exposes `update(state)`, `focus()`, `destroy()`. The host
  drives the lifecycle.
- **Down to `core`**: the controller dispatches `EditorAction`s, reads
  `EditorState`, and queries the geometry API. It supplies
  `canvas-shaper` as the engine's text shaper.

The paint cache is internal to the controller — one instance per canvas,
created on construction and discarded on destroy.

## Reading order

1. [`2.1-editor-controller.md`](2.1-editor-controller.md) — controller responsibilities, lifecycle, input flow.
2. [`2.2-canvas-renderer.md`](2.2-canvas-renderer.md) — paint pipeline, viewport culling, dirty regions.
3. [`2.3-paint-cache.md`](2.3-paint-cache.md) — paint-input hashing, root short-circuit.
4. [`2.4-canvas-shaper.md`](2.4-canvas-shaper.md) — `TextShaper` implementation, Unicode algorithm integration.
5. [`2.5-html-serializer.md`](2.5-html-serializer.md) — the `taleweaver-html` serializer: supported subset, lossiness boundary, DOMParser-in-dom rationale.

## Public API surface

`@taleweaver/dom` exports:

**Editor controller** — `EditorController`, `EditorControllerOptions`. `createEditorController`.

**Canvas renderer** — `CursorState`. `paintCanvas`, `paintPage`.

**Paint cache** — `PaintInputHash`, `PaintCache`. `createPaintCache`, `hashPaintInputs`.

**Default text shaper** — `createCanvasShaper`. (Plus the legacy `createCanvasMeasurer` for backwards compatibility.)

**HTML serializer** — `HTML_FORMAT`, `createHtmlDocumentSerializer` (the `taleweaver-html` `DocumentSerializer<string>`).

**Helpers** — `mapKeyEvent` (DOM keyboard event → `EditorAction`). `ImageCache`. `FONT_CONFIG`, `buildCssFontString`, `getEffectiveStyles` (font defaults).

**Re-exports from core** (current, per `index.ts` — the post-#172 LineBox model)
— `EditorAction`, `PixelPosition`, `SelectionRect`, `AbsoluteLineBox`, `LineLeaf`,
`EditorState`, `EditorConfig`, `History`, `SelectionEntry`, `UndoRedoResult`.
`resolvePixelPosition`, `resolvePositionFromPixel`, `computeSelectionRects`,
`moveToLine`, `moveToLineBoundary`, `collectLineBoxes`, `collectLineLeaves`,
`findLineForPosition`. `createInitialEditorState`, `reduceEditor`. `CounterFormat`,
`FootnoteNumberingPolicy`, `documentFootnotePolicy`. (The old `AbsoluteTextBox` /
`EditorHistory` / `collectAllTextBoxes` / `findFirst|LastTextDescendant` names
predate the #172 LineBox-canonical refactor and no longer exist.)
