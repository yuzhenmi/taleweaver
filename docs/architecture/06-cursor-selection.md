# 06 — Cursor & Selection

**Path:** `packages/core/src/cursor/` and selection-related modules in
`packages/core/src/editor/`

## Files

```
cursor/
├── selection.ts        Selection type + create/start/end/isCollapsed
└── cursor-ops.ts       moveByCharacter, moveByWord, expandSelection, selectWord

editor/
├── cursor-position.ts     state Position → pixel position (for caret painting)
├── hit-test.ts            pixel → state Position (for click handling)
├── selection-geometry.ts  Selection → SelectionRect[] (for highlight painting)
└── line-navigation.ts     up/down/home/end logic
```

## Selection model

```ts
// cursor/selection.ts
type Selection = Span;   // i.e. { anchor: Position, focus: Position }

createCursor(path, offset)             // collapsed at one point
createSelection(anchor, focus)         // ranged

isCollapsed(selection)                 // anchor === focus in document order
selectionStart(s) / selectionEnd(s)    // earlier / later in doc order
```

- `anchor` — where the user pressed mouse-down (or the un-moving end).
- `focus` — the caret end (the one that moves on Shift+Arrow).
- `Span` is just a type alias of `Selection` reused as the basis for
  formatting ranges and deletion ranges.
- `normalizeSpan(span)` (in `state/position.ts`) returns a copy with
  `anchor <= focus` for consumers who don't care about the user's intent.

## Cursor operations

`cursor/cursor-ops.ts`:

- `moveByCharacter(state, position, direction)` → new Position
- `moveByWord(state, position, direction)` → new Position
- `selectWord(state, position)` → Selection covering the word at position
- `expandSelection(selection, newFocus)` → keeps anchor, moves focus

These are pure tree-walks. They don't touch layout — they only need the
state tree.

## Pixel ⇄ state — the layout-aware functions

These bridge the semantic state world and the pixel world.

### `resolvePixelPosition` — `cursor-position.ts`

Given a state `Position`, walks the layout tree to find the matching
`TextLayoutBox` (and offset within it), returning:

```ts
interface PixelPosition {
  x: number;
  y: number;
  height: number;
  lineY: number;
  lineHeight: number;
  pageIndex: number;
}
```

Used by the DOM controller for caret rendering and `scrollCursorIntoView`.

### `resolvePositionFromPixel` — `hit-test.ts`

The inverse. Given pixel coordinates and an optional `pageIndex`, returns
the nearest state `Position`. Used for mouse click and drag.

### `computeSelectionRects` — `selection-geometry.ts`

Walks lines covered by the selection and emits one or more
`SelectionRect { x, y, width, height, pageIndex }` per line. The DOM
painter draws these as translucent blue blocks under the text.

### `moveToLine` / `moveToLineBoundary` — `line-navigation.ts`

`moveToLine` uses `targetX` (the column the user "wanted") to find the
position on the line above/below at the same x coordinate, falling back
to clamping to the line's text bounds. This is what makes vertical arrow
motion through varying-width lines feel right.

`moveToLineBoundary` finds the start/end of the current line.

## targetX preservation

`reduceEditor` (lines 165–166, 255–258 in `editor-state.ts`) treats
`MOVE_LINE` and `EXPAND_LINE` as "vertical". For these, `targetX` is
preserved across the action; for any other action, it is cleared. This
is why pressing Up, Up, Up moves the cursor through varying line widths
without "drifting" toward the end of the shorter lines.

## Triple-click and double-click

In the DOM controller (`packages/dom/src/editor-controller.ts` lines
541–561):

- `e.detail >= 3` → "select paragraph": find first/last text descendants
  of the block at `path[0]`, dispatch `SET_SELECTION`.
- `e.detail === 2` → `selectWord(state, pos)`.
- shift-click → expand selection from current anchor.
- single click → `MOVE_CURSOR` semantics via `SET_SELECTION` with a
  collapsed cursor; also begins a drag.

## Cell-boundary protection

`isAtCellBoundary(state, pos, boundary)` (in `editor/actions/helpers.ts`
lines 80–108) hardcodes:

```
path[0] = table index
path[1] = row index
path[2] = cell index
path[3] = paragraph index
path[4] = text index
```

…to detect whether the cursor is at the first/last text position of a
table cell, so `DELETE_BACKWARD` and `DELETE_FORWARD` won't merge cells.
This is a hardcoded structural assumption that components cannot influence
— see [issue 01](../issues/01-components-no-behavior-hooks.md).

## See also

- [04 layout layer](04-layout-layer.md) — provides the geometry these queries walk.
- [05 editor reducer](05-editor-reducer.md) — dispatches the cursor actions.
- [07 DOM controller](07-dom-controller.md) — drives pixel ⇄ state at event time.
