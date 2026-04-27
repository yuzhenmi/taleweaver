# 01 — State Layer

**Path:** `packages/core/src/state/`

The state layer defines the document as an immutable tree, the operations
on it, and the change/history machinery. It is the single source of truth
for everything semantic about the document. It has **no rendering and no
layout**.

A `README.md` lives next to the source at `packages/core/src/state/README.md`
— this doc complements it with structural and architectural framing.

## Files

```
state/
├── state-node.ts       StateNode + NodeStyles types
├── create-node.ts      createNode, createTextNode (frozen)
├── operations.ts       path-based tree manipulation
├── transformations.ts  insertText, deleteRange, replaceRange, splitNode
├── formatting.ts       applyInlineStyle, getStyleInRange, remapPosition
├── normalize.ts        structural-paragraph maintenance around opaque blocks
├── position.ts         Position, Span, comparePositions, normalizeSpan
├── history.ts          History<Change> + pushChange/undo/redo
├── change.ts           Change { oldState, newState, timestamp }
├── dirty.ts            findDirtyPaths via reference inequality
├── extract-text.ts     extractText(state, span) → string
├── find-path.ts        findPathById
├── text-utils.ts       getTextContent, getTextContentLength, clampOffset
└── initial-state.ts    createEmptyDocument()
```

## The shape of a node

```ts
// state-node.ts
interface NodeStyles {           // closed set, user-editable
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly fontStyle?: string;
  readonly textDecoration?: string;
  readonly lineHeight?: number;
}

interface StateNode {
  readonly id: string;
  readonly type: string;                                  // e.g. "paragraph"
  readonly properties: Readonly<Record<string, unknown>>; // OPEN — see issue 02
  readonly styles: Readonly<NodeStyles>;                  // closed
  readonly children: readonly StateNode[];
}
```

Frozen at construction — see `create-node.ts` lines 1–28. Empty styles
hash to a shared `EMPTY_STYLES` reference (line 3).

`properties` is the schema-less escape hatch:
- `text` nodes use `{ content: string }`
- `list` uses `{ listType: "ordered" | "unordered" }`
- `image` uses `{ src, width, height }`
- etc.

This is open by design but unsafe — see [issue 02](../issues/02-untyped-properties-schema.md).

## Positions and spans

```ts
// position.ts
interface Position {
  readonly path: readonly number[]; // child indices from root
  readonly offset: number;          // chars within text node content
}

interface Span {
  readonly anchor: Position;
  readonly focus: Position;
}
```

- `comparePositions(a, b)` — total order in document order. Handles different
  path lengths by treating shorter paths as ancestors (line 37–45).
- `normalizeSpan(span)` — returns a copy with `anchor <= focus`.
- A `Selection` is a `Span` (see `cursor/selection.ts`).

## Operations

### Tree primitives — `operations.ts`

Path-addressed, structurally sharing:

- `getNodeByPath(root, path)`
- `updateAtPath(root, path, node)` — replaces a node, sharing unchanged siblings
- `insertChild(parent, index, child)`
- `removeChild(parent, index)`
- `updateProperties(node, props)` — merges into properties

### Text editing — `transformations.ts`

Each returns a `Change { oldState, newState, timestamp }`:

| Function | What it does |
|---|---|
| `insertText(state, position, text)` | Insert at a position inside one text node. |
| `deleteRange(state, span)` | Delete across a span. Same-node and cross-node paths. |
| `replaceRange(state, span, text)` | Compose: delete then insert. |
| `splitNode(state, position, newId, splitDepth?)` | Split ancestors up to `splitDepth`. Default depth is grandparent (paragraph split on Enter). |

The cross-node delete path (`deleteCrossNode` lines 75–167) is non-trivial.
It finds the common ancestor depth, fuses the start node's prefix with the
end node's suffix, collects "trailing siblings" of the end node that should
survive, and rebuilds the ancestor chain.

### Inline styling — `formatting.ts`

Wraps text in `span` nodes carrying styles. Crucial parts:

- `applyInlineStyle(state, span, styles, idBase)` — accepts a partial of
  `NodeStyles` where `undefined` *removes* a property. Splits text nodes at
  span boundaries, wraps in span nodes, normalizes adjacent compatible nodes.
- `getStyleInRange(state, span, property)` — returns the uniform value if
  every text node in the span carries it (directly or via a span ancestor),
  else `undefined`.
- `remapPosition(oldState, newState, pos)` — used to keep cursors valid
  after formatting restructures the tree.

### Normalization — `normalize.ts`

Inserts empty "structural paragraphs" adjacent to opaque blocks (tables,
images, horizontal lines) so the user always has a paragraph to land their
cursor in. Idempotent — returns the same reference if no changes.

### Change & history — `change.ts`, `history.ts`

```ts
interface Change {
  readonly oldState: StateNode;
  readonly newState: StateNode;
  readonly timestamp: number;
}

interface History {
  readonly undoStack: readonly Change[];
  readonly redoStack: readonly Change[];
  readonly maxDepth: number;  // default 500
}
```

`pushChange` collapses changes within 500ms into a single entry (keeping
the original timestamp so the window cannot slide forward indefinitely).

⚠ **There are two history systems** — this `History<Change>` is mostly
unused. The editor uses a parallel `EditorHistory` in `editor/editor-state.ts`
that tracks selection-before / selection-after. See
[issue 06](../issues/06-duplicate-history-systems.md).

### Dirty tracking — `dirty.ts`

`findDirtyPaths(oldRoot, newRoot)` walks both trees comparing children by
reference. Where references differ, the path is dirty. This relies on
structural sharing — unchanged subtrees keep identical references.

## Invariants

- Text nodes are leaves: `node.type === "text"` ⇒ `node.children.length === 0`.
- A position's `path` always points to a text node for editable positions
  (insert/delete/split).
- After every transformation, the result is a new frozen tree with maximal
  structural sharing.
- `nextId` (held on `EditorState`) is incremented monotonically when actions
  need fresh IDs. Allocators are passed as `() => string` callbacks
  (see `normalize.ts` line 58, `formatting.ts` `idBase` parameter).

## Public exports

See `packages/core/src/index.ts` lines 4–39 for what's exposed:
- types: `StateNode`, `NodeStyles`, `Position`, `Span`, `Change`, `History`
- constructors and operations: `createNode`, `insertText`, `deleteRange`,
  `splitNode`, `applyInlineStyle`, etc.

## See also

- [02 components](02-components.md) — how state nodes become render nodes.
- [05 editor reducer](05-editor-reducer.md) — who calls these transformations.
- [issue 02](../issues/02-untyped-properties-schema.md) — properties are untyped.
- [issue 06](../issues/06-duplicate-history-systems.md) — two history systems coexist.
