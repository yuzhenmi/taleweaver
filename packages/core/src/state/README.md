# State

The state module defines the document model and all operations on it.

## Document tree

A document is an immutable tree of `StateNode` values:

```ts
interface StateNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly styles: Readonly<NodeStyles>;
  readonly children: readonly StateNode[];
}
```

Every node has a unique `id`, a `type` that determines its component
behavior, a bag of open-ended `properties` for component-specific data
(e.g. `content` on a text node), and an ordered list of `children`.

Nodes are frozen at creation via `createNode()`. Mutations produce new
trees through structural sharing — unchanged subtrees keep their
original references, which makes dirty-checking cheap (reference
equality).

### Properties vs. styles

`properties` is open-ended (`Record<string, unknown>`) — components
define what goes here (e.g. `content` for text, `level` for headings).

`styles` is a closed set defined by the library:

```ts
interface NodeStyles {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly fontStyle?: string;
  readonly textDecoration?: string;
  readonly lineHeight?: number;
}
```

These are the styles a user can apply through the editor (bold, italic,
underline, font family, font size, line height). Render-only layout
styles like margin and padding are not part of `NodeStyles` — those are
set by component implementations during the render phase.

## Positions and spans

A `Position` identifies a location in the tree:

```ts
interface Position {
  readonly path: readonly number[];  // child indices from root
  readonly offset: number;           // character offset within text node
}
```

A `Span` (used for selections) is a pair of positions:

```ts
interface Span {
  readonly anchor: Position;
  readonly focus: Position;
}
```

`anchor` is where the selection started; `focus` is where it ends.
`normalizeSpan()` returns a copy with anchor <= focus in document order.

## Operations

### Tree operations (`operations.ts`)

Low-level, path-based tree manipulation:

- `getNodeByPath(root, path)` — look up a node
- `updateAtPath(root, path, node)` — replace a node (structural sharing)
- `insertChild(parent, index, child)` — insert a child
- `removeChild(parent, index)` — remove a child
- `updateProperties(node, props)` — merge into properties

### Text operations (`transformations.ts`)

Editing primitives that return a `Change` (old state + new state):

- `insertText(state, position, text)` — insert text at a position
- `deleteRange(state, span)` — delete across a span
- `replaceRange(state, span, text)` — delete then insert
- `splitNode(state, position, depth)` — split a node (e.g. Enter key)

### Formatting (`formatting.ts`)

Inline style operations that wrap/unwrap text in span nodes:

- `applyInlineStyle(state, span, property, idBase)` — wrap selected text
- `removeInlineStyle(state, span, property, idBase)` — unwrap
- `isFullyStyled(state, span, property)` — check if fully styled
- `remapPosition(oldState, newState, pos)` — remap a position after
  formatting restructures the tree

Formatting operations split text nodes at selection boundaries, wrap
them in span nodes carrying the style property, and normalize afterward
(merging adjacent compatible nodes).

## Change tracking

A `Change` records a before/after state pair:

```ts
interface Change {
  readonly oldState: StateNode;
  readonly newState: StateNode;
  readonly timestamp: number;
}
```

All mutations (text editing, formatting) return `Change` values. The
history module uses them for undo/redo.

## History

The `History` type manages undo/redo stacks of changes. `pushChange()`
collapses rapid successive edits (within 500 ms) into a single entry.
Stack depth is bounded (default 500).

## Other utilities

- `createEmptyDocument()` — seed a new document with one empty paragraph
- `extractText(state, span)` — plain text from a selection
- `findPathById(root, id)` — find a node's path by id
- `findDirtyPaths(oldRoot, newRoot)` — paths where references differ
- `getTextContent(node)` / `getTextContentLength(node)` — text accessors
