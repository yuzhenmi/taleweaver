# Taleweaver

Canvas-based rich text editor engine.

[![Deploy to GitHub Pages](https://github.com/yuzhenmi/taleweaver/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/yuzhenmi/taleweaver/actions/workflows/gh-pages.yml)

> **Under active development — not yet released.**

**[Live demo](https://yuzhenmi.github.io/taleweaver)**

## Why

Most open-source rich text editors rely on `contentEditable` and the browser's layout engine. This works well in general, but it means the editor has no access to layout information — it doesn't know where lines break, how tall they are, or where elements are positioned on screen.

Features like word-processor-style pagination require exactly this kind of layout knowledge. Today, only commercial editors (e.g. Google Docs) achieve this by implementing their own layout engine.

Taleweaver takes the same approach: it includes its own layout engine, renders to canvas, and exposes layout information through its API. The goal is to bring word-processor-level editing capabilities to open source.

## Packages

| Package | Description |
|---------|-------------|
| [`@taleweaver/core`](packages/core) | Editor engine — document model, state management, transforms |
| [`@taleweaver/dom`](packages/dom) | DOM rendering layer |
| [`@taleweaver/react`](packages/react) | React bindings |

## Getting started

Prerequisites: Node >= 24 (see `.nvmrc`).

```bash
# Install dependencies
npm install

# Start the dev server (example app)
npm run dev -w examples/react

# Run tests
npm test -w packages/core
```

## Usage

Install the packages:

```bash
npm install @taleweaver/core @taleweaver/dom @taleweaver/react
```

Add the editor to your React app:

```tsx
import { useEditor, EditorView } from "@taleweaver/react";

function MyEditor() {
  const editor = useEditor();
  return <EditorView {...editor} />;
}
```

`useEditor()` returns an object containing `editorState`, `dispatch`, and the refs/measurer that `EditorView` needs. You can use `dispatch` to drive the editor programmatically:

```tsx
const { dispatch } = useEditor();

dispatch({ type: "INSERT_TEXT", text: "Hello" });
dispatch({ type: "TOGGLE_STYLE", style: "bold" });
dispatch({ type: "UNDO" });
```

## Architecture

The project is structured in layers:

- **Core** — Document model, state tree, and transforms. No DOM dependency.
- **DOM** — Canvas rendering, layout, keyboard/mouse mapping, and editor state reducer.
- **React** — React components (`EditorView`) and hooks (`useEditor`) that wire everything together.
- **Example** — A working editor app built with the React layer.

## License

[MIT](LICENSE)
