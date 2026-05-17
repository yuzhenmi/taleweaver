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
- Future *embed-content-shaped* side documents (e.g., revision-history snapshots if implemented as inline embeds; sidebar contents) follow the same pattern: add a new map field; existing operations that don't care don't see them. Comments and change-tracking are NOT in this category — per `decomposition.md` P23/P24 they are out-of-tree decoration sets carried alongside `EditorState`, not on `State`.

**Rationale:**

1. Architectural clarity at the type level: the lifecycle distinction between main-tree blocks (parent-chained) and embed-content blocks (referenced via contentBlockId) is real; the type system models it explicitly.
2. Matches Google Docs (`document.footnotes` as a separate dictionary) and Word OOXML (`footnotes.xml` as a separate part).
3. Restores the "only root has null parentId" invariant for `state.blocks`.
4. Scales cleanly to future side documents without widening a discriminator enum.
5. Helper cost trivial (~4 lines).

**Rejected alternatives:**

- **Option 2 (kind discriminator on Block):** discriminators widen over time (sidebars, revision-history embeds, etc.). Each widening forces consumers that switch on `kind` to update. Tree-walking operations need disciplined filtering. Easy to forget at fixture-write time.
- **Option 3 (hybrid: one map in State, split at clone output):** inconsistency between `State` shape and `ClonedSubtree` shape. `removeBlock` cascade-delete becomes O(depth) per check instead of O(1).

**Affected phases:** P6 (introduces the shape), P7 (renderer enumerates both), P8 (components consume from both via the renderer), P11.x (editor handles embed lifecycle), P15 (legacy invariant violation gone). Master spec sections referenced: § "State module" → embedContents bullet; § "Operations" → cascade-delete.

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

6. **History uses Yjs's UndoManager AFTER cutover** (a battle-tested undo implementation that handles per-user undo correctly for collab). A thin wrapper exposes our API: `History`, `pushHistoryEntry`, `undo`, `redo`. Selection is tracked separately (per master spec § "Public API surface" → `history.ts` bullet — HistoryEntry carries state + selection + dirtyIds + timestamp + mergeTag). **Timing:** during the parallel window (P11.0 through cutover), the `History` wrapper delegates to the legacy `EditorHistory` so undo remains functional. At cutover, the wrapper switches to delegating to Y.UndoManager. See decision D point 9 for details.

7. **Id namespaces.** Our `BlockId` is an opaque branded string produced by `IdAllocator`; it is NOT a Yjs internal struct id. Yjs's own struct ids (`{clientID, clock}`) operate one level below, on Y.Map / Y.Array / Y.Text entries — they're internal to Yjs and we don't expose them. Our `IdAllocator` continues to produce BlockIds independently. (Per Decision D, during the parallel window BlockIds come from `pathToBlockId(path)` instead of the allocator; a cutover-time translation pass swaps them out for fresh allocator-generated ids.)

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
- **P11.0 (EditorState type flip):** introduces both the new `History` wrapper AND retains the legacy `EditorHistory` (renamed to `historyLegacy`) for the parallel window per decision D. Wrapper delegates to legacy during parallel; flips to Y.UndoManager at cutover.
- **All P11.x action handlers:** Layer 3 ops on the Yjs-backed state; APIs unchanged from consumer perspective.
- **P15 cleanup:** `state/persistent-map.ts` is deleted in Phase 4e, not P15. Other legacy deletions still happen in P15.

**Per-character granularity confirmed:** for inline text CRDT, per-character ids match Google Docs' fine-grained concurrent-edit feel. Yjs's `Y.Text` provides this natively.

---

## B — `BlockView` interface (decided 2026-05-15)

**Question:** what does the render-time `BlockView` interface — the data handed to a component for rendering — actually look like? Specifically: children traversal pattern (pull vs push), parent reference, computed style attachment, state-wide access, container-vs-leaf shape.

**Decision:** **Push-model rendering with split container/leaf BlockView interfaces and a separate RenderContext escape hatch.** Renderer owns traversal; components receive their children (containers) or inline items (leaves) as already-rendered RenderNodes; the BlockView surface for each kind exposes only what that kind needs.

```typescript
interface BlockViewBase {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly computedStyle: ComputedStyle;
}

interface ContainerBlockView extends BlockViewBase {
  readonly kind: "container";
  // children are handed in pre-rendered via render(); not exposed here
}

interface LeafBlockView extends BlockViewBase {
  readonly kind: "leaf";
  readonly inlineContent: InlineContent;  // empty items array for blocks like image / horizontal-line
}

type BlockView = ContainerBlockView | LeafBlockView;

interface RenderContext {
  readonly state: State;
  getView(id: BlockId): BlockView | undefined;
  getEmbedContent(id: BlockId): BlockView | undefined;
  // additional accessors added as needed (cross-references, etc.)
}

interface ContainerComponentDefinition {
  readonly type: string;
  readonly kind: "container";
  render(
    view: ContainerBlockView,
    context: RenderContext,
    childRenderNodes: ReadonlyArray<RenderNode>,
  ): RenderNode;
}

interface LeafComponentDefinition {
  readonly type: string;
  readonly kind: "leaf";
  render(
    view: LeafBlockView,
    context: RenderContext,
    inlineRenderNodes: ReadonlyArray<RenderNode>,
  ): RenderNode;
}

type ComponentDefinition = ContainerComponentDefinition | LeafComponentDefinition;
```

**Concrete consequences:**

1. **Renderer drives traversal.** The renderer walks `State` top-down using the underlying Block fields (`firstChildId`/`nextSiblingId` chain). Components never traverse; they receive `childRenderNodes` (containers) or `inlineRenderNodes` (leaves) pre-built and compose their own RenderNode.
2. **BlockView has no `childIds` field.** Component code is simpler; cache invalidation is the renderer's exclusive concern.
3. **BlockView has no `parent` field.** Container-level coordination (table cell ↔ row ↔ table; list-item levels) happens at layout time or via attrs; components render self-contained from their own data.
4. **`computedStyle` is attached** to BlockView as a field. Cascade runs before the renderer dispatches; components don't walk ancestors for inherited values.
5. **Two interfaces for containers vs leaves.** `ContainerBlockView` / `LeafBlockView` discriminated union — paired with `ContainerComponentDefinition` / `LeafComponentDefinition`. Image, horizontal-line, and other "atomic" blocks are leaves with an empty `inlineContent.items` array. The registry's `kind` field lets the renderer hand the right shape to each component (and the type system enforces it). **For atomic blocks (image, horizontal-line), all rendering-relevant data — src URL, intrinsic dimensions, etc. — lives in `BlockViewBase.attrs` (mapped from the underlying `Block.attrs`).** `LeafBlockView.inlineContent.items` is empty by convention; component reads `view.attrs` for its rendering inputs.
6. **RenderContext is the escape hatch** for cross-block lookups (footnote-anchor → footnote body via `getEmbedContent`, future cross-references via `getView`). Keeps BlockView focused on "this block's data." A curated context object instead of handing components the full editor matches the surveyed editors' intent (controlled access to global state) while being narrower than their editor-singleton pattern.

   **`RenderContext.getView(id)` semantics:**
   - Returns `BlockView | undefined`. Returns `undefined` iff the id is unknown OR the block's `type` is unregistered (treated as a structural error — renderer logs a warning at that point; callers handle by skipping or rendering a placeholder).
   - When a non-undefined value is returned, callers MUST discriminate on `view.kind` before accessing kind-specific fields. `getView` does NOT guarantee a particular kind for a given id.
   - Construction is lazy. The renderer materializes a snapshot facade on demand (runs cascade for that block; dispatches container/leaf based on the registry's `kind` for the block's `type`).
   - Cache key: `(BlockId, stateVersion)`. During the parallel window, stateVersion bumps on every action (decision D point 5), so the cache effectively cold-starts each rebuild; post-cutover, Yjs-stable BlockIds make the cache usefully warm.
7. **Lifecycle and caching are implementation details** of the renderer. BlockViews can be lazy snapshot facades over the underlying Y.Map (post-Phase 4e), cached and invalidated via dirtyIds. Interface doesn't dictate.
8. **`text` and `span` components stay deleted** per master spec line 509. The renderer expands a leaf block's `inlineContent.items` directly into `inlineRenderNodes` (TextBoxes for TextItems, EmbedBoxes for EmbedItems) before invoking the leaf component. No "text component" exists.

**Rationale:**

1. **Smallest surface area.** BlockView exposes only what the component genuinely needs. Easier to evolve later (additive widening) than to shrink.
2. **Strict separation of concerns.** Components produce RenderNodes from their data; renderer owns the walk and cache; layout owns container coordination. Each module has one job.
3. **Aligned with canvas-renderer architecture.** A canvas renderer (target: match Google Docs) owns paint cache, dirty regions, viewport culling. Traversal must live with the renderer — components asking "who are my children?" would fight that ownership.
4. **React-style mental model.** Components compose pre-rendered children — familiar pattern, easy to reason about.
5. **No parent field avoids back-pointer construction order issues** and keeps BlockView trivially constructable from a single block's data + its computed style.

**Rejected alternatives:**

- **Pull-eager (full BlockView children tree pre-built per render):** builds the entire BlockView tree per render pass even for unchanged subtrees. Wasteful at scale.
- **Pull-lazy methods (`children()`, `inlineContent()`):** method-vs-field inconsistency; components must remember to call().
- **Pull-hybrid (eager `childIds`, lazy `getView` resolution):** components driving traversal — gives them work and responsibilities that belong with the renderer. Larger BlockView surface for no real win.
- **Parent reference on BlockView:** Lexical exposes `getParent()` on its node class, but the reconciler doesn't use it for rendering — it's a general graph utility for editing commands. ProseMirror and Slate omit parent entirely from the render-time view. For pure rendering, parent isn't needed; layout owns container coordination.
- **Single unified BlockView interface (container + leaf collapsed):** considered for simplicity, rejected after survey. All three reference editors (ProseMirror, Lexical, Slate) split container/leaf at the render interface — partly for type safety, partly because the renderer needs to know what to hand in (child render nodes vs inline render nodes). Single-interface saves nothing once the renderer's dispatch logic has to branch anyway.
- **State-wide access on BlockView directly:** muddles "this block's data" with "engine-wide queries." RenderContext keeps them separate.
- **Editor-singleton context (ProseMirror/Lexical/Slate pattern):** rejected as too wide. Components would gain access to mutation APIs they should never call during render. Curated RenderContext exposes only read-shaped accessors.

**Affected phases:**

- **P7 (render rewrite):** implements the renderer-drives-traversal walker; constructs BlockViews as snapshot facades over Y.Map (post-Phase 4e); produces `childRenderNodes` arrays for component invocations; emits embed-content RenderNode arrays alongside the main tree.
- **P8 (components rewrite):** each component's `render` signature is `(view, context, childRenderNodes) => RenderNode`. No component code traverses children. `text` and `span` stay deleted.
- **P11.x (editor actions):** unaffected — editor doesn't touch BlockView directly.

**Survey results (completed 2026-05-15):**

Surveyed ProseMirror (`NodeView` / `NodeViewDesc`), Lexical (`LexicalNode` + `LexicalReconciler`), Slate (`ElementComponent` + `useChildren`), and Google Docs canvas renderer (public sources).

**Validated by survey** (every surveyed open-source editor matches):
- Push model: framework owns traversal; components receive pre-rendered children.
- No parent on the render-time view (PM, Slate omit entirely; Lexical exposes on node but reconciler doesn't use it).
- Read-only render-time view; mutation through a separate edit channel.
- RenderContext-style cross-node access through an editor/state handle (PM's `EditorView`, Lexical's `LexicalEditor`, Slate's `useSlateStatic`).

**Revised after survey:** single BlockView → split `ContainerBlockView` / `LeafBlockView` interfaces. All three editors split container vs leaf at the render interface; collapsing them saved nothing once dispatch had to branch anyway. Decision text above reflects the split.

**Justified divergences** (we differ from the surveyed editors, intentionally):
- `computedStyle` field on BlockView. None of the surveyed editors do this because none is a CSS layout engine. We are — pre-computed style on the view is the right place for cascade output.
- Curated `RenderContext` instead of an editor singleton. None of the surveyed editors has a dedicated render-time context distinct from the editor handle. Our narrower context (read accessors only) is a sharper version of their pattern, not a contradiction.

**No evidence either way** for Google Docs / Kix canvas renderer — no public architecture detail on the model/view boundary. Cannot be cited as support or counter-example.

---

## D — P11.0 bridge mechanism (decided 2026-05-16)

**Question:** during the parallel window (P11.0 through P11.4) where `EditorState.state` is the new Yjs-backed `State` but action handlers haven't all migrated, how do legacy `StateNode`-consuming handlers and the still-legacy renderer keep working without losing changes the user makes via the other path?

**Decision:** **Dual representation with rebuild-based sync; `stateLegacy` is the canonical record during the parallel window.** `EditorState` carries both `state: State` (Yjs, declared from P11.0 — the type-flip target) and `stateLegacy: StateNode` (canonical during parallel; deleted at cutover). After each action, the rep NOT mutated by the handler is rebuilt from the rep that was. Legacy renderer continues consuming `stateLegacy` AND the legacy `EditorHistory` continues backing undo, until the renderer + history cutover at the end of the parallel window.

```typescript
interface EditorState {
  state: State;                    // type-flip target; becomes canonical at cutover
  stateLegacy: StateNode;          // canonical record during parallel window; deleted at cutover
  selection: LegacySelection;      // Span<LegacyPosition>; P11.3 migrates to Selection (Span<NewPosition>)
  history: History;                // wrapper; backed by legacy EditorHistory during parallel,
                                   // by Y.UndoManager after cutover (per decision C)
  historyLegacy: EditorHistory;    // active during parallel window; deleted at cutover
}

function rebuildStateFromLegacy(legacy: StateNode): State;   // fires after legacy actions
function downgradeToStateNode(state: State): StateNode;      // fires after migrated actions
```

**Concrete consequences:**

1. **Two sync directions, one per action source:**
   | Handler kind | Mutates | Refresh rule |
   |---|---|---|
   | Legacy (not yet migrated) | `stateLegacy` | `state` rebuilt from `stateLegacy` via `rebuildStateFromLegacy` |
   | Migrated (P11.x family) | `state` (Y.Doc transaction) | `stateLegacy` derived via `downgradeToStateNode` |

2. **`stateLegacy` is canonical during the parallel window.** Render, undo, and selection all source from `stateLegacy`. `state` exists primarily as the type-flip target so migrated handlers have something new-shape to read from. After every action, `stateLegacy` reflects truth; `state` is a derived view.

3. **`rebuildStateFromLegacy` is structural rebuild, not diff-replay.** A fresh `Y.Doc` is populated from the `StateNode` tree on each legacy action. Simpler than reconciling diffs against existing Y.Doc state. Pays a per-action cost; bounded because the parallel window is intentionally short.

4. **`downgradeToStateNode` is a forward walk of the Y.Doc** producing a frozen StateNode tree. Cheap; cacheable by Y.Doc version if needed.

5. **BlockId derivation: deterministic from path during the parallel window.** `rebuildStateFromLegacy` assigns each block's `BlockId = pathToBlockId(pathFromRoot)`, where `pathToBlockId` is a deterministic 1:1 string encoding of the path components (e.g., `path.join("/")` → `"0/1/2"` for the block reached by `root → child 0 → child 1 → child 2`). Not a hash — there are no collisions; it's a reversible encoding. This guarantees:
   - Same legacy structure → same BlockIds (stable across rebuilds for unchanged blocks).
   - Legacy `Position` (path) → `BlockId` conversion is trivial: `pathToBlockId(pos.path)`.
   - Selection survives rebuilds automatically: the path didn't change, so the BlockId it derives is unchanged.
   - Sibling insertions DO renumber downstream paths, so downstream BlockIds change after such operations. This is an acceptable consequence — any consumer holding a stale BlockId across actions must look it up fresh (the renderer cache discards entries automatically per the version-bumped state).
   - At cutover (parallel window ends), a **one-time id-translation pass** walks the post-rebuild State, allocates a fresh `BlockId` from `IdAllocator` per block, builds a `pathToBlockId-id → allocator-id` map, and replaces each `pathToBlockId`-derived id throughout (in Y.Map entries, in parent child-id lists, in `EmbedItem.properties.contentBlockId` references). After translation, BlockIds are stable across sibling insertions (no more path-renumbering hazard). **The existing `NewSelection` on `EditorState` (already `NewSelection` since P11.3) has its `Position.blockId` values remapped using the same translation table** — this is a BlockId-remap, not a legacy → new conversion. After the remap no external consumer ends up with stale references.

6. **Selection conversion is built on the same path-derivation.** Selection is a `Span` (anchor + focus `Position`s), not a single `Position`. Helpers convert each endpoint:
   - `legacyPositionToNew(state, pos: LegacyPosition): NewPosition` uses `pathToBlockId(pos.path)` to find the BlockId; offsets within the block map trivially.
   - `newPositionToLegacy(stateLegacy, pos: NewPosition): LegacyPosition` walks `stateLegacy` to find the path for a given BlockId.
   - `legacySelectionToNew(state, sel): NewSelection` and `newSelectionToLegacy(stateLegacy, sel): LegacySelection` apply the position helpers to anchor and focus.

   Both helpers live in `editor/legacy-position-bridge.ts` (transitional; deleted at cutover).

   **Round-trip on migrated-handler boundary:** after every migrated P11.x handler:
   1. Handler reads `selection: LegacySelection` from `EditorState`; converts to `NewSelection` via `legacySelectionToNew(state, selection)`.
   2. Handler runs its Layer 3 op on `state`, producing new `state'` and **new `NewSelection'`**. For handlers that don't move the cursor (e.g., `set-block-attrs`, toggle-bold over an existing range), the handler still produces a fresh `NewSelection'` by re-running `legacySelectionToNew` on `stateLegacy'` — it does NOT echo the pre-action `NewSelection` unchanged, because BlockIds may have shifted under sibling renumbering.
   3. The wrapper computes `stateLegacy' = downgradeToStateNode(state')`.
   4. The wrapper re-projects via `newSelectionToLegacy(stateLegacy', NewSelection')` — using the NEW `stateLegacy`, because the path may have shifted.
   5. `EditorState.selection` is assigned the re-projected `LegacySelection`.

   Handler responsibility: produce `state'` and `NewSelection'` valid against `state'`. Wrapper responsibility: the two conversions, the downgrade, and the assignment. The pre-action `LegacySelection` is discarded — it may not be valid against the new `stateLegacy`.

7. **`stateLegacy` and bridge functions are deleted at cutover (the closing commit of P11.4),** in the same atomic transition that flips the renderer to consume `state`, performs the id-translation pass, and switches the History wrapper to Y.UndoManager. See "Affected phases" below for the full cutover task list. P15 only handles `*-legacy.ts` file deletions that survive the cutover commit.

8. **No upgrade-replay machinery.** We considered diff-replay (incremental Y.Doc mutations from a StateNode diff). Rejected — identity preservation across BlockIds, character-level text reconciliation, and Y.Text format-mark consistency all become subtle bugs. Rebuild trades performance for correctness.

9. **Undo/redo backed by legacy `EditorHistory` during the parallel window.** The `History` wrapper's internal shape:

   ```typescript
   class History {
     private legacy: EditorHistory | null;   // set during parallel; null after cutover
     private yjs: YUndoManager | null;       // null during parallel; set at cutover
     undo() / redo() / push(...) — dispatches on whichever backend is set
   }
   ```

   During the parallel window, only `legacy` is set. Y.UndoManager doesn't exist yet — there's nothing to recreate on rebuild, nothing to discard. At cutover, the wrapper clears `legacy`, constructs a fresh Y.UndoManager bound to the live Y.Doc, and sets `yjs`. From that point on undo/redo goes through Y.UndoManager.

   **This means undo/redo IS FUNCTIONAL throughout the parallel window** — granularity matches the legacy implementation, not per-character Y.Text granularity. Per-character undo lights up at cutover.

   **History-push routing for migrated handlers:** during the parallel window, migrated handlers push to `historyLegacy` (the only backend set). After a migrated handler runs and the wrapper has computed `stateLegacy'` per point 6, the wrapper constructs a `Change { oldState: prevStateLegacy, newState: stateLegacy' }` and pushes it via `historyLegacy.push(change, selection)`. Handlers call `pushHistoryEntry(state, selection)` on the wrapper; the wrapper hides the legacy-or-new backend routing.

   **Cutover undo-stack behavior (accepted tradeoff):** at cutover, the active Y.UndoManager is the one attached to the current Y.Doc — which has no accumulated history (everything before cutover was rebuilt). User undo stack vanishes across the cutover deploy. Acceptable: cutover is a one-time engineering event (single deploy boundary, not a per-session boundary), and users typically don't expect undo to survive engine upgrades.

10. **Test discipline — handler equivalence tests.** For each migrated handler in P11.x, ship a paired test that applies the same logical action via the legacy handler and the migrated handler against an equivalent starting state, then asserts the resulting `stateLegacy` trees are structurally equal (and selections agree). This catches `downgradeToStateNode` drift. Paired tests are deleted in the cutover commit at the end of P11.4.

    Separately, for `rebuildStateFromLegacy`: for a representative set of starting `stateLegacy` shapes, assert the rebuilt `State` matches a direct `State` construction of the equivalent scenario. This catches `pathToBlockId` derivation bugs.

**Rationale:**

1. **Avoids upgrade-replay complexity.** Diff-replaying StateNode → Y.Doc is the highest-risk code path in any A/B option. Rebuild-from-scratch eliminates it entirely.
2. **Symmetric model.** Both directions are "build target rep from source rep." Easy to test, easy to reason about, easy to spot drift bugs.
3. **Throwaway field is honest.** `stateLegacy: StateNode` on `EditorState` is visibly transitional. When it's deleted, the cleanup is mechanical.
4. **Decision C-compatible.** Yjs-backed State can be rebuilt fresh from a StateNode tree without breaking any Yjs-specific contracts (the new Y.Doc has its own client id; no conflicting external state during the parallel window because collab isn't running).
5. **Renderer untouched at P11.0.** P11.0 stays a focused type flip; renderer migration happens via its own phase (P7) on its own schedule.

**Rejected alternatives:**

- **Option A from spec (one-way bridge with diff-replay upgrade).** The upgrade direction is the hardest engineering: identity preservation, text-mark reconciliation, Y.Text character-level diff. Subtle bugs hide there. Rebuild avoids the entire risk surface.
- **Option C from spec (defer render call).** UI pipeline breaks during the parallel window. Not acceptable.
- **Single-rep with on-the-fly bridging at every consumer.** Would require every legacy consumer site (handlers, renderer, tests) to call the bridge. Worse ergonomics than carrying both reps on `EditorState`.

**Accepted tradeoffs:**

- **Legacy actions slower during parallel window.** Each legacy action triggers a full Y.Doc rebuild. Bounded by the parallel window length (P11.0 → P11.4 in the migration timeline; not a permanent cost).
- **Y.Doc client metadata reset per legacy action.** No semantic loss in single-user mode; no impact on collab (which doesn't run during parallel window).
- **Per-character CRDT identity (Y.Text char ids) unstable across legacy-action boundaries.** Rebuild regenerates char ids. Fine for single-user; no impact on parallel-window behavior because collab isn't enabled. Tests asserting per-character CRDT identity must run in pure-new-state contexts, not via the dual-rep path.
- **Per-character CRDT identity also unstable for blocks created via migrated handlers.** Migrated handler's Y.Text char ids are lost when a subsequent legacy action triggers `rebuildStateFromLegacy` (the rebuild walks `stateLegacy`, which is the downgraded form). Same reasoning as above; bounded by parallel window.
- **Undo granularity during parallel window matches legacy, not Y.UndoManager.** Per-character undo (the Y.UndoManager benefit) lights up only at cutover. Acceptable: existing users get same-as-before undo throughout migration; only the post-cutover improvement is delayed.
- **Renderer cache effectively cold during parallel window.** Each `rebuildStateFromLegacy` produces a fresh Y.Doc with a fresh stateVersion. The renderer's `(BlockId, stateVersion)` cache key invalidates on every rebuild, so BlockViews are reconstructed from scratch for every block on every legacy action. Combined with the O(N) rebuild itself, this means O(N) rebuild + O(N) re-render per legacy action. For a 1k-block document this is sub-millisecond; for a 10k-block document it's user-noticeable but acceptable because the parallel window is bounded to the P11.0–cutover timeline. After cutover, BlockIds are allocator-generated and stable (per Decision C point 7); the cache becomes useful permanently.

- **Selection conversion per render call in the post-P11.3-pre-cutover sub-window.** Once `EditorState.selection` is `NewSelection` (after P11.3) but the renderer still consumes `stateLegacy` (before cutover), each render call invokes `newSelectionToLegacy(stateLegacy, selection)` — `O(treeDepth)` per Span endpoint, sub-millisecond for typical documents. Bounded by the P11.3 → cutover sub-window.

**Affected phases:**

- **P11.0:** introduces `state`, `stateLegacy`, `historyLegacy` fields on `EditorState`; introduces `History` wrapper delegating to `historyLegacy`; introduces `rebuildStateFromLegacy`, `downgradeToStateNode`, `legacyPositionToNew`, `newPositionToLegacy` helpers; wires `rebuildStateFromLegacy` to fire after each existing legacy action; initial render still consumes `stateLegacy`.
- **P11.1–P11.4:** each migrated handler:
  - (a) calls `downgradeToStateNode` after its Layer 3 ops to refresh `stateLegacy`;
  - (b) re-projects selection from `NewPosition` back to `LegacyPosition` against the NEW `stateLegacy` per point 6;
  - (c) routes history pushes through the `History` wrapper (which constructs a `Change` from pre/post `stateLegacy` snapshots and pushes to `historyLegacy`) per point 9;
  - (d) ships a paired equivalence test against the legacy handler per point 10.
- **Cutover phase (end of P11.4):** the closing task of P11.4 — same commit that finishes the last action-family migration — flips the renderer to consume `state` directly AND flips the `History` wrapper to delegate to Y.UndoManager AND deletes `historyLegacy`, `stateLegacy`, and the bridge functions. P11.4's success criteria gate on cutover. No separate "P11.5" phase.
- **P15:** removes any remaining `*-legacy.ts` files (renderer, components, etc.) per Decision E.

---

## E — File naming convention for parallel implementations (decided 2026-05-16)

**Question:** under Path B, new implementations coexist with the legacy ones they replace. What's the file naming convention that keeps the parallel pair clearly distinguished without polluting the canonical name?

**Decision:** **`-legacy` suffix on the OLD file; new code takes the canonical name.**

```
Before parallel implementation lands:    After parallel implementation lands:
  render/                                  render/
    render.ts        ← old code              render-legacy.ts  ← old code (renamed)
                                             render.ts         ← new code (canonical)
```

**Concrete consequences:**

1. **Same commit, two operations.** When a parallel implementation lands (P7 introduces new renderer, P8 introduces new components, etc.), the same commit:
   - Renames existing `<name>.ts` → `<name>-legacy.ts`
   - Adds new `<name>.ts` with the parallel implementation
   - Updates every import of the old code from `<name>` to `<name>-legacy`

2. **Consumer cutover changes imports back to canonical.** As each consumer migrates from legacy to new (P11.x for action handlers, eventually all renderer/component consumers), its import changes from `<name>-legacy` back to `<name>`. **`-legacy.ts` files may freely import other `-legacy.ts` files during the parallel window** — the entire legacy family is deleted together in P15; intermediate staged deletions are not attempted.

3. **P15 cleanup is pure deletion.** When the last consumer cuts over, the `<name>-legacy.ts` file is deleted. No renames needed; new code's canonical name was always canonical.

4. **Existing inconsistencies fixed during their owning phase:**
   - `state/new-initial-state.ts` → at P11.0, rename `state/initial-state.ts` → `state/initial-state-legacy.ts` and `state/new-initial-state.ts` → `state/initial-state.ts`. **Task ordering inside P11.0's per-phase plan:** rename + import updates as Task 1 (build stays green; only paths changed), THEN introduce dual-rep fields as Task 2. Skipping this ordering creates a build-red window.
   - `render/render-node-v2.ts` is a type-definition barrel split (not a parallel-implementations case). Folded into P7 — since P7 is already touching `render/` for the parallel renderer, the consolidation (`render-node-v2.ts` content moved into `render-node.ts`; barrel removed) lands in the same phase per the spirit of "new code claims the canonical name from day one."

5. **Applies to file naming AND directory naming.** If a whole subdirectory has a parallel implementation (e.g., a future `components/` rewrite), the legacy version becomes `components-legacy/`; new code lives in `components/`. (Decomposition.md's piece-level plans should rarely need whole-directory rename — most parallel implementations are file-level.)

6. **Applies to field/symbol naming on otherwise-canonical files.** Some transitional state lives as fields or symbols on files that are NOT themselves being rewritten (e.g., `EditorState.stateLegacy`, `EditorState.historyLegacy` per decision D; `legacyPositionToNew()` helper). The `-legacy`/`Legacy` suffix tags these as transitional too. They are deleted in P15 alongside the `*-legacy.ts` files. Convention: `camelCase` field suffix `Legacy` (e.g., `stateLegacy`, `historyLegacy`); helper functions use `legacy` prefix when the legacy nature is the dominant trait, or `Legacy` suffix when it's a variant of a canonical operation.

**Rationale:**

1. **New code claims the canonical name from day one.** The codebase's future lives at the un-suffixed path. Reading `render.ts` always means "the current best implementation," not "one of several versions."
2. **Cleanup cost asymmetry favors `-legacy`-on-old.** Suffix-on-new requires a rename at the end of the parallel window (`render-v3.ts` → `render.ts`). Suffix-on-old requires a deletion only.
3. **Semantic clarity.** `-legacy` says "this is going away." `-v3` / `-new` / `-block-state` all suggest "pick the right version for your case" — misleading when only one is the future.
4. **Mechanical migration.** A single grep across the codebase finds all consumers of the legacy file; updating their imports is rote.

**Rejected alternatives:**

- **`new-` prefix on new** (current `new-initial-state.ts` pattern): forces a rename at cleanup. `new` ages poorly — by the time the parallel window closes, "new" doesn't describe anything.
- **`-vN` suffix on new** (current `render-node-v2.ts` pattern): generic versioning suggests multiple stable versions; doesn't communicate which is canonical.
- **Descriptive suffix on new** (e.g., `render-block-state.ts`): conveys intent but still requires a cleanup-time rename. New code shouldn't have to wait for cleanup to claim its canonical name.
- **Subdirectory split** (e.g., `render/v3/render.ts`): deeper paths, more import noise, and file moves at cleanup. No benefit over a same-directory suffix.

**Affected phases:**

- **P7:** rename `render/render.ts` → `render/render-legacy.ts`; add new canonical `render/render.ts`. ALSO: consolidate `render/render-node-v2.ts` into `render/render-node.ts` (delete the `-v2` suffix) — same phase, same `render/` directory.
- **P8:** rename each `components/<name>.ts` → `components/<name>-legacy.ts` as parallel implementations land; add new canonical files. `text.ts` and `span.ts` are deleted outright (not renamed) per master spec § "Components" → text/span absence — they have no parallel implementation.
- **P11.0:** rename `state/initial-state.ts` → `state/initial-state-legacy.ts` and `state/new-initial-state.ts` → `state/initial-state.ts` (catching up the existing inconsistency). Done as Task 1 of P11.0's per-phase plan, before any dual-rep field is introduced.
- **P15:** delete every `*-legacy.ts` file whose consumers have all migrated.

---

## F — Component registration strategy during cutover (decided 2026-05-16)

**Question:** during the parallel window where old and new components coexist, do they share one registry or live in two? Should the new registry be singleton-based (matching current code) or constructor-injected?

**Decision:** **Two registries (legacy stays untouched; new is canonical) + new registry is constructor-injectable.**

```typescript
// components/component-registry.ts (NEW canonical, in canonical name per decision E)
export interface ComponentRegistry {
  register(def: ComponentDefinition): void;
  get(type: string): ComponentDefinition | undefined;
  has(type: string): boolean;
}

export function createComponentRegistry(): ComponentRegistry;        // empty
export function createDefaultComponentRegistry(): ComponentRegistry; // pre-populated with built-ins

// editor's createInitialEditorState signature:
function createInitialEditorState(
  opts?: { componentRegistry?: ComponentRegistry },
): EditorState;
// defaults to createDefaultComponentRegistry() if not provided.

// components/component-registry-legacy.ts (OLD, renamed per decision E)
// Stays as the existing singleton with module-load side-effect registration.
// Untouched — going away in P15.
```

**Concrete consequences:**

1. **Two registries during parallel window:**
   - `componentRegistryLegacy` (singleton, in `components/component-registry-legacy.ts`) — consumed by `render-legacy.ts`.
   - `componentRegistry` (constructor-injected, in `components/component-registry.ts`) — consumed by new `render.ts`.

2. **New registry shape matches Decision B's split.** `ComponentDefinition` = `ContainerComponentDefinition | LeafComponentDefinition`. The registry's `register` method type-checks against this union; the legacy registry doesn't know about kind discrimination.

3. **`createDefaultComponentRegistry()` explicitly lists built-ins.** No side-effect imports. The factory imports each new component definition and calls `register()` in order. A new built-in component requires editing this factory (explicit registration).

4. **Editor's existing `EditorConfig` shape is preserved; a new optional field is added.** The current `createInitialEditorState(config: EditorConfig)` signature continues to accept `EditorConfig.registry` (legacy `ComponentRegistry`, required throughout the parallel window). After P8 ships, the same `EditorConfig` gains an optional `componentRegistry: ComponentRegistry` (new shape) field. When both are present, the new renderer (post-cutover) uses `componentRegistry`; the legacy renderer uses `registry`. After cutover, the legacy `registry` field is deleted and `componentRegistry` becomes required. Sketch:

   ```typescript
   interface EditorConfig {
     // existing fields (measurer, containerWidth, pageConfig, ...)
     registry: ComponentRegistryLegacy;           // existing; required during parallel window
     componentRegistry?: ComponentRegistry;       // added by P8; defaults to createDefaultComponentRegistry()
   }
   ```

   Tests pass their own `componentRegistry` to isolate behavior. Existing examples (examples/react, examples/dom) need no immediate change — they continue passing `registry`; the new field defaults if omitted.

   **Sequencing with P11.0 (both phases modify `editor/editor-state.ts`):** P11.0 lands FIRST (introducing `state`, `stateLegacy`, `historyLegacy` fields). P8 lands AFTER, adding only the `componentRegistry?` optional field to `EditorConfig`. P8's per-phase plan adds `editor/editor-state.ts` to its "Modified" file list for this purpose. The P8 EditorConfig change is small and non-conflicting with P11.0's prior additions. (Reverse ordering would also work but reading the architecture top-down is clearer when the state model lands first.)

5. **Tests can use isolated registries.** A test exercising only `paragraph` can build a registry with just paragraph registered, eliminating coupling to unrelated components.

6. **No registry sharing across old and new.** Type incompatibility (old shape vs new container/leaf split) makes sharing infeasible without ugly type discriminators. Two clean registries beat one polluted one.

7. **Legacy registry retired in P15.** Same time the legacy renderer (`render-legacy.ts`) and legacy component files (`*-legacy.ts`) are deleted. `componentRegistry` (new) becomes the only registry.

**Rationale:**

1. **Type contracts are mutually incompatible.** New `ComponentDefinition` requires `kind`; legacy doesn't have it. Sharing forces ugly discrimination at every dispatch site.
2. **Testability earns its keep.** "Uncompromising word processor" implies a serious test suite. Injectable registries enable proper isolation. Cost (one extra constructor parameter) is trivial.
3. **No side-effect imports** improve clarity. Reading `createDefaultComponentRegistry()` tells you exactly which built-ins exist. Module-load magic is replaced by explicit registration.
4. **Don't refactor what's being deleted.** Converting legacy registry to injectable is wasted work — it's gone in P15. Leave it singleton.
5. **Aligned with Decision E.** Canonical names (`componentRegistry`, `render.ts`) belong to the new code from day one; legacy carries the `-legacy` suffix.

**Rejected alternatives:**

- **Shared registry with type discriminator:** `ComponentDefinition.shape: "legacy" | "container" | "leaf"`. Pollutes the type system; every consumer dispatches on shape. Saves nothing — old and new renderers still need to filter to their own shape.
- **Singleton new registry:** matches current pattern but forgoes test isolation. Not worth the symmetry; "uncompromising word processor" justifies the better pattern.
- **Inject legacy registry too:** wasted refactor on code that gets deleted in P15.
- **Side-effect imports for new components:** would silently extend the registry based on import graph; debugging "where did this component get registered?" becomes painful. Explicit `createDefaultComponentRegistry()` is worth the explicit-registration line per component.

**Affected phases:**

- **P7 (render rewrite):** new `render.ts` accepts a `ComponentRegistry` parameter (the new shape). For its tests, P7 constructs a fresh registry via `createComponentRegistry()` (empty) or builds a test-specific subset. The actual editor still calls the legacy renderer at this point — P7 doesn't change `createInitialEditorState`.
- **P8 (components rewrite):** introduces `components/component-registry.ts` with the new `ComponentRegistry` interface, `createComponentRegistry()`, and `createDefaultComponentRegistry()`. Each migrated component file exports its definition; `createDefaultComponentRegistry()` imports and registers all of them explicitly. Legacy `components/component-registry.ts` renamed to `components/component-registry-legacy.ts` per decision E. After P8 ships, `EditorConfig` gains the optional `componentRegistry` field (still unused by the editor since cutover hasn't happened).
- **Cutover (after P11.4 + P7):** new renderer wired into the editor; renderer reads `config.componentRegistry` (with default fallback). Legacy renderer becomes dead code.
- **P15:** delete `components/component-registry-legacy.ts`, `EditorConfig.registry` field, and any remaining `*-legacy.ts` component files; `componentRegistry` becomes the only registry and required.

---

