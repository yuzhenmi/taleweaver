# Issue 11 — No collaborative-editing architecture (Minor / Strategic)

## Summary

Taleweaver's state and history are single-user, in-memory, and
last-write-wins. There is no operation log, CRDT, OT, or conflict
resolution story. For a project benchmarking against Google Docs, this
isn't a *bug* — but it is a strategic gap, and the architecture has
some shapes that will fight a future collab implementation.

## Where it manifests

### The state is a snapshot, not an op log

`packages/core/src/state/state-node.ts` — every mutation produces a new
immutable tree. The `Change` type is just a snapshot pair:

```ts
// state/change.ts
interface Change {
  readonly oldState: StateNode;
  readonly newState: StateNode;
  readonly timestamp: number;
}
```

There is no operation describing *how* `oldState` became `newState`.
Replaying a change against a *different* base state is impossible
without re-deriving the operation.

### Transformations don't return ops

`packages/core/src/state/transformations.ts` — each transformation
function (`insertText`, `deleteRange`, `replaceRange`, `splitNode`)
returns only the resulting `Change`. Their inputs (position, span,
text) are not retained.

### History stores snapshots, not ops

`packages/core/src/editor/editor-state.ts:55–68` — `EditorHistoryEntry`
holds `Change` plus selections. To rebase against another user's edit,
you'd need to reconstruct the operation from the snapshots, which
isn't always possible.

### IDs are local-monotonic

`EditorState.nextId` is a number incremented on each allocator call.
Two clients editing the same doc would produce identical IDs for
different content.

### No remote application channel

The reducer is the only mutation path. No "applyRemoteOp" entry point.
The dispatch loop assumes single-source authority.

## Why it's a problem (eventually)

1. **The architecture is op-friendly but not op-aware.** Immutable
   trees with structural sharing are exactly what CRDTs / OT engines
   like — but without operations as first-class values, you can't
   transmit, transform, or replay them.
2. **ID collisions across clients.** Sequential numeric IDs are unsafe
   for any multi-source authoring.
3. **Selection model is single-user.** No notion of remote selections /
   cursors.
4. **Undo is local-only.** A real collab editor needs undo to skip your
   own undone ops without un-doing the other user's work.

## Fix options

### Option A — full CRDT integration (Yjs / Automerge / loro)

Replace the in-memory state tree with a CRDT representation that maps
to a `StateNode` view. The reducer becomes a thin layer that translates
actions into CRDT mutations.

Pros: solves it correctly; battle-tested libraries exist.
Cons: very large refactor; the immutable-tree mental model gives way
to a CRDT mental model; library choice has long-term consequences.

### Option B — operations as first-class values

Introduce `Operation` types that describe edits without snapshots:

```ts
type Operation =
  | { type: "insertText"; path: number[]; offset: number; text: string }
  | { type: "deleteRange"; range: Span }
  | { type: "splitNode"; position: Position; newId: string; depth?: number }
  | { type: "applyInlineStyle"; span: Span; styles: Partial<NodeStyles>; idBase: string };

function applyOperation(state: StateNode, op: Operation): { state: StateNode; reverse: Operation };
```

Each transformation is rewritten to return the operation alongside the
new state. The reverse operation enables undo.

For collab, operations can be transmitted, transformed (OT), and
replayed. This is the foundation. CRDT can come later as an
optional implementation of `applyOperation`.

Pros: incremental — can land before any networking is involved;
exposes a clean op log; enables remote-friendly undo.
Cons: still single-source until you add transforms/CRDT on top.

### Option C — "we're a single-user editor" — explicit non-goal

Document that collab is out of scope. Don't add machinery you don't
need.

Pros: zero work. Honest.
Cons: gives up the strategic positioning if the project ever wants to
pursue collab.

**Recommendation:** Option B as a stepping stone — even without
collab, op logs unlock useful features (replay tests, deterministic
fuzzing, server-side validation, undo-resistant macros). Make Option A
a future decision when the requirement is concrete.

## Migration plan (for Option B)

1. Define `Operation` discriminated union.
2. Refactor each transformation in `state/transformations.ts` and
   `state/formatting.ts` to also return its operation.
3. Provide `applyOperation(state, op): { state, reverse }`.
4. Switch `Change` to optionally carry `op?: Operation` (or replace it
   entirely once everyone's converted).
5. Replace ID allocation with UUID-or-similar to prepare for multi-source.
6. Keep the reducer as-is; it just records operations now.

## Test impact

- Add a property test: applying an op then its reverse returns to the
  original state.
- Add a serialization test: an op log replays to the same final state
  on a fresh document.

## See also

- [issue 02](02-untyped-properties-schema.md) — typed components and
  typed ops naturally pair.
- [architecture/01 state layer](../architecture/01-state-layer.md)
- [architecture/05 editor reducer](../architecture/05-editor-reducer.md)
