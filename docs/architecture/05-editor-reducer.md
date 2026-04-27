# 05 — Editor Reducer & Actions

**Path:** `packages/core/src/editor/`

The editor module sits **above** state, render, and layout. It owns:

- `EditorState` — the snapshot type
- `EditorAction` — the action union
- `reduceEditor` — the pure reducer
- 27 action handlers
- Geometric queries: `resolvePixelPosition`, `resolvePositionFromPixel`,
  `computeSelectionRects`, `moveToLine`, `moveToLineBoundary`,
  `collectAllTextBoxes`

The reducer is **pure** but takes both `state` and `config` because it
must rebuild the render and layout trees as part of every mutation —
which means `core/editor` requires a working `TextMeasurer` and is not
truly platform-agnostic. See [issue 05](../issues/05-editor-state-mixed-concerns.md).

## Files

```
editor/
├── editor-state.ts             EditorState, EditorConfig, EditorHistory, reduceEditor
├── editor-action.ts            EditorAction discriminated union
├── cursor-position.ts          state Position → PixelPosition
├── hit-test.ts                 pixel coords → state Position
├── line-navigation.ts          moveToLine, moveToLineBoundary
├── selection-geometry.ts       Selection → SelectionRect[]
├── layout-utils.ts             collectAllTextBoxes
└── actions/
    ├── index.ts                barrel
    ├── helpers.ts              rebuildTrees, isAtCellBoundary, deleteSelectionRange,
    │                           findFirstTextDescendant, findLastTextDescendant,
    │                           isEmptyParagraph
    ├── test-helpers.ts
    └── 27 action handler files (one per action)
```

## EditorState shape

```ts
// editor-state.ts lines 122–131
interface EditorState {
  state: StateNode;        // semantic — source of truth
  selection: Selection;    // semantic — anchor + focus
  history: EditorHistory;  // selection-aware undo/redo

  renderTree: RenderNode;  // derived cache (== render(state))
  layoutTree: LayoutBox;   // derived cache (== layout(renderTree, containerWidth))

  containerWidth: number;  // input from view (set by SET_CONTAINER_WIDTH)
  nextId: number;          // monotonic ID allocator
  targetX: number | null;  // ephemeral: column we want to land at on Up/Down
}

interface EditorConfig {
  measurer: TextMeasurer;
  registry: ComponentRegistry;
  containerWidth: number;
  pageHeight?: number;
  pageMargins?: PageMargins;
}
```

`createInitialEditorState(config)` (lines 141–157) builds the initial empty
document, runs render and layout, and returns the seeded `EditorState`.

### EditorHistory

```ts
// editor-state.ts lines 55–68
interface EditorHistoryEntry {
  change: Change;
  selectionBefore: Selection;
  selectionAfter: Selection;
}

interface EditorHistory {
  undoStack: readonly EditorHistoryEntry[];
  redoStack: readonly EditorHistoryEntry[];
  lastEditTimestamp: number;
  lastEditTag: string;        // "" = chain broken, else "insert", "delete", etc.
}
```

`pushEditorChange(history, entry, mergeTag)` (lines 79–118) merges entries
when `mergeTag` is non-empty AND matches the previous, AND timestamps are
within 500ms. This is what gives "one keystroke ≈ one undo step *only* for
rapid sequences" behavior. Constants:

- `MAX_HISTORY_DEPTH = 500`
- `MERGE_THRESHOLD_MS = 500`

This is **separate** from `state/history.ts`'s `History` — see
[issue 06](../issues/06-duplicate-history-systems.md).

## EditorAction — full union

From `editor-action.ts`:

| Action | Payload | Notes |
|---|---|---|
| INSERT_TEXT | `text: string` | merge tag "insert" |
| DELETE_BACKWARD | — | |
| DELETE_FORWARD | — | |
| DELETE_WORD | `direction` | |
| DELETE_LINE | — | |
| SPLIT_NODE | — | Enter |
| MOVE_CURSOR | `direction: "forward" \| "backward"` | |
| MOVE_WORD | `direction` | |
| MOVE_LINE | `direction: "up" \| "down"` | preserves `targetX` |
| MOVE_LINE_BOUNDARY | `boundary: "start" \| "end"` | |
| MOVE_DOCUMENT_BOUNDARY | `boundary` | |
| EXPAND_SELECTION | `direction` | |
| EXPAND_WORD | `direction` | |
| EXPAND_LINE | `direction` | preserves `targetX` |
| EXPAND_LINE_BOUNDARY | `boundary` | |
| EXPAND_DOCUMENT_BOUNDARY | `boundary` | |
| SELECT_ALL | — | |
| SET_SELECTION | `selection: Selection` | |
| SET_CONTAINER_WIDTH | `width: number` | |
| TOGGLE_STYLE | `style: "bold" \| "italic" \| "underline"` | |
| SET_BLOCK_TYPE | `blockType, properties?` | paragraph ↔ heading |
| TOGGLE_LIST | `listType: "ordered" \| "unordered"` | |
| INSERT_BLOCK | `blockType, properties?` | uses `createInitialState` |
| PASTE | `text: string` | plain text |
| UNDO | — | |
| REDO | — | |

## reduceEditor

```ts
// editor-state.ts lines 160–260
reduceEditor(editor, action, config):
  isVertical = action is MOVE_LINE or EXPAND_LINE
  switch (action.type) → handleX(...)
  if !isVertical AND result.targetX !== null:
    result.targetX = null
  return result
```

The `isVertical` carve-out preserves the desired column across consecutive
up/down moves through varying line widths. See `line-navigation.ts`.

The default branch uses TS `never` exhaustiveness:
```ts
default: { const _: never = action; result = editor; }
```

So the type system enforces that every action has a handler.

## Action handler shape

All 27 handlers live in `actions/`. They share a pattern:

```ts
function handleX(editor, ...args, config) {
  // 1. compute newState via state/transformations or formatting
  const change = insertText(editor.state, pos, text);

  // 2. compute newSelection
  const newSelection = createCursor(...);

  // 3. push history entry (with merge tag for keystroke groups)
  const history = pushEditorChange(editor.history, { change, selectionBefore, selectionAfter }, "insert");

  // 4. rebuild render + layout incrementally
  return rebuildTrees({ ...editor, state: change.newState, selection: newSelection, history }, editor, config);
}
```

`rebuildTrees` lives in `actions/helpers.ts` (lines 47–73):

```ts
rebuildTrees(newEditor, oldEditor, config):
  newRender = renderTreeIncremental(newEditor.state, oldEditor.state, oldEditor.renderTree, config.registry)
  newLayout = layoutTreeIncremental(newRender, oldEditor.renderTree, oldEditor.layoutTree,
                                    newEditor.containerWidth, config.measurer,
                                    config.pageHeight, config.pageMargins)
  return { ...newEditor, renderTree: newRender, layoutTree: newLayout }
```

Note: `layoutTreeIncremental` is called with **`oldEditor.renderTree`** as
the "old render", not the pre-rebuild render of the new state. This is
correct — what matters is the layout's old render reference.

## Geometric queries (read-only)

These do not mutate state; they answer questions about the current layout.

| Function | File | Purpose |
|---|---|---|
| `resolvePixelPosition(state, pos, layoutTree, measurer)` | `cursor-position.ts` | Returns `{ x, y, height, lineY, lineHeight, pageIndex }` for a state Position. |
| `resolvePositionFromPixel(state, layoutTree, measurer, x, y, pageIndex)` | `hit-test.ts` | The inverse: pixel → state Position. |
| `computeSelectionRects(state, selection, layoutTree, measurer, containerWidth)` | `selection-geometry.ts` | Merged per-line rectangles for selection painting. |
| `moveToLine(state, focus, layoutTree, measurer, direction, targetX)` | `line-navigation.ts` | Used by `MOVE_LINE`, `EXPAND_LINE`. |
| `moveToLineBoundary(state, focus, layoutTree, measurer, boundary)` | `line-navigation.ts` | Used by `MOVE_LINE_BOUNDARY`, `EXPAND_LINE_BOUNDARY`. |
| `collectAllTextBoxes(layoutTree)` | `layout-utils.ts` | Flat list of `AbsoluteTextBox` (used by hit-testing and selection-rect math). |

## Helpers worth knowing

- `findFirstTextDescendant(node, basePath)`, `findLastTextDescendant(...)`
  — depth-first search returning `{ path, node }`. Used by triple-click
  paragraph selection and various selection-extension actions.
- `isAtCellBoundary(state, pos, "start" | "end")` — hardcodes that
  `path[0]` is the table and `path[2]` is the cell. Used to prevent
  Backspace/Delete from crossing table cell boundaries. **Lives in
  `helpers.ts`, not in any component** — see [issue 01](../issues/01-components-no-behavior-hooks.md).
- `isEmptyParagraph(node)` — detects empty `paragraph[text]` for behavior
  decisions like "Backspace at start of empty list-item exits the list".

## Public exports

```ts
// packages/core/src/index.ts lines 119–139
export type { EditorAction, EditorState, EditorConfig, EditorHistory, EditorHistoryEntry }
export { createInitialEditorState, reduceEditor }
export { findFirstTextDescendant, findLastTextDescendant }
export { resolvePixelPosition, resolvePositionFromPixel, computeSelectionRects }
export { moveToLine, moveToLineBoundary, collectAllTextBoxes }
```

## See also

- [09 data flow](09-data-flow.md) — how a key event becomes an `EditorState`.
- [issue 05](../issues/05-editor-state-mixed-concerns.md) — `EditorState` mixes concerns.
- [issue 06](../issues/06-duplicate-history-systems.md) — two history systems.
- [issue 07](../issues/07-monolithic-reducer-switch.md) — 27-case switch.
