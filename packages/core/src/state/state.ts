import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import {
  createYDoc,
  getMetaMap,
  runTransaction,
  allTreeBlockCount,
} from "./yjs-doc";
import {
  getEmbedContentRootIds,
  getTemplateContentRootIds,
} from "./root-id-cache";
import {
  createSnapshotCache,
  createOverlayCache,
  compactCache,
  chainDepth,
  getBlockSnapshot,
  getEmbedContentSnapshot,
  getTemplateContentSnapshot,
  type SnapshotCache,
} from "./snapshot";
import { STATE_INTERNAL } from "./state-internal";
import { isDevMode } from "./dev-mode";
import {
  assertNoOrphanedEmbedContent,
  assertNoSharedEmbedContent,
} from "./embed-content-cascade";
import { assertChainIntegrity } from "./chain-integrity";

/**
 * Maximum chain depth before `applyOperation` compacts. Each
 * additional layer adds one Map.get + one Set.has to every fall-
 * through read, so a deep chain (e.g., a bulk paste of 4000 lines
 * chaining ~8000 applyOperation calls) makes per-read cost O(depth).
 * Compacting periodically keeps per-read cost bounded; the trigger
 * threshold balances "more frequent compaction work" against "deeper
 * chains between compactions". 64 layers ≈ 64 hops per cold read =
 * ~3μs, an acceptable per-read floor for the bulk-op case.
 */
const CHAIN_DEPTH_COMPACT_THRESHOLD = 64;

/**
 * Opaque document-state container. Internally a Y.Doc; consumers read
 * via the snapshot accessors `getBlock`, `getEmbedContent`,
 * `getTemplateContent` (or `resolveBlock` when the owning tree is unknown).
 * `rootId` is a stable BlockId — the entry point to the main document tree.
 *
 * Snapshots are cached per State instance; ops that produce a new State
 * inherit the underlying Y.Doc but get a fresh snapshot cache.
 *
 * **Encapsulation contract.** The underlying `Y.Doc` and the per-State
 * `SnapshotCache` live behind the non-exported `STATE_INTERNAL` symbol
 * (see `state-internal.ts`). Modules outside `state/` cannot import the
 * symbol, so `state[STATE_INTERNAL]` is unreachable from outside — the
 * only public field is `rootId`. State-module-internal code reaches the
 * Y.Doc / cache via `state[STATE_INTERNAL].doc` /
 * `state[STATE_INTERNAL].snapshotCache`.
 */
export interface State {
  readonly rootId: BlockId;
  readonly [STATE_INTERNAL]: {
    readonly doc: Y.Doc;
    readonly snapshotCache: SnapshotCache;
  };
}

export function createState(args: { rootId: BlockId; doc?: Y.Doc }): State {
  const doc = args.doc ?? createYDoc({ rootId: args.rootId });
  // Ensure meta.rootId is set (in case caller passed an externally-built doc).
  //
  // `rootId` is the ONLY field doc-meta may hold: it is immutable for the
  // document's lifetime. doc-meta is outside the History UndoManager's
  // tracked scopes, so any MUTABLE field written here would silently lapse
  // out of undo/redo — mutable, user-observable state must live in the
  // Layer-3 Y.Maps (blocks / embedContents / templateContents) instead.
  // See `getMetaMap` (yjs-doc.ts) and the A14 whitelist test.
  const meta = getMetaMap(doc);
  if (meta.get("rootId") === undefined) {
    doc.transact(() => meta.set("rootId", args.rootId));
  }
  return Object.freeze({
    rootId: args.rootId,
    [STATE_INTERNAL]: Object.freeze({
      doc,
      snapshotCache: createSnapshotCache(),
    }),
  }) as State;
}

/**
 * Read a frozen Block snapshot from the main tree by id. Returns null
 * for unknown ids. Subsequent reads with no intervening mutation return
 * the same reference (cache hit).
 */
export function getBlock(state: State, id: BlockId): Block | null {
  const internal = state[STATE_INTERNAL];
  return getBlockSnapshot(internal.doc, id, internal.snapshotCache);
}

/**
 * Read a frozen Block snapshot from the embed-contents tree by id.
 * Returns null for unknown ids. The embed-contents tree is initially
 * empty; embed operations populate it as embed nodes are created.
 */
export function getEmbedContent(state: State, id: BlockId): Block | null {
  const internal = state[STATE_INTERNAL];
  return getEmbedContentSnapshot(internal.doc, id, internal.snapshotCache);
}

/**
 * Read a frozen Block snapshot from the template-contents tree by id.
 * Returns null for unknown ids. The template-contents tree holds
 * header/footer template bodies; it is initially empty and is populated
 * as template definitions are created.
 */
export function getTemplateContent(state: State, id: BlockId): Block | null {
  const internal = state[STATE_INTERNAL];
  return getTemplateContentSnapshot(internal.doc, id, internal.snapshotCache);
}

/**
 * Identifies which of the three top-level trees a resolved block came
 * from. Consumers that need the tree provenance (e.g. so a downstream
 * write targets the correct Y.Map via `getYBlock`'s `kind` param) read
 * `kind`; consumers that only need the value can use
 * `resolveBlock(state, id)?.block ?? null`.
 */
export type ResolvedBlockKind = "block" | "embedContent" | "templateContent";

// Type-level cross-check that `ResolvedBlockKind` stays in lockstep with
// yjs-doc's `BlockTreeKind` (the keys of `TREE_MAP_GETTERS`). Both must be
// exactly `"block" | "embedContent" | "templateContent"`. We restate the
// literal union here (rather than importing `BlockTreeKind`, which would create
// a state → yjs-doc → state import cycle) and assert mutual assignability with
// the same literal yjs-doc asserts against — so if either union drifts, one of
// the two files fails to compile. See yjs-doc.ts `_blockTreeKindCrossCheck`.
type _ResolvedBlockKindMatchesLiteral = ResolvedBlockKind extends "block" | "embedContent" | "templateContent" ? true : never;
type _LiteralMatchesResolvedBlockKind = "block" | "embedContent" | "templateContent" extends ResolvedBlockKind ? true : never;
const _resolvedBlockKindCrossCheck: [_ResolvedBlockKindMatchesLiteral, _LiteralMatchesResolvedBlockKind] = [true, true];
void _resolvedBlockKindCrossCheck;

/** A block plus the tree it was resolved from. See `resolveBlock`. */
export interface ResolvedBlock {
  readonly block: Block;
  readonly kind: ResolvedBlockKind;
}

/**
 * Resolve a BlockId across all three trees (main, embedContents,
 * templateContents) and report which tree it came from. The only
 * unified accessor; consumers that need the tree provenance read
 * `kind`, consumers that only need the value use
 * `resolveBlock(state, id)?.block ?? null`.
 *
 * Precedence on id collision is main tree → embedContents →
 * templateContents. Returns null if the id is absent from every tree.
 */
export function resolveBlock(state: State, id: BlockId): ResolvedBlock | null {
  const b = getBlock(state, id);
  if (b !== null) return { block: b, kind: "block" };
  const e = getEmbedContent(state, id);
  if (e !== null) return { block: e, kind: "embedContent" };
  const t = getTemplateContent(state, id);
  if (t !== null) return { block: t, kind: "templateContent" };
  return null;
}

/**
 * Total number of blocks across all three trees (main `blocks`,
 * `embedContents`, `templateContents`).
 *
 * Exists as a Layer-1 accessor so Layer-2 utilities (`block-traversal`,
 * `block-compare`, `span-iteration`) can size their cycle-detection bounds
 * WITHOUT reaching through `STATE_INTERNAL` to the raw `Y.Doc` themselves —
 * keeping the Y.Doc fully behind Layer 1. A doc-order traversal can legitimately
 * walk WITHIN an embed/template body subtree, so the bound must cover every
 * tree's blocks, not just the main map. Not re-exported from the barrel; it is
 * a state-module-internal helper consumed via direct sibling import.
 */
export function blockCount(state: State): number {
  return allTreeBlockCount(state[STATE_INTERNAL].doc);
}

/**
 * Yield the ROOT BlockId of each registered embed-content body (footnote
 * bodies, etc.) — blocks with `parentId === null` in the embedContents
 * Y.Map. Body CHILDREN (the descendant blocks of a multi-level body) are
 * reached via the root's child chain during render, NOT enumerated here.
 * Narrowing to roots prevents spurious non-root `RenderOutput.embedContents`
 * entries (#313): a child rendered as a standalone top-level entry would
 * have no parent computed style (wrong cascade context) and duplicate the
 * in-body render under its root.
 *
 * Order is the underlying Y.Map iteration order; callers must not rely
 * on a particular sort.
 */
export function* getEmbedContentIds(state: State): IterableIterator<BlockId> {
  // Yields from the doc-keyed root-id cache (#317): the common render path,
  // including the per-keystroke incremental path, no longer scans the whole
  // embedContents map (roots + body children). The cache recomputes its root
  // set lazily, only after a key add/remove fires the map's `observe`
  // handler (a rare event relative to keystrokes), so this is O(1) per
  // keystroke for footnote-heavy docs. The #313 root-only contract is
  // preserved by the cache, which records only `parentId === null` keys.
  yield* getEmbedContentRootIds(state[STATE_INTERNAL].doc);
}

/**
 * True iff the document currently holds at least one footnote, i.e. at least
 * one embed-content body ROOT.
 *
 * Backed by the #317 doc-keyed root-id cache (`getEmbedContentRootIds`), this
 * is O(1) per call: the cache recomputes its root set only after a key
 * add/remove fires the embedContents map's `observe` handler (a footnote
 * insert/delete — rare relative to keystrokes), NOT per keystroke. Reading
 * `.size` avoids materializing or iterating the set.
 *
 * Coupling note: `embedContents` currently holds ONLY footnote bodies (FN-1;
 * exactly one body root per footnote, enforced by the
 * `assertNoOrphanedEmbedContent` invariant), so "no embed-content roots ⟺ no
 * footnote anchors". If other embed-content types are added later, this helper
 * becomes conservative (it may report `true` with no footnote anchors) but
 * never wrong-in-the-skipping-direction: a true return never skips footnote
 * work; revisit this accessor when non-footnote embed types land.
 */
export function docHasFootnotes(state: State): boolean {
  return getEmbedContentRootIds(state[STATE_INTERNAL].doc).size > 0;
}

/**
 * Yield the ROOT BlockId of each registered template-content body
 * (header/footer template bodies) — blocks with `parentId === null` in the
 * templateContents Y.Map. Mirrors `getEmbedContentIds`: body CHILDREN are
 * reached via the root's child chain during render, NOT enumerated here —
 * this prevents spurious non-root `RenderOutput.templateContents` entries
 * (#313).
 *
 * Order is the underlying Y.Map iteration order; callers must not rely
 * on a particular sort.
 */
export function* getTemplateContentIds(
  state: State,
): IterableIterator<BlockId> {
  // Yields from the doc-keyed root-id cache (#317); mirrors
  // `getEmbedContentIds`. See that accessor for the cache rationale and the
  // #313 root-only contract preservation.
  yield* getTemplateContentRootIds(state[STATE_INTERNAL].doc);
}

/**
 * Result of every Layer 3 state-mutating operation. The dirtyIds set is
 * produced at write-time by the operation itself, captured from the
 * Y.Doc transaction's change set.
 *
 * Renderer contract for dirtyIds: the set contains both updated and
 * deleted ids. Consumers should check `getBlock(state, id) === null`
 * to distinguish "updated, re-render" from "deleted, drop cached render
 * node". Deletions in embedContents follow the same contract via
 * getEmbedContent.
 */
export interface OperationResult {
  readonly state: State;
  readonly dirtyIds: ReadonlySet<BlockId>;
}

/**
 * Mint a State referencing the same Y.Doc as `state` but with a
 * different snapshot cache, after Y.Doc was mutated outside of
 * `applyOperation` (e.g., `Y.UndoManager.undo` / `.redo`).
 *
 * The new State's cache is an overlay on top of `state`'s cache with
 * `dirtyIds` invalidated. Sibling snapshots (and any other unchanged
 * block) stay warm via fall-through, so a single-block undo on a
 * hundred-page document doesn't force the renderer to re-snapshot every
 * block.
 *
 * `dirtyIds` is REQUIRED. The production path (`History.undo` /
 * `History.redo`) always has a captured dirty set from
 * `captureDirtyIds`. Callers that don't have one — test fixtures,
 * external Y.Doc surgery whose effects aren't tracked — must use
 * `freshStateFromDoc(state)` (the escape hatch with no overlay
 * continuity from the prior cache).
 *
 * **Chain-depth compaction (#273).** Compacts when the input chain is
 * too deep, mirroring `applyOperation`. Without this, a long run of
 * undo/redo would push overlay layers without ever flattening —
 * re-introducing the O(depth)-per-cold-read growth that
 * `applyOperation`'s compaction exists to prevent. Compaction is
 * structurally equivalent (same live entries, `dirtyIds` invalidated),
 * just collapsed to one root layer.
 */
export function freshState(
  state: State,
  dirtyIds: ReadonlySet<BlockId>,
): State {
  const { doc, snapshotCache } = state[STATE_INTERNAL];
  const newCache =
    chainDepth(snapshotCache) >= CHAIN_DEPTH_COMPACT_THRESHOLD
      ? compactCache(snapshotCache, dirtyIds)
      : createOverlayCache(snapshotCache, dirtyIds);
  return Object.freeze({
    rootId: state.rootId,
    [STATE_INTERNAL]: Object.freeze({
      doc,
      snapshotCache: newCache,
    }),
  }) as State;
}

/**
 * Mint a fresh State referencing the same Y.Doc but with a completely
 * empty snapshot cache — no overlay continuity from `state`'s prior
 * cache. The next read on any block hits the live Y.Doc and snapshots
 * it into the new (initially empty) cache.
 *
 * **Escape hatch only.** The production undo/redo path always uses
 * `freshState(state, dirtyIds)` so unchanged blocks stay reference-equal
 * across the cycle. Use `freshStateFromDoc` ONLY when there is no
 * captured dirty set:
 *   - Test fixtures that mutated the underlying Y.Doc directly.
 *   - External Y.Doc surgery (e.g., the bypass-detection path in
 *     `embed-content-cascade.test.ts`) whose effects aren't tracked
 *     through `applyOperation` / `History`.
 *
 * Using this in production would defeat the per-State view-stability
 * + structural-sharing properties of the snapshot cache. The split
 * signature is deliberate — production callers can't accidentally
 * reach for the escape hatch by omitting an argument.
 */
export function freshStateFromDoc(state: State): State {
  const { doc } = state[STATE_INTERNAL];
  return Object.freeze({
    rootId: state.rootId,
    [STATE_INTERNAL]: Object.freeze({
      doc,
      snapshotCache: createSnapshotCache(),
    }),
  }) as State;
}

/**
 * Run a mutating `fn` inside a Y.Doc transaction and produce an
 * OperationResult.
 *
 * **`options.origin`** (optional) tags the underlying `doc.transact` so the
 * `History`'s `Y.UndoManager` can decide whether to track the change. Omitting
 * `options` (the common case) is byte-identical to the pre-origin signature —
 * Yjs's default `null` origin, which History tracks (undoable). The suggestion
 * accept/reject ops (slice 3) pass `{ origin: SUGGESTION_RESOLVE_ORIGIN }` so the
 * resolve is NON-undoable; that caller then reconciles History's cached
 * `currentState` via `History.advanceState` (the txn skipped `History.commit`).
 *
 * The returned State has a fresh SnapshotCache built
 * as an overlay on top of the input state's cache, giving three
 * properties at once:
 *   - **O(dirtyIds.size) per-mutation bookkeeping**: the new cache
 *     starts empty (just an invalidation set and a base pointer); no
 *     iteration over the input cache's entries. Replaces the prior
 *     O(N_cached) per-mutation carry-forward, which dominated
 *     keystroke cost on warm caches at scale.
 *   - **Structural sharing**: snapshots of unchanged blocks are still
 *     returned by reference across `applyOperation` calls. The first
 *     read on the new layer falls through to base and returns the
 *     same `Block` instance, then promotes it into the new layer so
 *     subsequent reads are O(1).
 *   - **Per-State view stability**: the input state's cache is
 *     untouched — it becomes the immutable `base` of the new overlay.
 *     Reads via the pre-op State handle continue to see the
 *     pre-mutation snapshot. (Y.Doc is mutable in place, so this is a
 *     cached-view property, not true immutability — it lasts until
 *     the pre-op cache is invalidated or replaced.)
 *
 * See `SnapshotCache` in `snapshot.ts` for the layered-read algorithm
 * and the chain-depth / flattening notes.
 *
 * No-op contract: when the transaction produces no Y.Doc mutations
 * (`dirtyIds.size === 0`), this function returns the LITERAL input
 * `state` reference unchanged. Callers can therefore use
 * `result.state === input.state` as an O(1) "did anything change?"
 * guard — e.g., action handlers short-circuit before calling
 * `history.commit`, and the cascade/render pipeline skips a recomputation
 * pass entirely. The overlay allocation only runs on the non-no-op
 * branch.
 */
export function applyOperation(
  state: State,
  fn: (doc: Y.Doc) => void | ReadonlySet<BlockId>,
  options?: { readonly origin?: unknown },
): OperationResult {
  const internal = state[STATE_INTERNAL];
  const doc = internal.doc;
  let extra: ReadonlySet<BlockId> | undefined;
  // `options?.origin` (default `undefined`) tags the transaction so the History's
  // Y.UndoManager can opt the change OUT of undo tracking (the suggestion
  // accept/reject ops pass SUGGESTION_RESOLVE_ORIGIN). `undefined` is
  // byte-identical to the pre-origin call (Yjs's default `null` origin, tracked).
  const { dirtyIds: captured } = runTransaction(
    doc,
    () => {
      extra = fn(doc) ?? undefined;
    },
    options?.origin,
  );
  // Union op-contributed ids (e.g. a listDef-only write → affected-block-ids)
  // with the transaction-captured ids — BEFORE the size===0 short-circuit and
  // BEFORE cache invalidation, so a config-only write that touches no block in
  // the tree (and therefore captures nothing) still invalidates the blocks it
  // affects. When fn returns nothing (the common case), `captured` is reused as
  // a reference so existing void-returning ops allocate nothing extra.
  const dirtyIds: ReadonlySet<BlockId> =
    extra === undefined || extra.size === 0
      ? captured
      : new Set<BlockId>([...captured, ...extra]);
  if (dirtyIds.size === 0) {
    // No-op transaction: return the input state reference unchanged.
    // Preserves identity so callers can short-circuit on
    // `result.state === input.state`.
    return { state, dirtyIds };
  }
  // L-PERF-E: compact the chain when it grows too deep, so a bulk
  // handler (paste, multi-keystroke macro, programmatic replay) doesn't
  // create an arbitrarily deep overlay chain that costs O(depth) per
  // subsequent read. The result is structurally equivalent — same
  // live entries, dirtyIds invalidated — just collapsed into a single
  // root layer instead of N layers.
  const newCache =
    chainDepth(internal.snapshotCache) >= CHAIN_DEPTH_COMPACT_THRESHOLD
      ? compactCache(internal.snapshotCache, dirtyIds)
      : createOverlayCache(internal.snapshotCache, dirtyIds);
  const newState = Object.freeze({
    rootId: state.rootId,
    [STATE_INTERNAL]: Object.freeze({
      doc: internal.doc,
      snapshotCache: newCache,
    }),
  }) as State;
  // Dev-mode post-op invariant: every EmbedItem.properties.contentBlockId
  // reference must resolve to an existing embedContent root. Catches future
  // ops that drop EmbedItems (or embedContent bodies) without going through
  // the cascade helpers, which would otherwise silently leak orphans. Gated
  // on isDevMode() so production pays nothing. The dirtyIds set lets the
  // assertion scope its scan inductively — pre-state is orphan-free, so a
  // new orphan can only come from a dirty block's new EmbedItem (cheap)
  // unless a dirty id was deleted (could be a body deletion → full scan).
  if (isDevMode()) {
    assertNoOrphanedEmbedContent(newState, "applyOperation", dirtyIds);
    // Companion invariant: every embedContent root has at most ONE owning
    // anchor (the orphan check above covers the "at least one" direction).
    // Together they pin the 1:1 anchor<->body mapping. Sharing is unsupported
    // by design; copy-paste remaps contentBlockId via clonePastedSubtree. The
    // sharing check's scope-down only sweeps when a dirty block introduced an
    // embed reference (deletions/typing pay nothing).
    assertNoSharedEmbedContent(newState, "applyOperation", dirtyIds);
    // Structural invariant: the parent/sibling/child back-link chain is
    // internally consistent. Catches a structural op that mis-sets a pointer
    // (split/merge/remove/reparent/section-break) before the broken tree can
    // silently drop or duplicate blocks in the render walk. Inductively scoped
    // by dirtyIds (full scan only on a deletion). See chain-integrity.ts.
    assertChainIntegrity(newState, "applyOperation", dirtyIds);
  }
  return { state: newState, dirtyIds };
}
