# 02 — Components

**Path:** `packages/core/src/components/`

Components are the extensibility seam between the **state tree** and the
**render tree**. A component knows how to:

1. (Optionally) construct an initial state node of its type.
2. Render its state node into a render node, given its already-rendered
   children.

A component **does not** participate in editing semantics, hit-testing,
keyboard handling, or layout — see [issue 01](../issues/01-components-no-behavior-hooks.md).

## Files

```
components/
├── component-definition.ts   the contract
├── component-registry.ts     Map<typeString, ComponentDefinition>
├── index.ts                  exports + defaultComponents
├── document.ts               root container
├── paragraph.ts              text block
├── heading.ts                styled paragraph (level → fontSize/fontWeight)
├── text.ts                   leaf text
├── span.ts                   inline style wrapper
├── list.ts                   ordered/unordered, generates markers per child
├── list-item.ts              list child
├── image.ts                  void block (block + metadata.image)
├── horizontal-line.ts        void block (block + metadata.horizontal-line)
├── table.ts                  table render node
├── table-row.ts
└── table-cell.ts
```

## The contract

```ts
// component-definition.ts
type ComponentRenderFn = (
  node: StateNode,
  renderedChildren: readonly RenderNode[],
) => RenderNode;

interface ComponentDefinition {
  readonly type: string;
  readonly render: ComponentRenderFn;
  readonly createInitialState?: (
    id: string,
    properties: Record<string, unknown>,
    allocateId: () => string,
  ) => StateNode;
}
```

`createInitialState` is used by `INSERT_BLOCK` to construct fresh nodes of
arbitrary type without the reducer hardcoding their shape.

## The registry

```ts
// component-registry.ts (lines 4–18)
class ComponentRegistry {
  register(definition: ComponentDefinition): void;
  get(type: string): ComponentDefinition | undefined;
  has(type: string): boolean;
}
```

`createRegistry(components)` builds one. The integration setup uses
`createRegistry(defaultComponents)`. The React layer does the same in
`use-editor.ts` line 24.

## How rendering uses the registry

```ts
// render/render.ts lines 9–23
function renderTree(state, registry) {
  const def = registry.get(state.type);
  if (!def) throw new Error(`No render function registered for type "${state.type}"`);
  const renderedChildren = state.children.map(c => renderTree(c, registry));
  return def.render(state, renderedChildren);   // bottom-up
}
```

Bottom-up: children first, then the parent's render function consumes them.
Components can choose to wrap, transform, or replace their children — see
`list.ts` line 7–22 which adds a per-child marker.

## The default components in detail

All ship pre-registered (`packages/core/src/components/index.ts` line 32–45)
and produce one of four render-node kinds: `block`, `inline`, `text`, `table`.

### document
```ts
// document.ts
{ type: "document", render: (n, c) => createBlockNode(n.id, {}, c) }
```
Trivial container — no styles, just block render node.

### paragraph
```ts
// paragraph.ts
{ type: "paragraph",
  render: (n, c) => createBlockNode(n.id, { lineMarginTop: 0, lineMarginBottom: 0.2 }, c) }
```
Adds inter-line bottom margin (a fraction of the line height).

### text
```ts
// text.ts
{ type: "text", render: (n) => createTextRenderNode(n.id, getTextContent(n), { ...n.styles }) }
```
Leaf node — pulls `properties.content`, propagates the user's `NodeStyles`.

### span
Inline wrapper carrying user styles for partial-range formatting (bold,
italic, underline). Produced by `applyInlineStyle`.

### heading
Maps `properties.level` (1–6) to `fontSize` and `fontWeight` overrides on
the rendered block.

### list / list-item
`list.ts` line 7–22 walks children and replaces each with a copy carrying
a marker:
- `"ordered"` → `"1.", "2.", …`
- otherwise → `"•"` (bullet)

It also sets `paddingLeft: 24` on each item.

### image / horizontal-line
Void blocks: zero children. Use `metadata` on the block render node:

```ts
metadata: { type: "image", src, width, height }
metadata: { type: "horizontal-line" }
```

The canvas painter (`paintBox` in `packages/dom/src/canvas-renderer.ts`
lines 102–121) reads `box.metadata.type` and special-cases drawing.

### table / table-row / table-cell
Produce a `TableRenderNode` carrying `columnWidths` (fractions of available
width) and `rowHeights` (explicit pixels, 0 = auto). Layout resolves these
in `layout-engine.ts` `layoutTable`.

## What components can NOT do

- Decide how Enter behaves inside their type (handled by `handleSplitNode`).
- Decide how Backspace behaves at their boundary (table cell boundary
  detection is hardcoded in `editor/actions/helpers.ts` `isAtCellBoundary`,
  lines 80–108).
- Decide how Tab navigates (no Tab handling exists yet).
- Define a JSON schema for their `properties`.
- Define what children are valid.

See [issue 01](../issues/01-components-no-behavior-hooks.md) and
[issue 02](../issues/02-untyped-properties-schema.md).

## Public exports

```ts
// index.ts
export { defaultComponents, ComponentRegistry, createRegistry, ... }
export type { ComponentRenderFn, ComponentDefinition }
```

Consumers can pass their own components by building a custom registry and
passing it into `EditorConfig.registry`.
