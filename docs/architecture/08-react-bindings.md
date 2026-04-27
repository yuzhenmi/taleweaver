# 08 — React Bindings

**Path:** `packages/react/src/`

A small layer (~130 LOC) that adapts the engine to React's lifecycle and
hooks. There are exactly two exports: `useEditor` and `<EditorView>`.

## Files

```
react/
├── index.ts          two exports
├── use-editor.ts     useEditor hook
└── editor-view.tsx   EditorView component
```

## useEditor

```ts
// use-editor.ts
function useEditor(options?: { pageHeight?: number; pageMargins?: PageMargins }) {
  // 1. lazily create EditorConfig (canvas measurer + default registry)
  const configRef = useRef<EditorConfig | null>(null);
  if (configRef.current === null) {
    configRef.current = createConfig(options);
  }
  const config = configRef.current;

  // 2. classic useReducer wrapper around reduceEditor
  const [editorState, dispatch] = useReducer(
    (state, action) => reduceEditor(state, action, config),
    config,
    createInitialEditorState,
  );

  // 3. ResizeObserver on the container → SET_CONTAINER_WIDTH
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          dispatch({ type: "SET_CONTAINER_WIDTH", width: entry.contentRect.width });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 4. focus helper — finds the textarea inside containerRef
  const focus = useCallback(() => {
    const ta = containerRef.current?.querySelector("textarea");
    if (ta) ta.focus();
  }, []);

  return { editorState, dispatch, containerRef, measurer: config.measurer, pageHeight: config.pageHeight, focus };
}
```

`createConfig` (lines 21–32) instantiates a hidden canvas, wires up the
measurer, builds a registry from `defaultComponents`, and sets a default
container width of 600.

The config is held in a ref because it carries a real `<canvas>` element
and a `ComponentRegistry` instance — neither should be reconstructed on
re-render.

`createInitialEditorState` (called via the third-arg-init form) seeds the
initial render and layout once; subsequent dispatches go through
`reduceEditor`.

## EditorView

```tsx
// editor-view.tsx
function EditorView({ editorState, dispatch, containerRef, measurer, pageHeight, pageGap }) {
  const controllerRef = useRef<EditorController | null>(null);

  // mount only — create the imperative controller, run first update, return cleanup
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ctrl = createEditorController(el, { measurer, dispatch, pageHeight, pageGap });
    controllerRef.current = ctrl;
    ctrl.update(editorState);
    return () => ctrl.destroy();
  }, []);

  // sync — feed every editorState into the controller
  useEffect(() => {
    controllerRef.current?.update(editorState);
  }, [editorState]);

  return <div ref={containerRef} />;
}
```

The pattern is **imperative-controller-inside-React**:
- React owns the `editorState` (via `useReducer`).
- The DOM controller owns the canvas, textarea, mouse/keyboard listeners,
  and the paint loop.
- React calls `controller.update(state)` after every render.
- `containerRef` is shared between `useEditor` (to set up `ResizeObserver`)
  and `EditorView` (to mount the controller).

The mount-effect intentionally has empty deps and disables
`react-hooks/exhaustive-deps` — it must run exactly once. If `dispatch`,
`measurer`, `pageHeight`, or `pageGap` change after mount, they are not
re-applied. (The first three are stable because they live in refs / are
memoized; `pageGap` is a number that's expected to be constant in practice.)

## Why two effects

The first effect creates the controller and tears it down. The second
syncs `editorState` on every change. They have to be separate so that the
mount effect's cleanup never runs except on unmount.

## Public exports

```ts
// index.ts
export { EditorView }
export type { EditorViewProps }
export { useEditor }
```

## Example consumption (from `examples/react/src/app.tsx`)

```tsx
const PAGE_HEIGHT = 1056; // US Letter at 96dpi
const PAGE_MARGINS = { top: 96, bottom: 96, left: 72, right: 72 };

function App() {
  const editor = useEditor({ pageHeight: PAGE_HEIGHT, pageMargins: PAGE_MARGINS });
  return <EditorView {...editor} pageHeight={PAGE_HEIGHT} pageGap={24} />;
}
```

The toolbar reads `editor.editorState` (e.g. `getStyleInRange` over the
selection) and calls `editor.dispatch(...)` with `TOGGLE_STYLE`,
`SET_BLOCK_TYPE`, `TOGGLE_LIST`, `INSERT_BLOCK`, etc.

## See also

- [05 editor reducer](05-editor-reducer.md) — what `dispatch` invokes.
- [07 DOM controller](07-dom-controller.md) — what `<EditorView>` mounts.
- [09 data flow](09-data-flow.md) — end-to-end.
