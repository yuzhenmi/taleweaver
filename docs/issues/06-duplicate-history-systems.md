# Issue 06 — Two parallel history systems coexist (Significant)

## Summary

There are two history implementations in the codebase. They share a
`Change` type and a 500ms collapse threshold, but neither uses the
other. One of them appears unused. Maintaining both is a smell and a
trap for future contributors.

## Where it manifests

### System 1 — `state/history.ts`

```ts
// packages/core/src/state/history.ts
interface History {
  readonly undoStack: readonly Change[];
  readonly redoStack: readonly Change[];
  readonly maxDepth: number;          // default 500
}

createHistory, pushChange, undo, redo
const COLLAPSE_THRESHOLD_MS = 500;
const DEFAULT_MAX_DEPTH = 500;
```

Exported from `packages/core/src/index.ts:29–30`:

```ts
export type { History } from "./state/history";
export { createHistory, pushChange, undo, redo } from "./state/history";
```

So it's a public API.

### System 2 — `editor/editor-state.ts`

```ts
interface EditorHistoryEntry {
  change: Change;
  selectionBefore: Selection;
  selectionAfter: Selection;
}

interface EditorHistory {
  undoStack: readonly EditorHistoryEntry[];
  redoStack: readonly EditorHistoryEntry[];
  lastEditTimestamp: number;
  lastEditTag: string;
}

const MAX_HISTORY_DEPTH = 500;
const MERGE_THRESHOLD_MS = 500;
```

This is what the editor reducer actually uses. It tracks selections in
addition to changes so that undo restores not just the document but also
the cursor.

### What's duplicated / divergent

| Concern | `state/history.ts` | `editor/editor-state.ts` |
|---|---|---|
| Stack shape | `readonly Change[]` | `readonly EditorHistoryEntry[]` |
| Collapse threshold | `COLLAPSE_THRESHOLD_MS = 500` | `MERGE_THRESHOLD_MS = 500` |
| Max depth | `DEFAULT_MAX_DEPTH = 500` | `MAX_HISTORY_DEPTH = 500` |
| Collapse strategy | unconditional time-based | tag-based + time-based |
| Selections tracked | no | yes |
| Used by reducer | no | yes |

The "merge tag" concept (only collapse adjacent edits of the *same kind*)
in `EditorHistory` is the right behavior — typing then deleting then
typing should produce three undo steps, not one. `state/history.ts`
collapses unconditionally, which is wrong.

## Why it's a problem

1. **Cognitive duplication.** New contributors see two histories and
   either pick the wrong one or invent a third.
2. **Public API is a footgun.** Exporting `createHistory`, `pushChange`,
   `undo`, `redo` from the package makes it look like consumers are
   meant to use them — but using them won't integrate with the reducer
   at all.
3. **Constants drift risk.** `MAX_HISTORY_DEPTH = 500` and
   `DEFAULT_MAX_DEPTH = 500` are independently maintained. If one is
   bumped, the other won't be.

## Fix options

### Option A — delete `state/history.ts`

Remove both the file and the public exports. Make `EditorHistory` the
only history. Keep `Change` (used by both) and the constants.

Pros: smallest, cleanest. One concept, one place.
Cons: minor breaking change to the public API. Anyone who imported
`createHistory`/`pushChange`/`undo`/`redo` (likely no one) breaks.

### Option B — make `EditorHistory` compose `History`

Treat `EditorHistory` as a wrapper:

```ts
interface EditorHistoryEntry {
  changeRef: ChangeIndex;       // index into inner History
  selectionBefore: Selection;
  selectionAfter: Selection;
}

interface EditorHistory {
  inner: History;               // pure state changes
  selections: EditorHistoryEntry[];
  ...
}
```

Pros: separates state-tree-change from selection bookkeeping.
Cons: extra indirection without obvious payoff. The inner `History`
already lacks the merge-tag logic, so it would still need work.

### Option C — generalize `History` to accept selection metadata

Make `state/history.ts` a generic history with arbitrary metadata, and
have `editor/editor-state.ts` instantiate it with selections.

```ts
interface History<Meta> {
  undoStack: readonly Entry<Meta>[];
  redoStack: readonly Entry<Meta>[];
  ...
}
type EditorHistory = History<{ selectionBefore, selectionAfter }>;
```

Pros: reusable; one source of truth for the algorithm.
Cons: generics across an exported API; the merge-tag wrinkle still
needs first-class support.

**Recommendation:** Option A. The simpler thing wins — there's no
demonstrated need for a generic history.

## Migration plan (for Option A)

1. Confirm `state/history.ts` is unused inside the codebase
   (it appears to be — `EditorState.history` is `EditorHistory`, not
   `History`). Run a grep:

   ```
   rg "createHistory|pushChange\(|from \"\.\./state/history\""
   ```

2. Remove the public exports in `packages/core/src/index.ts:29–30`.
3. Delete `packages/core/src/state/history.ts` and its tests.
4. Move `Change` (and `createChange`) to a stand-alone `state/change.ts`
   if not already there (it is).
5. Hoist the duplicate constants into a single `state/history-constants.ts`
   or just keep them in `editor-state.ts`.

## Test impact

- Drop tests for the deleted module.
- No other tests should change.

## See also

- [issue 10](10-duplicate-magic-constants.md) — the duplicated `500`s
  share a root cause.
- [architecture/01 state layer](../architecture/01-state-layer.md)
- [architecture/05 editor reducer](../architecture/05-editor-reducer.md)
