import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { asBlockId } from "./block-id";
import { isDevMode } from "./dev-mode";

const BLOCKS_KEY = "blocks";
const EMBED_CONTENTS_KEY = "embedContents";
const TEMPLATE_CONTENTS_KEY = "templateContents";
const LIST_DEFS_KEY = "listDefs";
const COMMENTS_KEY = "comments";
const SUGGESTIONS_KEY = "suggestions";
const META_KEY = "meta";

export function createYDoc(args?: { rootId?: BlockId }): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(BLOCKS_KEY);
  doc.getMap(EMBED_CONTENTS_KEY);
  doc.getMap(TEMPLATE_CONTENTS_KEY);
  doc.getMap(LIST_DEFS_KEY);
  doc.getMap(COMMENTS_KEY);
  doc.getMap(SUGGESTIONS_KEY);
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

export function getTemplateContentsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(TEMPLATE_CONTENTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * The top-level `listDefs` config side-table: listId → per-list numbering
 * config (Y.Map). NOT a block tree (keys are listId strings, not BlockIds), so
 * it is intentionally excluded from TREE_MAP_GETTERS / dirty-capture / the
 * snapshot cache. Tracked by the UndoManager (history.ts) as a 4th scope.
 */
export function getListDefsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(LIST_DEFS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * The top-level `comments` side-table: commentId → comment thread record
 * (Y.Map of author/body/createdAt/resolved scalars + a replies Y.Array). NOT a
 * block tree (keys are commentId strings, not BlockIds), so — like `listDefs` —
 * it is intentionally excluded from TREE_MAP_GETTERS / dirty-capture / the
 * snapshot cache. The comment RANGE is NOT stored here: paired zero-width
 * `comment-start`/`comment-end` marker embeds in inline content ARE the anchor
 * (see `state/comments.ts`). The map IS undo-tracked: `history.ts` adds it as a
 * Y.UndoManager scope, so a comment thread reverts atomically with its markers
 * (per-transaction tracking means a pure text edit, which never touches this
 * map, leaves comments untouched). It is excluded from dirty-capture, so a
 * comments-only write surfaces `state.rootId` as its dirtyId (the `setListType`
 * precedent) to advance state and land a committable, undoable entry.
 */
export function getCommentsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(COMMENTS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * The top-level `suggestions` side-table (change-tracking / Suggesting mode):
 * suggestionId → suggestion record (Y.Map of kind/author/createdAt scalars +
 * an optional nested `proposedAttrs` Y.Map for the formatting variant). NOT a
 * block tree (keys are suggestionId strings, not BlockIds), so — like
 * `listDefs` and `comments` — it is intentionally excluded from
 * TREE_MAP_GETTERS / dirty-capture / the snapshot cache. The suggestion RANGE
 * is NOT stored here: it is DERIVED by a content scan over the three
 * `insertion/deletion/formattingSuggestionId` inline attrs (and the two
 * block-join/split break embeds) that carry the id (see `state/suggestions.ts`)
 * — exactly as comments derive their range from in-content markers. The map IS
 * undo-tracked: `history.ts` adds it as a Y.UndoManager scope, so a suggestion
 * record reverts atomically with the tagged items / break embeds (per-transaction
 * tracking means a pure text edit, which never touches this map, leaves
 * suggestions untouched). It is excluded from dirty-capture, so a
 * suggestions-only write surfaces `state.rootId` as its dirtyId (the `setListType`
 * precedent) to advance state and land a committable, undoable entry.
 */
export function getSuggestionsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(SUGGESTIONS_KEY) as Y.Map<Y.Map<unknown>>;
}

/**
 * Which tree a block id belongs to. The single source of truth for the set
 * of top-level block-tree Y.Maps. Adding a 4th tree (e.g. comments) means
 * extending this record + `BlockTreeKind` — every consumer below
 * (`getYBlock`, dirty-capture event scan, owning-block walk) iterates it
 * rather than naming the three maps individually.
 */
const TREE_MAP_GETTERS = {
  block: getBlocksMap,
  embedContent: getEmbedContentsMap,
  templateContent: getTemplateContentsMap,
} as const satisfies Record<string, (doc: Y.Doc) => Y.Map<Y.Map<unknown>>>;

export type BlockTreeKind = keyof typeof TREE_MAP_GETTERS;

// Type-level cross-check that `BlockTreeKind` (the set of trees identified
// here) stays in lockstep with `ResolvedBlockKind` (state.ts) — both must be
// exactly `"block" | "embedContent" | "templateContent"`. These two unions are
// produced independently (this one from `TREE_MAP_GETTERS`' keys; the other
// hand-written in state.ts), so without a tripwire one could grow a tree the
// other doesn't know about. The mutual `extends` assignments below fail to
// compile if either union gains/loses a member relative to the other. (A direct
// `import type { ResolvedBlockKind }` would create a yjs-doc → state import
// cycle; instead we restate the literal union here and let the assertions catch
// drift in BOTH directions — if `ResolvedBlockKind` changes, its own assertion
// against this literal fails; see state.ts.)
type _BlockTreeKindMatchesLiteral = BlockTreeKind extends "block" | "embedContent" | "templateContent" ? true : never;
type _LiteralMatchesBlockTreeKind = "block" | "embedContent" | "templateContent" extends BlockTreeKind ? true : never;
const _blockTreeKindCrossCheck: [_BlockTreeKindMatchesLiteral, _LiteralMatchesBlockTreeKind] = [true, true];
void _blockTreeKindCrossCheck;

/**
 * The single top-level block-tree map owning blocks of the given `kind`.
 * Mirror of `getYBlock`'s `kind` dispatch at the map level: lets a Layer-3 op
 * route a write to the correct map once it knows a resolved block's tree
 * provenance (via `resolveBlock(...).kind`), without naming the three maps
 * individually.
 */
export function getTreeMap(doc: Y.Doc, kind: BlockTreeKind): Y.Map<Y.Map<unknown>> {
  return TREE_MAP_GETTERS[kind](doc);
}

/**
 * All top-level block-tree maps for `doc`, in the stable order of
 * `TREE_MAP_GETTERS`. Used by `captureDirtyIds` (the changed-key event scan
 * and the owning-block parent-chain membership test).
 */
export function getTreeMaps(doc: Y.Doc): Y.Map<Y.Map<unknown>>[] {
  return Object.values(TREE_MAP_GETTERS).map((get) => get(doc));
}

/**
 * Total block count across ALL three trees (main `blocks`, `embedContents`,
 * `templateContents`). This is the widened cycle-detection bound for the
 * map-agnostic traversal/compare/span helpers: a deep template or embed body
 * subtree can hold more blocks than the main map alone, so a main-map-sized
 * bound (`getBlocksMap(doc).size`) would under-bound a legitimate walk through
 * such a body and spuriously throw "cycle detected". Summing all three keeps
 * the bound a safe upper limit on the number of distinct blocks any single
 * traversal could visit.
 */
export function allTreeBlockCount(doc: Y.Doc): number {
  return getTreeMaps(doc).reduce((n, m) => n + m.size, 0);
}

/**
 * Returns the doc's meta Y.Map. Currently holds only `rootId`, which is
 * set once in `createYDoc` and never reassigned during a session.
 *
 * **doc-meta holds ONLY the immutable `rootId`.** Mutable, user-observable
 * state belongs in the Layer-3 block-tree Y.Maps (blocks / embedContents /
 * templateContents), NOT here — doc-meta is outside the History
 * UndoManager's tracked scopes, so a doc-meta write silently lapses out of
 * undo/redo and loses state across a session. The `A14` whitelist test
 * (`encapsulation.test.ts`) fails the moment a non-`rootId` key appears.
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
 * document serializer's decode to reconstruct State from a decoded Y.Doc.
 */
export function getMetaRootId(doc: Y.Doc): BlockId | undefined {
  const v = getMetaMap(doc).get("rootId");
  return typeof v === "string" ? asBlockId(v) : undefined;
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
 * `kind` selects between the main blocks map, the embedContents map, and
 * the templateContents map.
 */
export function getYBlock(
  doc: Y.Doc,
  id: BlockId,
  opName: string,
  kind: BlockTreeKind = "block",
): Y.Map<unknown> {
  const yBlock = TREE_MAP_GETTERS[kind](doc).get(id);
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
 * Recover the key a block-level Y.Map was inserted under in its parent tree
 * Y.Map: the `parentSub` field of its CRDT `_item`. `_item` / `parentSub`
 * are Yjs internals (TypeScript-invisible) but stable across Yjs 13.x and
 * used by Yjs's own bindings (e.g. y-prosemirror); the version is pinned to
 * `~13.6.x` and `yjs-version-guard.test.ts` is the tripwire if the field is
 * ever removed. The `as unknown as { ... }` cast is the compliant escape
 * hatch (CLAUDE.md forbids `as any`). Returns null if the item or its
 * `parentSub` is absent. Shared by the two owning-block walks below.
 */
function getParentSubKey(cursor: AnyYType): BlockId | null {
  const item = (cursor as unknown as { _item?: { parentSub?: string } })._item;
  if (item === undefined || item.parentSub === undefined) return null;
  return item.parentSub as BlockId;
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
 * (`undefined` → Yjs's `null`) IS tracked (undoable); a non-`null` tag (e.g.
 * `SUGGESTION_RESOLVE_ORIGIN` from the suggestion accept/reject ops) is NOT, so
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
  // Origin precedence: an EXPLICIT `origin` arg (e.g. the slice-3 suggestion
  // accept/reject ops passing SUGGESTION_RESOLVE_ORIGIN) wins; otherwise adopt the
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
  const captureDirty = (tx: Y.Transaction) => {
    for (const id of dirtyIdsFromTransaction(doc, tx)) dirtyIds.add(id);
  };
  doc.on("afterTransaction", captureDirty);
  try {
    fn();
  } finally {
    doc.off("afterTransaction", captureDirty);
  }
  return dirtyIds;
}

/**
 * The per-transaction half of `captureDirtyIds`: every `BlockId` whose subtree
 * was mutated by ONE `Y.Transaction`. Pulled out of `captureDirtyIds`' inner
 * closure so the SAME derivation feeds two consumers from a single home:
 *   - `captureDirtyIds` (local edits — aggregates across the transactions a `fn`
 *     runs), and
 *   - `subscribeForeignChanges` (collab — a standing observer that reacts to a
 *     REMOTE peer's transaction on a shared doc; see `state/collab.ts`).
 *
 * A direct add/remove/replace of a tree key marks that id dirty; a deeper change
 * (a block's inline content / attrs) surfaces via `changedParentTypes` walked to
 * its owning block. The `memo` lifetime is exactly this call — sharing across
 * transactions is unsafe (Yjs may GC/re-layout internal items between them).
 *
 * The `as unknown as AnyYType` / `as BlockId` bridges are the Yjs↔domain type
 * seam (Yjs keys its event maps by an internal abstract-type identity and its
 * change-set keys as raw strings); they were previously duplicated inline in
 * `captureDirtyIds` and are now centralized here.
 */
export function dirtyIdsFromTransaction(doc: Y.Doc, tx: Y.Transaction): Set<BlockId> {
  const dirtyIds = new Set<BlockId>();
  const treeMaps = getTreeMaps(doc);
  const treeMapSet = new Set<AnyYType>(treeMaps.map((m) => m as unknown as AnyYType));

  for (const map of treeMaps) {
    const event = tx.changed.get(map as unknown as AnyYType);
    if (event === undefined) continue;
    for (const key of event) {
      if (key !== null) dirtyIds.add(key as BlockId);
    }
  }
  const memo = new Map<AnyYType, BlockId | null>();
  for (const [type] of tx.changedParentTypes) {
    const owningBlockId = findOwningBlockIdMemoized(type, treeMapSet, memo);
    if (owningBlockId !== null) dirtyIds.add(owningBlockId);
  }
  return dirtyIds;
}

/**
 * Non-memoized parent-chain walk. Called only by `findOwningBlockIdForTest`
 * — production path inside `runTransaction` uses `findOwningBlockIdMemoized`,
 * which amortizes shared ancestors across one transaction's
 * `changedParentTypes` iteration.
 *
 * Walks up the Y type parent chain to find the BlockId that owns `type`,
 * i.e. the key under one of the tree maps (`treeMapSet`) whose value is an
 * ancestor of `type`. Returns null if `type` is not nested under any of them.
 *
 * **O(depth) per call** — no linear scan of the outer map. Once we reach a
 * `cursor` whose `parent` is a tree map, `cursor` is the block-level Y.Map
 * and its insertion key is recovered via `getParentSubKey` (see that helper
 * for the Yjs-internal `_item.parentSub` rationale + version pin).
 */
function findOwningBlockId(
  type: AnyYType,
  treeMapSet: ReadonlySet<AnyYType>,
): BlockId | null {
  let cursor: AnyYType | null = type;
  while (cursor !== null) {
    const parent = cursor.parent as AnyYType | null;
    if (parent !== null && treeMapSet.has(parent)) {
      // `cursor` is the block-level Y.Map; recover its key in the outer map.
      return getParentSubKey(cursor);
    }
    cursor = parent;
  }
  return null;
}

/**
 * Test-only export of `findOwningBlockId` for direct perf measurement.
 * `treeMapsAsAny` is the list of tree maps cast to the YEvent-keyed type
 * (e.g. `getTreeMaps(doc).map(m => m as unknown as ...)`). Production code
 * path is via `runTransaction`; do not import this from non-test files.
 */
export function findOwningBlockIdForTest(
  treeMapsAsAny: readonly AnyYType[],
  type: AnyYType,
): BlockId | null {
  return findOwningBlockId(type, new Set(treeMapsAsAny));
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
  treeMapSet: ReadonlySet<AnyYType>,
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
    if (parent !== null && treeMapSet.has(parent)) {
      resolved = getParentSubKey(cursor);
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
