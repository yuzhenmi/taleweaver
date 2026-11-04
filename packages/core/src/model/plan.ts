/**
 * Commands as Plan + Apply (core-architecture G1: Yjs has no transaction abort).
 *
 *   - PLAN (`commands/`): read ONE version, validate, and build
 *     the primitive writes as data. Every throw happens here; a command that does
 *     nothing returns null.
 *   - APPLY ({@link applyPlan}): run the writes in ONE `Y.transact` with the
 *     editor's origin (X16). It never throws: every write is a plain Yjs call at a
 *     storage index the plan read from the same version, and a plan whose version is
 *     no longer current — or applied inside an open transaction — is refused (null)
 *     before anything is written.
 *
 * Writes address storage by (piece, index) in the plan's version. Apply runs each
 * piece's writes from the highest index down, so no write shifts another's index;
 * at one index a delete runs first, then a format, then the inserts in plan order
 * (concatenated). The piece-size rule (X11 / X12) is applied at write time: a full
 * piece gets a fresh piece or a sub-flow ({@link writablePoint}); an insert too big
 * for one piece is chunked into fresh pieces.
 */
import * as Y from "yjs";
import type { ReadonlyAttrs } from "./block";
import type { Document } from "./document/types";
import type { Model } from "./model";
import type { ModelSelection } from "./position/model-position";
import { PIECE_SOFT_MAX, SUBFLOW_DEPTH_CAP } from "./storage/limits";
import { newSubflow } from "./storage/new-items";
import { arrayOfPiece, pieceDepth, pieceIndex } from "./storage/pieces";
import type { Scalar } from "./storage/scalar";
import { writablePoint } from "./storage/writable-point";

/** One inserted storage unit: text with its exact formatting, or an embedded item map (detached). */
export type InsertUnit =
  | { readonly text: string; readonly attrs: ReadonlyAttrs }
  | { readonly embed: Y.Map<unknown>; readonly attrs: ReadonlyAttrs };

export type Write =
  | { readonly k: "insert"; readonly piece: Y.Text; readonly index: number; readonly units: readonly InsertUnit[] }
  | { readonly k: "delete"; readonly piece: Y.Text; readonly index: number; readonly len: number }
  | { readonly k: "format"; readonly piece: Y.Text; readonly index: number; readonly len: number; readonly attrs: Readonly<Record<string, Scalar>> }
  /** Set (a scalar) or delete (undefined) flat keys of an item map. */
  | { readonly k: "keys"; readonly map: Y.Map<unknown>; readonly keys: Readonly<Record<string, Scalar | undefined>> }
  /** A flow with no piece: its first piece, holding `units`. */
  | { readonly k: "firstPiece"; readonly flow: Y.Array<Y.Text>; readonly units: readonly InsertUnit[] }
  /** A table's `cols` array: delete `delete` entries at `index`, then insert the detached `insert` maps there. */
  | { readonly k: "cols"; readonly array: Y.Array<unknown>; readonly index: number; readonly delete: number; readonly insert: readonly Y.Map<unknown>[] }
  /** Set (a detached map) or delete (null) a nested-map entry (header / footer bodies). */
  | { readonly k: "entry"; readonly map: Y.Map<unknown>; readonly key: string; readonly value: Y.Map<unknown> | null };

export interface Plan {
  /**
   * The version the plan was read from. Holding a plan (or any old Document) keeps
   * the forward chain of every later version alive (`mapping/map-position.ts`): drop stale plans.
   */
  readonly base: Document;
  readonly writes: readonly Write[];
  /** The selection after Apply, given the version Apply produced (may read ids of items the writes created). */
  readonly selection: (after: Document) => ModelSelection;
}

type IndexWrite = Extract<Write, { piece: Y.Text }>;

const RANK: Readonly<Record<IndexWrite["k"], number>> = { delete: 0, format: 1, insert: 2 };

function unitBudget(units: readonly InsertUnit[]): number {
  let n = 0;
  for (const u of units) n += 1 + 2 * Object.keys(u.attrs).length;
  return n;
}

function writeUnits(piece: Y.Text, index: number, units: readonly InsertUnit[]): void {
  let i = index;
  for (const u of units) {
    if ("text" in u) {
      if (u.text === "") continue;
      piece.insert(i, u.text, { ...u.attrs });
      i += u.text.length;
    } else {
      piece.insertEmbed(i, u.embed, { ...u.attrs });
      i += 1;
    }
  }
}

/** Fresh detached pieces holding `units`, each within half the piece cap (at least one piece). */
export function chunked(units: readonly InsertUnit[]): Y.Text[] {
  const out: Y.Text[] = [];
  let cur: InsertUnit[] = [];
  let n = 0;
  const flush = (): void => {
    if (cur.length === 0) return;
    const p = new Y.Text();
    writeUnits(p, 0, cur);
    out.push(p);
    cur = [];
    n = 0;
  };
  for (const u of units) {
    const b = unitBudget([u]);
    if (n + b > PIECE_SOFT_MAX / 2) flush();
    cur.push(u);
    n += b;
  }
  flush();
  if (out.length === 0) out.push(new Y.Text());
  return out;
}

/** Insert `units` at `index` of `piece` under the piece-size rule. */
function insertUnits(piece: Y.Text, index: number, units: readonly InsertUnit[]): void {
  const budget = unitBudget(units);
  if (budget <= PIECE_SOFT_MAX / 2) {
    const p = writablePoint({ piece, index }, budget);
    writeUnits(p.piece, p.index, units);
    return;
  }
  const pieces = chunked(units);
  if (index >= piece.length) arrayOfPiece(piece).insert(pieceIndex(piece) + 1, pieces);
  else if (index === 0) arrayOfPiece(piece).insert(pieceIndex(piece), pieces);
  else if (pieceDepth(piece) < SUBFLOW_DEPTH_CAP) piece.insertEmbed(index, newSubflow(...pieces), {});
  // ponytail: at the sub-flow depth cap a big insert overfills the piece (as writablePoint does).
  else writeUnits(piece, index, units);
}

function runIndexWrite(w: IndexWrite): void {
  if (w.k === "delete") w.piece.delete(w.index, w.len);
  else if (w.k === "format") w.piece.format(w.index, w.len, { ...w.attrs });
  else insertUnits(w.piece, w.index, w.units);
}

/**
 * Apply `plan` in one transaction with `origin`; the selection after, or null when
 * the plan's version is no longer the model's current version (nothing written).
 */
export function applyPlan(model: Model, plan: Plan, origin: symbol): ModelSelection | null {
  if (plan.base !== model.version) return null;
  // Inside a transaction, or from an observer / model listener before every observer has
  // run, the version may not describe storage: refuse.
  if (model.busy) return null;
  const byPiece = new Map<Y.Text, IndexWrite[]>();
  const other: Exclude<Write, IndexWrite>[] = [];
  for (const w of plan.writes) {
    if (w.k === "insert" || w.k === "delete" || w.k === "format") {
      const xs = byPiece.get(w.piece);
      if (xs === undefined) byPiece.set(w.piece, [w]);
      else xs.push(w);
    } else other.push(w);
  }
  model.doc.transact(() => {
    for (const w of other) {
      if (w.k === "keys") {
        for (const [k, v] of Object.entries(w.keys)) {
          if (v === undefined) {
            if (w.map.has(k)) w.map.delete(k);
          } else if (w.map.get(k) !== v) w.map.set(k, v);
        }
      } else if (w.k === "firstPiece") {
        w.flow.insert(0, chunked(w.units));
      } else if (w.k === "cols") {
        if (w.delete > 0) w.array.delete(w.index, w.delete);
        if (w.insert.length > 0) w.array.insert(w.index, [...w.insert]);
      } else if (w.value === null) w.map.delete(w.key);
      else w.map.set(w.key, w.value);
    }
    for (const xs of byPiece.values()) {
      // Stable sort: highest index first; at one index delete, format, then inserts in plan order.
      const sorted = xs.map((w, i) => ({ w, i })).sort((a, b) => b.w.index - a.w.index || RANK[a.w.k] - RANK[b.w.k] || a.i - b.i);
      for (let j = 0; j < sorted.length; j++) {
        const cur = sorted[j]?.w;
        if (cur === undefined) continue;
        if (cur.k !== "insert") {
          runIndexWrite(cur);
          continue;
        }
        // Concatenate the inserts at one index, in plan order.
        const units: InsertUnit[] = [...cur.units];
        while (j + 1 < sorted.length) {
          const nx = sorted[j + 1]?.w;
          if (nx === undefined || nx.k !== "insert" || nx.index !== cur.index) break;
          units.push(...nx.units);
          j++;
        }
        insertUnits(cur.piece, cur.index, units);
      }
    }
  }, origin);
  return plan.selection(model.version);
}
