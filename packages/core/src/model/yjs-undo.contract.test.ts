/**
 * K3 contract (P2 plan §4): the stock-Yjs (13.6.30) UndoManager / item behaviour the
 * table design relies on. A failure here is kill signal K3 — a Yjs bump changed it.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createEditorOrigin, flowContainerDeleteFilter } from "./storage/history-hooks";
import { COLS_KEY, ROWS_KEY } from "./storage/keys";
import { mapOf, newParagraphMark } from "./storage/new-items";
import { newColMap, newRowMap, newTable } from "./storage/new-table";
import { cellFlowKey } from "./storage/table-keys";
import { fixture } from "./test-helpers/fixture";
import { cellPiece } from "./test-helpers/table";

describe("K3 (a)/(b): map-entry redo", () => {
  it("(a) refuses to redo a map entry when a live entry this UndoManager does not own sits to its right", () => {
    const doc = new Y.Doc();
    const m = doc.getMap("m");
    const O = Symbol("ed");
    const um = new Y.UndoManager(m, { trackedOrigins: new Set([O]), captureTimeout: 0 });
    doc.transact(() => m.set("k", 1), O);
    doc.transact(() => m.delete("k"), O);
    doc.transact(() => m.set("k", 2), "peer");
    um.undo(); // would restore k = 1 over the peer's live entry: refused
    expect(m.get("k")).toBe(2);
  });

  it("(b) set k twice, undo both, redo both is exact (isDeletedByUndoStack skips the undone entry)", () => {
    const doc = new Y.Doc();
    const m = doc.getMap("m");
    const O = Symbol("ed");
    const um = new Y.UndoManager(m, { trackedOrigins: new Set([O]), captureTimeout: 0 });
    doc.transact(() => m.set("k", 1), O);
    doc.transact(() => m.set("k", 2), O);
    const seen: unknown[] = [];
    um.undo();
    seen.push(m.get("k"));
    um.undo();
    seen.push(m.has("k"));
    um.redo();
    seen.push(m.get("k"));
    um.redo();
    seen.push(m.get("k"));
    expect(seen).toEqual([1, false, 1, 2]);
  });
});

describe("K3 (c): deleteFilter order and cell flows", () => {
  it("sees a map's children before the map, and keeps a `c:<col>:flow` array", () => {
    const f = fixture();
    const table = newTable([newRowMap("r0", ["a"])], [newColMap("a")]);
    f.piece.insertEmbed(0, table);
    const rows = table.get(ROWS_KEY);
    if (!(rows instanceof Y.Array)) throw new Error("no rows");
    const O = createEditorOrigin();
    const order: string[] = [];
    const row = newRowMap("r1", ["a"]);
    const um = new Y.UndoManager(rows, {
      trackedOrigins: new Set([O]),
      captureTimeout: 0,
      deleteFilter: (item) => {
        const c = item.content;
        if (c instanceof Y.ContentType && c.type === row) order.push("RowMap");
        if (item.parentSub === cellFlowKey("a")) order.push("cell flow");
        return flowContainerDeleteFilter(item);
      },
    });
    f.doc.transact(() => rows.push([row]), O);
    um.undo();
    expect(order.indexOf("cell flow")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("cell flow")).toBeLessThan(order.indexOf("RowMap"));
    expect(rows.length).toBe(1); // the row died with its kept flow inside it

    // T5 (X5): a flow created in an existing row is kept by undo (X17); its content is not.
    const r0 = rows.get(0);
    if (!(r0 instanceof Y.Map)) throw new Error("no r0");
    f.doc.transact(() => r0.delete(cellFlowKey("a")));
    const piece = new Y.Text();
    piece.insert(0, "q");
    piece.insertEmbed(1, newParagraphMark());
    const flow = new Y.Array<Y.Text>();
    flow.insert(0, [piece]);
    f.doc.transact(() => r0.set(cellFlowKey("a"), flow), O);
    um.undo();
    expect(r0.get(cellFlowKey("a"))).toBe(flow);
    expect(flow.get(0)).toBe(piece);
    expect(piece.length).toBe(0);
  });
});

describe("K3 (d): the item chain from a cell piece to its table (X14 reads)", () => {
  it("piece → c:<col>:flow array → RowMap → rows array → table map → body piece, locally and on a peer", () => {
    const f = fixture();
    const table = newTable([newRowMap("r0", ["a"])], [newColMap("a")]);
    f.piece.insertEmbed(0, table);
    const peer = fixture(2, f.doc);
    for (const piece of [f.piece, peer.piece]) {
      const t = piece.toDelta()[0]?.insert;
      if (!(t instanceof Y.Map)) throw new Error("no table");
      const rows = t.get(ROWS_KEY);
      const row: unknown = rows instanceof Y.Array ? rows.get(0) : null;
      if (!(row instanceof Y.Map)) throw new Error("no row");
      const cell = cellPiece(row, "a");
      const flowItem = cell._item?.parent instanceof Y.Array ? cell._item.parent._item : null;
      expect(flowItem?.parentSub).toBe(cellFlowKey("a"));
      expect(flowItem?.parent).toBe(row);
      expect(row._item?.parent).toBe(rows);
      expect(rows instanceof Y.Array ? rows._item?.parentSub : null).toBe(ROWS_KEY);
      expect(rows instanceof Y.Array ? rows._item?.parent : null).toBe(t);
      expect(t.get(COLS_KEY) instanceof Y.Array).toBe(true);
      expect(t._item?.parent).toBe(piece);
    }
  });
});

// ---------------------------------------------------------------------------
// (e) r7 f1#1–#6, ported verbatim from proof-scripts/r7/lib.mjs + f1.mjs
// ---------------------------------------------------------------------------

describe("K3 (e): r7 f1 — T6 / T7 undo and redo are exact at every step", () => {
  const O = Symbol("ed");
  const mk = (id: number): Y.Doc => {
    const d = new Y.Doc();
    d.clientID = id;
    return d;
  };
  const tx = (d: Y.Doc, f: () => void): void => d.transact(f, O);
  const para = (k: Readonly<Record<string, unknown>> = {}): Y.Map<unknown> => mapOf(k);
  const isPara = (x: unknown): boolean => x instanceof Y.Map && !x.has("k");
  const flow = (s: string, keys: Readonly<Record<string, unknown>> = {}): Y.Text => {
    const f = new Y.Text();
    f.insert(0, s, { b: true });
    f.insertEmbed(s.length, para(keys));
    return f;
  };
  const showOp = (op: { insert?: unknown; attributes?: unknown }): string => {
    const ins = op.insert;
    const bold = typeof op.attributes === "object" && op.attributes !== null && "b" in op.attributes;
    if (typeof ins === "string") return ins + (bold ? "(b)" : "");
    if (!(ins instanceof Y.Map)) return "?";
    return ins.has("k") ? `[${String(ins.get("k"))}]` : `¶${JSON.stringify(ins.toJSON())}`;
  };
  const show = (f: unknown): string => (f instanceof Y.Text ? `"${f.toDelta().map(showOp).join("")}"` : "<none>");
  const rows = (d: Y.Doc): Y.Array<Y.Map<unknown>> => d.getArray("rows");
  const rowAt = (d: Y.Doc, i: number): Y.Map<unknown> => {
    const r = rows(d).get(i);
    if (r === undefined) throw new Error(`no row ${i}`);
    return r;
  };
  const textAt = (r: Y.Map<unknown>, key: string): Y.Text | undefined => {
    const t = r.get(key);
    return t instanceof Y.Text ? t : undefined;
  };
  const st = (d: Y.Doc): string =>
    rows(d)
      .toArray()
      .map(
        (r, i) =>
          `r${i}{` +
          [...r.keys()]
            .sort()
            .filter((k) => k !== "key")
            .map((k) => `${k}=${r.get(k) instanceof Y.Text ? show(r.get(k)) : String(r.get(k))}`)
            .join(" ") +
          "}",
      )
      .join(" ");
  const um = (d: Y.Doc): Y.UndoManager =>
    new Y.UndoManager(rows(d), {
      trackedOrigins: new Set([O]),
      captureTimeout: 0,
      deleteFilter: (it) => !(it.content instanceof Y.ContentType && typeof it.parentSub === "string" && it.parentSub.endsWith(":flow")),
    });
  const seedRows = (a: Y.Doc, n: number): void =>
    tx(a, () => {
      for (let i = 0; i < n; i++) {
        const r = new Y.Map<unknown>();
        r.set("key", `r${i}`);
        r.set("c:a:flow", flow(`t${i}`, { "p:type": `h${i}` }));
        r.set("c:a:a:bg", `c${i}`);
        rows(a).push([r]);
      }
    });
  const lastInsert = (f: Y.Text): unknown => f.toDelta().at(-1)?.insert;
  const isEmptyFlow = (f: Y.Text): boolean => {
    const d = f.toDelta();
    const only = d[0]?.insert;
    return d.length === 1 && isPara(only) && only instanceof Y.Map && only.size === 0;
  };
  const clearFlow = (f: Y.Text): void => {
    if (f.length > 1) f.delete(0, f.length - 1);
    const last = lastInsert(f);
    if (last instanceof Y.Map) for (const k of [...last.keys()]) last.delete(k);
  };
  const setKeys = (m: Y.Map<unknown>, keys: Readonly<Record<string, unknown>>): void => {
    for (const k of [...m.keys()]) if (!(k in keys)) m.delete(k);
    for (const [k, v] of Object.entries(keys)) if (m.get(k) !== v) m.set(k, v);
  };
  const jsonOf = (v: unknown): Record<string, unknown> => (v instanceof Y.Map ? v.toJSON() : {});
  /** T6: merge rows [from..to] in column a; anchor = from. */
  const merge = (d: Y.Doc, from: number, to: number, col = "a"): void =>
    tx(d, () => {
      const ar = rowAt(d, from);
      let A = textAt(ar, `c:${col}:flow`);
      if (A === undefined) {
        A = new Y.Text();
        ar.set(`c:${col}:flow`, A);
        A.insertEmbed(0, para());
      }
      const run: { insert?: unknown; attributes?: unknown }[] = [];
      for (let i = from + 1; i <= to; i++) {
        const B = textAt(rowAt(d, i), `c:${col}:flow`);
        if (B !== undefined && !isEmptyFlow(B)) run.push(...B.toDelta());
      }
      if (run.length > 0) {
        const F = lastInsert(A);
        const fKeys = jsonOf(F);
        const lastKeys = jsonOf(run.at(-1)?.insert);
        let at = A.length - 1;
        A.insertEmbed(at++, para(fKeys));
        for (const op of run.slice(0, -1)) {
          if (typeof op.insert === "string") {
            const attrs = typeof op.attributes === "object" && op.attributes !== null ? { ...op.attributes } : {};
            A.insert(at, op.insert, attrs);
            at += op.insert.length;
          } else {
            A.insertEmbed(at, para(jsonOf(op.insert)));
            at++;
          }
        }
        if (F instanceof Y.Map) setKeys(F, lastKeys);
      }
      for (let i = from + 1; i <= to; i++) {
        const r = rowAt(d, i);
        const B = textAt(r, `c:${col}:flow`);
        if (B !== undefined) clearFlow(B);
        for (const k of [...r.keys()]) if (k.startsWith(`c:${col}:a:`) || k === `c:${col}:rowSpanTo`) r.delete(k);
      }
      ar.set(`c:${col}:rowSpanTo`, `r${to}`);
    });
  /** T7: delete the span; clear any content left in covered flows. */
  const unmerge = (d: Y.Doc, i: number, col = "a"): void =>
    tx(d, () => {
      const to = rowAt(d, i).get(`c:${col}:rowSpanTo`);
      const j = rows(d)
        .toArray()
        .findIndex((r) => r.get("key") === to);
      for (let k = i + 1; k <= j; k++) {
        const B = textAt(rowAt(d, k), `c:${col}:flow`);
        if (B !== undefined && !isEmptyFlow(B)) clearFlow(B);
      }
      rowAt(d, i).delete(`c:${col}:rowSpanTo`);
    });
  const type = (d: Y.Doc, i: number, at: number, s: string): void => tx(d, () => textAt(rowAt(d, i), "c:a:flow")?.insert(at, s, { b: true }));
  const lastPara = (d: Y.Doc, i: number): unknown => {
    const f = textAt(rowAt(d, i), "c:a:flow");
    return f === undefined ? undefined : lastInsert(f);
  };

  const cases: Record<string, (a: Y.Doc) => (() => void)[]> = {
    "merge,unmerge,merge(r1-r2)": (a) => [() => merge(a, 0, 1), () => unmerge(a, 0), () => merge(a, 1, 2)],
    "merge,unmerge,type in r1": (a) => [() => merge(a, 0, 1), () => unmerge(a, 0), () => type(a, 1, 0, "new")],
    "merge,unmerge,style r1 ¶": (a) => [
      () => merge(a, 0, 1),
      () => unmerge(a, 0),
      () =>
        tx(a, () => {
          const p = lastPara(a, 1);
          if (p instanceof Y.Map) p.set("p:type", "X");
        }),
    ],
    "merge,unmerge,bg r1": (a) => [() => merge(a, 0, 1), () => unmerge(a, 0), () => tx(a, () => rowAt(a, 1).set("c:a:a:bg", "X"))],
    "merge,unmerge,merge(r0-r1)": (a) => [() => merge(a, 0, 1), () => unmerge(a, 0), () => merge(a, 0, 1)],
    "merge(r0-r2) 3 rows": (a) => [() => merge(a, 0, 2)],
  };
  const finals: Record<string, string> = {
    "merge,unmerge,merge(r1-r2)": 'r0{c:a:a:bg=c0 c:a:flow="t0(b)¶{"p:type":"h0"}t1(b)¶{"p:type":"h1"}"} r1{c:a:flow="¶{}t2(b)¶{"p:type":"h2"}" c:a:rowSpanTo=r2} r2{c:a:flow="¶{}"}',
    "merge(r0-r2) 3 rows": 'r0{c:a:a:bg=c0 c:a:flow="t0(b)¶{"p:type":"h0"}t1(b)¶{"p:type":"h1"}t2(b)¶{"p:type":"h2"}" c:a:rowSpanTo=r2} r1{c:a:flow="¶{}"} r2{c:a:flow="¶{}"}',
  };

  for (const [name, steps] of Object.entries(cases)) {
    it(name, () => {
      const a = mk(1);
      seedRows(a, 3);
      const u = um(a);
      const s = [st(a)];
      for (const f of steps(a)) {
        f();
        s.push(st(a));
      }
      const n = s.length - 1;
      const finalWant = finals[name];
      if (finalWant !== undefined) expect(s[n]).toBe(finalWant);
      for (let i = n - 1; i >= 0; i--) {
        u.undo();
        expect(st(a), `undo to step ${i}`).toBe(s[i]);
      }
      for (let i = 1; i <= n; i++) {
        u.redo();
        expect(st(a), `redo to step ${i}`).toBe(s[i]);
      }
    });
  }
});
