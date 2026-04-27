# Issue 07 — `reduceEditor` is a 27-case switch (Significant)

## Summary

`reduceEditor` dispatches every action through a single 27-case switch.
Adding an action requires editing three places (the `EditorAction`
union, the reducer switch, and the action handler exports). Compared
to the registry-driven extensibility of components, this asymmetry is
inconsistent and makes user-defined actions impossible.

## Where it manifests

`packages/core/src/editor/editor-state.ts:160–260`:

```ts
function reduceEditor(editor, action, config) {
  const isVertical = action.type === "MOVE_LINE" || action.type === "EXPAND_LINE";

  switch (action.type) {
    case "INSERT_TEXT":  result = handleInsertText(editor, action.text, config); break;
    case "DELETE_BACKWARD": ...
    // 25 more cases ...
    default: { const _exhaustive: never = action; result = editor; break; }
  }

  if (!isVertical && result.targetX !== null) result = { ...result, targetX: null };
  return result;
}
```

Plus:

- `packages/core/src/editor/editor-action.ts` — discriminated union of 27 types.
- `packages/core/src/editor/actions/index.ts` — barrel re-exporting 27 handlers.
- 27 handler files in `actions/`.

## Why it's a problem

1. **Asymmetric extensibility.** Components are registered via a
   `ComponentRegistry`. Actions are not. There's no way for a consumer
   to add a `INSERT_FOOTNOTE` action without forking core.
2. **Three-place edits.** Add an action, edit at minimum three files.
3. **The switch lies about isVertical.** Only `MOVE_LINE` and
   `EXPAND_LINE` preserve `targetX`. New vertical-motion actions added
   later can silently break this if the contributor doesn't notice the
   carve-out.
4. **Can't compose.** Higher-level actions (e.g. macro-record-replay,
   batch transforms) have no clean way to compose primitive actions
   without round-tripping through the reducer.

## Fix options

### Option A — action registry

Mirror the component pattern:

```ts
interface ActionDefinition<A extends EditorAction> {
  type: A["type"];
  handler: (editor: EditorState, action: A, config: EditorConfig) => EditorState;
  /** If true, preserve targetX; otherwise clear it after this action runs. */
  preserveTargetX?: boolean;
}

class ActionRegistry { register(def); get(type); }
const defaultActions: ActionDefinition<any>[] = [...];

function reduceEditor(editor, action, config, registry: ActionRegistry) {
  const def = registry.get(action.type);
  if (!def) return editor;
  const result = def.handler(editor, action, config);
  if (!def.preserveTargetX && result.targetX !== null) {
    return { ...result, targetX: null };
  }
  return result;
}
```

Pros: consumers add actions; symmetric with components; `preserveTargetX`
moves to the action that owns it.

Cons: typing the action union dynamically is ugly — you lose static
exhaustiveness. Mitigate with module augmentation or a builder pattern.

### Option B — action handlers as plain functions, no central switch

Drop the action object entirely. Replace `dispatch({ type: "INSERT_TEXT", text })`
with `dispatchInsertText(text)` returning a state transformer. The "action"
becomes a function call.

Pros: best ergonomics; full type safety; trivial to compose.
Cons: breaks the React `useReducer` pattern. Loses the time-travel
debugger story (every action is visible in a Redux-style log).

### Option C — keep the switch, hide it behind a registry-style API

The switch stays, but a public `registerAction(definition)` API lets
consumers extend it via a side table that the switch falls back to:

```ts
default:
  const userHandler = userRegistry.get(action.type);
  if (userHandler) return userHandler(editor, action, config);
  // …exhaustive check
```

Pros: smallest change; preserves exhaustiveness for built-ins.
Cons: hybrid; the switch still scales linearly with built-in actions.

**Recommendation:** Option A, paired with [issue 01](01-components-no-behavior-hooks.md).
A component can register both render and the actions it owns. The
result is a single registry per component, holding render + behavior +
actions, with the reducer doing nothing more than `registry.get(type).handler(...)`.

## Migration plan (for Option A)

1. Define `ActionDefinition` and `ActionRegistry`.
2. Convert each of the 27 cases to an `ActionDefinition`. Mark
   `MOVE_LINE` and `EXPAND_LINE` with `preserveTargetX: true`.
3. Build `defaultActions` from these definitions.
4. Rewrite `reduceEditor` to look up by type.
5. Pass an `ActionRegistry` in `EditorConfig` (so default = built-ins,
   consumer = built-ins + extensions).
6. Update tests to import the registry.

## Test impact

- Existing tests pass unchanged (calling `reduceEditor` with default
  registry is identical behavior).
- Add a "consumer-defined action" test: register a custom action,
  dispatch it, verify the reducer routes it.

## See also

- [issue 01](01-components-no-behavior-hooks.md) — components owning
  their own actions is the cleanest end state.
- [issue 05](05-editor-state-mixed-concerns.md) — splitting state /
  view also splits the action set.
- [architecture/05 editor reducer](../architecture/05-editor-reducer.md)
