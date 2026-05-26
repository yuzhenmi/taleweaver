import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import {
  createYDoc,
  getMetaMap,
  runTransaction,
  getEmbedContentsMap,
  getTemplateContentsMap,
} from "./yjs-doc";
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
 * Read a frozen Block snapshot from either the main tree or the
 * embedContents tree. Used by Layer 3 ops that don't know in advance
 * which tree an id belongs to (paste walker, future cross-tree
 * references). Main tree takes precedence in the unlikely event of
 * an id collision.
 *
 * Does NOT search the templateContents tree — this is the original
 * two-tree shortcut. When an id may live in ANY of the three trees (or
 * the tree provenance is needed), use `resolveBlock` instead.
 *
 * Most ops should call `getBlock` or `getEmbedContent` directly — they
 * know which tree they operate on.
 *
 * Implemented on top of `resolveBlock` and narrowed to the two-tree subset:
 * the precedence (main → embed) is the same first two arms `resolveBlock`
 * walks, and a `templateContent` hit is treated as a miss here (returns
 * null) to preserve this accessor's historical two-tree contract.
 */
export function getBlockFromEither(state: State, id: BlockId): Block | null {
  const resolved = resolveBlock(state, id);
  if (resolved === null || resolved.kind === "templateContent") return null;
  return resolved.block;
}

/**
 * Identifies which of the three top-level trees a resolved block came
 * from. Consumers that need the tree provenance (e.g. so a downstream
 * write targets the correct Y.Map via `getYBlock`'s `kind` param) read
 * `kind`; consumers that only need the value can use `getBlockFromEither`.
 */
export type ResolvedBlockKind = "block" | "embedContent" | "templateContent";

/** A block plus the tree it was resolved from. See `resolveBlock`. */
export interface ResolvedBlock {
  readonly block: Block;
  readonly kind: ResolvedBlockKind;
}

/**
 * Resolve a BlockId across all three trees (main, embedContents,
 * templateContents) and report which tree it came from. Unlike
 * `getBlockFromEither` (value-only, two trees), this returns the tree
 * provenance so a caller can route a follow-up write to the right Y.Map.
 *
 * Precedence on id collision is main tree → embedContents →
 * templateContents, matching `getBlockFromEither`'s order. Returns null
 * if the id is absent from every tree.
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
  for (const id of getEmbedContentsMap(
    state[STATE_INTERNAL].doc,
  ).keys() as IterableIterator<BlockId>) {
    const block = getEmbedContent(state, id);
    if (block !== null && block.parentId === null) yield id;
  }
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
  for (const id of getTemplateContentsMap(
    state[STATE_INTERNAL].doc,
  ).keys() as IterableIterator<BlockId>) {
    const block = getTemplateContent(state, id);
    if (block !== null && block.parentId === null) yield id;
  }
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
 * When `dirtyIds` is provided, the new State's cache is an overlay on
 * top of `state`'s cache with `dirtyIds` invalidated. Sibling snapshots
 * (and any other unchanged block) stay warm via fall-through, so a
 * single-block undo on a hundred-page document doesn't force the
 * renderer to re-snapshot every block.
 *
 * When `dirtyIds` is omitted, the new State gets a fully empty root
 * cache — appropriate when no dirty set is available (test fixtures,
 * external Y.Doc surgery whose effects aren't tracked).
 *
 * **Chain-depth compaction (#273).** The `dirtyIds` branch compacts when the
 * input chain is too deep, mirroring `applyOperation`. Without this, a long
 * run of undo/redo (each `undo`/`redo` calls `freshState` with a dirty set)
 * would push overlay layers without ever flattening — re-introducing the
 * O(depth)-per-cold-read growth that `applyOperation`'s compaction exists to
 * prevent. Compaction is structurally equivalent (same live entries,
 * `dirtyIds` invalidated), just collapsed to one root layer.
 */
export function freshState(
  state: State,
  dirtyIds?: ReadonlySet<BlockId>,
): State {
  const { doc, snapshotCache } = state[STATE_INTERNAL];
  const newCache =
    dirtyIds === undefined
      ? createSnapshotCache()
      : chainDepth(snapshotCache) >= CHAIN_DEPTH_COMPACT_THRESHOLD
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
 * Run a mutating `fn` inside a Y.Doc transaction and produce an
 * OperationResult. The returned State has a fresh SnapshotCache built
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
export function applyOperation(state: State, fn: () => void): OperationResult {
  const internal = state[STATE_INTERNAL];
  const { dirtyIds } = runTransaction(internal.doc, fn);
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
  return {
    state: Object.freeze({
      rootId: state.rootId,
      [STATE_INTERNAL]: Object.freeze({
        doc: internal.doc,
        snapshotCache: newCache,
      }),
    }) as State,
    dirtyIds,
  };
}
