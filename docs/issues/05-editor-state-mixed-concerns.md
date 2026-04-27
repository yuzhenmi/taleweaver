# Issue 05 — `EditorState` mixes semantic state, derived caches, and view config (Significant)

## Summary

`EditorState` is the type the reducer returns. It carries semantic state
(`state`, `selection`, `history`), derived caches (`renderTree`,
`layoutTree`), view input (`containerWidth`), and ephemeral UI state
(`targetX`). The reducer must take an `EditorConfig` (with `measurer`
and `registry`) on every call to keep the caches in sync. As a result,
**`core/editor` is not actually platform-agnostic** — it requires a
working `TextMeasurer` to run.

## Where it manifests

`packages/core/src/editor/editor-state.ts:122–131`:

```ts
interface EditorState {
  state: StateNode;        // semantic
  selection: Selection;    // semantic
  history: EditorHistory;  // semantic

  renderTree: RenderNode;  // derived from state + registry
  layoutTree: LayoutBox;   // derived from renderTree + measurer + containerWidth

  containerWidth: number;  // view input
  nextId: number;          // allocator
  targetX: number | null;  // ephemeral UI state
}

interface EditorConfig {   // also required on every reduce call
  measurer: TextMeasurer;
  registry: ComponentRegistry;
  containerWidth: number;
  pageHeight?: number;
  pageMargins?: PageMargins;
}

function reduceEditor(editor: EditorState, action: EditorAction, config: EditorConfig): EditorState
```

Every action handler eventually calls `rebuildTrees` (`actions/helpers.ts:47`)
which calls `renderTreeIncremental` and `layoutTreeIncremental`.

## Why it's a problem

1. **Reducer impurity creep.** A standard reducer signature is
   `(state, action) → state`. This reducer is `(state, action, config) →
   state`. The `config` is *effectively input* but isn't part of state,
   isn't part of action, and references stateful objects (a real
   `<canvas>` text measurer, a registry instance with mutable state).
   Time-travel debugging, replay, and serialization are all complicated
   by this.
2. **Engine cannot run headless.** "Core has no DOM dependency" is true
   only for the type imports; at runtime, every keystroke needs a
   measurer that returns sensible widths. A genuinely headless backend
   (collab server, schema validator) cannot use the reducer without
   spinning up a fake measurer.
3. **`containerWidth` lives in two places.** Both `EditorState.containerWidth`
   and `EditorConfig.containerWidth` exist. The action `SET_CONTAINER_WIDTH`
   updates the state's value; the config's is only used for initial
   layout. Two values, one concept, different update paths.
4. **`targetX` belongs to UI, not the document.** It's specifically about
   "what column did the user mean to be in for vertical motion" — that's
   a view concept. Including it in `EditorState` means changes to the
   view's notion of motion semantics force changes to "state."
5. **Caching at the wrong level.** Render and layout trees are pure
   derivations of state + config. Storing them inside state pretends
   they have separate identity, when really they are functions of state.

## Fix options

### Option A — split into pure semantic state and a derived-view layer

```ts
// pure
interface DocumentState {
  state: StateNode;
  selection: Selection;
  history: EditorHistory;
  nextId: number;
}

// view-side
interface DerivedView {
  renderTree: RenderNode;
  layoutTree: LayoutBox;
}

interface ViewState {
  containerWidth: number;
  targetX: number | null;
}

// reducer is pure over DocumentState
reduceDocument(doc: DocumentState, action: SemanticAction): DocumentState

// derived view is a memoized fn
deriveView(doc: DocumentState, view: ViewState, config: ViewConfig): DerivedView

// the React layer composes them
const doc = useReducer(reduceDocument, ...);
const view = useReducer(reduceView, ...);
const derived = useMemo(() => deriveView(doc, view, config), [doc, view, config]);
```

Pros: each piece is testable in isolation; headless usage is trivial;
caches no longer pollute the reducer signature.
Cons: needs a careful split of which actions are semantic vs view-only.
Some actions cross the line (SET_BLOCK_TYPE re-lays-out, but it's
semantic).

### Option B — keep `EditorState` but use weak caches

Keep the existing shape, but treat `renderTree`/`layoutTree` as pure
caches that any caller can rebuild. Drop them from the reducer's
signature; let consumers `useMemo` them. Move `containerWidth` and
`targetX` to a separate `EditorView` type that React owns.

Pros: smaller move; easier migration.
Cons: still mixes concerns inside the reducer file; `targetX` plumbing
gets tricky because the reducer needs to know about it for `MOVE_LINE`.

### Option C — keep as-is, document the contract

Argue that this is fine because the framework consumer benefits from
single-state simplicity. Add a doc that says "the reducer requires a
measurer; here's a mock for headless contexts."

Pros: zero work.
Cons: codifies a footgun.

**Recommendation:** Option A. The cost is real but the payoff —
genuinely platform-agnostic core, simple reducer signature, headless
testability — is exactly what `core` is supposed to deliver.

## Migration plan (for Option A)

1. Define `DocumentState`, `ViewState`, `DerivedView`.
2. Audit each action: classify as `SemanticAction` (state/selection/history)
   or `ViewAction` (`SET_CONTAINER_WIDTH`, `MOVE_LINE` produces a side
   effect on `targetX`).
3. The tricky cases are vertical-motion actions: they need to read the
   layout to know where to move. Resolve by passing `derivedView` as a
   read-only argument to `reduceDocument` for those actions, or model
   the action's input differently (e.g. pre-compute the target position
   on the view side and dispatch `SET_SELECTION`).
4. Update React bindings: two reducers + a `useMemo` for the derived
   view.
5. Update DOM controller's `update()` to take a tuple of
   `(doc, view, derived)` instead of `editorState`.

## Test impact

- The split lets you write reducer tests with no measurer.
- `derivedView` has its own snapshot tests covering each render-then-layout
  output.
- View-only actions test in isolation.

## See also

- [issue 06](06-duplicate-history-systems.md) — once history is
  semantic-only, the dual-history confusion gets simpler.
- [issue 07](07-monolithic-reducer-switch.md) — the split naturally
  carves the giant switch into two smaller ones.
- [architecture/05 editor reducer](../architecture/05-editor-reducer.md)
