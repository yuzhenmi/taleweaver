/**
 * `MarkIndex` — per `Y.Doc`, in memory, derived, never synced: BlockId → its live
 * mark Items (indexed under the `end` id, and a section-end also under its `section`
 * id), plus the live section-end items.
 *
 * Built once when a doc is first bound (a scan of every flow, O(doc) — the same
 * order as decoding the update itself). Ops update it EAGERLY inside their
 * transaction ({@link indexMark} / {@link unindexMark}) so composed in-tx steps see
 * their own writes; an `afterTransaction` pass ({@link reconcileTransaction})
 * reconciles from the transaction's new structs (`beforeState` → `afterState`) and
 * deleted structs — O(changed), idempotent, and the only path for remote and undo
 * transactions. Undo/redo creates new structs, so restored marks are indexed like
 * any insert; nothing reads `Item.redone`.
 *
 * The same pass runs the second-Yjs-instance check: every new struct must be an
 * instance of THIS module's `Y.Item` / `Y.GC`; a struct decoded by a foreign Yjs copy
 * is not, and marks the doc incompatible ({@link foreignStructSeen}).
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { getRegistry, entryFlow } from "./registry";
import { allPiecesDeep, markOf, inDeletedFlow, isPiece, invalidatePiece } from "./y-flow";

/**
 * Section-walk memos (valid while the section-ends are unchanged): the section of a
 * root-flow item, and each section's neighbouring boundary items keyed by its end item
 * (null = the final section).
 */
export interface SectionMemo {
  readonly parents: Map<Y.Item, string>;
  readonly bounds: Map<Y.Item | null, { readonly prev: Y.Item | null; readonly next: Y.Item | null }>;
}

export function newSectionMemo(): SectionMemo {
  return { parents: new Map(), bounds: new Map() };
}

function clearSections(idx: MarkIndex): void {
  idx.sections.parents.clear();
  idx.sections.bounds.clear();
}

export interface MarkIndex {
  /** Live mark items per block id — `end` ids and `section` ids (duplicates possible: concurrent undo / move). */
  readonly marks: Map<string, Set<Y.Item>>;
  /** Live section-end items (a ¶ carrying `section`). */
  readonly sectionMarks: Set<Y.Item>;
  /** Transactions already reconciled (idempotence across listeners). */
  readonly reconciled: WeakSet<Y.Transaction>;
  /** Set once a struct from a second Yjs instance is seen. */
  foreign: boolean;
  /** Section derivations of the current version; cleared when a section-end changes. */
  readonly sections: SectionMemo;
  readonly gridCache: Map<string, unknown>;
}

const indexes = new WeakMap<Y.Doc, MarkIndex>();

/** The doc's index, built by a full scan on first use. */
export function getMarkIndex(doc: Y.Doc): MarkIndex {
  let idx = indexes.get(doc);
  if (idx !== undefined) return idx;
  idx = {
    marks: new Map(),
    sectionMarks: new Set(),
    reconciled: new WeakSet(),
    foreign: false,
    sections: newSectionMemo(),
    gridCache: new Map(),
  };
  indexes.set(doc, idx);
  const built = idx;
  for (const entry of getRegistry(doc).values()) {
    const flow = entryFlow(entry);
    if (flow === null) continue;
    for (const piece of allPiecesDeep(flow)) {
      for (let it = piece._start; it !== null; it = it.right) {
        if (!it.deleted && markOf(it) !== null) addMark(built, it);
      }
    }
  }
  doc.on("afterTransaction", (tx: Y.Transaction) => reconcileTransaction(doc, tx));
  return built;
}

function addTo(idx: MarkIndex, id: string, item: Y.Item): void {
  let set = idx.marks.get(id);
  if (set === undefined) {
    set = new Set();
    idx.marks.set(id, set);
  }
  set.add(item);
}

function removeFrom(idx: MarkIndex, id: string, item: Y.Item): void {
  const set = idx.marks.get(id);
  if (set === undefined) return;
  set.delete(item);
  if (set.size === 0) idx.marks.delete(id);
}

function addMark(idx: MarkIndex, item: Y.Item): void {
  const m = markOf(item);
  if (m === null) return;
  addTo(idx, m.end, item);
  if (m.section !== undefined) {
    addTo(idx, m.section, item);
    idx.sectionMarks.add(item);
    clearSections(idx);
  }
}

function removeMark(idx: MarkIndex, item: Y.Item): void {
  const m = markOf(item);
  if (m === null) return;
  removeFrom(idx, m.end, item);
  if (m.section !== undefined) removeFrom(idx, m.section, item);
  if (idx.sectionMarks.delete(item)) clearSections(idx);
}

/** Eagerly index a mark an op just inserted. */
export function indexMark(doc: Y.Doc, item: Y.Item): void {
  const idx = getMarkIndex(doc);
  addMark(idx, item);
}

/** Eagerly un-index a mark an op just deleted. */
export function unindexMark(doc: Y.Doc, item: Y.Item): void {
  const idx = getMarkIndex(doc);
  removeMark(idx, item);
}

/** Live mark items of `id` (empty when none). */
export function liveMarks(doc: Y.Doc, id: string): ReadonlySet<Y.Item> {
  return getMarkIndex(doc).marks.get(id) ?? EMPTY;
}
const EMPTY: ReadonlySet<Y.Item> = new Set();

/** Item-id order: client, then clock. */
export function compareItems(a: Y.Item, b: Y.Item): number {
  return a.id.client - b.id.client || a.id.clock - b.id.clock;
}

/** The canonical live mark of `id`: the smallest Item id. */
export function canonicalMark(doc: Y.Doc, id: string): Y.Item | null {
  let best: Y.Item | null = null;
  for (const it of liveMarks(doc, id)) {
    if (best === null || compareItems(it, best) < 0) best = it;
  }
  return best;
}

/** True when the doc has seen a struct from a second Yjs instance. */
export function foreignStructSeen(doc: Y.Doc): boolean {
  return indexes.get(doc)?.foreign ?? false;
}

/** The changed structs of one transaction: new items + deleted items. */
export interface TransactionStructs {
  readonly inserted: readonly Y.Item[];
  readonly deleted: readonly Y.Item[];
}

const structsMemo = new WeakMap<Y.Transaction, TransactionStructs>();

/** The transaction's new and deleted Items (memoized per transaction). O(changed). */
export function transactionStructs(tx: Y.Transaction): TransactionStructs {
  const memo = structsMemo.get(tx);
  if (memo !== undefined) return memo;
  const inserted: Y.Item[] = [];
  const deleted: Y.Item[] = [];
  const store = tx.doc.store;
  tx.afterState.forEach((clock, client) => {
    const before = tx.beforeState.get(client) ?? 0;
    if (clock <= before) return;
    const structs = store.clients.get(client);
    if (structs === undefined) return;
    for (let i = Y.findIndexSS(structs, before); i < structs.length; i++) {
      const s = structs[i];
      if (s === undefined || s.id.clock >= clock) break;
      if (s instanceof Y.Item) inserted.push(s);
      else if (!(s instanceof Y.GC)) markForeign(tx.doc);
    }
  });
  Y.iterateDeletedStructs(tx, tx.deleteSet, (s) => {
    if (s instanceof Y.Item) deleted.push(s);
  });
  const out = { inserted, deleted };
  structsMemo.set(tx, out);
  return out;
}

function markForeign(doc: Y.Doc): void {
  const idx = indexes.get(doc);
  if (idx !== undefined) idx.foreign = true;
}

type Hook = (doc: Y.Doc, tx: Y.Transaction) => void;
const reconcileHooks: Hook[] = [];
const clearHooks: ((doc: Y.Doc) => void)[] = [];

/** Run `hook` after the index reconciles each transaction (derived caches: the locators). */
export function addReconcileHook(hook: Hook): void {
  reconcileHooks.push(hook);
}

/** Run `hook` whenever {@link clearDerivedCaches} runs. */
export function addClearHook(hook: (doc: Y.Doc) => void): void {
  clearHooks.push(hook);
}

/** Reconcile the index from one transaction's structs. Idempotent. */
export function reconcileTransaction(doc: Y.Doc, tx: Y.Transaction): void {
  const idx = indexes.get(doc);
  if (idx === undefined || idx.reconciled.has(tx)) return;
  idx.reconciled.add(tx);
  const { inserted, deleted } = transactionStructs(tx);
  for (const it of [...inserted, ...deleted]) {
    if (isPiece(it.parent)) invalidatePiece(it.parent);
  }
  for (const it of inserted) {
    if (it.deleted || markOf(it) === null) continue;
    if (!isPiece(it.parent) || inDeletedFlow(it)) continue;
    addMark(idx, it);
  }
  const reg: unknown = getRegistry(doc);
  for (const it of deleted) {
    if (markOf(it) !== null) removeMark(idx, it);
    // A section entry appearing / vanishing changes which ¶s end a section.
    else if (it.parent === reg && isSectionContent(it)) clearSections(idx);
  }
  for (const it of inserted) if (it.parent === reg && isSectionContent(it)) clearSections(idx);
  idx.gridCache.clear();
  for (const h of reconcileHooks) h(doc, tx);
}

/** The raw `shape` value of registry struct `it` (read raw: a deleted entry still holds its content before GC). */
export function rawEntryShape(it: Y.Item): unknown {
  const c = it.content;
  if (!(c instanceof Y.ContentType) || !(c.type instanceof Y.Map)) return undefined;
  return c.type._map.get("shape")?.content.getContent()[0];
}

/** True iff registry struct `it` holds a section entry. */
function isSectionContent(it: Y.Item): boolean {
  return rawEntryShape(it) === "section";
}

/** Clear every derived cache (used when an op reshapes a grid in-tx). */
export function clearDerivedCaches(doc: Y.Doc): void {
  const idx = getMarkIndex(doc);
  clearSections(idx);
  idx.gridCache.clear();
  for (const h of clearHooks) h(doc);
}

export type { BlockId };
