# Taleweaver — Comprehensive Feature List

This is an exhaustive enumeration of what the engine can currently do,
based on a read of the codebase. Every feature has its source file (and
in many cases line numbers). Items are grouped by domain.

A "✅" means working today. A "⚠" means partially working with caveats.
A "❌" means absent — listed for completeness so the gap is visible.

---

## 1. Document model

### 1.1 Node types ✅

Twelve built-in component types (`packages/core/src/components/`):

| Type | Role | Notes |
|---|---|---|
| `document` | Root container | `components/document.ts` |
| `paragraph` | Text block | `components/paragraph.ts` |
| `heading` | Styled paragraph | `level: 1–6` → fontSize/fontWeight |
| `text` | Leaf, holds `content` | `components/text.ts` |
| `span` | Inline style wrapper | Used by `applyInlineStyle` |
| `list` | Ordered or unordered | `listType: "ordered" \| "unordered"` |
| `list-item` | Single list child | Rendered with marker by `list` parent |
| `image` | Void block | `properties: { src, width, height }` |
| `horizontal-line` | Void block | Renders 1px separator |
| `table` | Container with column widths | `properties: { columnWidths, rowHeights }` |
| `table-row` | Row container | |
| `table-cell` | Cell container | Text content lives in cell paragraphs |

### 1.2 Open `properties` schema ✅ (with caveat)

Each node has a `properties: Record<string, unknown>` for component-
specific data. Components define what keys they expect. ⚠ Untyped — see
[issue 02](issues/02-untyped-properties-schema.md).

### 1.3 Inline styles ✅

Closed set on `NodeStyles` (`state-node.ts`):

- `fontFamily`
- `fontSize`
- `fontWeight`
- `fontStyle`
- `textDecoration` — used for "underline"
- `lineHeight`

Toggled via `TOGGLE_STYLE` action with `"bold" | "italic" | "underline"`.
Set programmatically via `applyInlineStyle(state, span, styles, idBase)`
in `state/formatting.ts`.

### 1.4 Block-level styles ✅

Set by component implementations (not user-editable directly). Lives in
`RenderStyles` (`render/render-styles.ts`):

- `paddingTop` / `paddingBottom` / `paddingLeft` / `paddingRight`
- `lineMarginTop` / `lineMarginBottom` (ratio of line height — used for
  inline-content margin collapsing)
- `blockMarginTop` / `blockMarginBottom` (ratio of line height — used
  for block-formatting-context inter-block gap)

### 1.5 Markers ✅

Block render nodes can carry a `marker?: string`. Used by the `list`
component to put bullet (`•`) or number (`1.`, `2.`, …) at each item's
left edge. Painted by `canvas-renderer.ts` lines 123–134.

### 1.6 Metadata for void blocks ✅

`metadata?: Record<string, unknown>` on block render nodes carries
per-component drawing hints:

- `metadata.type === "image"` with `src, width, height` — painted as
  bitmap
- `metadata.type === "horizontal-line"` — painted as 1px gray line

Defined in `block-render-node.ts`, painted in `canvas-renderer.ts`
lines 102–121.

### 1.7 Immutability + structural sharing ✅

Every node and tree is `Object.freeze`d at creation
(`state/create-node.ts`). Mutations produce new trees with maximal
sharing. Reference equality is the dirty-check primitive.

### 1.8 Document normalization ✅

`normalizeDocument(state, allocateId)` (`state/normalize.ts`) inserts
empty paragraphs adjacent to opaque blocks (tables, images, hr) so the
user always has a place to put a cursor.

---

## 2. State operations (programmatic API)

All exported from `@taleweaver/core` (`packages/core/src/index.ts`):

- `createEmptyDocument()` — seed a doc with one empty paragraph.
- `createNode(id, type, properties, children, styles)`
- `createTextNode(id, content)`
- `getNodeByPath(root, path)`, `updateAtPath(root, path, node)`
- `insertChild(parent, index, child)`, `removeChild(parent, index)`
- `updateProperties(node, props)`
- `findPathById(root, id)`
- `findDirtyPaths(oldRoot, newRoot)`, `isDirty(...)`
- `getTextContent(node)`, `getTextContentLength(node)`, `clampOffset(...)`
- `extractText(state, span)` — plain text extraction
- `findFirstTextDescendant(node, basePath)`,
  `findLastTextDescendant(node, basePath)`

Transformations (return `Change`):

- `insertText(state, position, text)`
- `deleteRange(state, span)`
- `replaceRange(state, span, text)`
- `splitNode(state, position, newId, splitDepth?)`

Formatting:

- `applyInlineStyle(state, span, styles, idBase)` — supports `undefined`
  values to remove a style.
- `getStyleInRange(state, span, property)` — returns uniform value or
  undefined if mixed.
- `remapPosition(oldState, newState, position)` — keeps cursor valid
  across formatting restructures.

Position math:

- `createPosition(path, offset)`
- `createSpan(anchor, focus)`, `createSelection(anchor, focus)`
- `createCursor(path, offset)` — collapsed selection
- `comparePositions(a, b)`, `pathsEqual(a, b)`, `positionsEqual(a, b)`
- `normalizeSpan(span)` — anchor ≤ focus
- `selectionStart(s)`, `selectionEnd(s)`, `isCollapsed(s)`

---

## 3. Editor actions (the dispatched API)

Full list of `EditorAction` types (from `editor/editor-action.ts`).
Every one is dispatched as `editor.dispatch({ type: "...", ...payload })`.

### 3.1 Text input ✅

| Action | Payload | What it does |
|---|---|---|
| `INSERT_TEXT` | `text: string` | Insert at cursor; replace selection if non-collapsed. |
| `PASTE` | `text: string` | Plaintext paste. |

### 3.2 Deletion ✅

| Action | What it does |
|---|---|
| `DELETE_BACKWARD` | Backspace — delete one char or selection. |
| `DELETE_FORWARD` | Delete — delete one char or selection. |
| `DELETE_WORD` (`direction`) | Alt+Backspace / Alt+Delete. |
| `DELETE_LINE` | Cmd+Backspace — delete to start of line. |

### 3.3 Splitting / inserting blocks ✅

| Action | What it does |
|---|---|
| `SPLIT_NODE` | Enter — split paragraph (or split inside list-item). |
| `INSERT_BLOCK` (`blockType, properties?`) | Insert a fresh block via `createInitialState`. |
| `SET_BLOCK_TYPE` (`blockType, properties?`) | Convert paragraph ↔ heading etc. |
| `TOGGLE_LIST` (`listType`) | Wrap/unwrap selection in an ordered or unordered list. |

### 3.4 Cursor movement ✅

| Action | Payload | Meaning |
|---|---|---|
| `MOVE_CURSOR` | `direction: "forward" \| "backward"` | One character. |
| `MOVE_WORD` | `direction` | One word. |
| `MOVE_LINE` | `direction: "up" \| "down"` | Line up/down — preserves `targetX`. |
| `MOVE_LINE_BOUNDARY` | `boundary: "start" \| "end"` | Line home/end. |
| `MOVE_DOCUMENT_BOUNDARY` | `boundary: "start" \| "end"` | Doc home/end. |

### 3.5 Selection ✅

| Action | Payload | Meaning |
|---|---|---|
| `SET_SELECTION` | `selection: Selection` | Replace selection. |
| `EXPAND_SELECTION` | `direction` | Shift+Arrow. |
| `EXPAND_WORD` | `direction` | Shift+Alt+Arrow. |
| `EXPAND_LINE` | `direction` | Shift+Up/Down. |
| `EXPAND_LINE_BOUNDARY` | `boundary` | Shift+Cmd+Arrow / Shift+Home/End. |
| `EXPAND_DOCUMENT_BOUNDARY` | `boundary` | Shift+Ctrl+Home/End or Shift+Cmd+Up/Down. |
| `SELECT_ALL` | — | Cmd+A / Ctrl+A. |

### 3.6 Formatting ✅

| Action | Payload | Meaning |
|---|---|---|
| `TOGGLE_STYLE` | `style: "bold" \| "italic" \| "underline"` | Toggle on selection. |

### 3.7 History ✅

| Action | Meaning |
|---|---|
| `UNDO` | Pop undo stack, restore state + selection. |
| `REDO` | Pop redo stack. |

Merge tag system (`pushEditorChange`):
- Rapid same-tag edits within 500ms collapse into one undo step.
- Switching action kind breaks the chain.

### 3.8 View ✅

| Action | Payload | Meaning |
|---|---|---|
| `SET_CONTAINER_WIDTH` | `width: number` | Triggered by `ResizeObserver`. |

---

## 4. Keyboard shortcuts

Mapped in `packages/dom/src/key-handler.ts`. Below `mod` = Cmd on macOS,
Ctrl elsewhere.

### 4.1 Undo / Redo ✅
- `mod+Z` — UNDO
- `mod+Shift+Z` — REDO
- `Ctrl+Y` — REDO

### 4.2 Selection ✅
- `mod+A` — SELECT_ALL

### 4.3 Cursor movement (horizontal) ✅
- `←` — MOVE_CURSOR backward
- `→` — MOVE_CURSOR forward
- `Alt+←` / `Ctrl+←` — MOVE_WORD backward
- `Alt+→` / `Ctrl+→` — MOVE_WORD forward
- `Cmd+←` — MOVE_LINE_BOUNDARY start
- `Cmd+→` — MOVE_LINE_BOUNDARY end

### 4.4 Selection extension (horizontal) ✅
- `Shift+←` / `Shift+→` — EXPAND_SELECTION
- `Shift+Alt+←/→` / `Shift+Ctrl+←/→` — EXPAND_WORD
- `Shift+Cmd+←/→` — EXPAND_LINE_BOUNDARY

### 4.5 Cursor movement (vertical) ✅
- `↑` — MOVE_LINE up
- `↓` — MOVE_LINE down
- `Cmd+↑` — MOVE_DOCUMENT_BOUNDARY start
- `Cmd+↓` — MOVE_DOCUMENT_BOUNDARY end

### 4.6 Selection extension (vertical) ✅
- `Shift+↑/↓` — EXPAND_LINE
- `Shift+Cmd+↑/↓` — EXPAND_DOCUMENT_BOUNDARY

### 4.7 Home / End ✅
- `Home` — MOVE_LINE_BOUNDARY start
- `End` — MOVE_LINE_BOUNDARY end
- `Ctrl+Home` — MOVE_DOCUMENT_BOUNDARY start
- `Ctrl+End` — MOVE_DOCUMENT_BOUNDARY end
- `Shift+Home` / `Shift+End` — EXPAND_LINE_BOUNDARY
- `Shift+Ctrl+Home/End` — EXPAND_DOCUMENT_BOUNDARY

### 4.8 Deletion ✅
- `Backspace` — DELETE_BACKWARD
- `Alt+Backspace` / `Ctrl+Backspace` — DELETE_WORD backward
- `Cmd+Backspace` — DELETE_LINE
- `Delete` — DELETE_FORWARD
- `Alt+Delete` / `Ctrl+Delete` — DELETE_WORD forward

### 4.9 Block-level ✅
- `Enter` — SPLIT_NODE

### 4.10 Inline styling ✅
- `mod+B` — TOGGLE_STYLE bold
- `mod+I` — TOGGLE_STYLE italic
- `mod+U` — TOGGLE_STYLE underline

### 4.11 Not bound ❌

These are common in word processors but currently unmapped:

- `Tab` — anywhere (no Tab handling at all today; the textarea swallows
  it as default focus traversal)
- `mod+K` — link insertion
- `mod+Shift+L/E/R/J` — paragraph alignment
- `mod+]` / `mod+[` — indent / outdent
- `mod+Shift+5` — strikethrough
- Any function-key shortcuts

---

## 5. Mouse interactions

Implemented in `packages/dom/src/editor-controller.ts:520–618`.

### 5.1 Single click ✅
- Places cursor at hit position.
- Begins a drag (`isDragging = true`, `dragAnchor = pos`).
- If clicked outside any text, dispatches `MOVE_DOCUMENT_BOUNDARY end`.

### 5.2 Drag-select ✅
- `mousemove` while dragging → `SET_SELECTION` from anchor to current
  hit position.
- `mouseup` ends drag.

### 5.3 Double click ✅
- Selects the word at the click position via `selectWord`.

### 5.4 Triple click ✅
- Selects the entire paragraph (block at `path[0]`).
- Implementation: find first/last text descendants of the block,
  build a `SET_SELECTION` from start of first to end of last.

### 5.5 Shift+click ✅
- Extends selection from the current anchor to the click position.

### 5.6 Hit-testing across pages ✅
- `resolveMouseToLayout` resolves the click to `(x, y, pageIndex)` —
  works whether the user clicked on a canvas, a slot div, or container
  chrome.

### 5.7 Not implemented ❌
- No middle-click paste (X11 selection convention).
- No right-click context menu (the browser default still appears).
- No drag-and-drop of text (the dragged content can't be moved within
  the document).

---

## 6. Clipboard

Implemented on the textarea (`editor-controller.ts:655–676`).

### 6.1 Copy ✅
- `extractText(state, selection)` → plaintext on clipboard.
- Skipped if selection is collapsed.

### 6.2 Cut ✅
- Same as copy + dispatches `DELETE_BACKWARD` to remove the selection.

### 6.3 Paste ✅
- Reads `clipboardData.getData("text/plain")`.
- Dispatches `PASTE` action.

### 6.4 Not implemented ❌
- No HTML clipboard read/write — pasting from a rich source loses
  formatting; copying does not preserve structure for other rich
  editors.
- No image paste.
- No drag-drop file paste.

---

## 7. IME / composition support ✅

`editor-controller.ts:640–651`:

- `compositionstart` sets `isComposing = true`, suppressing `keydown`
  and `input` handlers during composition.
- `compositionend` reads `e.data` and dispatches `INSERT_TEXT`.
- The textarea's `value` is cleared after each commit.

---

## 8. Cursor & caret rendering

### 8.1 Cursor blink ✅
- 500ms interval (`editor-controller.ts:241`).
- Stopped on blur, started on focus.
- Hidden when a selection is active (`getCursorState` returns "hidden").

### 8.2 Cursor states ✅
- `"active"` — solid black, blinking.
- `"inactive"` — translucent black (40% opacity), not blinking.
- `"hidden"` — not drawn (selection active or unfocused → blink off
  state).

### 8.3 Cursor positioning ✅
- `resolvePixelPosition(state, position, layoutTree, measurer)` returns
  `{ x, y, height, lineY, lineHeight, pageIndex }`.
- Across paginated layout: `pageIndex` reports which page the cursor
  is on.
- Cursor width: 2px.

### 8.4 Selection rendering ✅
- `computeSelectionRects(state, selection, layoutTree, measurer, containerWidth)`
  returns one rect per visual line covered by the selection.
- Painted in translucent blue (`rgba(59, 130, 246, 0.3)`) before the
  text is drawn (so text reads on top).

### 8.5 Smooth scroll into view ✅
- `scrollCursorIntoView` runs after every `update`.
- 64px padding around the cursor.
- 250ms `easeOutCubic` animation.
- Scroll parent auto-detected by walking up the DOM looking for
  `overflow-y: auto | scroll`. Falls back to `window`.

---

## 9. Layout features

### 9.1 Line wrapping ✅
- Greedy word wrap inside inline formatting contexts
  (`layout-engine.ts:322–404`).
- Words are produced by `splitTextIntoWords` in `text-splitter.ts`.

### 9.2 Oversized-word break ✅
- Words wider than the available width are character-broken via
  `splitTextIntoWords(text, styles, measurer, maxWidth)`.

### 9.3 Margin collapsing ✅
- `lineMargin*` collapses by **min overlap**.
- `blockMargin*` collapses by **max** (CSS-like).
- See `layout-engine.ts:215–231`.

### 9.4 Line height ✅
- `styles.lineHeight` is a multiplier of `fontSize`. Default is
  `FONT_CONFIG.lineHeight` (1.2).
- Half-leading: glyphs centered within the line height
  (`canvas-renderer.ts:144–148`).

### 9.5 Paddings ✅
- `paddingTop/Bottom/Left/Right` consumed by `layoutBlock`.

### 9.6 Tables ✅
- Column widths as fractions of available width.
- Row heights = `max(maxCellHeight, explicitHeight)`.
- Borders drawn at outer rect + column / row separators
  (`canvas-renderer.ts:176–209`).

### 9.7 Pagination ⚠
- Distributes blocks into pages of fixed height.
- Page margins: `top`, `bottom`, `left`, `right`.
- ⚠ **Whole-block only** — no cross-page block splitting. See
  [issue 04](issues/04-pagination-whole-block-only.md).

### 9.8 Single-canvas mode ✅
- When `pageHeight` is undefined, layout uses one tall canvas.
- A `<div spacer>` drives the scroll height.

---

## 10. Rendering / canvas

Implemented in `packages/dom/src/canvas-renderer.ts`.

### 10.1 Selection rects ✅
Drawn first, behind text. Translucent blue.

### 10.2 Block markers ✅
Rendered at the block's top-left edge using the default font.

### 10.3 Text ✅
- Per-text-box font string built from `styles` via `buildCssFontString`.
- Underline drawn 1px below baseline if `styles.textDecoration === "underline"`.
- Glyphs vertically centered with half-leading.

### 10.4 Tables ✅
Borders drawn after children. Column / row separators at integer pixel
boundaries (`+ 0.5` for crisp 1px lines).

### 10.5 Images ✅
- Loaded async via `ImageCache` (`packages/dom/src/image-cache.ts`).
- Triggers a repaint when an image arrives.
- Gray placeholder while loading.

### 10.6 Horizontal lines ✅
- 1px gray line, 8px inset from the block's left/right edge.

### 10.7 Cursor ✅
- 2px-wide rectangle, black or translucent black.

### 10.8 Viewport culling ✅
- `paintBox` skips subtrees fully outside `[visibleTop, visibleBottom]`.
- Single-canvas mode computes the visible window from the scroll parent.
- Paginated mode delegates per-page (only active canvases are painted).

### 10.9 DPR / retina support ✅
- Canvas pixel buffer = `logicalSize × devicePixelRatio`.
- `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` lets drawing use logical
  coordinates.
- Resize-on-demand only when dimensions change.

### 10.10 Font cache ✅
- `PaintState.lastFont` short-circuits redundant `ctx.font` writes
  across adjacent text boxes.

---

## 11. Pagination chrome (paginated mode)

Implemented in `editor-controller.ts:373–479`.

### 11.1 Page slot DOM ✅
- One `<div data-page-index="N">` per page.
- Drop shadow box-shadow per page (paper effect).
- Inter-page gap via `marginBottom: pageGap`.

### 11.2 Lazy canvas attachment ✅
- `IntersectionObserver` with `rootMargin: "200px"`.
- When a slot enters the viewport, a canvas is acquired (from pool or
  newly allocated) and appended.
- When a slot leaves, the canvas is detached and returned to the pool.

### 11.3 Canvas pool ✅
- Canvases reused across slots — never destroyed, just moved.

### 11.4 Mode switching ✅
- `syncDom` tears down single-canvas DOM and rebuilds slots when
  pagination mode changes (or vice versa).

---

## 12. Focus management ✅

- A 1px-wide transparent textarea inside the container is the focus
  target.
- Focus listener: starts cursor blink, repaints.
- Blur listener: stops blink, repaints (cursor goes inactive-translucent).
- `editor.focus()` on the React API focuses the textarea.

---

## 13. History (undo/redo) ✅

`packages/core/src/editor/editor-state.ts:55–118`:

- Selection-aware: each entry stores `selectionBefore` and
  `selectionAfter`. Undo restores both document and selection.
- Merge-tag coalescing: actions tagged with the same kind within 500ms
  collapse into a single undo step.
  - `INSERT_TEXT` is tagged `"insert"`.
  - Other actions break the chain.
- Stack depth capped at 500.
- Redo cleared on any new edit.

---

## 14. Programmatic API surface

Re-exports from `@taleweaver/dom` and `@taleweaver/react` for consumer
convenience. Highlights:

- Construct: `createInitialEditorState(config)`, `reduceEditor(state, action, config)`.
- Compute: `resolvePixelPosition`, `resolvePositionFromPixel`,
  `computeSelectionRects`, `moveToLine`, `moveToLineBoundary`,
  `collectAllTextBoxes`.
- Inspect: `getStyleInRange`, `extractText`, `findFirstTextDescendant`,
  `findLastTextDescendant`, `findPathById`.
- Mutate: full transformation API (`insertText`, etc.) for headless
  workflows.

---

## 15. React integration ✅

- `useEditor(options?)` — returns `{ editorState, dispatch, containerRef,
  measurer, pageHeight, focus }`.
- `<EditorView {...editor} pageHeight pageGap />` — mounts the controller.
- `ResizeObserver` automatically dispatches `SET_CONTAINER_WIDTH` on
  container resize.

---

## 16. Configuration / customization

### 16.1 Default container width
- Defaults to 600 in `useEditor` if not overridden by `ResizeObserver`.

### 16.2 Pagination
- Optional via `useEditor({ pageHeight, pageMargins })`.
- `pageGap` separately passed to `<EditorView>` (defaults to 24).

### 16.3 Component registry ✅
- Pass a custom registry by overriding `EditorConfig.registry`.
- Default = `defaultComponents`.

### 16.4 Text measurer ✅
- Default = `createCanvasMeasurer(document.createElement("canvas"))`.
- Headless contexts use `createMockMeasurer(charWidth, lineHeight)`.

---

## 17. Example apps

### 17.1 React example (`examples/react`) ✅
Google-Docs-style demo with:
- US Letter pagination (1056px, 96px margins).
- Header + menu bar (DocMenuBar) + toolbar.
- Built with shadcn/ui components.

### 17.2 DOM example (`examples/dom`) ✅
Bare-bones HTML page demonstrating direct integration via
`createEditorController`.

---

## 18. Known absent features (❌)

These are commonly expected in a word-processor-grade editor but are
not implemented:

### 18.1 Editing
- ❌ Tab key handling (no indent / outdent / cell navigation).
- ❌ Drag-and-drop of selected text within the document.
- ❌ Drag-and-drop file/image upload.
- ❌ Rich-text paste (HTML clipboard).
- ❌ Smart quotes / smart dashes / autocorrect.
- ❌ Spell check overlay.
- ❌ Find & Replace.
- ❌ Comments / annotations.
- ❌ Track changes / suggestions.
- ❌ Footnotes / endnotes.
- ❌ Hyperlinks (no link node, no Cmd+K binding).
- ❌ Cross-block drag-to-reorder.

### 18.2 Formatting
- ❌ Strikethrough, subscript, superscript, color, highlight.
- ❌ Paragraph alignment (left/center/right/justify).
- ❌ Indent / outdent of paragraphs.
- ❌ Block quote.
- ❌ Code block.
- ❌ Custom paragraph spacing (only line-height multiplier).
- ❌ Page break (manual).

### 18.3 Layout
- ❌ Cross-page block splitting (see [issue 04](issues/04-pagination-whole-block-only.md)).
- ❌ Widow / orphan control.
- ❌ Multi-column layout.
- ❌ Floating images (text wrap around image).
- ❌ Headers / footers.
- ❌ Page numbers.
- ❌ Section breaks with different page settings.

### 18.4 Tables
- ❌ Tab to next cell.
- ❌ Add/remove row or column shortcuts.
- ❌ Cell merging.
- ❌ Column resize via drag.
- ❌ Row resize via drag.

### 18.5 Lists
- ❌ Nested lists with proper indentation behavior.
- ❌ Tab/Shift+Tab to indent/outdent list items.
- ❌ Custom marker formats (lowercase letters, roman numerals).
- ❌ Continued numbering across breaks.

### 18.6 Persistence
- ❌ Serialize / deserialize document to JSON or HTML.
- ❌ Auto-save.
- ❌ Document import (Markdown, HTML, .docx).
- ❌ Document export.

### 18.7 Collaboration
- ❌ Operations as first-class values (see [issue 11](issues/11-no-collaboration-architecture.md)).
- ❌ CRDT or OT.
- ❌ Remote cursors.
- ❌ Server-side persistence.

### 18.8 Accessibility
- ❌ ARIA tree / accessibility DOM (see [issue 12](issues/12-accessibility-gap.md)).
- ❌ Screen reader support.
- ❌ Find in page (browser feature requires DOM text nodes).
- ❌ Reader mode compatibility.
- ❌ High-contrast / forced-colors mode.

### 18.9 Internationalization
- ❌ RTL languages (no bidi support in line wrap).
- ❌ Vertical writing mode (CJK).
- ❌ Locale-aware word boundaries (the word splitter is whitespace-based).
- ❌ Composition cursor visualization during IME.

### 18.10 Performance for very long docs
- ❌ Windowed layout (see [issue 13](issues/13-long-document-virtualization.md)).
- ❌ Line-stable incremental wrap (see [issue 03](issues/03-inline-layout-not-incremental.md)).
- ❌ Background / off-thread layout.

### 18.11 Editor chrome
- ❌ Default toolbar (the React example builds its own).
- ❌ Default menu bar.
- ❌ Right-click context menu.
- ❌ Floating selection toolbar.

---

## How to read this list

- The "✅" items are implemented and have test coverage.
- The "⚠" items work but with documented limits — follow the linked
  issue for the gap.
- The "❌" items are absent. Many are reasonable absences for a
  pre-1.0 engine; others are gaps in the project's stated goal of
  word-processor parity.

For a deeper dive into how any feature works, see the [architecture
docs](README.md).
