import * as Y from "yjs";
import type { FlowState } from "../document/types";
import { isParagraphBreak, isSectionBreak, isStructural, kindOfStored } from "../scan/kinds";
import { readsAsContent } from "../scan/scan-range";
import { itemId } from "../storage/item-id";
import { ITEM_KINDS, KIND_KEY, PIECES_KEY } from "../storage/keys";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { markRole } from "../storage/table-marks";

/** A firing of a read rule (or an A1 / A2 / W2 break) in one flow's storage. */
export interface Firing {
  readonly type: "debris" | "abut" | "SS" | "leadingS" | "trailingS" | "empty";
  /** What ends it: a block object, an `[S]`, or the flow end. */
  readonly end: "blockObject" | "section" | "end";
  readonly where: string;
  /** Live units on its left: the debris run's units (per character), or the object / `[S]` before the gap. */
  readonly left: readonly Y.ID[];
  /** The block object / `[S]` that ends it (null at the flow end). */
  readonly right: Y.ID | null;
  /** Deleted ¶s between the left boundary and the right. */
  readonly gap: readonly string[];
  /** Identity across undo / redo: its type, end and right unit, with restored items mapped to the items they restore (Yjs `redone`). */
  readonly key: string;
}

export const idKey = (id: Y.ID): string => `${id.client}:${id.clock}`;

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
  // `cell`: after a `⟨c⟩`; `newRow` / `newCell`: after a `⟦` / `⟨r⟩`, the mark that must come next (design §1 faces).
  type Boundary = { k: "start" | "paragraphBreak" | "blockObject" | "section" | "inCell" | "newRow" | "newCell"; id: Y.ID | null };
  let left: Boundary = { k: "start", id: null };
  let run: Y.ID[] = [];
  let gap: string[] = [];
  let any = false;
  let open = 0;
  const awaiting = (): boolean => left.k === "newRow" || left.k === "newCell";
  /** A table broken by its faces (a lead, a missing row / cell mark, an empty cell, an unbalanced bracket): A1-like. */
  const broken = (right: Y.ID | null): void => void pending.push({ type: "empty", end: "end", where, left: [], right, gap });
  const where = fs.holderId;
  const terminate = (k: "blockObject" | "section" | "end", id: Y.ID | null): void => {
    const leftIds = left.id === null ? [] : [left.id];
    if (run.length > 0) pending.push({ type: "debris", end: k, where, left: run, right: id, gap });
    else if (left.k === "blockObject") pending.push({ type: "abut", end: k, where, left: leftIds, right: id, gap });
    else if (k === "section" && left.k === "section") pending.push({ type: "SS", end: k, where, left: leftIds, right: id, gap });
    else if (k === "section" && left.k === "start") pending.push({ type: "leadingS", end: k, where, left: leftIds, right: id, gap });
    else if (k === "end" && left.k === "section") pending.push({ type: "trailingS", end: k, where, left: leftIds, right: id, gap });
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
      const fk = kindOfStored(kind);
      if (it.deleted) {
        if (isParagraphBreak(fk)) gap.push(itemId(it));
        continue;
      }
      if (kind === ITEM_KINDS.sub) {
        const arr = m.get(PIECES_KEY);
        if (depth < SUBFLOW_DEPTH_CAP && arr instanceof Y.Array) for (const p of arr.toArray()) if (p instanceof Y.Text) visit(p, depth + 1);
        continue;
      }
      const role = markRole(m);
      if (role !== null) {
        // A table mark: `⟦` ends what precedes as the table (a block object); `⟨r⟩` / `⟨c⟩` / `⟧` end a container,
        // as the flow end does. (Inert marks are not modelled: concurrency only.)
        any = true;
        const misplaced = awaiting() ? role !== left.k : left.k === "inCell" && role !== "open";
        open += role === "open" ? 1 : role === "close" ? -1 : 0;
        if (run.length === 0 && (misplaced || open < 0 || (open === 0 && role !== "open" && role !== "close"))) broken(it.id);
        else terminate(role === "open" ? "blockObject" : "end", it.id);
        left = role === "close" ? { k: "blockObject", id: it.id } : { k: role === "newCell" ? "inCell" : role === "open" ? "newRow" : "newCell", id: null };
        run = [];
        gap = [];
        continue;
      }
      if (awaiting()) broken(it.id); // a table / row lead (F2)
      if (isParagraphBreak(fk)) {
        any = true;
        left = { k: "paragraphBreak", id: it.id };
        run = [];
        gap = [];
      } else if (isStructural(fk)) {
        any = true;
        const k = isSectionBreak(fk) ? "section" : "blockObject";
        terminate(k, it.id);
        left = { k, id: it.id };
        run = [];
        gap = [];
      } else if (readsAsContent(m, fs.tree === "block")) run.push(it.id);
    }
  };
  for (const p of fs.array?.toArray() ?? []) if (p instanceof Y.Text) visit(p, 0);
  if (open > 0) broken(null);
  terminate("end", null);
  for (const f of pending) out.push({ ...f, key: `${f.type}:${f.end}:${f.right === null ? f.where : canon(idKey(f.right))}` });
  return out;
}

/** Shapes A1 / A2 claim unreachable except by Q1 (O7). */
export const A1A2 = (f: Firing): boolean => f.type === "SS" || f.type === "leadingS" || f.type === "trailingS" || f.type === "empty" || (f.type === "abut" && f.end !== "blockObject") || (f.type === "debris" && f.end === "end");

/** One flow's storage with tombstones, for failure reports: `text@id`, `¶id`, `[toc id]`, `[S id]`, `†` = deleted, `|` between pieces, `{…}` a sub-flow. */
export function storageLine(fs: FlowState): string {
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
        } else {
          const para = isParagraphBreak(kindOfStored(k));
          parts.push(`${para ? "¶" : `[${k} `}${idKey(it.id)}${para ? "" : "]"}${del}`);
        }
      }
    }
  };
  for (const p of fs.array?.toArray() ?? []) if (p instanceof Y.Text) visit(p);
  return parts.join(" ");
}

export const describeFiring = (f: Firing): string => `${f.type} before ${f.end} in ${f.where} (left ${f.left.map(idKey).join(",")}, right ${f.right === null ? "-" : idKey(f.right)}, gap ${f.gap.join(",")})`;
