# Taleweaver

**An open-source word-processor engine for the web — with its own layout engine.**

[![Deploy to GitHub Pages](https://github.com/yuzhenmi/taleweaver/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/yuzhenmi/taleweaver/actions/workflows/gh-pages.yml)

> ⚠️ **Under active development.** Not yet released — APIs will change, and it is not yet on npm.

[**▶ Live demo**](https://yuzhenmi.github.io/taleweaver) · [Architecture docs](docs/architecture/overview.md)

<!-- TODO before launch: add a GIF here showing pagination + a hard case
     (justified+hyphenated paragraph, or RTL text). A text-editor README needs a visual. -->

## Why

Almost every open-source rich text editor (ProseMirror, Slate, Lexical, TipTap, Quill)
is built on `contentEditable` and the browser's layout engine. That's the right call for
most apps — but it means the editor never *sees* its own layout. It doesn't know where
lines break, how tall they are, or where anything sits on the page.

Word-processor features need exactly that knowledge: real pagination, footnotes that
split across pages, justified text with automatic hyphenation, vertical writing modes,
multi-column flow. Today only closed-source editors like Google Docs achieve this — by
shipping their own layout engine.

**Taleweaver is that layout engine, open source.** It implements a real CSS box model
(block / inline / table formatting contexts, floats, CSS Fragmentation pagination) and
Unicode-correct text (UAX #9 bidi, UAX #14 line-breaking, grapheme clustering), renders
to canvas, and exposes layout geometry through its API.

## What works today

Honest status — this is a young project:

| Capability | Status |
|---|---|
| Document model & editing (insert/delete/style, undo, selection) | ✅ Working |
| Paginated layout & within-block fragmentation | ✅ Working |
| Bidirectional text (UAX #9), grapheme clustering, line-breaking (UAX #14) | ✅ Working |
| Justification + automatic hyphenation | ✅ Working |
| Vertical writing modes (CJK) | ✅ Working |
| Tables, lists, multi-column | ✅ Working |
| Real-time collaboration | 🚧 Live local CRDT sync (two peers, one shared Yjs doc, per-peer cursors); network transport + selection-rebasing are planned |
| Stable public API / npm release | ❌ Not yet |

See [`docs/architecture/state-of-branch.md`](docs/architecture/state-of-branch.md) for the
full current-vs-target audit.

## Packages

| Package | Description |
|---|---|
| `@taleweaver/core` | Geometry-free document model, state, and editing transforms — no DOM dependency |
| `@taleweaver/print` | The layout engine: CSS box model, pagination, cursor geometry, canvas paint |
| `@taleweaver/digital` | Continuous (non-paginated) editing mode |
| `@taleweaver/pdf` | PDF export |
| `@taleweaver/react` | React bindings (`EditorView`, `useEditor`) |
| `@taleweaver/hyphenation-en-us` | en-US hyphenation patterns |

## Getting started

Not yet published to npm — run it from source:

```bash
git clone https://github.com/yuzhenmi/taleweaver
cd taleweaver
npm install                       # Node >= 24 (see .nvmrc)
npm run dev -w examples/react     # play with the example editor
npm test -w packages/core
```

## Usage

The React layer wires everything together:

```tsx
import { useEditor, EditorView } from "@taleweaver/react";

function MyEditor() {
  const editor = useEditor();
  return <EditorView {...editor} />;
}
```

`useEditor()` returns `editorState`, `dispatch`, and the refs/measurer that `EditorView`
needs. Drive the editor programmatically through `dispatch`:

```tsx
const { dispatch } = useEditor();

dispatch({ type: "INSERT_TEXT", text: "Hello" });
dispatch({ type: "TOGGLE_STYLE", style: "bold" });
dispatch({ type: "UNDO" });
```

## Architecture

[Layered living docs live in `docs/architecture/`.](docs/architecture/overview.md) In short:

- **`core`** — document model, state, and transforms. No geometry, no DOM.
- **`print`** — the box-layout + canvas paint engine (formatting contexts, fragmentation,
  cursor/selection geometry).
- **`react`** — components (`EditorView`) and hooks (`useEditor`).
- **`examples/`** — a working editor app built on the React layer.

## Contributing

Early days — issues, questions, and discussion are welcome via GitHub Issues.

## License

[MIT](LICENSE)
