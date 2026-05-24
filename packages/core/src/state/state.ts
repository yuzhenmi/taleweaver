import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import {
  createYDoc,
  getMetaMap,
  runTransaction,
  getEmbedContentsMap,
} from "./yjs-doc";
import {
  createSnapshotCache,
  createOverlayCache,
  getBlockSnapshot,
  getEmbedContentSnapshot,
  type SnapshotCache,
} from "./snapshot";
import { STATE_INTERNAL } from "./state-internal";

/**
 * Opaque document-state container. Internally a Y.Doc; consumers read
 * via the snapshot accessors `getBlock`, `getEmbedContent`. `rootId` is
 * a stable BlockId — the entry point to the main document tree.
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
 * Read a frozen Block snapshot from either the main tree or the
 * embedContents tree. Used by Layer 3 ops that don't know in advance
 * which tree an id belongs to (paste walker, future cross-tree
 * references). Main tree takes precedence in the unlikely event of
 * an id collision.
 *
 * Most ops should call `getBlock` or `getEmbedContent` directly — they
 * know which tree they operate on.
 */
export function getBlockFromEither(state: State, id: BlockId): Block | null {
  return getBlock(state, id) ?? getEmbedContent(state, id);
}

/**
 * Yield every BlockId currently present in the embed-contents tree
 * (footnote bodies, etc.). Narrow accessor exposed for the render module
 * so it can iterate embed subtrees without reaching into Y.Doc directly.
 *
 * Order is the underlying Y.Map iteration order; callers must not rely
 * on a particular sort.
 */
export function getEmbedContentIds(state: State): IterableIterator<BlockId> {
  return getEmbedContentsMap(
    state[STATE_INTERNAL].doc,
  ).keys() as IterableIterator<BlockId>;
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
 */
export function freshState(
  state: State,
  dirtyIds?: ReadonlySet<BlockId>,
): State {
  const { doc, snapshotCache } = state[STATE_INTERNAL];
  const newCache =
    dirtyIds !== undefined
      ? createOverlayCache(snapshotCache, dirtyIds)
      : createSnapshotCache();
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
  return {
    state: Object.freeze({
      rootId: state.rootId,
      [STATE_INTERNAL]: Object.freeze({
        doc: internal.doc,
        snapshotCache: createOverlayCache(internal.snapshotCache, dirtyIds),
      }),
    }) as State,
    dirtyIds,
  };
}
