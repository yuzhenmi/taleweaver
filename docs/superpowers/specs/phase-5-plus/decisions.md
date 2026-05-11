# Phase 5+ ambiguity decisions log

Tracks the cross-cutting design decisions made before per-phase plans are drafted. Each entry includes the question, the chosen option, and the rationale. Per-phase context files reference this log.

---

## A — `state.embedContents` shape (decided 2026-05-10)

**Question:** where do embed-content blocks (footnote bodies, sidebar contents, comment threads) live in `State`?

**Decision:** **Two separate maps on State.**

```typescript
interface State {
  rootId: BlockId;
  blocks: PersistentMap<BlockId, Block>;          // main tree (parent chain reaches rootId)
  embedContents: PersistentMap<BlockId, Block>;   // referenced via EmbedItem.properties.contentBlockId
}
```

**Concrete consequences:**

- `clonePastedSubtree` returns `ClonedSubtree { blocks, embedContents, rootId }`.
- New helper `state/get-block.ts: getBlockFromEither(state, id): Block | undefined` for the rare cross-map lookup.
- `removeBlock` cascade-delete walks the removed subtree's inline content; for each `EmbedItem.properties.contentBlockId` reference, recursively removes from `embedContents` (cycle-defended).
- Test builders gain an optional `embedContents: [...]` parameter on `buildState`.
- Future side documents (comment threads, change-tracking suggestions, revision history) follow the same pattern: add a new map field; existing operations that don't care don't see them.

**Rationale:**

1. Architectural clarity at the type level: the lifecycle distinction between main-tree blocks (parent-chained) and embed-content blocks (referenced via contentBlockId) is real; the type system models it explicitly.
2. Matches Google Docs (`document.footnotes` as a separate dictionary) and Word OOXML (`footnotes.xml` as a separate part).
3. Restores the "only root has null parentId" invariant for `state.blocks`.
4. Scales cleanly to future side documents without widening a discriminator enum.
5. Helper cost trivial (~4 lines).

**Rejected alternatives:**

- **Option 2 (kind discriminator on Block):** discriminators widen over time (comment threads, change tracking, sidebars). Each widening forces consumers that switch on `kind` to update. Tree-walking operations need disciplined filtering. Easy to forget at fixture-write time.
- **Option 3 (hybrid: one map in State, split at clone output):** inconsistency between `State` shape and `ClonedSubtree` shape. `removeBlock` cascade-delete becomes O(depth) per check instead of O(1).

**Affected phases:** P6 (introduces the shape), P7 (renderer enumerates both), P8 (components consume from both via the renderer), P11.x (editor handles embed lifecycle), P15 (legacy invariant violation gone).

Note: after decision C below, both maps become `Y.Map` instances at the Y.Doc root. The two-map architecture survives; only the storage primitive changes.

---

## C — History / collab-readiness / state primitive choice (decided 2026-05-10)

**Question:** how do we design history (undo/redo) such that we don't lock ourselves out of real-time collaborative editing later?

**Decision:** **Adopt Yjs as the state primitive from the start.** The state module is built on Yjs's CRDT primitives (`Y.Doc`, `Y.Map`, `Y.Array`, `Y.Text`). Yjs becomes a runtime dependency of `@taleweaver/core`. Single-user editing runs entirely on Yjs primitives locally (no sync transport). When collab work begins, a sync transport (`y-websocket`, `y-webrtc`, `y-indexeddb`, or custom) is added — the state module itself is unchanged.

**Concrete consequences:**

1. **Yjs as a hard dependency** of `@taleweaver/core`. Added to `package.json`.

2. **State storage** uses Yjs primitives:
   - `Y.Doc` is the root container. Our `State` type is the Y.Doc plus immutable snapshot facades for consumers.
   - `state.blocks` → `Y.Map<BlockId, Y.Map>` (a Y.Map of Y.Maps; the inner Y.Map represents one block).
   - `state.embedContents` → `Y.Map<BlockId, Y.Map>` (another Y.Map at the Y.Doc root).
   - `Block.attrs` → `Y.Map<string, unknown>`.
   - `Block.inlineContent` → `Y.Array<Y.Map>` (each inner Y.Map is one InlineItem).
   - Text items use `Y.Text` for their text content (per-character CRDT with formatting marks).

3. **`PersistentMap` goes away.** Replaced by `Y.Map` (which has structural sharing via Yjs's internal data structures). Phase 1's `state/persistent-map.ts` is deleted in Phase 4e.

4. **Layer 3 operations** become Yjs transactions. Each op opens a Y.Doc transaction (`doc.transact(...)`), applies the mutations to Y types, observes which BlockIds changed (via the transaction's change set), and returns `OperationResult { state, dirtyIds }` where `state` is a fresh immutable snapshot view of the Y.Doc.

5. **Snapshot views.** Consumers read state via immutable snapshot facades: `getBlock(state, id): Block | undefined` returns a frozen JS view of the Y.Map at that id. Snapshots are lazy and cacheable; they share underlying Yjs storage. No `state.blocks.get(id).mutate(...)` — Y types are accessed only through transactions in Layer 3 ops.

6. **History uses Yjs's UndoManager** (a battle-tested undo implementation that handles per-user undo correctly for collab). A thin wrapper exposes our API: `History`, `pushHistoryEntry`, `undo`, `redo`. Selection is tracked separately (per master spec line 480 — HistoryEntry carries state + selection + dirtyIds + timestamp + mergeTag).

7. **Causal id generation:** Yjs handles this internally (lamport timestamp + client id). Our `BlockId`, `ItemId`, `CharId` use Yjs's id-generation pattern. `IdAllocator` becomes a wrapper over Yjs's id generator.

8. **Collab is genuinely additive.** When collab work begins:
   - Add a sync transport package (`y-websocket`, `y-webrtc`, etc.) — separate npm dep.
   - Wire up the transport to the existing Y.Doc.
   - Done. The state module needs no changes.

9. **Undo with collab semantics works automatically** via Yjs's UndoManager (each user has their own undo stack; undo applies inverses transformed against intervening peer ops).

**Rationale:**

1. **Don't reinvent CRDT machinery.** Per-character text CRDTs are notoriously subtle (decades of academic papers fixing earlier algorithms). Yjs has 10+ years of bug-fixing on the most-stressed CRDT-text codebase in open source.

2. **Future collab is genuinely additive.** No state-module rewrite when collab work begins; just add a sync transport.

3. **MIT-licensed, ~50KB, single team's well-maintained work.** Lock-in is bounded; the library is small enough to fork if needed.

4. **Yjs handles correctness gotchas:** convergence guarantees, tombstone GC, per-character text CRDT, undo with collab semantics, garbage collection of dead structs.

5. **Aligned with the project quality bar.** Google Docs-grade collab requires per-character CRDT; Yjs delivers that.

**Rejected alternatives:**

- **Option 1 from earlier discussion (snapshot-based undo, defer collab as rewrite):** "optimizing for short-term gains too much, and piling on problems for later" (per user feedback 2026-05-10).
- **Option 2 (build our own CRDT):** Significant correctness risk; we'd re-derive years of research.
- **Architecture A (CRDT-shape state + swappable backend with Yjs as additive sync layer):** Muddy in practice — would require maintaining duplicate CRDT representations (our state + a parallel Y.Doc) with translation overhead and drift risk. Retracted as a coherent option.

**Affected phases:**

- **Phase 4e (new):** rebase state module on Yjs primitives. Restructures Phase 1-4 type definitions and Layer 3 op implementations. Significant work but well-bounded once the design is specified.
- **P6 (state.embedContents separation):** now expressed as a second `Y.Map` at the Y.Doc root rather than a `PersistentMap`. Architecturally unchanged.
- **P11.0 (EditorState type flip):** uses Yjs UndoManager for history.
- **All P11.x action handlers:** Layer 3 ops on the Yjs-backed state; APIs unchanged from consumer perspective.
- **P15 cleanup:** `state/persistent-map.ts` is deleted in Phase 4e, not P15. Other legacy deletions still happen in P15.

**Per-character granularity confirmed:** for inline text CRDT, per-character ids match Google Docs' fine-grained concurrent-edit feel. Yjs's `Y.Text` provides this natively.

---

