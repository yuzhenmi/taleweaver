import * as Y from "yjs";
import { type Firing, idKey } from "./firings";
import type { Peer } from "./peer";

export type ActionKind = "cmd" | "undo" | "redo" | "cleanup";

/** One local transaction that changed storage. */
export interface Action {
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

// ---------------------------------------------------------------------------
// The run's log and quirk classification (O6)
// ---------------------------------------------------------------------------

export class Log {
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
export function classify(f: Firing, peers: readonly Peer[], log: Log, earlier: ReadonlyMap<string, string>): string | null {
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
  const label = f.type === "debris" && f.end !== "end" ? "Q2" : f.type === "abut" && f.end === "blockObject" ? "Q3" : null;
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

const describeAction = (a: Action | null): string => (a === null ? "setup" : `peer ${a.peer} ${a.kind}${a.name === a.kind ? "" : ` ${a.name}`} @${a.seq} sv ${[...a.sv].map(([c, k]) => `${c}:${k}`).join(" ")}`);

/** The log behind a firing: who made each unit, who deleted each gap ¶. */
export function explain(f: Firing, log: Log): string {
  const units = f.right === null ? f.left : [...f.left, f.right];
  return [
    ...log.actions.map((a) => `  ${describeAction(a)}`),
    ...units.map((x) => `  unit ${idKey(x)} by ${describeAction(log.creator(x))}`),
    ...f.gap.map((c) => `  gap ¶ ${c} made by ${describeAction(log.creator(Y.createID(Number(c.split(":")[0]), Number(c.split(":")[1]))))}, deleted by ${(log.deletedBy.get(c) ?? []).map(describeAction).join("; ")}`),
  ].join("\n");
}
