# 07 — DOM Controller

**Path:** `packages/dom/src/`

The DOM package is the bridge between the headless engine and the browser.
It paints to canvas, listens to events, maps keystrokes to actions, and
manages the canvas pool for paginated documents.

## Files

```
dom/
├── index.ts                 public API + re-exports from core
├── editor-controller.ts     createEditorController — the do-everything factory
├── canvas-renderer.ts       paintCanvas, paintPage, paintBox, table borders
├── canvas-measurer.ts       createCanvasMeasurer — implements TextMeasurer
├── font-config.ts           FONT_CONFIG, buildCssFontString, getEffectiveStyles
├── key-handler.ts           mapKeyEvent (KeyboardEvent → EditorAction | null)
└── image-cache.ts           ImageCache — async-loaded images for image components
```

## EditorController contract

```ts
// editor-controller.ts lines 30–41
interface EditorControllerOptions {
  measurer: TextMeasurer;
  dispatch: (action: EditorAction) => void;
  pageHeight?: number;
  pageGap?: number;       // defaults to 24
}

interface EditorController {
  update(editorState: EditorState): void;
  focus(): void;
  destroy(): void;
}
```

The controller is a closure over a private mutable state bag (~30 local
variables and DOM references). The React layer calls `update` whenever
`editorState` changes.

## DOM layout produced inside `container`

```
container[position: relative; user-select: none; cursor: text]
├── (single mode only)
│   ├── <div spacer>            (sized to layoutTree.height, pointer-events: none)
│   └── <canvas single>         (positioned absolute, full doc)
│
├── (paginated mode only)
│   ├── <div pageSlot data-page-index="0">       (boxShadow drop shadow)
│   │   └── <canvas data-page-index="0">         (acquired/released by IntersectionObserver)
│   ├── <div pageSlot data-page-index="1">
│   │   └── <canvas data-page-index="1">
│   └── ...
│
└── <textarea>                  (1px wide, transparent — receives keys, IME, clipboard)
```

The textarea is the focus target. It's invisibly positioned at the cursor
pixel (`textarea.style.left/top` updated in `syncDom`).

## Single vs paginated mode

`syncDom` (lines 312–371) inspects `state.layoutTree.children` for any
`PageLayoutBox`. If present → paginated; else → single canvas. Switching
between modes tears down and rebuilds the DOM accordingly.

## Canvas pooling for pagination

`syncPageCanvases` + `setupIntersectionObserver` (lines 373–464):

```
slots: <div>[]                  one per page — always present
activeCanvases: Map<idx, canvas> only for visible pages (rootMargin: 200px)
canvasPool: canvas[]             retired canvases, ready for reuse
```

When a slot enters the viewport, a canvas is acquired (from pool or new),
appended, and painted. When a slot leaves, the canvas is returned to the
pool. This keeps memory sub-linear in page count.

## Painting

`paintCanvas` and `paintPage` are in `canvas-renderer.ts`. They:

1. Clear (or fill page background white).
2. Draw selection rects (translucent blue).
3. Walk the layout tree top-down (`paintBox` lines 87–174):
   - Viewport-cull subtrees outside `[visibleTop, visibleBottom]`.
   - Block + `metadata.type === "horizontal-line"` → draw 1px gray line.
   - Block + `metadata.type === "image"` → draw image (or gray placeholder
     while `ImageCache` loads).
   - Block + `marker` → render the list bullet/number.
   - Text → set font from `styles`, draw glyphs with half-leading vertical
     centering, optional underline.
   - Table → paint children, then borders.
4. Draw cursor (`active`, `inactive`, or `hidden`).

A `PaintState { lastFont, imageCache }` short-circuits redundant `ctx.font`
sets across adjacent text boxes.

DPR handling: the canvas's pixel buffer is `logicalSize × devicePixelRatio`
and `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` makes drawing operations
operate in logical units.

## Keyboard mapping

`key-handler.ts` `mapKeyEvent(event) → EditorAction | null`. Coverage:

| Key combo | Action |
|---|---|
| ⌘/Ctrl + Z | UNDO |
| ⌘/Ctrl + Shift + Z, Ctrl + Y | REDO |
| ⌘/Ctrl + A | SELECT_ALL |
| ⌘/Ctrl + B / I / U | TOGGLE_STYLE bold / italic / underline |
| ←, → | MOVE_CURSOR |
| Shift + ←/→ | EXPAND_SELECTION |
| Alt/Ctrl + ←/→ | MOVE_WORD |
| Shift + Alt/Ctrl + ←/→ | EXPAND_WORD |
| Cmd + ←/→ | MOVE_LINE_BOUNDARY |
| Shift + Cmd + ←/→ | EXPAND_LINE_BOUNDARY |
| ↑, ↓ | MOVE_LINE |
| Shift + ↑/↓ | EXPAND_LINE |
| Cmd + ↑/↓ | MOVE_DOCUMENT_BOUNDARY |
| Shift + Cmd + ↑/↓ | EXPAND_DOCUMENT_BOUNDARY |
| Home / End | MOVE_LINE_BOUNDARY |
| Ctrl + Home/End | MOVE_DOCUMENT_BOUNDARY |
| Shift variants of above | EXPAND_* |
| Backspace | DELETE_BACKWARD |
| Alt/Ctrl + Backspace | DELETE_WORD backward |
| Cmd + Backspace | DELETE_LINE |
| Delete | DELETE_FORWARD |
| Alt/Ctrl + Delete | DELETE_WORD forward |
| Enter | SPLIT_NODE |

Modifier evaluation order matters and is documented inline (e.g.
"check metaKey before ctrlKey/altKey on Mac").

## Mouse handling

In `editor-controller.ts`:

- `mousedown` (line 520): determines `(x, y, pageIndex)` from the target
  element (`resolveMouseToLayout` lines 484–518), runs hit-test, dispatches
  `SET_SELECTION` (or `MOVE_DOCUMENT_BOUNDARY` if outside any text).
- `e.detail === 2` → select word (`selectWord`).
- `e.detail >= 3` → select paragraph (find first/last text descendants of
  the block).
- `shiftKey` → extend selection from current anchor.
- Single click → place cursor + start drag tracking (`isDragging = true`,
  `dragAnchor = pos`).
- `mousemove` (document-level): if dragging, update focus only.
- `mouseup` (document-level): clear drag state.

`resolveMouseToLayout` handles three cases: click on a canvas, click on
a slot div, click on container chrome (closest page by visual Y).

## Clipboard

- `copy` / `cut`: `extractText(state, selection)` → plaintext on clipboard.
  `cut` also dispatches `DELETE_BACKWARD`.
- `paste`: pulls `text/plain` and dispatches `PASTE`.

Plaintext only — no rich content roundtripping.

## Composition (IME)

- `compositionstart` sets `isComposing = true`, suppressing other input.
- `compositionend` reads `e.data` and dispatches `INSERT_TEXT`.
- The textarea's `input` listener also dispatches `INSERT_TEXT` for
  ordinary typing, then clears the textarea value.

## Cursor blink

`startBlink` / `stopBlink` (lines 234–249) toggles `cursorVisible` every
500ms when focused. Repaint follows. When a selection is active
(`selectionRects.length > 0`), the cursor is hidden (`getCursorState`
returns "hidden").

## Scroll handling

- `detectScrollParent` walks the parent chain looking for `overflow-y` =
  `auto`/`scroll`. Falls back to `window`.
- `handleScroll`: rAF-throttled repaint (so single-canvas viewport culling
  stays correct).
- `smoothScrollTo`: easeOutCubic over 250ms.
- `scrollCursorIntoView`: pads 64px around the cursor; computes the cursor
  visual y based on `pageIndex × (pageHeight + pageGap) + cursorPos.y` for
  paginated mode.

## ImageCache

`image-cache.ts` (35 lines): a `Map<src, HTMLImageElement>` that
asynchronously loads images and triggers a repaint via the supplied
callback when an image arrives. The painter draws a gray placeholder
in the meantime.

## destroy()

Removes all event listeners (container, document, textarea, scrollParent),
clears blink and scroll timers, removes pageSlots / canvases / textarea,
and sets `destroyed = true` so any in-flight callback aborts cleanly.

## Why this file is huge

`editor-controller.ts` is **790 lines**. It does mode switching, mouse,
keyboard, IME, clipboard, focus, blink, smooth scroll, scroll-parent
detection, IntersectionObserver canvas pooling, DPR, single-vs-paginated
DOM trees, repaint orchestration. See [issue 08](../issues/08-editor-controller-srp.md).

## Public exports

See `packages/dom/src/index.ts`:

```ts
// DOM-specific
export { FONT_CONFIG, buildCssFontString, getEffectiveStyles }
export { createCanvasMeasurer }
export { mapKeyEvent }
export { paintCanvas, paintPage } from "./canvas-renderer"
export type { CursorState }
export { createEditorController } from "./editor-controller"
export type { EditorController, EditorControllerOptions }
export { ImageCache }

// Re-exports from core (consumer convenience)
export type { EditorAction, PixelPosition, SelectionRect, AbsoluteTextBox }
export type { EditorState, EditorConfig, EditorHistory, EditorHistoryEntry }
export { resolvePixelPosition, resolvePositionFromPixel, computeSelectionRects }
export { moveToLine, moveToLineBoundary, collectAllTextBoxes }
export { createInitialEditorState, reduceEditor }
export { findFirstTextDescendant, findLastTextDescendant }
```

## See also

- [05 editor reducer](05-editor-reducer.md) — produces the `EditorState` this controller consumes.
- [08 React bindings](08-react-bindings.md) — how this controller is plumbed into React.
- [issue 08](../issues/08-editor-controller-srp.md) — single-responsibility issues.
- [issue 12](../issues/12-accessibility-gap.md) — there's no accessibility tree.
