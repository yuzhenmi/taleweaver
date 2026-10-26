# 4 — `@taleweaver/react`

`react` is a thin adapter that lets a React application drop the engine
into its tree without touching `print`'s controller directly. It owns no
state and no rendering of its own — it bridges React's lifecycle to
`print`'s controller.

## Top-level modules

- **`use-editor`** (file: `use-editor.ts`) — the React hook. Returns a
  `{ editorState, dispatch, containerRef, shaper, focus }` bag. Owns
  the editor's `EditorState` via `useReducer`. Constructs an
  `EditorConfig` (component registry, container width) on mount and a
  separate `TextShaper` (canvas-based) — both reused across renders.

- **`editor-view`** (file: `editor-view.tsx`) — the React component.
  Mounts a single HTML container; on mount, instantiates a `print`
  controller pointing at that container and wires the controller's
  dispatch callback to the hook's reducer. On every state change, it
  forwards the new state to the controller via `controller.update(state)`.
  Calls `controller.destroy()` on unmount.

## How modules connect

A typical React consumer uses both together:

    function MyEditor() {
      const editor = useEditor();
      return <EditorView {...editor} />;
    }

The hook owns the engine state. The component owns the DOM container and
the controller. The hook's `dispatch` flows down into the component as
the `dispatch` prop; the component's input handlers flow back into the
hook by calling that `dispatch`. State flows down (`editorState` prop);
actions flow up (`dispatch` callback).

    React tree
        │
        │ const editor = useEditor()
        ▼
    ┌──────────────────────────────────────┐
    │ useEditor()                          │
    │                                      │
    │ useReducer(reduceEditor, initial)    │
    │         │            ▲               │
    │   editorState     dispatch          │
    │         │            │               │
    └─────────┼────────────┼───────────────┘
              │            │
              │ props      │ props
              ▼            │
    ┌──────────────────────────────────────┐
    │ <EditorView />                       │
    │                                      │
    │  useEffect(mount):                   │
    │    createEditorController(...)       │
    │      ◄──── dispatch ─────────────────┘ (callback prop)
    │                                      │
    │  useEffect(state change):            │
    │    controller.update(editorState)    │
    │                                      │
    │  useEffect(unmount):                 │
    │    controller.destroy()              │
    │                                      │
    │  renders: <div ref={containerRef} /> │
    └──────────────────────────────────────┘
              │
              │ (controller paints into the div)
              ▼
          rendered editor

Consumers that need `core` types (`EditorAction`, `EditorState`, etc.) import
them directly from `@taleweaver/core`; `@taleweaver/react` re-exports only its
own surface (`EditorView`, `EditorViewProps`, `EditorViewHandle`, `useEditor`).

## Reading order

1. [`4.1-use-editor.md`](./4.1-use-editor.md) — hook responsibilities, `EditorConfig` construction, the reducer wiring.
2. [`4.2-editor-view.md`](./4.2-editor-view.md) — component lifecycle, controller mount/update/destroy, profiler instrumentation.

## Public API surface

`@taleweaver/react` exports:

- `useEditor` — the React hook.
- `EditorView` — the React component.
- `EditorViewProps` — the component's props type.
