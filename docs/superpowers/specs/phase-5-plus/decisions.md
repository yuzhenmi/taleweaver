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

---
