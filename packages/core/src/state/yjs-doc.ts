import { txMappingOf, type TxMapping } from "./tx-mapping";
import { attachTxMappings } from "./position-mapping";
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { asBlockId } from "./block-id";
import { isDevMode } from "./dev-mode";
import { getRegistry, type TreeKind } from "./registry";
import { realIdForWrite } from "./flow-ops";
import { dirtyIdsFromFlows } from "./flow-dirty";

const LIST_DEFS_KEY = "listDefs";
const COMMENTS_KEY = "comments";
const SUGGESTIONS_KEY = "suggestions";
const META_KEY = "meta";

/** Legacy (schema ≤ 2) block-tree roots. Read only by `upgrade.ts`; never written. */
export const LEGACY_TREE_ROOTS = ["blocks", "embedContents", "templateContents"] as const;

/** The storage schema this engine reads and writes (see `upgrade.ts`). */
export const CURRENT_SCHEMA_VERSION = 3;

/** The `meta` key holding the document's schema version (immutable between upgrades). */
export const SCHEMA_VERSION_KEY = "schemaVersion";

export function createYDoc(args?: { rootId?: BlockId }): Y.Doc {
  const doc = new Y.Doc();
  getRegistry(doc);
  doc.getMap(LIST_DEFS_KEY);
  doc.getMap(COMMENTS_KEY);
  doc.getMap(SUGGESTIONS_KEY);
  const meta = doc.getMap(META_KEY);
  if (args?.rootId !== undefined) {
    meta.set("rootId", args.rootId);
  }
  // A fresh local doc is born at the current schema. Only this and
  // `upgradeDocument` ever write the marker (see `upgrade.ts`).
  meta.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
  return doc;
}

/**
 * The top-level `listDefs` config side-table: listId → per-list numbering
 * config (Y.Map). Not a block structure; tracked by the History UndoManager.
 */
export function getListDefsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(LIST_DEFS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * The top-level `comments` side-table: commentId → comment thread record. The
 * comment RANGE is not stored here: paired zero-width `comment-start` /
 * `comment-end` marker embeds in inline content ARE the anchor (see
 * `state/comments.ts`). Undo-tracked; a comments-only write surfaces
 * `state.rootId` as its dirtyId.
 */
export function getCommentsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(COMMENTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * The top-level `suggestions` side-table (change tracking): suggestionId →
 * record. The suggestion RANGE is derived by a content scan over the
 * `insertionSuggestionId` / `deletionSuggestionId` / `formattingSuggestionId:<id>`
 * inline attrs and the block-level tags (see `state/suggestions.ts`).
 * Undo-tracked; a suggestions-only write surfaces `state.rootId` as its dirtyId.
 */
export function getSuggestionsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(SUGGESTIONS_KEY) as Y.Map<Y.Map<unknown>>;
}

/** Which tree a block belongs to (its registry entry's `tree`, written at creation). */
export type BlockTreeKind = TreeKind;

/** Number of registry entries (the index size; dev checks only). */
export function allTreeBlockCount(doc: Y.Doc): number {
  return getRegistry(doc).size;
}

/**
 * Returns the doc's meta Y.Map. Holds `rootId` (set once in `createYDoc`, never
 * reassigned) and `schemaVersion` (the inline-storage schema; written only by
 * `createYDoc` for a fresh local doc and by `upgradeDocument` — immutable between
 * upgrades, and never written by `createDocument` on a host-supplied, possibly
 * pre-sync doc).
 *
 * **doc-meta holds ONLY these immutable fields.** Mutable, user-observable
 * state belongs in the Layer-3 block-tree Y.Maps (blocks / embedContents /
 * templateContents), NOT here — doc-meta is outside the History
 * UndoManager's tracked scopes, so a doc-meta write silently lapses out of
 * undo/redo and loses state across a session. The doc-meta whitelist test
 * (`encapsulation.test.ts`) fails the moment any other key appears.
 *
 * **Not tracked by the History UndoManager.** The `History` class
 * (`history.ts`) constructs its `Y.UndoManager` with the blocks map,
 * the embedContents map, the templateContents map, the listDefs config
 * side-table, the comments side-table, and the suggestions side-table as
 * tracked scopes — writes to this
 * meta map are intentionally outside the undo/redo stack.
 * The current design relies on the meta map holding only immutable
 * session-level fields (rootId today; possibly format version, doc id,
 * etc. in the future).
 *
 * (Undo-TRACKING is distinct from dirty-CAPTURE: `captureDirtyIds` below
 * treats the blocks, embedContents, AND templateContents maps as dirty
 * roots for incremental render. The meta map is in neither set. The
 * templateContents map is both dirty-captured (here) and undo-tracked (added
 * to the UndoManager's tracked scopes in the `History` constructor) — the two
 * are independent concerns wired in separate places.)
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
 * Read the immutable document `rootId` out of the meta map of a raw Y.Doc.
 * Returns undefined when the meta map carries no (valid) rootId — e.g. a
 * freshly-decoded update that never seeded one. The `typeof === "string"` guard
 * + `asBlockId` is the codebase's validated branded-string construction (BlockId
 * is a branded string), NOT a forbidden narrowing cast. Used by the binary
 * document serializer's decode to reconstruct Document from a decoded Y.Doc.
 */
export function getMetaRootId(doc: Y.Doc): BlockId | undefined {
  const v = getMetaMap(doc).get("rootId");
  return typeof v === "string" ? asBlockId(v) : undefined;
}

/**
 * The registry entry to WRITE for block `id` (its `type` / `attrs`). A derived
 * entity is made real first: an implicit paragraph / cell / leading section is
 * materialized (fresh id + `implicitOf`), a joined chain is collapsed (see
 * `flow-ops.ts`). Throws when the block is not in the read model. `kind` is kept
 * for call-site compatibility; provenance is the entry's own `tree`.
 */
export function getYBlock(
  doc: Y.Doc,
  id: BlockId,
  opName: string,
  _kind?: BlockTreeKind,
): Y.Map<unknown> {
  void _kind;
  let real: string;
  try {
    real = realIdForWrite(doc, id);
  } catch {
    throw new Error(`${opName}: block "${id}" disappeared mid-transaction`);
  }
  const entry = getRegistry(doc).get(real);
  if (entry === undefined) throw new Error(`${opName}: block "${id}" disappeared mid-transaction`);
  return entry;
}

export interface TransactionResult {
  readonly dirtyIds: ReadonlySet<BlockId>;
}

/**
 * Probe whether `doc` is currently executing inside a `Y.Doc.transact`
 * callback. Yjs sets `doc._transaction` to the current `Y.Transaction`
 * for the duration of `.transact(fn)` (including transactions opened
 * internally by `Y.UndoManager.undo()` / `.redo()`) and clears it on
 * return. `_transaction` is underscore-prefixed and not part of Y.Doc's
 * public TS surface, but it is stable across Yjs 13.x (used by Yjs's own
 * bindings like y-prosemirror) and the version is pinned to `~13.6.x`,
 * with `yjs-version-guard.test.ts` as a tripwire.
 *
 * The `as unknown as { _transaction: unknown }` cast is the CLAUDE.md-
 * compliant escape hatch for the internal field (no `as any`).
 */
function isInYjsTransaction(doc: Y.Doc): boolean {
  const tx = (doc as unknown as { _transaction: unknown })._transaction;
  return tx != null;
}

/**
 * Guard for the state-module-internal `*InTx` family
 * (`insertTextInTx`, `deleteRangeInTx`, `reparentChildrenInTx`).
 *
 * Those helpers MUST run inside an open Y.Doc transaction so that
 * (a) their writes are atomic relative to peers and (b) their dirty
 * Y types reach `runTransaction` / `captureDirtyIds`' `afterTransaction`
 * listener — without an open transaction, the listener never fires and
 * the dirty ids are silently dropped, leaving renderers with stale paint.
 *
 * Two failure modes are closed by this assert:
 *   1. Caller forgets to wrap an `*InTx` helper in `runTransaction`
 *      (or another `doc.transact`).
 *   2. An `*InTx` helper calls `runTransaction` itself — Yjs merges the
 *      inner `transact` into the outer one and only fires
 *      `afterTransaction` once, after the inner listener has been
 *      detached. (See the non-reentrancy note on `runTransaction` below.)
 *      This guard catches case 1 directly; case 2 is documented as a
 *      separate invariant on `runTransaction`.
 *
 * Throws in BOTH DEV and PROD: silent dirty-id loss is worse than a loud
 * throw — the symptom is invisible (stale paint) until users notice.
 *
 * Exposed only via direct `./yjs-doc` imports inside the `state/`
 * module; intentionally NOT re-exported from `state/index.ts`. The
 * only legitimate call sites are the `*InTx` helpers themselves.
 */
export function requireInTransaction(doc: Y.Doc, opName: string): void {
  if (!isInYjsTransaction(doc)) {
    throw new Error(
      `${opName}: must be called inside Y.Doc.transact (e.g. via runTransaction).`,
    );
  }
}

/**
 * Runs `fn` inside a Y.Doc transaction and returns the set of BlockIds
 * whose subtree was touched. A BlockId becomes dirty when:
 *   - any block-tree map (every map in `TREE_MAP_GETTERS` — currently
 *     blocks / embedContents / templateContents) adds/removes/replaces it
 *     as a key, OR
 *   - any Y type nested under one of those entries is mutated.
 *
 * Implementation: attach an `afterTransaction` listener for the duration
 * of this call.
 *
 * **Cost.** O(unique_cursors_visited) per transaction, where
 * unique_cursors_visited is the total number of distinct Y types found
 * on the union of parent chains from each changed Y type up to a
 * block-tree map boundary. A per-transaction memo
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
 *
 * **`origin`** (optional) is forwarded to `doc.transact(fn, origin)`. It tags
 * the transaction so `History`'s `Y.UndoManager` (constructed with
 * `trackedOrigins: new Set([null])`) can decide whether to track it: the default
 * (`undefined` → Yjs's `null`) IS tracked (undoable); a non-`null` tag is NOT, so
 * the change is non-undoable. `undefined` is byte-identical to the pre-origin
 * call.
 */
/**
 * The AMBIENT transaction origin — the collab seam's "current dispatch belongs to
 * peer X" context. `null` (Yjs's default origin) outside any
 * `runWithTransactionOrigin` scope, so single-editor behavior is byte-identical.
 *
 * Why ambient (vs. threading an `origin` param through every Layer-3 op): the
 * editor has no single op-chokepoint — `reduceEditor` dispatches to ~30 handlers
 * that each call their own Layer-3 ops, which each open their own transaction via
 * `applyOperation`. A collab controller needs ALL of one dispatch's transactions
 * tagged with its peer origin (so its own foreign-change observer can skip them
 * and its UndoManager can track only its own edits). A synchronous, try/finally-
 * scoped ambient value set ONCE around the dispatch achieves that without touching
 * any op signature — analogous to React's "current dispatcher". The editor reducer
 * is fully synchronous, so the scope can't leak across dispatches.
 */
let ambientTransactionOrigin: unknown = null;

/**
 * Run `fn` with the ambient transaction origin set to `origin` for the (synchronous)
 * duration of the call — every `runTransaction` inside `fn` that doesn't pass an
 * EXPLICIT origin adopts it. Restores the prior origin in `finally` (supports
 * nesting). A collab host wraps its `dispatch(action)` in this so all of that
 * dispatch's edits carry its peer origin. No-op-equivalent for non-collab callers
 * (they never call it → origin stays `null`).
 */
/** The current ambient transaction origin (`null` outside any `runWithTransactionOrigin`). */
export function currentTransactionOrigin(): unknown {
  return ambientTransactionOrigin;
}

/**
 * The origin of an UNTRACKED change a host makes on its own behalf (a host
 * proposal): `owner` is that host's own origin. No `History` tracks it (a History
 * tracks its owner's origin by identity, and this is a different value), yet
 * `subscribeForeignChanges(state, owner, …)` recognises it as SELF — so the host
 * never re-applies its own proposal as a foreign change — while a second host on
 * the same doc (a different `selfOrigin`) still sees it as foreign.
 */
export class UntrackedOrigin {
  constructor(readonly owner: unknown) {}
}

export function runWithTransactionOrigin<T>(origin: unknown, fn: () => T): T {
  const prev = ambientTransactionOrigin;
  ambientTransactionOrigin = origin;
  try {
    return fn();
  } finally {
    ambientTransactionOrigin = prev;
  }
}

export function runTransaction(
  doc: Y.Doc,
  fn: () => void,
  origin?: unknown,
): TransactionResult {
  // Reentrancy guard (dev-mode). A nested `runTransaction` silently returns an
  // empty dirtyIds set — Yjs merges the inner `doc.transact` into the outer
  // one, so this call's `afterTransaction` listener is detached before the
  // outer commit fires. That manifests as invisible stale paint (the inner
  // mutation never reaches incremental render), the hardest class of bug to
  // trace. Turn the silent footgun into a loud throw. PROD pays nothing.
  if (isDevMode() && isInYjsTransaction(doc)) {
    throw new Error(
      "runTransaction called while already inside a Y.Doc transaction. " +
        "Nested runTransaction loses dirtyIds (the inner afterTransaction " +
        "listener detaches before the outer commit). Mutate raw Y types " +
        "directly and let the outer caller's runTransaction capture dirtyIds.",
    );
  }
  // Origin precedence: an EXPLICIT `origin` arg wins; otherwise adopt the
  // AMBIENT origin (a collab host's per-dispatch peer tag, or `null` — Yjs's
  // default — outside any `runWithTransactionOrigin` scope). `undefined` explicit
  // arg falls through to ambient, so non-collab callers stay byte-identical (`null`,
  // which `History`'s UndoManager tracks).
  const effectiveOrigin = origin ?? ambientTransactionOrigin;
  const dirtyIds = captureDirtyIds(doc, () => doc.transact(fn, effectiveOrigin));
  return { dirtyIds };
}

/**
 * Run `fn` and capture every BlockId whose subtree was mutated during
 * its execution. Used by `runTransaction` (which wraps `doc.transact`)
 * and by `History.undo` / `.redo` (which call `Y.UndoManager.undo` /
 * `.redo` — each opens its own internal `doc.transact`). Both paths
 * need identical dirty-id semantics so downstream incremental render
 * can treat them uniformly.
 *
 * The capture relies on Y.Doc's `afterTransaction` event, which fires
 * once per outer transaction (per the non-reentrancy note on
 * `runTransaction`). The same `findOwningBlockIdMemoized` memo applies
 * — it lives only for the duration of this call.
 */
export function captureDirtyIds(
  doc: Y.Doc,
  fn: () => void,
): ReadonlySet<BlockId> {
  const dirtyIds = new Set<BlockId>();
  const maps: TxMapping[] = [];
  const captureDirty = (tx: Y.Transaction) => {
    for (const id of dirtyIdsFromTransaction(doc, tx)) dirtyIds.add(id);
    maps.push(txMappingOf(doc, tx));
  };
  doc.on("afterTransaction", captureDirty);
  try {
    fn();
  } finally {
    doc.off("afterTransaction", captureDirty);
  }
  attachTxMappings(dirtyIds, maps);
  return dirtyIds;
}

/**
 * Every `BlockId` whose read-model snapshot ONE `Y.Transaction` may have changed —
 * the two-tier derivation in `flow-dirty.ts`. Feeds both `captureDirtyIds` (local
 * edits, undo/redo) and `subscribeForeignChanges` (remote transactions).
 */
export function dirtyIdsFromTransaction(doc: Y.Doc, tx: Y.Transaction): Set<BlockId> {
  const dirty = dirtyIdsFromFlows(doc, tx);
  // The transaction's exact position mapping travels with its dirty set.
  attachTxMappings(dirty, [txMappingOf(doc, tx)]);
  return dirty;
}
