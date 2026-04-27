# Issue 09 — `id` / `key` / `key` naming across three trees (Minor)

## Summary

The same conceptual identity — "this thing's stable name" — has three
different field names across the state, render, and layout trees. Worse,
keys are sometimes synthesized as derived strings (`${id}-text`,
`${id}:${counter}`, `${baseId}-${depth}`) without an explicit collision
discipline. Readers and writers end up doing string manipulation to
correlate trees.

## Where it manifests

### Three field names

```ts
// state-node.ts
interface StateNode { readonly id: string; ... }

// render-node.ts (and friends)
interface BlockRenderNode { readonly key: string; ... }
interface TextRenderNode  { readonly key: string; ... }

// layout-node.ts
interface BlockLayoutBox  { readonly key: string; ... }
interface TextLayoutBox   { readonly key: string; ... }
```

### Synthesized keys at layout

`packages/core/src/layout/layout-engine.ts:419–425`:

```ts
const count = keyCounters.get(child.key) ?? 0;
const key = count === 0 && words.length === 1
  ? child.key
  : `${child.key}:${count}`;
keyCounters.set(child.key, count + 1);
```

So one text render node may produce many text layout boxes with keys
`text-0`, `text-0:0`, `text-0:1`, …

### Synthesized keys at split

`packages/core/src/state/transformations.ts:294–323`:

```ts
const afterLeaf = createNode(
  newNodeId + "-text", textNode.type, ...
);
// ...
const afterParent = createNode(
  newNodeId + "-" + d, parent.type, ...
);
```

Multiple `-text` and `-${depth}` suffixes are appended per call site,
relying on a fresh `newNodeId` to avoid collisions.

### List children rebuilt with same key

`packages/core/src/components/list.ts:11`:

```ts
return createBlockNode(child.key, ...)
```

So the new wrapped child shares a key with the inner node — keys aren't
always unique within a tree level if you're not careful.

## Why it's a problem

1. **Mental tax.** Readers have to remember "id at state, key at render,
   key at layout, but they're the same thing… mostly."
2. **Synthesis is silent.** Look at a layout key and you have to know
   whether the `:` suffix means "n-th word from a single text node" or
   "n-th anything else." There's no convention, just convergent
   patterns.
3. **Collision risk.** `${id}-text` is a per-action choice. If two
   action handlers in different files use this convention with the same
   `id`, they collide. Today it's controlled because IDs are sequential
   integers per editor and rarely reused, but the discipline is fragile.
4. **No central registry of synthesis rules.** Greppable suffix
   conventions (`-text`, `:N`, `-${depth}`, `-line-${idx}`) appear in
   five files. A new contributor will introduce a sixth.

## Fix options

### Option A — unify the field name; document synthesis rules

Rename `key` to `id` everywhere (or `key` everywhere, your call).
Centralize synthesis helpers in `state/key-utils.ts`:

```ts
function synthTextOffsetKey(textId: string, n: number): string;
function synthSplitNodeId(baseId: string, depth: number): string;
function synthLineKey(blockId: string, lineIndex: number): string;
```

Use these consistently — every synthesis goes through a named helper.

Pros: cheap; immediately readable; reverse-engineering of any key
becomes possible.
Cons: doesn't add type safety.

### Option B — branded types for ids

Distinguish the levels at the type system:

```ts
type StateId      = string & { __brand: "StateId" };
type RenderKey    = string & { __brand: "RenderKey" };
type LayoutKey    = string & { __brand: "LayoutKey" };
```

Force conversions through helpers. Synthesis is the only path between
levels.

Pros: makes the levels first-class.
Cons: ceremony; many casts; doesn't catch collisions.

### Option C — structured keys

Replace string keys with typed objects:

```ts
type RenderKey =
  | { kind: "stateNode"; stateId: string }
  | { kind: "stateNode"; stateId: string; offset: number }
  | { kind: "block-line"; blockId: string; lineIndex: number };
```

Carry through render and layout. Lookups use deep equality.

Pros: total clarity on what each key means.
Cons: bigger refactor; equality semantics need helpers; perf cost on
hash-map lookups (need stable serializations).

**Recommendation:** Option A. The synthesis is genuinely a rare pattern;
naming and centralizing the helpers gets 90% of the benefit.

## Migration plan (for Option A)

1. Decide on one name (`key` is more general than `id` — keys can be
   derived; ids imply originality. Pick `key` everywhere or keep `id`
   only at the state layer to denote "originally allocated"). Document
   the choice.
2. Create `state/key-utils.ts` with named synth helpers. Replace
   `${child.key}:${count}` and `newNodeId + "-text"` style strings.
3. Add a unit test that all synth helpers produce distinct keys for
   distinct inputs.
4. Update tests and docs.

## Test impact

- New unit tests for the synthesis helpers (round-trip checks where
  applicable).
- Existing tests should pass unchanged.

## See also

- [architecture/01 state layer](../architecture/01-state-layer.md)
- [architecture/03 render layer](../architecture/03-render-layer.md)
- [architecture/04 layout layer](../architecture/04-layout-layer.md)
