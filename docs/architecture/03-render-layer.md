# 03 — Render Layer

**Path:** `packages/core/src/render/`

The render layer is the middle tree of the pipeline. It mirrors the state
tree's structure but carries layout-relevant styles, optional metadata, and
an open-ended marker (for list bullets). It is **derived purely from
state + the component registry** — nothing else affects it.

## Files

```
render/
├── render-node.ts            discriminated union + barrel exports
├── block-render-node.ts      BlockRenderNode + createBlockNode
├── table-render-node.ts      TableRenderNode + createTableNode
├── inline-render-node.ts     InlineRenderNode + createInlineNode
├── text-render-node.ts       TextRenderNode + createTextRenderNode
├── render-styles.ts          RenderStyles type
└── render.ts                 renderTree + renderTreeIncremental
```

## The discriminated union

```ts
// render-node.ts
type RenderNode =
  | BlockRenderNode    // type: "block"
  | TableRenderNode    // type: "table"
  | InlineRenderNode   // type: "inline"
  | TextRenderNode;    // type: "text"
```

| Type | Children allowed | Notes |
|---|---|---|
| block | any | Optional `marker` (list), `metadata` (image / hr) |
| table | row blocks | Carries `columnWidths`, `rowHeights` |
| inline | inline / text only | `createInlineNode` throws on block child |
| text | none (leaves) | Carries `text: string` and `styles` |

All node constructors `Object.freeze` the node and freeze `children`,
`styles`, `metadata`. See `block-render-node.ts` lines 22–29.

## RenderStyles

```ts
// render-styles.ts
interface RenderStyles {
  // user-facing
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  lineHeight?: number;          // multiplier of fontSize

  // component-set
  lineMarginTop?: number;       // ratio × line height
  lineMarginBottom?: number;
  blockMarginTop?: number;
  blockMarginBottom?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
}
```

This is a superset of `NodeStyles`. The user-facing subset propagates from
state; the rest is set by component implementations during `render()`.

The line/block margin distinction matters for the layout engine's margin
collapsing — see `layout-engine.ts` `computeTopEdgeLineMargin` /
`computeBottomEdgeLineMargin` (lines 144–166) and
[04-layout-layer](04-layout-layer.md).

## Full render pass

```ts
// render.ts lines 9–23
renderTree(state, registry):
  def = registry.get(state.type)               // throws if missing
  renderedChildren = state.children.map(child => renderTree(child, registry))
  return def.render(state, renderedChildren)   // bottom-up
```

Cost: O(n) over all state nodes, plus per-component work.

## Incremental render pass

```ts
// render.ts lines 30–74
renderTreeIncremental(newState, oldState, oldRender, registry):
  if (newState === oldState) return oldRender    // reference equality short-circuit
  build maps of oldState children by id and oldRender children by id
  for each new child:
    matched by id?
      same reference?           → reuse old render
      same id and type?         → recurse incrementally
      else                      → full render
  return def.render(newState, mapped children)
```

Key insight: **state nodes are matched by `id`**. This handles inserts and
removals without re-rendering siblings that just shifted index. The
`renderedChildren` array still gets passed through `def.render` on every
call, so a parent whose own state changed will re-run its render function
even if all its children matched.

Reference equality is the entry-point optimization. The editor reducer
ensures that unchanged state subtrees keep their references, so this works
out to O(dirty subtree size) in practice.

## What the render tree gives downstream

- `key: string` — used by the layout engine and DOM controller.
- `styles: RenderStyles` — full layout style information.
- `marker?: string` — drawn by the canvas painter at the block's left edge.
- `metadata?: Record<string, unknown>` — open bag for void-block specifics
  (image src, etc.).

The render tree is the minimal information needed to lay out, plus the
minimum painting hints. It does not carry the original state node — once
rendered, downstream code uses `key`, not `id`.

## See also

- [02 components](02-components.md) — defines what each render node looks like.
- [04 layout layer](04-layout-layer.md) — consumes the render tree.
- [issue 09](../issues/09-three-level-naming.md) — `id` vs `key` naming.
