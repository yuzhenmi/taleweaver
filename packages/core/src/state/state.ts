import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { createYDoc, getMetaMap, runTransaction } from "./yjs-doc";
import {
  createSnapshotCache,
  getBlockSnapshot,
  getEmbedContentSnapshot,
  type SnapshotCache,
} from "./snapshot";

/**
 * Opaque document-state container. Internally a Y.Doc; consumers read
 * via the snapshot accessors `getBlock`, `getEmbedContent`. `rootId` is
 * a stable BlockId — the entry point to the main document tree.
 *
 * Snapshots are cached per State instance; ops that produce a new State
 * inherit the underlying Y.Doc but get a fresh snapshot cache.
 */
export interface State {
  readonly rootId: BlockId;
  readonly doc: Y.Doc;
  readonly snapshotCache: SnapshotCache;
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
    doc,
    snapshotCache: createSnapshotCache(),
  });
}

/**
 * Read a frozen Block snapshot from the main tree by id. Returns null
 * for unknown ids. Subsequent reads with no intervening mutation return
 * the same reference (cache hit).
 */
export function getBlock(state: State, id: BlockId): Block | null {
  return getBlockSnapshot(state.doc, id, state.snapshotCache);
}

/**
 * Read a frozen Block snapshot from the embed-contents tree by id.
 * Returns null for unknown ids. The embed-contents tree is initially
 * empty; embed operations populate it as embed nodes are created.
 */
export function getEmbedContent(state: State, id: BlockId): Block | null {
  return getEmbedContentSnapshot(state.doc, id, state.snapshotCache);
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
 * Mint a fresh State referencing the same Y.Doc but with an empty
 * SnapshotCache. Used after operations that mutated the Y.Doc outside
 * of `applyOperation` (e.g., Y.UndoManager.undo / .redo).
 */
export function freshState(state: State): State {
  return Object.freeze({
    rootId: state.rootId,
    doc: state.doc,
    snapshotCache: createSnapshotCache(),
  });
}

/**
 * Run a mutating `fn` inside a Y.Doc transaction and produce an
 * OperationResult. The returned State has a fresh SnapshotCache that
 * carries forward all non-dirty entries from the input state's cache,
 * giving two properties at once:
 *   - structural sharing: snapshots of unchanged blocks remain
 *     reference-equal across `applyOperation` calls (memoized renderers
 *     can `prev === next` to skip unchanged subtrees).
 *   - per-State view stability: the input state's cache is untouched,
 *     so reads via the pre-op State handle continue to see the
 *     pre-mutation snapshot. (Y.Doc is mutable in place, so this is
 *     a cached-view property, not true immutability — it lasts until
 *     the pre-op cache is invalidated or replaced.)
 *
 * No-op contract: when the transaction produces no Y.Doc mutations
 * (`dirtyIds.size === 0`), this function returns the LITERAL input
 * `state` reference unchanged. Callers can therefore use
 * `result.state === input.state` as an O(1) "did anything change?"
 * guard — e.g., action handlers short-circuit before calling
 * `history.commit`, and the cascade/render pipeline skips a recomputation
 * pass entirely. The carry-forward / fresh-frozen-State allocation only
 * runs on the non-no-op branch.
 */
export function applyOperation(state: State, fn: () => void): OperationResult {
  const { dirtyIds } = runTransaction(state.doc, fn);
  if (dirtyIds.size === 0) {
    // No-op transaction: return the input state reference unchanged.
    // Preserves identity so callers can short-circuit on
    // `result.state === input.state`.
    return { state, dirtyIds };
  }
  const newCache = createSnapshotCache();
  for (const [id, snap] of state.snapshotCache.blocks) {
    if (!dirtyIds.has(id)) newCache.blocks.set(id, snap);
  }
  for (const [id, snap] of state.snapshotCache.embedContents) {
    if (!dirtyIds.has(id)) newCache.embedContents.set(id, snap);
  }
  return {
    state: Object.freeze({
      rootId: state.rootId,
      doc: state.doc,
      snapshotCache: newCache,
    }),
    dirtyIds,
  };
}
