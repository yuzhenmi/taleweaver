/**
 * O4: incremental derivation == from-scratch derivation, over random raw-Yjs writes
 * (local transactions with one or several writes, plus remote updates from a peer).
 * Commands arrive in M2; these writes deliberately include states commands never
 * produce, so every read rule's incremental path is exercised.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveDocument, type Document, type TreeKind } from "./derive";
import { Model } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import {
  BODIES_KEY,
  BODY_KEY,
  FLOW_KEY,
  LIST_DEFS_KEY,
  PIECES_KEY,
  childMap,
  createDocMap,
  createEditorOrigin,
  flowOf,
  getDocMap,
  insertPieceAfter,
  kindOf,
  newBody,
  newFlow,
  newFootnote,
  newHorizontalRule,
  newMarker,
  newObject,
  newParagraphMark,
  newSectionBreak,
  newSubflow,
  newTableOfContents,
  typeId,
  writablePoint,
  flowContainerDeleteFilter,
} from "./storage";
import { expectSameVersion, fixture, idOf, mapAt } from "./test-helpers";

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

/** Every live piece (top-level and sub-flow) of every flow, plus the flow arrays. */
function storageOf(docMap: Y.Map<unknown>): { pieces: Y.Text[]; flows: Y.Array<Y.Text>[]; subArrays: Y.Array<Y.Text>[]; maps: Y.Map<unknown>[] } {
  const pieces: Y.Text[] = [];
  const flows: Y.Array<Y.Text>[] = [];
  const subArrays: Y.Array<Y.Text>[] = [];
  const maps: Y.Map<unknown>[] = [];
  const visitArray = (arr: Y.Array<Y.Text>, top: boolean): void => {
    if (top) flows.push(arr);
    else subArrays.push(arr);
    for (const p of arr.toArray()) {
      if (!(p instanceof Y.Text)) continue;
      pieces.push(p);
      for (const op of p.toDelta()) {
        const ins: unknown = op.insert;
        if (!(ins instanceof Y.Map)) continue;
        maps.push(ins);
        const k = kindOf(ins);
        const sub = ins.get(PIECES_KEY);
        if (k === "sub" && sub instanceof Y.Array) visitArray(sub, false);
        const body = childMap(ins, BODY_KEY);
        const bf = body === null ? null : flowOf(body);
        if (bf !== null) visitArray(bf, true);
      }
    }
  };
  const f = flowOf(docMap);
  if (f !== null) visitArray(f, true);
  childMap(docMap, BODIES_KEY)?.forEach((b) => {
    const bf = b instanceof Y.Map ? flowOf(b) : null;
    if (bf !== null) visitArray(bf, true);
  });
  return { pieces, flows, subArrays, maps };
}

function pick<T>(r: () => number, xs: readonly T[]): T | undefined {
  return xs[Math.floor(r() * xs.length)];
}

const P_KEYS = ["p:type", "p:align", "m:bold", "t:ins"];
const P_VALUES = ["heading", "paragraph", "list-item", "center", "x", null, true, 3];

/** One random raw write into `doc`. */
function randomWrite(r: () => number, doc: Y.Doc): void {
  const docMap = getDocMap(doc);
  if (docMap === null) return;
  const { pieces, flows, subArrays, maps } = storageOf(docMap);
  const piece = pick(r, pieces);
  if (piece === undefined) return;
  const at = Math.floor(r() * (piece.length + 1));
  const roll = r();
  if (roll < 0.25) {
    piece.insert(at, pick(r, ["a", "bc", "def ", "é"]) ?? "a", r() < 0.3 ? { bold: true } : r() < 0.2 ? { italic: true } : {});
  } else if (roll < 0.37) {
    const keys: Record<string, string | number | boolean | null> = {};
    if (r() < 0.5) keys[pick(r, P_KEYS) ?? "p:type"] = pick(r, P_VALUES) ?? null;
    piece.insertEmbed(at, newParagraphMark(keys));
  } else if (roll < 0.5) {
    if (piece.length > 0) {
      const from = Math.floor(r() * piece.length);
      piece.delete(from, Math.min(piece.length - from, 1 + Math.floor(r() * 4)));
    }
  } else if (roll < 0.56) {
    if (piece.length > 0) {
      const from = Math.floor(r() * piece.length);
      piece.format(from, Math.min(piece.length - from, 1 + Math.floor(r() * 5)), { bold: r() < 0.5 ? true : null });
    }
  } else if (roll < 0.64) {
    const m = pick(r, maps);
    if (m !== undefined) {
      const k = kindOf(m);
      if (r() < 0.15) m.set("k", pick(r, ["para", "toc", "sectionBreak", "hr", "marker", "object", "footnote", "sub", "hologram"]) ?? "para");
      else if (k === "sectionBreak")
        m.set(
          pick(r, ["s:columnCount", "h:header:default", "h:footer:first", "h:headerFirst:default", "h:header:first:x", "s:headerBlockId"]) ?? "s:x",
          pick(r, ["hdr0", "hdr1", "none", "a", "a/end", 2]) ?? 1,
        );
      else if (k === "object") m.set(pick(r, ["wrap", "w", "a:src", "kind"]) ?? "w", pick(r, ["left", "break", 4, "x.png", "image", "acme:x"]) ?? 1);
      else m.set(pick(r, P_KEYS) ?? "p:type", pick(r, P_VALUES) ?? null);
    }
  } else if (roll < 0.68) {
    piece.insertEmbed(at, newTableOfContents({ "a:depth": 2 }));
  } else if (roll < 0.71) {
    piece.insertEmbed(at, newSectionBreak({ "s:columnCount": 1 }));
  } else if (roll < 0.74) {
    piece.insertEmbed(at, newFootnote());
  } else if (roll < 0.78) {
    piece.insertEmbed(at, newMarker("c", pick(r, ["1", "2"]) ?? "1", r() < 0.5 ? "start" : "end"));
  } else if (roll < 0.82) {
    piece.insertEmbed(at, r() < 0.5 ? newObject("image", { w: 3, props: { src: "a.png" } }) : newHorizontalRule());
  } else if (roll < 0.85) {
    const sub = r();
    const arr = pick(r, subArrays);
    if (sub < 0.3 && arr !== undefined) {
      // a piece inserted at a random position of a sub-flow, or one removed from it
      if (r() < 0.6 || arr.length < 2) {
        const fresh = new Y.Text();
        fresh.insert(0, "sp");
        if (r() < 0.5) fresh.insertEmbed(1, newParagraphMark());
        arr.insert(Math.floor(r() * (arr.length + 1)), [fresh]);
      } else arr.delete(Math.floor(r() * arr.length), 1);
    } else if (at > 0 && at < piece.length) {
      const inner = new Y.Text();
      inner.insert(0, "sub");
      if (r() < 0.5) inner.insertEmbed(1, newParagraphMark());
      if (r() < 0.3) {
        const deeper = new Y.Text();
        deeper.insert(0, "deep");
        if (r() < 0.5) deeper.insertEmbed(2, newParagraphMark());
        inner.insertEmbed(2, newSubflow(deeper));
      }
      piece.insertEmbed(at, newSubflow(inner));
    }
  } else if (roll < 0.88) {
    const flow = pick(r, flows);
    const first = flow?.get(0);
    if (first instanceof Y.Text) {
      const fresh = new Y.Text();
      fresh.insert(0, "np");
      if (r() < 0.5) fresh.insertEmbed(2, newParagraphMark());
      insertPieceAfter(first, fresh);
    }
  } else if (roll < 0.9) {
    // the piece-size rule with a tiny budget headroom: may create a piece / sub-flow
    const p = writablePoint({ piece, index: at }, 2000);
    p.piece.insert(p.index, "w");
  } else if (roll < 0.93) {
    const bodies = childMap(docMap, BODIES_KEY);
    const id = pick(r, ["hdr0", "hdr1", "a", "a/end", typeId(docMap) ?? "root"]) ?? "hdr0";
    if (bodies?.has(id) === true && r() < 0.5) bodies.delete(id);
    else bodies?.set(id, newBody());
  } else if (roll < 0.95) {
    docMap.set(pick(r, ["h:header:default", "s:pageInlineSize"]) ?? "s:x", pick(r, ["hdr0", "none", 600]) ?? 1);
  } else if (roll < 0.955) {
    // structural writes the read must absorb: a piece removed, a body flow replaced
    const sub = r();
    const flow = pick(r, flows);
    if (sub < 0.3 && flow !== undefined && flow.length > 1) flow.delete(Math.floor(r() * flow.length), 1);
    else if (sub < 0.65) {
      const fn = pick(r, maps.filter((m) => kindOf(m) === "footnote"));
      const body = fn === undefined ? null : childMap(fn, BODY_KEY);
      if (body !== null) body.set(FLOW_KEY, newFlow());
      else fn?.set(BODY_KEY, newBody());
    } else {
      const bodies = childMap(docMap, BODIES_KEY);
      const id = pick(r, ["hdr0", "hdr1", "a"]) ?? "hdr0";
      const body = bodies === null ? null : childMap(bodies, id);
      body?.set(r() < 0.5 ? FLOW_KEY : "x", r() < 0.5 ? newFlow() : 1);
    }
  } else if (roll < 0.97) {
    const defs = childMap(docMap, LIST_DEFS_KEY);
    const def = new Y.Map<unknown>();
    def.set(pick(r, ["0:style", "01:style", "1:style", "1:style:junk", "1e0:start"]) ?? "0:style", pick(r, ["disc", "decimal", "bogus", 3]) ?? "disc");
    if (r() < 0.5) defs?.set(pick(r, ["L1", "L2"]) ?? "L1", def);
    else defs?.delete("L1");
  } else {
    const unknown = new Y.Map<unknown>();
    unknown.set("k", "hologram");
    piece.insertEmbed(at, unknown);
  }
}

/** A numeric env var (Node), or `fallback`. */
function envNumber(name: string, fallback: number): number {
  const proc: unknown = Reflect.get(globalThis, "process");
  const env: unknown = typeof proc === "object" && proc !== null ? Reflect.get(proc, "env") : undefined;
  const v: unknown = typeof env === "object" && env !== null ? Reflect.get(env, name) : undefined;
  return typeof v === "string" && v !== "" ? Number(v) : fallback;
}

/** Ids whose record identity differs between two versions (added, replaced or removed), all trees. */
function changedIds(a: Document, b: Document): string[] {
  const out: string[] = [];
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    for (const [id, rec] of b.trees[tree].entries()) if (a.trees[tree].get(id) !== rec) out.push(id);
    for (const [id] of a.trees[tree].entries()) if (!b.trees[tree].has(id)) out.push(id);
  }
  return out;
}

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "remote");
}

describe("O4: incremental == from scratch", () => {
  const seeds = envNumber("MODEL_SEEDS", 150);
  const steps = 120;
  it(`holds over ${seeds} seeds × ${steps} random transactions (local + remote)`, () => {
    for (let seed = 1; seed <= seeds; seed++) {
      const r = rng(seed);
      const f = fixture(1);
      const peer = new Y.Doc();
      peer.clientID = 2;
      sync(f.doc, peer);
      const model = new Model(f.doc);
      const origin = createEditorOrigin();
      // Dirty-id coverage: every record whose identity changed or that was removed in a
      // step must be reported by one of the step's changes (a step can emit several).
      let stepDirty = new Set<string>();
      let stepFull = false;
      model.subscribe((c) => {
        for (const id of c.dirtyIds) stepDirty.add(id);
        stepFull ||= c.full;
      });
      const um = new Y.UndoManager(f.doc.getMap("v4"), { trackedOrigins: new Set([origin]), deleteFilter: flowContainerDeleteFilter, captureTimeout: 0 });
      for (let step = 0; step < steps; step++) {
        const prev = model.version;
        stepDirty = new Set();
        stepFull = false;
        try {
          const u = r();
          if (u < 0.06) um.undo();
          else if (u < 0.09) um.redo();
          else if (r() < 0.2) {
            peer.transact(() => randomWrite(r, peer));
            if (r() < 0.5) sync(peer, f.doc);
          } else {
            const n = r() < 0.25 ? 2 + Math.floor(r() * 3) : 1;
            f.doc.transact(() => {
              for (let i = 0; i < n; i++) randomWrite(r, f.doc);
            }, origin);
            if (r() < 0.2) sync(f.doc, peer);
          }
          expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
          if (!stepFull) expect(changedIds(prev, model.version).filter((id) => !stepDirty.has(id))).toEqual([]);
        } catch (e) {
          throw new Error(`seed ${seed} step ${step}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      // Read convergence: after a full sync both peers read the same document.
      sync(f.doc, peer);
      sync(peer, f.doc);
      try {
        expectSameVersion(deriveDocument(peer, BUILTIN_OBJECT_KINDS), deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
        expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
      } catch (e) {
        throw new Error(`seed ${seed} convergence: ${e instanceof Error ? e.message : String(e)}`);
      }
      um.destroy();
      model.destroy();
    }
  }, 600_000);

  it("reports dirty ids per transaction and leaves untouched records shared", () => {
    const f = fixture();
    const model = new Model(f.doc);
    f.doc.transact(() => {
      for (let i = 0; i < 5; i++) f.piece.insertEmbed(0, newParagraphMark());
    });
    const before = model.version;
    let dirty: ReadonlySet<string> = new Set();
    model.subscribe((c) => (dirty = c.dirtyIds));
    const target = idOf(mapAt(f.piece, 1));
    f.piece.insert(1, "x");
    expect([...dirty]).toEqual([target]);
    const untouched = [...before.trees.block.entries()].filter(([id]) => !dirty.has(id));
    for (const [id, b] of untouched) expect(model.version.trees.block.get(id)).toBe(b);
    model.destroy();
  });

  it("re-derives the whole document on an unrecognised write", () => {
    const f = fixture();
    const model = new Model(f.doc);
    let full = false;
    model.subscribe((c) => (full = c.full));
    f.docMap.set("somethingNew", 1);
    expect(full).toBe(true);
    const flow = new Y.Array<Y.Text>();
    flow.insert(0, [new Y.Text()]);
    f.docMap.set(FLOW_KEY, flow);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("a ¶ whose k becomes [S] leaves no orphan record", () => {
    const f = fixture();
    const model = new Model(f.doc);
    f.piece.insert(0, "a");
    f.piece.insertEmbed(1, newParagraphMark());
    const id = idOf(mapAt(f.piece, 1));
    mapAt(f.piece, 1).set("k", "sectionBreak");
    expect(model.version.trees.block.get(id)).toBeUndefined();
    expect(model.version.trees.block.get(`${id}/section`)?.type).toBe("section");
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("an unread-key edit keeps the record's identity and dirties nothing; a header body key change is not a full re-derive", () => {
    const f = fixture();
    f.piece.insert(0, "ab");
    f.piece.insertEmbed(2, newParagraphMark());
    f.piece.insertEmbed(3, newSectionBreak());
    childMap(f.docMap, BODIES_KEY)?.set("H", newBody());
    const model = new Model(f.doc);
    const id = idOf(mapAt(f.piece, 2));
    const before = model.version.trees.block.get(id);
    const section = model.version.trees.block.get(`${idOf(mapAt(f.piece, 3))}/section`);
    const changes: { dirty: number; full: boolean }[] = [];
    model.subscribe((c) => changes.push({ dirty: c.dirtyIds.size, full: c.full }));
    mapAt(f.piece, 2).set("unread", 1);
    mapAt(f.piece, 3).set("unread", 1);
    expect(model.version.trees.block.get(id)).toBe(before);
    expect(model.version.trees.block.get(`${idOf(mapAt(f.piece, 3))}/section`)).toBe(section);
    expect(changes).toEqual([
      { dirty: 0, full: false },
      { dirty: 0, full: false },
    ]);
    childMap(childMap(f.docMap, BODIES_KEY) ?? f.docMap, "H")?.set(FLOW_KEY, newFlow());
    expect(changes[2]?.full).toBe(false);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("a throwing onError never escapes into Yjs", () => {
    const f = fixture();
    const model = new Model(f.doc, BUILTIN_OBJECT_KINDS, () => {
      throw new Error("handler boom");
    });
    model.subscribe(() => {
      throw new Error("listener boom");
    });
    const pending: unknown[] = [];
    const orig = Reflect.get(globalThis, "queueMicrotask");
    Reflect.set(globalThis, "queueMicrotask", (cb: () => void) => pending.push(cb));
    try {
      expect(() => f.piece.insert(0, "x")).not.toThrow();
    } finally {
      Reflect.set(globalThis, "queueMicrotask", orig);
    }
    expect(pending).toHaveLength(1);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("edits inside sub-flows are incremental: nested pieces are their own segments", () => {
    const f = fixture();
    f.piece.insert(0, "ab");
    const inner = new Y.Text();
    inner.insert(0, "xy");
    f.piece.insertEmbed(1, newSubflow(inner));
    const model = new Model(f.doc);
    const changes: boolean[] = [];
    model.subscribe((c) => changes.push(c.full));
    inner.insert(1, "Q");
    inner.insertEmbed(3, newParagraphMark());
    f.doc.transact(() => {
      const deeper = new Y.Text();
      deeper.insert(0, "d");
      inner.insertEmbed(1, newSubflow(deeper));
    });
    const sub = inner._item?.parent;
    if (sub instanceof Y.Array) sub.insert(1, [new Y.Text()]);
    expect(changes.every((x) => !x)).toBe(true);
    expect(model.version.flows.get(f.rootId)?.segments.length).toBeGreaterThan(3);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("emits nothing for a comments-only transaction; a footnote anchor's key change is not a full re-derive", () => {
    const f = fixture();
    f.piece.insertEmbed(0, newFootnote());
    const model = new Model(f.doc);
    const changes: boolean[] = [];
    model.subscribe((c) => changes.push(c.full));
    childMap(f.docMap, "comments")?.set("c1", new Y.Map());
    expect(changes).toEqual([]);
    mapAt(f.piece, 0).set("x", 1);
    expect(changes).toEqual([false]);
    mapAt(f.piece, 0).set(BODY_KEY, newBody());
    expect(changes).toEqual([false, false]);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("isolates a throwing listener and recovers from a derivation error with a full re-derive", () => {
    const f = fixture();
    const errors: unknown[] = [];
    const model = new Model(f.doc, BUILTIN_OBJECT_KINDS, (e) => errors.push(e));
    const seen: boolean[] = [];
    model.subscribe(() => {
      throw new Error("listener boom");
    });
    model.subscribe((c) => seen.push(c.full));
    // Corrupt the current version's flow state so the incremental step throws.
    const fs = model.version.flows.get(f.rootId);
    if (fs === undefined) throw new Error("no flow");
    const broken = {
      ...fs,
      get segments(): never {
        throw new Error("derive boom");
      },
    };
    Reflect.set(model, "current", { ...model.version, flows: model.version.flows.set(f.rootId, broken) });
    expect(() => f.piece.insert(0, "x")).not.toThrow();
    expect(seen).toEqual([true]);
    expect(errors.map((e) => (e instanceof Error ? e.message : ""))).toEqual(["derive boom", "listener boom"]);
    expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
    model.destroy();
  });

  it("a second root write is refused", () => {
    expect(() => createDocMap(fixture().doc)).toThrow();
  });
});
