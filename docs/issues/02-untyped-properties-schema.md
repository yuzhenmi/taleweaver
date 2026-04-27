# Issue 02 — `properties` is `Record<string, unknown>` (Major)

## Summary

Every `StateNode` has `properties: Readonly<Record<string, unknown>>`,
the open escape hatch where component-specific data lives. There's no
schema, no per-type type, and consumers everywhere fall back to `as`
casts. This conflicts with the project's stated rule of *no
type-unsafe code* and is a permanent foot-gun.

## Where it manifests

### The type itself

`packages/core/src/state/state-node.ts:17–23`:

```ts
interface StateNode {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly styles: Readonly<NodeStyles>;
  readonly children: readonly StateNode[];
}
```

### Casts in use

- `components/list.ts:7` — `const listType = node.properties.listType as string;`
- `components/heading.ts` — reads `properties.level` as number
- `components/image.ts` — reads `properties.src`, `width`, `height`
- `components/text.ts:7` via `getTextContent(node)` reading
  `properties.content`
- Likely more across action handlers and tests.

### No schema validation

- `createNode(id, type, properties = {}, ...)` accepts any properties for
  any type.
- A `paragraph` could be created with `{ src: "..." }` and nothing would
  catch it.
- A `text` node could have non-string `content` and rendering would fail
  at runtime.

### No child-type validation

- A `table` could have `paragraph` direct children — only the layout
  engine catches some of this (`page-layout-box.ts:24–28`,
  `line-layout-box.ts:30–35` throw at construction time, but state itself
  doesn't).

## Why it's a problem

1. **Type safety promise broken.** `MEMORY.md` records "Never write
   type-unsafe code. Avoid non-null assertions (`!`) — use proper
   narrowing." The `properties as X` pattern is identical in spirit.
2. **Refactor risk.** Renaming a property name (`content` → `text`) is
   a string-grep job rather than a TypeScript-driven refactor. Any miss
   becomes a runtime undefined.
3. **Plugin risk.** Custom components depend on string property names
   that aren't documented anywhere except the component's own source.
4. **Trees can be malformed.** Tests have to be written for "what if
   someone constructs a `text` node with no `content`?" instead of
   relying on the type system.

## Fix options

### Option A — discriminated union of node types

```ts
interface BaseNode<T extends string, P> {
  readonly id: string;
  readonly type: T;
  readonly properties: Readonly<P>;
  readonly styles: Readonly<NodeStyles>;
  readonly children: readonly StateNode[];
}

type TextNode      = BaseNode<"text", { content: string }>;
type ParagraphNode = BaseNode<"paragraph", {}>;
type HeadingNode   = BaseNode<"heading", { level: 1|2|3|4|5|6 }>;
type ListNode      = BaseNode<"list", { listType: "ordered" | "unordered" }>;
type ImageNode     = BaseNode<"image", { src: string; width: number; height: number }>;
// ...
type StateNode = TextNode | ParagraphNode | HeadingNode | ListNode | ImageNode | ...;
```

Pros: maximum type safety, IDE auto-complete, refactors flow through
TypeScript.

Cons: closes the type to library-defined components. Custom components
can't extend the union without TypeScript module augmentation, which is
ugly.

### Option B — generic over component registry

Have the component definition declare its property type, and the registry
expose a typed lookup:

```ts
interface ComponentDefinition<T extends string = string, P = {}> {
  readonly type: T;
  readonly propertiesSchema?: Schema<P>; // zod / superstruct / runtype
  render(node: StateNode<T, P>, children): RenderNode;
}

// Library node type
type StateNode<T extends string = string, P = unknown> = ...;

// Look up via registry to recover the typed shape
const def = registry.get<HeadingNode>("heading");
```

Pros: open to extensions; runtime validation possible.
Cons: types only resolve when the component type literal is known
statically.

### Option C — narrow at the boundary, accept open in the tree

Keep `properties: Record<string, unknown>` on `StateNode`, but have each
component define a narrowing helper `isHeadingNode(n): n is HeadingNode`.
Component code uses these narrowings; cross-cutting code stays generic.

Pros: minimal refactor; preserves dynamism.
Cons: trust-but-verify pattern still requires casts at boundaries; no
runtime schema enforcement.

**Recommendation:** Option B — pair with [issue 01](01-components-no-behavior-hooks.md)
so the component definition becomes the single declaration of *type +
property schema + behavior*. If a runtime schema lib feels heavy, ship
without runtime validation but require components to provide a TS-only
property type.

## Migration plan (for Option B)

1. Define `ComponentDefinition<T, P>` with an optional `properties:`
   field declaring the TS shape.
2. Refactor each existing component to declare its property type.
3. Add a typed `registry.get<T extends ...>` that returns the component
   with its property type resolved.
4. Provide a `getPropertyValue(node, key)` helper that returns
   `unknown | undefined` and a narrowing helper per component.
5. Replace `as string`/`as number` casts in component render functions
   with reads through narrowed helpers.
6. Optionally add zod schemas alongside for runtime validation in dev
   mode.

## Test impact

- A new test category: "malformed properties" — what does the engine do
  if a list node ships with `listType: "circular"`? Probably should
  throw or render with a fallback. Document the contract.
- Existing component tests stay green if the migration preserves
  semantics.

## See also

- [issue 01](01-components-no-behavior-hooks.md) — the same redesign
  should land at once.
- [architecture/01 state layer](../architecture/01-state-layer.md)
- [architecture/02 components](../architecture/02-components.md)
