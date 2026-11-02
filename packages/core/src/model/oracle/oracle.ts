/**
 * The randomized multi-peer oracle (r7 §10, build plan P1). One seed = one run of
 * N peers (1 = a single-user run; 3 = concurrency) × `steps` steps. Each step one peer
 * runs a random M2 command at a random (or its current) selection, or undo / redo,
 * through {@link ModelHistory}; then a random partial, shuffled subset of the pending
 * updates is delivered to a random peer (occasionally a full sync). After every
 * applied transaction, on the peer that applied it:
 *
 *   - O2 validity: the version's trees are consistent (parents, sibling chains,
 *     children reachable once, ids unique across trees); every paragraph's first and
 *     last offsets resolve; the step's Plan was built without throwing (and every
 *     10th step, 8 random planners on random selections);
 *   - O3 no repair: every transaction that changed storage is this peer's command
 *     (its editor origin, inside `history.apply`), its undo / redo (its UndoManager,
 *     inside `history.undo` / `redo`), a remote apply, or Yjs format cleanup (X26,
 *     {@link isFormatCleanup});
 *   - O4 incremental == from scratch;
 *   - O7 / O5(a) / O6: the flow's storage is walked (tombstones included) for read-rule
 *     firings — debris (R2: a non-empty run ended by a TOC, `[S]` or the flow end),
 *     abutting objects (R1's empty run: a TOC followed by a TOC, `[S]` or the end),
 *     `[S][S]` / a leading `[S]` / a trailing `[S]` (A2, R4), an empty holder (R17).
 *     Single-peer runs: any firing fails (O5(a), W1 / W2 / A1 / A2). Multi-peer runs:
 *     every firing is classified from the run's log ({@link classify}) and counted for
 *     the report only — unclassified, UNLISTED-restore, A1 / A2 shapes and firings left
 *     after the full sync included (Q-adj, accepted 2026-11-02: the read rules read
 *     them validly and they converge).
 *
 * Single-peer runs also check O5(c) / (d): every undo reads exactly (without ids) as
 * the state before the entry and restores its selection; every redo reads as the state
 * after it and restores the selection after. Multi-peer runs check that undo / redo
 * return a selection that resolves. Every run checks the undo grouping: each command's
 * effect on the undo stack matches the coalescing rule computed here, independently of
 * {@link ModelHistory} (and single-peer undo / redo move exactly one entry). Around
 * every undo / redo the peer's doc, read from scratch, is compared with a replica of
 * its own encoded state (O1, early).
 *
 * Stock Yjs 13.6.30's UndoManager is known inexact (accepted 2026-11-02, unpatched).
 * After an undo / redo, O2 / O3 / O4 run first and always fail hard. Then two cases are
 * reported in {@link SeedResult.yjsUndo} (the `yjs-undo` bucket) instead of failed:
 *   - O1: the doc and a replica of its encoded state (both read from scratch) differ.
 *     That peer's early O1 / O5 checks stop (no sound baseline: its in-memory doc is
 *     not its storage); the run goes on, and after the full sync the replicas are
 *     compared with each other and with the peers that did not diverge;
 *   - O5: the read differs from the expected one AND so does the storage (id-free,
 *     {@link storageOf}): Yjs restored different content. The expected stacks and the
 *     UndoManager are cleared (re-baselined). A read that differs over storage that
 *     matches, or an exact read with a wrong selection, fails.
 * After either, a single-user run's storage is Yjs's rather than its commands', so its
 * firings are no longer judged.
 *
 * After the run: a full sync; O1 every peer reads identically, and so do fresh replicas
 * built from all updates in three delivery orders (each merged into one update first:
 * applied one by one out of order, Yjs's format cleanup would write on partial states).
 *
 * Docs run with `gc: false` so tombstones keep their kinds for the classification.
 */
import { expect } from "vitest";
import * as Y from "yjs";
import { deriveDocument, type Document, type FlowState } from "../derive";
import { Model } from "../model";
import { BUILTIN_OBJECT_KINDS } from "../object-kinds";
import { ModelHistory, UNDO_COALESCE_PAUSE_MS, type EditKind, type HistoryStep } from "../history";
import { paragraphLayout, resolvePosition, type ModelSelection } from "../position";
import { KIND_KEY, ITEM_KINDS, PIECES_KEY, ROOT_MAP, SUBFLOW_DEPTH_CAP, createEditorOrigin, getDocMap, itemId } from "../storage";
import { expectSameVersion, fixture } from "../test-helpers";
import { readOf, selectionOf } from "../command-test-helpers";
import { readsAsContent } from "../scan";
import { OPTIONS, commandName, lengthOf, pick, randomCommand, resetMarkerSeq, rng, wellFormed } from "./generate";

const REMOTE = "oracle-remote";

type ActionKind = "cmd" | "undo" | "redo" | "cleanup";

/** One local transaction that changed storage. */
interface Action {
  readonly peer: number;
  readonly kind: ActionKind;
  readonly name: string;
  /** Global transaction counter (all peers). */
  readonly seq: number;
  /** The peer's state vector before the transaction. */
  readonly sv: ReadonlyMap<number, number>;
  readonly from: number;
  readonly to: number;
}

class Peer {
  readonly model: Model;
  readonly origin: symbol;
  readonly history: ModelHistory;
  selection: ModelSelection | null = null;
  clock = 0;
  /** Updates from other peers not yet applied here. */
  readonly inbox: Uint8Array[] = [];
  /** Item (per character) → the global seq at which this peer first saw it deleted. */
  readonly deletedSeen = new Map<string, number>();
  /** Inside `history.apply` (O3: only then may this peer's editor origin write). */
  applying = false;
  /** Inside `history.undo` / `redo`: what its UndoManager transaction is (O3: only then may it write). */
  stepping: "undo" | "redo" | null = null;
  /** A yjs-undo O1 event happened here: its in-memory doc is not its storage; its early O1 / O5 checks stop. */
  diverged = false;
  /** The expected undo grouping (computed here, not read from ModelHistory): the open entry's kind and last edit time. */
  expOpen: EditKind | null = null;
  expLast = 0;
  /** The command being applied (log label). */
  label = "";
  /** An O3 violation seen inside a Yjs event handler, thrown after the call. */
  o3: string | null = null;

  constructor(
    readonly index: number,
    readonly doc: Y.Doc,
  ) {
    this.model = new Model(doc);
    this.origin = createEditorOrigin(`peer-${index}`);
    this.history = new ModelHistory(this.model, this.origin, () => this.clock);
  }
}

/** A firing of a read rule (or an A1 / A2 / W2 break) in one flow's storage. */
export interface Firing {
  readonly type: "debris" | "abut" | "SS" | "leadingS" | "trailingS" | "empty";
  /** What ends it: a TOC, an `[S]`, or the flow end. */
  readonly end: "toc" | "S" | "end";
  readonly where: string;
  /** Live units on its left: the debris run's units (per character), or the object / `[S]` before the gap. */
  readonly left: readonly Y.ID[];
  /** The TOC / `[S]` that ends it (null at the flow end). */
  readonly right: Y.ID | null;
  /** Deleted ¶s between the left boundary and the right. */
  readonly gap: readonly string[];
  /** Identity across undo / redo: its type, end and right unit, with restored items mapped to the items they restore (Yjs `redone`). */
  readonly key: string;
}

const idKey = (id: Y.ID): string => `${id.client}:${id.clock}`;

/**
 * An embedded map's `k`, read from its entry even when the map (and so the entry) is deleted.
 * Test-only Yjs introspection outside the X14 list: `Y.Map._map`.
 */
function rawKind(m: Y.Map<unknown>): string {
  const it = m._map.get(KIND_KEY);
  const v: unknown = it === undefined ? undefined : it.content.getContent()[0];
  return typeof v === "string" ? v : "";
}

/**
 * The read-rule firings of one flow, from its storage with tombstones (docs run with
 * `gc: false`, so a deleted ¶ keeps its kind). `restores` (restored item id → the item it
 * restores) is read and extended from Yjs's `redone` links, which only the undoing peer has.
 */
export function firingsOf(fs: FlowState, restores: Map<string, string> = new Map()): Firing[] {
  const out: Firing[] = [];
  const canon = (id: string): string => {
    let cur = id;
    for (let next = restores.get(cur); next !== undefined; next = restores.get(cur)) cur = next;
    return cur;
  };
  const pending: Omit<Firing, "key">[] = [];
  type Boundary = { k: "start" | "para" | "toc" | "S"; id: Y.ID | null };
  let left: Boundary = { k: "start", id: null };
  let run: Y.ID[] = [];
  let gap: string[] = [];
  let any = false;
  const where = fs.holderId;
  const terminate = (k: "toc" | "S" | "end", id: Y.ID | null): void => {
    const leftIds = left.id === null ? [] : [left.id];
    if (run.length > 0) pending.push({ type: "debris", end: k, where, left: run, right: id, gap });
    else if (left.k === "toc") pending.push({ type: "abut", end: k, where, left: leftIds, right: id, gap });
    else if (k === "S" && left.k === "S") pending.push({ type: "SS", end: k, where, left: leftIds, right: id, gap });
    else if (k === "S" && left.k === "start") pending.push({ type: "leadingS", end: k, where, left: leftIds, right: id, gap });
    else if (k === "end" && left.k === "S") pending.push({ type: "trailingS", end: k, where, left: leftIds, right: id, gap });
    else if (k === "end" && !any) pending.push({ type: "empty", end: k, where, left: [], right: null, gap });
  };
  const visit = (piece: Y.Text, depth: number): void => {
    for (let it = piece._start; it !== null; it = it.right) {
      const c = it.content;
      // Test-only Yjs introspection outside the X14 list: `Item.redone` (the item an undo / redo restored it as).
      if (it.redone !== null) restores.set(idKey(it.redone), idKey(it.id));
      if (c instanceof Y.ContentString) {
        if (it.deleted) continue;
        for (let k = 0; k < it.length; k++) run.push(Y.createID(it.id.client, it.id.clock + k));
        continue;
      }
      if (!(c instanceof Y.ContentType) || !(c.type instanceof Y.Map)) continue;
      const m = c.type;
      const kind = rawKind(m);
      if (it.deleted) {
        if (kind === ITEM_KINDS.para) gap.push(itemId(it));
        continue;
      }
      if (kind === ITEM_KINDS.sub) {
        const arr = m.get(PIECES_KEY);
        if (depth < SUBFLOW_DEPTH_CAP && arr instanceof Y.Array) for (const p of arr.toArray()) if (p instanceof Y.Text) visit(p, depth + 1);
        continue;
      }
      if (kind === ITEM_KINDS.para) {
        any = true;
        left = { k: "para", id: it.id };
        run = [];
        gap = [];
      } else if (kind === ITEM_KINDS.toc || kind === ITEM_KINDS.sectionBreak) {
        any = true;
        const k = kind === ITEM_KINDS.toc ? "toc" : "S";
        terminate(k, it.id);
        left = { k, id: it.id };
        run = [];
        gap = [];
      } else if (readsAsContent(m, fs.tree === "block")) run.push(it.id);
    }
  };
  for (const p of fs.array?.toArray() ?? []) if (p instanceof Y.Text) visit(p, 0);
  terminate("end", null);
  for (const f of pending) out.push({ ...f, key: `${f.type}:${f.end}:${f.right === null ? f.where : canon(idKey(f.right))}` });
  return out;
}

/** Shapes A1 / A2 claim unreachable except by Q1 (O7). */
const A1A2 = (f: Firing): boolean => f.type === "SS" || f.type === "leadingS" || f.type === "trailingS" || f.type === "empty" || (f.type === "abut" && f.end !== "toc") || (f.type === "debris" && f.end === "end");

/** One flow's storage with tombstones, for failure reports: `text@id`, `¶id`, `[toc id]`, `[S id]`, `†` = deleted, `|` between pieces, `{…}` a sub-flow. */
function storageLine(fs: FlowState): string {
  const parts: string[] = [];
  const visit = (piece: Y.Text): void => {
    parts.push("|");
    for (let it = piece._start; it !== null; it = it.right) {
      const c = it.content;
      const del = it.deleted ? "†" : "";
      if (c instanceof Y.ContentString) parts.push(`${JSON.stringify(c.str)}@${idKey(it.id)}${del}`);
      else if (c instanceof Y.ContentType && c.type instanceof Y.Map) {
        const k = rawKind(c.type);
        if (k === ITEM_KINDS.sub) {
          parts.push(`{${del}`);
          const arr = c.type.get(PIECES_KEY);
          if (arr instanceof Y.Array) for (const p of arr.toArray()) if (p instanceof Y.Text) visit(p);
          parts.push("}");
        } else parts.push(`${k === ITEM_KINDS.para ? "¶" : `[${k} `}${idKey(it.id)}${k === ITEM_KINDS.para ? "" : "]"}${del}`);
      }
    }
  };
  for (const p of fs.array?.toArray() ?? []) if (p instanceof Y.Text) visit(p);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// The run's log and quirk classification (O6)
// ---------------------------------------------------------------------------

class Log {
  readonly actions: Action[] = [];
  /** Item key (per character) → the actions that deleted it. */
  readonly deletedBy = new Map<string, Action[]>();
  /** Restored item id → the item an undo / redo restored (from the undoing peer's `redone` links). */
  readonly restores = new Map<string, string>();
  seq = 0;

  creator(id: Y.ID): Action | null {
    for (const a of this.actions) if (a.peer + 1 === id.client && id.clock >= a.from && id.clock < a.to) return a;
    return null;
  }
}

const knows = (a: Action, id: Y.ID): boolean => (a.sv.get(id.client) ?? 0) > id.clock;
const isHistory = (a: Action | null): boolean => a !== null && (a.kind === "undo" || a.kind === "redo");

/**
 * The class of a firing, from the log; null when none applies (unclassified — K-f).
 * In order:
 *   - restored: an undo / redo re-created a firing already classified (same key);
 *   - `transient`: a causal gap at this peer — a unit's author, or a gap ¶'s deleter,
 *     had seen a unit here deleted that this peer has not (deletes carry no clock, so
 *     Yjs may apply a later insert first); it ends on delivery;
 *   - Q1 both-undo: `[T][T]` / `[S][S]` whose two items two peers' undo / redo restored;
 *   - same-spot concurrency (r7 §10 O6): a gap ¶'s deletion raced a unit's insertion
 *     (neither side had seen the other), two units were inserted concurrently by two
 *     peers, or an undo / redo restored a unit whose deletion had raced another unit's
 *     insertion. Debris → Q2; a TOC followed by a TOC → Q3; other shapes `CONC`
 *     (an A1 / A2 shape is reported as O7-BREAK);
 *   - Q18 (sequential, not rare; incl. G3 / G7's widening): an undo / redo deleted a
 *     gap ¶ after another peer put a unit there (the deleter had seen everything);
 *   - `UNLISTED-restore` (reported): a sequential undo / redo restored units around
 *     another peer's unit.
 */
function classify(f: Firing, peers: readonly Peer[], log: Log, earlier: ReadonlyMap<string, string>): string | null {
  const right = f.right;
  const units = right === null ? f.left : [...f.left, right];
  // An undo / redo restored a firing already classified (Yjs restores exactly; the restored items have new ids).
  const before = earlier.get(f.key);
  if (before !== undefined && !before.startsWith("transient")) return before;
  // A causal gap at this peer: a unit's author had seen another unit deleted, but this peer has not received that
  // deletion yet (deletes carry no clock, so Yjs may apply a later insert first). Transient: it ends on delivery.
  for (const x of units) {
    const b = log.creator(x);
    const seen = b === null ? undefined : peers[b.peer]?.deletedSeen;
    if (b !== null && seen !== undefined && units.some((y) => (seen.get(idKey(y)) ?? Infinity) < b.seq)) return `transient:${f.type}-${f.end}`;
  }
  // …or a gap ¶'s deleter had seen a unit here deleted (it joined across an object it saw removed).
  for (const c of f.gap) {
    for (const a of log.deletedBy.get(c) ?? []) {
      const seen = peers[a.peer]?.deletedSeen;
      if (seen !== undefined && units.some((y) => (seen.get(idKey(y)) ?? Infinity) < a.seq)) return `transient:${f.type}-${f.end}`;
    }
  }
  const label = f.type === "debris" && f.end !== "end" ? "Q2" : f.type === "abut" && f.end === "toc" ? "Q3" : null;
  if ((f.type === "abut" || f.type === "SS") && right !== null && f.left.length === 1) {
    const l = f.left[0];
    const a = l === undefined ? null : log.creator(l);
    const b = log.creator(right);
    if (a !== null && b !== null && isHistory(a) && isHistory(b) && a.peer !== b.peer) return `Q1:${f.type}`;
  }
  // Same-spot concurrency: a gap ¶'s deletion raced a unit's insertion (neither side had seen the other), or two
  // units were inserted concurrently by two peers.
  const concurrent = (): boolean => {
    for (const c of f.gap) {
      for (const a of log.deletedBy.get(c) ?? []) {
        for (const x of units) {
          const ins = log.creator(x);
          const insSeen = ins === null ? undefined : peers[ins.peer]?.deletedSeen.get(c);
          if (!knows(a, x) && ins !== null && (insSeen === undefined || insSeen >= ins.seq)) return true;
        }
      }
    }
    for (const x of units) {
      for (const y of units) {
        const a = log.creator(x);
        const b = log.creator(y);
        if (a !== null && b !== null && a.peer !== b.peer && !knows(a, y) && !knows(b, x)) return true;
      }
    }
    return false;
  };
  if (concurrent()) return `${label ?? "CONC"}:${f.type}-${f.end}`;
  for (const c of f.gap) {
    for (const a of log.deletedBy.get(c) ?? []) {
      if (isHistory(a) && units.every((x) => knows(a, x)) && units.some((x) => (log.creator(x)?.peer ?? a.peer) !== a.peer)) return `Q18:${f.type}-${f.end}:${a.kind}`;
    }
  }
  // An undo / redo restored a unit whose deletion had raced another unit's insertion: the race re-materializes.
  for (const x of units) {
    const a = log.creator(x);
    if (a === null || !isHistory(a)) continue;
    let o = idKey(x);
    for (let next = log.restores.get(o); next !== undefined; next = log.restores.get(o)) o = next;
    for (const d of log.deletedBy.get(o) ?? []) {
      for (const y of units) {
        const b = y === x ? null : log.creator(y);
        if (b !== null && b.peer !== d.peer && !knows(d, y)) return `${label ?? "CONC"}:${f.type}-${f.end}:restored`;
      }
    }
  }
  // UNLISTED (reported): an undo / redo RESTORED units around another peer's unit (sequential).
  for (const x of units) {
    const a = log.creator(x);
    if (a !== null && isHistory(a) && units.every((y) => knows(a, y) || log.creator(y) === a) && units.some((y) => (log.creator(y)?.peer ?? a.peer) !== a.peer)) return `UNLISTED-restore:${f.type}-${f.end}:${a.kind}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// O2 validity
// ---------------------------------------------------------------------------

function expectValid(d: Document): void {
  const seen = new Set<string>();
  for (const tree of ["block", "embedContent", "templateContent"] as const) {
    const t = d.trees[tree];
    for (const [id, b] of t.entries()) {
      if (seen.has(id)) throw new Error(`O2: id ${id} in two trees`);
      seen.add(id);
      if (b.parentId === null) continue;
      const parent = t.get(b.parentId);
      if (parent === undefined) throw new Error(`O2: ${id}'s parent ${b.parentId} is missing`);
      if ((b.prevSiblingId === null ? parent.firstChildId : t.get(b.prevSiblingId)?.nextSiblingId) !== id) throw new Error(`O2: ${id}'s prev link is broken`);
      if ((b.nextSiblingId === null ? parent.lastChildId : t.get(b.nextSiblingId)?.prevSiblingId) !== id) throw new Error(`O2: ${id}'s next link is broken`);
      if (b.inlineContent !== null) {
        const len = lengthOf(d, id);
        for (const offset of [0, len]) if (resolvePosition(d, { blockId: id, offset }) === null) throw new Error(`O2: ${id}:${offset} does not resolve`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface SeedResult {
  /** Classified quirk instances (distinct firings), by label. */
  readonly quirks: ReadonlyMap<string, number>;
  /** Known Yjs UndoManager inexactness at an undo / redo step (the `yjs-undo` bucket): `seed S step N peer P undo|redo: O1|O5`. */
  readonly yjsUndo: readonly string[];
}

function shuffle<T>(r: () => number, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const a = xs[i];
    const b = xs[j];
    if (a === undefined || b === undefined) continue;
    xs[i] = b;
    xs[j] = a;
  }
  return xs;
}

/**
 * X26: Yjs's format cleanup — after a remote apply (`cleanupYTextAfterTransaction`), and
 * whenever a `YTextEvent.delta` is read (the getter deletes redundant format items; the
 * model reads every piece's delta for D8's exact mapping, so this also follows local
 * undo / redo) — runs in its own origin-null transaction that inserts nothing and
 * deletes only format items.
 */
function isFormatCleanup(tr: Y.Transaction): boolean {
  for (const [c, k] of tr.afterState) if ((tr.beforeState.get(c) ?? 0) !== k) return false;
  let ok = true;
  Y.iterateDeletedStructs(tr, tr.deleteSet, (s) => {
    if (!(s instanceof Y.Item) || !(s.content instanceof Y.ContentFormat)) ok = false;
  });
  return ok;
}

function changed(tr: Y.Transaction): boolean {
  if (tr.deleteSet.clients.size > 0) return true;
  for (const [c, k] of tr.afterState) if ((tr.beforeState.get(c) ?? 0) !== k) return true;
  return false;
}

interface Snap {
  readonly read: unknown;
  readonly sel: string;
  /** {@link storageOf} the doc. */
  readonly storage: unknown;
}

/**
 * Live storage without ids: pieces as deltas (embedded types recursed), maps by key, arrays in order. What an undo's
 * delete filter keeps (X17) is dropped when empty: empty pieces, and sub-flows whose pieces are all empty.
 */
function storageOf(v: unknown): unknown {
  if (v instanceof Y.Text) {
    const ops: { insert?: unknown }[] = v.toDelta();
    return ops.flatMap((op) => {
      const pieces = op.insert instanceof Y.Map ? op.insert.get(PIECES_KEY) : undefined;
      return pieces instanceof Y.Array && isEmptyArray(storageOf(pieces)) ? [] : [{ ...op, insert: storageOf(op.insert) }];
    });
  }
  if (v instanceof Y.Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, storageOf(x)]));
  if (v instanceof Y.Array) {
    return v.toArray().flatMap((x) => {
      const y = storageOf(x);
      return x instanceof Y.Text && isEmptyArray(y) ? [] : [y];
    });
  }
  return v;
}

const isEmptyArray = (x: unknown): boolean => Array.isArray(x) && x.length === 0;

/** `toEqual` as a boolean. */
function sameRead(a: unknown, b: unknown): boolean {
  try {
    expect(a).toEqual(b);
    return true;
  } catch {
    return false;
  }
}

/** A selection snapped to caret positions (R14–R16), as restored selections are. */
function snapped(d: Document, sel: ModelSelection): ModelSelection {
  return { anchor: resolvePosition(d, sel.anchor, OPTIONS) ?? sel.anchor, focus: resolvePosition(d, sel.focus, OPTIONS) ?? sel.focus };
}

const resolves = (d: Document, sel: ModelSelection): boolean => paragraphLayout(d, sel.anchor.blockId) !== null && paragraphLayout(d, sel.focus.blockId) !== null;

const describeAction = (a: Action | null): string => (a === null ? "setup" : `peer ${a.peer} ${a.kind}${a.name === a.kind ? "" : ` ${a.name}`} @${a.seq} sv ${[...a.sv].map(([c, k]) => `${c}:${k}`).join(" ")}`);

/** The log behind a firing: who made each unit, who deleted each gap ¶. */
function explain(f: Firing, log: Log): string {
  const units = f.right === null ? f.left : [...f.left, f.right];
  return [
    ...log.actions.map((a) => `  ${describeAction(a)}`),
    ...units.map((x) => `  unit ${idKey(x)} by ${describeAction(log.creator(x))}`),
    ...f.gap.map((c) => `  gap ¶ ${c} made by ${describeAction(log.creator(Y.createID(Number(c.split(":")[0]), Number(c.split(":")[1]))))}, deleted by ${(log.deletedBy.get(c) ?? []).map(describeAction).join("; ")}`),
  ].join("\n");
}

const describeFiring = (f: Firing): string => `${f.type} before ${f.end} in ${f.where} (left ${f.left.map(idKey).join(",")}, right ${f.right === null ? "-" : idKey(f.right)}, gap ${f.gap.join(",")})`;

/**
 * One seed. Multi-peer firings are counted by class in `quirks` (labels include `UNCLASSIFIED:*`,
 * `UNLISTED-restore:*`, `CONC:*`, `O7-BREAK:*`, and `FINAL:*` for firings left after the
 * full sync); they never fail the run.
 */
export function runSeed(seed: number, peerCount: number, steps: number): SeedResult {
  const r = rng(seed * 2654435761);
  resetMarkerSeq();
  const single = peerCount === 1;
  const log = new Log();
  const first = fixture(1, undefined, false);
  const all: Uint8Array[] = [Y.encodeStateAsUpdate(first.doc)];
  const peers: Peer[] = [];
  for (let i = 0; i < peerCount; i++) peers.push(new Peer(i, i === 0 ? first.doc : fixture(i + 1, first.doc, false).doc));
  const quirks = new Map<string, number>();
  /** Firing key → its classification (transient ones are re-classified when seen again). */
  const classified = new Map<string, string>();
  const yjsUndo: string[] = [];

  for (const p of peers) {
    p.doc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      all.push(u);
      for (const q of peers) if (q !== p) q.inbox.push(u);
    });
    p.doc.on("afterTransaction", (tr: Y.Transaction) => {
      if (!changed(tr)) return;
      const seq = ++log.seq;
      const maps: string[] = [];
      Y.iterateDeletedStructs(tr, tr.deleteSet, (s) => {
        if (!(s instanceof Y.Item)) return;
        for (let i = 0; i < s.length; i++) {
          const k = `${s.id.client}:${s.id.clock + i}`;
          if (!p.deletedSeen.has(k)) p.deletedSeen.set(k, seq);
          maps.push(k);
        }
      });
      if (tr.origin === REMOTE) return;
      let kind: ActionKind;
      if (tr.origin === p.origin && p.applying) kind = "cmd";
      else if (tr.origin instanceof Y.UndoManager && p.stepping !== null) kind = p.stepping;
      else if (tr.origin === null && isFormatCleanup(tr)) kind = "cleanup";
      else {
        const ins: string[] = [];
        for (const [c, k] of tr.afterState) if ((tr.beforeState.get(c) ?? 0) !== k) ins.push(`${c}:${tr.beforeState.get(c) ?? 0}..${k}`);
        const dels: string[] = [];
        Y.iterateDeletedStructs(tr, tr.deleteSet, (x) => dels.push(`${x.constructor.name}/${x instanceof Y.Item ? x.content.constructor.name : ""}@${idKey(x.id)}`));
        p.o3 = `O3: peer ${p.index} wrote outside a command / undo / remote apply / format cleanup (origin ${String(tr.origin)}, inserted ${ins.join(" ")}, deleted ${dels.join(" ")})`;
        return;
      }
      const me = p.doc.clientID;
      const a: Action = { peer: p.index, kind, name: kind === "cmd" ? p.label : kind, seq, sv: new Map(tr.beforeState), from: tr.beforeState.get(me) ?? 0, to: tr.afterState.get(me) ?? 0 };
      log.actions.push(a);
      for (const k of maps) log.deletedBy.set(k, [...(log.deletedBy.get(k) ?? []), a]);
    });
  }

  /** O2 / O3 / O4 on peer `p` after a transaction it applied: never bucketed. */
  const checkModel = (p: Peer): void => {
    if (p.o3 !== null) throw new Error(p.o3);
    const d = p.model.version;
    expectSameVersion(d, deriveDocument(p.doc, BUILTIN_OBJECT_KINDS));
    expectValid(d);
  };
  /** {@link checkModel}, then O5(a) / O6 / O7. */
  const check = (p: Peer): void => {
    checkModel(p);
    judge(p.model.version, false);
  };

  /**
   * O5(a) on every flow of `d`; multi-peer firings are classified and counted (`final`: after a full sync, as
   * `FINAL:*`). A single-user run fails on any firing — until a yjs-undo event: its storage is then Yjs's, not its
   * commands', and firings are no longer judged.
   */
  const judge = (d: Document, final: boolean): void => {
    for (const [, fs] of d.flows.entries()) {
      const fl = firingsOf(fs, log.restores);
      if ((fl.length === 0) !== wellFormed(fs)) throw new Error(`oracle: the storage walk and the read disagree on ${fs.holderId}`);
      for (const f of fl) {
        if (single) {
          if (yjsUndo.length === 0) throw new Error(`O5(a) / O7: single-user ${describeFiring(f)}\n${explain(f, log)}\n  storage: ${storageLine(fs)}`);
          continue;
        }
        const known = classified.get(f.key);
        if (known !== undefined && !known.startsWith("transient") && !final) continue;
        const q = classify(f, peers, log, classified);
        // Multi-peer firings are reported, never failed (Q-adj, 2026-11-02): the read rules read them validly and they converge.
        const base = q === null ? `UNCLASSIFIED:${f.type}-${f.end}` : A1A2(f) && !q.startsWith("Q1") && !q.startsWith("transient") ? `O7-BREAK:${q}` : q;
        const lab = final ? `FINAL:${base}` : base;
        if (final) quirks.set(lab, (quirks.get(lab) ?? 0) + 1);
        else if (known === undefined || lab !== known) {
          classified.set(f.key, lab);
          quirks.set(lab, (quirks.get(lab) ?? 0) + 1);
        }
      }
    }
  };

  const apply = (q: Peer, u: Uint8Array): void => {
    Y.applyUpdate(q.doc, u, REMOTE);
    check(q);
  };
  const drain = (): void => {
    for (let any = true; any; ) {
      any = false;
      for (const q of peers) {
        for (let u = q.inbox.shift(); u !== undefined; u = q.inbox.shift()) {
          apply(q, u);
          any = true;
        }
      }
    }
  };
  const fullSync = (): void => {
    drain();
    // y-protocols sync step 2: every pair exchanges a state-vector diff. Relayed updates alone can leave
    // structs pending forever in Yjs (seeds 572, 3708, 4709, 7172, 7473); the diff carries what they wait on.
    // Then drain again: a remote apply may run format cleanup (X26), a local update relayed to the others.
    for (const q of peers) for (const o of peers) if (o !== q) apply(q, Y.encodeStateAsUpdate(o.doc, Y.encodeStateVector(q.doc)));
    drain();
  };

  // Single-peer O5(c) / (d): the expected undo / redo stacks.
  const undoExp: { before: Snap; after: Snap }[] = [];
  let redoExp: { before: Snap; after: Snap }[] = [];
  const snap = (p: Peer, sel: ModelSelection): Snap => ({ read: readOf(p.model.version), sel: selectionOf(p.model.version, snapped(p.model.version, sel)), storage: storageOf(p.doc.getMap(ROOT_MAP)) });
  /**
   * O1 early: the peer's doc and a replica of its own encoded state read the same, both from scratch (the encoding
   * carries pending updates, so a peer with some may differ for that reason alone).
   */
  const matchesEncoded = (p: Peer): boolean => {
    const fresh = new Y.Doc({ gc: false });
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(p.doc));
    try {
      expectSameVersion(deriveDocument(p.doc, BUILTIN_OBJECT_KINDS), deriveDocument(fresh, BUILTIN_OBJECT_KINDS));
      return true;
    } catch {
      return false;
    }
  };
  // Test-only Yjs introspection outside the X14 list: `StructStore.pendingStructs` / `pendingDs`.
  const hasPending = (doc: Y.Doc): boolean => doc.store.pendingStructs !== null || doc.store.pendingDs !== null;

  for (let step = 0; step < steps; step++) {
    const p = pick(r, peers);
    if (p === undefined) continue;
    try {
      const u = r();
      if (u < 0.12) {
        const undo = u < 0.08;
        const mode = undo ? "undo" : "redo";
        // Before: a mismatch is a hard failure (it came from a command / remote step), unless updates are pending
        // here — then it is unknown, and the undo / redo is not judged (seed 7473).
        const judged = !p.diverged && matchesEncoded(p);
        if (!p.diverged && !judged && !hasPending(p.doc)) throw new Error(`O1: peer ${p.index}'s doc ≠ its encoded state before ${mode} (first appeared at a command / remote step)`);
        const pre = p.history.depths();
        const fromDepth = undo ? pre.undo : pre.redo;
        const toDepth = undo ? pre.redo : pre.undo;
        let res: HistoryStep | null;
        p.stepping = mode;
        try {
          res = undo ? p.history.undo() : p.history.redo();
        } finally {
          p.stepping = null;
        }
        p.expOpen = null; // undo / redo close the open entry
        // O2 / O3 / O4 first: the model must read its own storage, whatever Yjs restored.
        checkModel(p);
        // The stacks: an undo / redo that did something moves one entry (multi-peer: Yjs may first drop entries a
        // peer's edits emptied); one that did nothing emptied its stack.
        const post = p.history.depths();
        const fromNow = undo ? post.undo : post.redo;
        const toNow = undo ? post.redo : post.undo;
        if (res === null) expect([fromNow, toNow]).toEqual([0, toDepth]);
        else {
          expect(toNow).toBe(toDepth + 1);
          if (single) expect(fromNow).toBe(fromDepth - 1);
          else expect(fromNow).toBeLessThan(fromDepth);
        }
        const tag = `seed ${seed} step ${step} peer ${p.index} ${mode}`;
        if (judged && !matchesEncoded(p)) {
          yjsUndo.push(`${tag}: O1`);
          p.diverged = true;
        }
        const sel = res?.selection ?? null;
        if (single && !p.diverged) {
          const exp = (undo ? undoExp : redoExp).pop();
          if (exp === undefined) expect(res).toBeNull();
          else {
            expect(res).not.toBeNull();
            const want = undo ? exp.before : exp.after;
            const v = p.model.version;
            if (sameRead(readOf(v), want.read)) {
              // An exact read must come from exactly the expected storage and restore the selection exactly: a mismatch is
              // ours, never bucketed.
              expect(storageOf(p.doc.getMap(ROOT_MAP)), `O5: the ${mode} reads as expected from different storage`).toEqual(want.storage);
              expect(sel === null ? null : selectionOf(v, snapped(v, sel))).toBe(want.sel);
              (undo ? redoExp : undoExp).push(exp);
            } else if (sameRead(storageOf(p.doc.getMap(ROOT_MAP)), want.storage)) {
              throw new Error(`O5: the ${mode} restored the expected storage, but it reads differently`);
            } else {
              // Yjs restored different content (the yjs-undo bucket): re-baseline.
              yjsUndo.push(`${tag}: O5`);
              p.history.clear();
              undoExp.length = 0;
              redoExp = [];
            }
          }
        } else if (sel !== null) expect(resolves(p.model.version, sel)).toBe(true);
        if (sel !== null) p.selection = sel;
        judge(p.model.version, false);
      } else {
        const d = p.model.version;
        const keep = p.selection !== null && resolves(d, p.selection) && r() < 0.4 ? p.selection : undefined;
        if (keep === undefined) {
          p.history.breakCoalescing();
          p.expOpen = null;
        }
        const c = randomCommand(r, d, keep);
        if (step % 10 === 0) for (let i = 0; i < 8; i++) randomCommand(r, d); // O2: planners are total (8 random draws)
        if (c.plan !== null) {
          const depth = p.history.depths().undo;
          const before = single ? snap(p, c.ctx.selection) : null;
          p.label = commandName(c.roll);
          // The expected grouping (today's rule, computed here): an insert / delete joins the open entry of its kind
          // when less than the pause passed since its last edit; anything else closes it first — even a command
          // that then writes nothing.
          const coalesce = c.kind !== "command" && c.kind === p.expOpen && p.clock - p.expLast < UNDO_COALESCE_PAUSE_MS;
          if (!coalesce) p.expOpen = null;
          let after: ModelSelection | null;
          p.applying = true;
          try {
            after = p.history.apply(c.plan, c.kind, c.ctx.selection);
          } finally {
            p.applying = false;
          }
          expect(after).not.toBeNull();
          p.selection = after;
          const wrote = p.model.version !== d;
          if (wrote) {
            p.expOpen = c.kind === "command" ? null : c.kind;
            p.expLast = p.clock;
          }
          expect(p.history.depths().undo, "undo grouping").toBe(depth + (wrote && !coalesce ? 1 : 0));
          if (wrote) {
            expect(p.history.depths().redo).toBe(0);
            check(p);
            if (before !== null && after !== null) {
              const now = snap(p, after);
              const top = undoExp[undoExp.length - 1];
              if (!coalesce || top === undefined) undoExp.push({ before, after: now });
              else top.after = now;
              redoExp = [];
            }
          }
        }
      }
      p.clock += r() < 0.5 ? 50 : 700;
      if (!single) {
        if (r() < 0.05) fullSync();
        else {
          const q = pick(r, peers);
          if (q !== undefined && q.inbox.length > 0) {
            const batch = shuffle(r, q.inbox.splice(0, q.inbox.length));
            const n = 1 + Math.floor(r() * batch.length);
            q.inbox.push(...batch.slice(n));
            for (const x of batch.slice(0, n)) apply(q, x);
          }
        }
      }
    } catch (e) {
      throw new Error(`seed ${seed} (${peerCount} peers) step ${step}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`, { cause: e });
    }
  }

  try {
    fullSync();
    // O1: replicas fed every update in three orders, and every peer that did not diverge (yjs-undo O1), read the same,
    // with nothing pending.
    for (const q of peers) if (hasPending(q.doc)) throw new Error(`O1: peer ${q.index} kept pending updates`);
    const replicas = [all, [...all].reverse(), shuffle(r, [...all])].map((order, i) => {
      const fresh = new Y.Doc({ gc: false });
      // Merged into ONE update: applied update by update out of order, Yjs's format cleanup (X26, exempt)
      // would run on partial states and write deletions of its own.
      Y.applyUpdate(fresh, Y.mergeUpdates(order));
      const how = i === 0 ? "in order" : "reordered";
      if (getDocMap(fresh) === null) throw new Error("O1: a replica has no root");
      if (hasPending(fresh)) throw new Error(`O1: a replica kept pending updates (${how})`);
      return { how, d: deriveDocument(fresh, BUILTIN_OBJECT_KINDS) };
    });
    const live = peers.filter((q) => !q.diverged);
    const want = live[0]?.model.version ?? replicas[0]?.d;
    if (want === undefined) throw new Error("oracle: no peer");
    judge(want, true);
    for (const q of live) expectSameVersion(q.model.version, want);
    for (const { how, d } of replicas) {
      try {
        expectSameVersion(d, want);
      } catch (e) {
        throw new Error(`O1: a replica fed every update ${how} reads differently`, { cause: e });
      }
    }
  } catch (e) {
    throw new Error(`seed ${seed} (${peerCount} peers) convergence: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  for (const q of peers) {
    q.history.destroy();
    q.model.destroy();
  }
  return { quirks, yjsUndo };
}
