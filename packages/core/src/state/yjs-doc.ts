import * as Y from "yjs";
import type { BlockId } from "./block-id";

const BLOCKS_KEY = "blocks";
const EMBED_CONTENTS_KEY = "embedContents";
const META_KEY = "meta";

export function createYDoc(args?: { rootId?: BlockId }): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(BLOCKS_KEY);
  doc.getMap(EMBED_CONTENTS_KEY);
  const meta = doc.getMap(META_KEY);
  if (args?.rootId !== undefined) {
    meta.set("rootId", args.rootId);
  }
  return doc;
}

export function getBlocksMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(BLOCKS_KEY) as Y.Map<Y.Map<unknown>>;
}

export function getEmbedContentsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(EMBED_CONTENTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * Returns the doc's meta Y.Map. Currently holds only `rootId`, which is
 * set once in `createYDoc` and never reassigned during a session.
 *
 * **Not tracked by the History UndoManager.** The `History` class
 * (`history.ts`) constructs its `Y.UndoManager` with only the blocks
 * map and the embedContents map as tracked scopes — writes to this
 * meta map are intentionally outside the undo/redo stack. The current
 * design relies on the meta map holding only immutable session-level
 * fields (rootId today; possibly format version, doc id, etc. in the
 * future).
 *
 * If you are adding a NEW meta-map writer, you MUST decide explicitly
 * whether the field should be undoable:
 *   - Genuinely immutable / set-once → meta map is fine; document the
 *     write site to make the non-undoable behavior visible to readers.
 *   - Mutable and user-observable → either put it under a tracked map
 *     (blocks/embedContents) or extend the UndoManager's tracked list
 *     in `history.ts` AND update its docstring.
 *
 * Silently mutating the meta map after document creation is a footgun —
 * the change will not appear in undo history and may surprise users.
 */
export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

/**
 * Fetch a block's Y.Map by id with a throw-on-miss contract. Layer 3 ops
 * call this inside `applyOperation` *after* having verified existence via
 * `getBlock(state, id) !== null`; the throw branch is a defensive guard
 * against future invariant breakage (it should never fire in correct code)
 * but is preferable to a non-null assertion because (a) it satisfies
 * CLAUDE.md's no-`!` rule via narrowing, (b) it surfaces the op name in
 * the error if it ever does fire.
 *
 * `kind` selects between the main blocks map and the embedContents map.
 */
export function getYBlock(
  doc: Y.Doc,
  id: BlockId,
  opName: string,
  kind: "block" | "embedContent" = "block",
): Y.Map<unknown> {
  const map = kind === "block" ? getBlocksMap(doc) : getEmbedContentsMap(doc);
  const yBlock = map.get(id);
  if (yBlock === undefined) {
    throw new Error(`${opName}: ${kind} "${id}" disappeared mid-transaction`);
  }
  return yBlock;
}

export interface TransactionResult {
  readonly dirtyIds: ReadonlySet<BlockId>;
}

// Yjs's Transaction#changed is typed as Map<AbstractType<YEvent<any>>, Set<string|null>>
// and #changedParentTypes uses the same key type. Y.Map's event-type generic is
// invariant, so to look up our concrete Y.Map<Y.Map<unknown>> instance we use
// reference identity and treat the map keys uniformly as AbstractType<YEvent<any>>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyYType = Y.AbstractType<Y.YEvent<any>>;

/**
 * Runs `fn` inside a Y.Doc transaction and returns the set of BlockIds
 * whose subtree was touched. A BlockId becomes dirty when:
 *   - the blocks map adds/removes/replaces it as a key, OR
 *   - the embedContents map adds/removes/replaces it as a key, OR
 *   - any Y type nested under one of those entries is mutated.
 *
 * Implementation: attach an `afterTransaction` listener for the duration
 * of this call.
 *
 * **Cost.** O(unique_cursors_visited) per transaction, where
 * unique_cursors_visited is the total number of distinct Y types found
 * on the union of parent chains from each changed Y type up to the
 * blocks/embedContents map boundary. A per-transaction memo
 * (`findOwningBlockIdMemoized` below) ensures each cursor is walked at
 * most once even when many changed Y types share intermediate ancestors
 * — a common pattern in wide-selection format ops where every item's
 * text + attrs both contribute to `changedParentTypes`.
 *
 * **Not reentrant.** A nested call inside another `runTransaction`'s `fn`
 * returns an empty `dirtyIds` set: Yjs merges the inner `doc.transact` into
 * the outer transaction, so `afterTransaction` only fires once at the
 * outer commit — after the inner call's listener has already been detached.
 * Internal helpers must therefore NOT call `runTransaction` themselves;
 * instead, mutate raw Y types directly and let the outer caller's
 * `runTransaction` capture dirty ids. Layer 3 ops are the only intended
 * call site.
 */
export function runTransaction(
  doc: Y.Doc,
  fn: () => void,
): TransactionResult {
  const dirtyIds = new Set<BlockId>();
  const blocksMap = getBlocksMap(doc);
  const embedContentsMap = getEmbedContentsMap(doc);
  const blocksMapAsAny = blocksMap as unknown as AnyYType;
  const embedContentsMapAsAny = embedContentsMap as unknown as AnyYType;

  const captureDirty = (tx: Y.Transaction) => {
    const blocksEvent = tx.changed.get(blocksMapAsAny);
    if (blocksEvent) {
      for (const key of blocksEvent) {
        if (key !== null) dirtyIds.add(key as BlockId);
      }
    }
    const embedsEvent = tx.changed.get(embedContentsMapAsAny);
    if (embedsEvent) {
      for (const key of embedsEvent) {
        if (key !== null) dirtyIds.add(key as BlockId);
      }
    }
    // Memo lifetime is exactly this captureDirty call. Sharing across
    // transactions is unsafe because Yjs may garbage-collect / re-layout
    // internal items between transactions.
    const memo = new Map<AnyYType, BlockId | null>();
    for (const [type] of tx.changedParentTypes) {
      const owningBlockId = findOwningBlockIdMemoized(
        type,
        blocksMapAsAny,
        embedContentsMapAsAny,
        memo,
      );
      if (owningBlockId !== null) {
        dirtyIds.add(owningBlockId);
      }
    }
  };

  doc.on("afterTransaction", captureDirty);
  try {
    doc.transact(fn);
  } finally {
    doc.off("afterTransaction", captureDirty);
  }
  return { dirtyIds };
}

/**
 * Non-memoized parent-chain walk. Called only by `findOwningBlockIdForTest`
 * — production path inside `runTransaction` uses `findOwningBlockIdMemoized`,
 * which amortizes shared ancestors across one transaction's
 * `changedParentTypes` iteration.
 *
 * Walks up the Y type parent chain to find the BlockId that owns `type`,
 * i.e. the key under blocksMap or embedContentsMap whose value is an
 * ancestor of `type`. Returns null if `type` is not nested under either.
 *
 * **O(depth) per call** — no linear scan of the outer map. Once we reach a
 * `cursor` whose `parent` is the blocks map or the embedContents map,
 * `cursor` is the block-level Y.Map and its insertion key is recoverable
 * from `_item.parentSub`. This is the Yjs internal field that records the
 * key under which a shared type was inserted into its parent Y.Map.
 *
 * `_item.parentSub` is documented as internal but is stable across Yjs 13.x
 * and used by Yjs's own bindings (e.g. y-prosemirror). The version is
 * pinned to `~13.6.x` in `packages/core/package.json` (patch-only upgrades)
 * and `yjs-version-guard.test.ts` fails loudly if the field is ever removed.
 *
 * `_item` and `parentSub` are TypeScript-invisible; the `as unknown as
 * { ... }` cast is the compliant escape hatch (CLAUDE.md forbids `as any`).
 */
function findOwningBlockId(
  type: AnyYType,
  blocksMapAsAny: AnyYType,
  embedContentsMapAsAny: AnyYType,
): BlockId | null {
  let cursor: AnyYType | null = type;
  while (cursor !== null) {
    const parent = cursor.parent as AnyYType | null;
    if (parent === blocksMapAsAny || parent === embedContentsMapAsAny) {
      // `cursor` is the block-level Y.Map. Its key in the outer map is the
      // `parentSub` field of its CRDT item.
      const item = (cursor as unknown as { _item?: { parentSub?: string } })
        ._item;
      if (item === undefined || item.parentSub === undefined) return null;
      return item.parentSub as BlockId;
    }
    cursor = parent;
  }
  return null;
}

/**
 * Test-only export of `findOwningBlockId` for direct perf measurement.
 * Production code path is via `runTransaction`; do not import this from
 * non-test files.
 */
export function findOwningBlockIdForTest(
  blocksMapAsAny: AnyYType,
  embedContentsMapAsAny: AnyYType,
  type: AnyYType,
): BlockId | null {
  return findOwningBlockId(type, blocksMapAsAny, embedContentsMapAsAny);
}

/**
 * Amortized variant used by `runTransaction`. Walks up the parent chain
 * exactly as `findOwningBlockId` does, but records every cursor it visits
 * in `memo` so subsequent calls within the same transaction short-circuit
 * the moment they land on a known cursor.
 *
 * Per-transaction lifetime is enforced by `runTransaction` allocating
 * a fresh `memo` map for each `captureDirty` invocation.
 */
function findOwningBlockIdMemoized(
  type: AnyYType,
  blocksMapAsAny: AnyYType,
  embedContentsMapAsAny: AnyYType,
  memo: Map<AnyYType, BlockId | null>,
): BlockId | null {
  const direct = memo.get(type);
  if (direct !== undefined) return direct;

  const path: AnyYType[] = [];
  let cursor: AnyYType | null = type;
  let resolved: BlockId | null = null;
  while (cursor !== null) {
    const cached = memo.get(cursor);
    if (cached !== undefined) {
      resolved = cached;
      break;
    }
    path.push(cursor);
    _walkStepCounter++;
    const parent = cursor.parent as AnyYType | null;
    if (parent === blocksMapAsAny || parent === embedContentsMapAsAny) {
      const item = (cursor as unknown as { _item?: { parentSub?: string } })
        ._item;
      resolved =
        item === undefined || item.parentSub === undefined
          ? null
          : (item.parentSub as BlockId);
      break;
    }
    cursor = parent;
  }
  for (const c of path) memo.set(c, resolved);
  return resolved;
}

/**
 * Test-only walk-step counter for the memoized walk used by
 * `runTransaction`. Increments once per `cursor` visited inside
 * `findOwningBlockIdMemoized`. Lets tests assert that wide-selection
 * format ops amortize the parent-chain walk rather than re-walking per
 * changed Y type. Production code only pays the increment; tests reset
 * and read it via the exports below.
 */
let _walkStepCounter = 0;

export function __resetWalkStepsForTest(): void {
  _walkStepCounter = 0;
}

export function __getWalkStepsForTest(): number {
  return _walkStepCounter;
}
