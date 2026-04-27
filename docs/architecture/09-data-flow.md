# 09 — End-to-End Data Flow

A single keystroke trace through the system. References are
`file:line` for the version of the code at writing time.

## Cast

| Component | File |
|---|---|
| **textarea (focus target)** | created in `editor-controller.ts:84–98` |
| **mapKeyEvent** | `packages/dom/src/key-handler.ts` |
| **dispatch** | from `useReducer` in `packages/react/src/use-editor.ts:41–46` |
| **reduceEditor** | `packages/core/src/editor/editor-state.ts:160` |
| **handleInsertText** | `packages/core/src/editor/actions/insert-text.ts:8` |
| **rebuildTrees** | `packages/core/src/editor/actions/helpers.ts:47` |
| **renderTreeIncremental** | `packages/core/src/render/render.ts:30` |
| **layoutTreeIncremental** | `packages/core/src/layout/layout-engine.ts:451` |
| **EditorController.update** | `packages/dom/src/editor-controller.ts:721` |
| **paintCanvas / paintPage** | `packages/dom/src/canvas-renderer.ts` |

## Trace — pressing the letter "x"

### 1. Browser delivers a `keydown`

The hidden `<textarea>` inside the editor container has focus and receives
the event. Two listeners fire on it: `keydown` and (later) `input`.

### 2. `keydown` is mapped to an action — but for printable chars, mostly skipped

`handleKeyDown` (`editor-controller.ts:622`):

```
if (isComposing || e.isComposing) return;
const action = mapKeyEvent(e);   // returns null for most printable keys
if (action) { e.preventDefault(); dispatch(action); }
```

Plain letter keys produce no `EditorAction` from `mapKeyEvent`. They
propagate to the textarea, which mutates its own `value`.

(Modifier-bearing keys like `⌘B` produce `TOGGLE_STYLE` and skip the
input path.)

### 3. `input` event reads the textarea contents

`handleInput` (`editor-controller.ts:631`):

```
if (isComposing) return;
const text = textarea.value;
if (text) dispatch({ type: "INSERT_TEXT", text });
textarea.value = "";
```

So on the user typing "x", the controller dispatches
`{ type: "INSERT_TEXT", text: "x" }`.

### 4. `dispatch` is the React reducer dispatch

```
useReducer(
  (state, action) => reduceEditor(state, action, config),
  config,
  createInitialEditorState,
)
```

React calls `reduceEditor(prevState, { type: "INSERT_TEXT", text: "x" }, config)`.

### 5. `reduceEditor` switches on action type

```
case "INSERT_TEXT":
  result = handleInsertText(editor, action.text, config);
  break;
```

(See `editor-state.ts:170–172`.)

### 6. `handleInsertText` applies the state mutation

`insert-text.ts:8–58`:

1. If selection is non-collapsed → `replaceRange(state, normalizedSpan, "x")`.
2. Otherwise → `insertText(state, focus, "x")`.
3. Compute the new collapsed `Selection`.
4. Push a history entry with `mergeTag = "insert"` (so rapid typing
   collapses into one undo step).
5. Call `rebuildTrees(newEditor, oldEditor, config)`.

Underneath, `state/transformations.ts` `insertText` (line 22) walks the
state tree to the targeted text node, builds a new node with the inserted
characters, and runs `updateAtPath` to produce a new immutable tree
(structural sharing keeps unchanged subtrees the same reference).

### 7. `rebuildTrees` regenerates the derived caches

`helpers.ts:47–73`:

```
newRender = renderTreeIncremental(newEditor.state, oldEditor.state, oldEditor.renderTree, registry)
newLayout = layoutTreeIncremental(newRender, oldEditor.renderTree, oldEditor.layoutTree,
                                  newEditor.containerWidth, measurer, pageHeight, pageMargins)
return { ...newEditor, renderTree: newRender, layoutTree: newLayout }
```

`renderTreeIncremental`:
- short-circuits where state references match (most of the tree).
- bottom-up reaches the changed `text` node, runs the text component's
  render.
- the text node's parent re-runs `def.render(node, [...])` because the
  `node` reference changed.
- bubbles up to root.

`layoutTreeIncremental`:
- short-circuits at the document level (`newRender !== oldRender`).
- recurses into block formatting context, matching children by `key`.
- finds the dirty paragraph block.
- because that block has inline content, it re-wraps the entire
  paragraph (`layoutTree(paragraph, contentWidth, measurer)`).
- repositions following blocks if dirty block's height changed.
- if paginated, rebuilds page boxes from the document.

### 8. The new EditorState is returned to React

React commits the state, runs effects.

### 9. `EditorView` re-runs its sync effect

`editor-view.tsx:46–48`:

```
useEffect(() => {
  controllerRef.current?.update(editorState);
}, [editorState]);
```

### 10. `EditorController.update` updates derived UI state and repaints

`editor-controller.ts:721–746`:

```
state = editorState
cursorPos = resolvePixelPosition(state.state, state.selection.focus, state.layoutTree, measurer)
selectionRects = isCollapsed(state.selection) ? [] :
                 computeSelectionRects(state.state, state.selection, state.layoutTree, measurer, containerWidth)

syncDom()              // mode switch (single ↔ paginated), canvas sizing, textarea positioning
startBlink()           // reset blink so cursor is visible immediately after edit
paint()                // canvas draw — viewport-culled
scrollCursorIntoView() // smooth scroll if cursor outside the visible window
```

### 11. `paint()` walks the layout tree and draws

For single-canvas mode → `paintCanvas`. For paginated mode → `paintPages`,
which iterates only `activeCanvases` (those currently visible per the
IntersectionObserver).

`paintBox` (`canvas-renderer.ts:87`) viewport-culls subtrees, then for each
visible box draws background/borders/markers/text/images.

### 12. The cursor blinks via `setInterval`

`startBlink` (`editor-controller.ts:234`) fires every 500ms, toggling
`cursorVisible` and triggering `paint()`.

## What's invariant during this trace

1. State, render, and layout trees of unchanged regions retain the same
   object references — the JS engine never has to allocate new nodes for
   them.
2. The history stack never reallocates older entries.
3. Visible offscreen pages keep their paginated canvases off the DOM
   entirely.
4. The reducer is pure — running it again on the same input gives the
   same output, so React's `StrictMode` double-invocation is safe.

## Where this trace can be slow

- **Long paragraphs:** step 7's "re-wrap the entire paragraph" is O(words)
  every keystroke. See [issue 03](../issues/03-inline-layout-not-incremental.md).
- **Tall images / oversize blocks in paginated mode:** step 7's pagination
  pass is O(blocks) per keystroke since it can't split blocks. See
  [issue 04](../issues/04-pagination-whole-block-only.md).
- **Long documents:** step 11 culls offscreen content, but the whole layout
  tree is still alive in memory. See
  [issue 13](../issues/13-long-document-virtualization.md).

## See also

- [05 editor reducer](05-editor-reducer.md) — full action list.
- [04 layout layer](04-layout-layer.md) — incremental algorithm details.
- [07 DOM controller](07-dom-controller.md) — the imperative side.
