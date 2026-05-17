import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { createYDoc, getMetaMap } from "./yjs-doc";
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
 * P6 populates this map; for P4e it's empty.
 */
export function getEmbedContent(state: State, id: BlockId): Block | null {
  return getEmbedContentSnapshot(state.doc, id, state.snapshotCache);
}

/**
 * Result of every Layer 3 state-mutating operation. The dirtyIds set is
 * produced at write-time by the operation itself, captured from the
 * Y.Doc transaction's change set.
 */
export interface OperationResult {
  readonly state: State;
  readonly dirtyIds: ReadonlySet<BlockId>;
}
