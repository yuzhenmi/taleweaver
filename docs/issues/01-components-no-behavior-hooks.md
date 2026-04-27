# Issue 01 — Components have no behavior hooks (Major)

## Summary

The `ComponentDefinition` contract is **render-only**. Components cannot
declare how editing behaves at their type's boundaries (Enter, Backspace,
Tab, paste, drag-and-drop, …). All editing semantics live in the global
reducer and helpers, which means **adding a new structural component
requires editing core editor code**, not just registering a new component.

This is the project's most important extensibility limit and will be the
primary blocker to community/third-party components.

## Where it manifests

### The contract is render-only

`packages/core/src/components/component-definition.ts:9–23`:

```ts
type ComponentRenderFn = (
  node: StateNode,
  renderedChildren: readonly RenderNode[],
) => RenderNode;

interface ComponentDefinition {
  readonly type: string;
  readonly render: ComponentRenderFn;
  readonly createInitialState?: (...) => StateNode;
}
```

There is no hook for behavior of any kind.

### Behavior is hardcoded outside components

- **Table cell boundary detection:** `editor/actions/helpers.ts:80–108`
  — `isAtCellBoundary` knows that `path[0] = table`, `path[2] = cell`.
- **Empty paragraph detection:** `editor/actions/helpers.ts:40–45`
  — `isEmptyParagraph` only checks `paragraph` literal.
- **List splitting on Enter at empty list-item, list↔paragraph
  conversions:** `editor/actions/toggle-list.ts` and
  `editor/actions/split-node.ts` — entire flow is in the reducer.
- **Heading-level handling:** lives in `components/heading.ts` for render,
  but `set-block-type` lives in `editor/actions/set-block-type.ts`.
- **Triple-click paragraph selection:** `editor-controller.ts:541–561`
  — DOM controller hardcodes `path.slice(0, 1)` as "the block".
- **Backspace at document start, Backspace merging blocks:** lives in
  `editor/actions/delete-backward.ts` (not shown above but follows the
  same pattern).

### Adding a new component today

To add (say) a `code-block` component, you must edit:

1. `components/code-block.ts` — render function
2. `components/index.ts` — export + add to `defaultComponents`
3. `state/normalize.ts` — if it should be considered "opaque"
4. `editor/actions/set-block-type.ts` — for SET_BLOCK_TYPE support
5. `editor/actions/split-node.ts` — if Enter should not split it
6. `editor/actions/delete-backward.ts` — boundary handling
7. `editor/actions/insert-block.ts` — INSERT_BLOCK support
8. `editor/actions/toggle-list.ts` — opt-out from list conversion

That's a lot of central-code editing for one new feature.

## Why it's a problem

1. **Open/closed violation.** Components are open for *appearance* but
   closed for *behavior*. Anyone wanting Tab navigation in a table, code
   fences with their own Enter behavior, footnotes with merge-resistant
   boundaries, etc., must fork the engine.
2. **Path-shape leakage.** `isAtCellBoundary` knows `path[0]` is the
   table. If you ever wrap a table in something else (a column container,
   a section, a footnote box), this breaks silently.
3. **Discoverability.** Behavioral logic is scattered across 27 action
   files plus DOM controller plus helpers. There's no single place where
   "what does Enter do here?" is answered.
4. **Coupling between unrelated features.** Table-cell awareness shows
   up in delete-backward, delete-forward, delete-word, move-cursor,
   move-word, etc.

## Fix options

### Option A — extend `ComponentDefinition` with optional behavior hooks

Smallest change. Add optional callbacks the reducer consults:

```ts
interface ComponentDefinition {
  readonly type: string;
  readonly render: ComponentRenderFn;
  readonly createInitialState?: ...;

  // NEW
  readonly onSplit?: (ctx: ActionContext) => SplitDecision | null;
  readonly onDeleteAtStart?: (ctx) => DeleteDecision | null;
  readonly onDeleteAtEnd?: (ctx) => DeleteDecision | null;
  readonly opaque?: boolean;             // replaces hardcoded OPAQUE_TYPES
  readonly canHaveChildren?: (childType: string) => boolean;
  readonly preventCrossBoundaryDelete?: boolean;
}
```

`ActionContext` would carry `state, position, allocateId` etc.; the
return shape lets the component say "I handled it, here's the new state"
or "fall through to default". The reducer walks up the path consulting
ancestor components in order, just like CSS bubbling.

Pros: minimal refactor; backward compatible; lets component authors opt in.
Cons: adds optional surface area incrementally; doesn't force discipline.

### Option B — introduce a node-spec with schema + behavior in one place

ProseMirror-style. Each component declares:
- its render function
- which child types are allowed (a tiny grammar)
- how it responds to commands

Pros: schema validation comes for free; clean conceptual model.
Cons: bigger refactor; existing actions need to be re-expressed as commands.

### Option C — ECS-style (commands × components matrix)

Define commands as plain action types but resolve them through a
registered table of `(commandType × componentType) → handler`. Each
component registers handlers for the commands it cares about.

Pros: very flexible; trivially testable in isolation.
Cons: handler discovery becomes runtime; harder to reason about which
handler runs.

**Recommendation:** start with Option A. It's compatible with both B and
C and unblocks the practical pain points immediately.

## Migration plan (for Option A)

1. Add the optional hooks to `ComponentDefinition`.
2. Audit `editor/actions/` and identify all places that hardcode a node
   type. Replace with a `lookupComponent(state, path)` walk that asks the
   nearest ancestor component for a decision.
3. Move `isAtCellBoundary` logic into `tableCellComponent`'s
   `preventCrossBoundaryDelete` flag.
4. Move `isEmptyParagraph` "empty list-item exits list" logic into
   `listItemComponent`'s `onSplit` and `onDeleteAtStart`.
5. Replace `state/normalize.ts`'s `OPAQUE_TYPES` set with reading
   `definition.opaque` from the registry.
6. Update tests to register hooks where the test exercises behavior.

## Test impact

- New unit tests for each hook, per component.
- Integration tests in `editor/actions/` should still pass — they exercise
  end-to-end behavior.
- One careful integration test asserting "the same actions still produce
  the same results after the refactor." Snapshot the editor state
  trajectory of a typical session.

## See also

- [issue 02](02-untyped-properties-schema.md) — naturally pairs with this:
  schema validation belongs on the same component definition.
- [issue 07](07-monolithic-reducer-switch.md) — once components carry
  behavior, the giant switch shrinks.
- [architecture/02 components](../architecture/02-components.md)
- [architecture/05 editor reducer](../architecture/05-editor-reducer.md)
