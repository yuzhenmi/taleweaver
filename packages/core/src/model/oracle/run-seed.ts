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
import { deriveDocument } from "../derive/derive-document";
import type { Document } from "../document/types";
import { type HistoryStep, UNDO_COALESCE_PAUSE_MS } from "../history";
import { BUILTIN_OBJECT_KINDS } from "../object-kinds";
import type { ModelSelection } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { resolvePosition } from "../position/resolve-position";
import { getDocMap } from "../storage/doc-map";
import { ROOT_MAP } from "../storage/keys";
import { expectSameVersion } from "../test-helpers/expect-same-version";
import { fixture } from "../test-helpers/fixture";
import { readOf, selectionOf } from "../test-helpers/harness";
import { wellFormed } from "./document-probes";
import { expectValid } from "./expect-valid";
import { A1A2, describeFiring, firingsOf, idKey, storageLine } from "./firings";
import { type Action, type ActionKind, Log, classify, explain } from "./log";
import { Peer } from "./peer";
import { pick, rng, shuffle } from "./random";
import { OPTIONS, commandName, randomCommand, resetMarkerSeq } from "./random-command";
import { type Snap, sameRead, storageOf } from "./storage-snapshot";

const REMOTE = "oracle-remote";

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface SeedResult {
  /** Classified quirk instances (distinct firings), by label. */
  readonly quirks: ReadonlyMap<string, number>;
  /** Known Yjs UndoManager inexactness at an undo / redo step (the `yjs-undo` bucket): `seed S step N peer P undo|redo: O1|O5`. */
  readonly yjsUndo: readonly string[];
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

/** A selection snapped to caret positions (R14–R16), as restored selections are. */
function snapped(d: Document, sel: ModelSelection): ModelSelection {
  return { anchor: resolvePosition(d, sel.anchor, OPTIONS) ?? sel.anchor, focus: resolvePosition(d, sel.focus, OPTIONS) ?? sel.focus };
}

const resolves = (d: Document, sel: ModelSelection): boolean => paragraphLayout(d, sel.anchor.blockId) !== null && paragraphLayout(d, sel.focus.blockId) !== null;

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
