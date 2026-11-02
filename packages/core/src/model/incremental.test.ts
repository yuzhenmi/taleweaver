/**
 * O4: incremental derivation == from-scratch derivation, over random raw-Yjs writes
 * (local transactions with one or several writes, plus remote updates from a peer).
 * Commands arrive in M2; these writes deliberately include states commands never
 * produce, so every read rule's incremental path is exercised.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveDocument, type Document, type FlowState, type TreeKind } from "./derive";
import { Model } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import {
  BODIES_KEY,
  BODY_KEY,
  FLOW_KEY,
  LIST_DEFS_KEY,
  PIECES_KEY,
  SUBFLOW_DEPTH_CAP,
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
import { childrenOf, expectSameVersion, fixture, idOf, mapAt, textOf } from "./test-helpers";
import { applyPlan } from "./plan";
import { type ModelPosition, paragraphLayout, positionAtPoint } from "./position";
import { mapPosition } from "./mapping";
import { type RandomCommand, envNumber, lengthOf, paragraphIds, pick, randomCommand, rng, seedChunks, wellFormed } from "./oracle/generate";

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

const P_KEYS = ["p:type", "p:align", "m:bold", "t:ins"];
const P_VALUES = ["heading", "paragraph", "list-item", "center", "x", null, true, 3];

/** Storage index `i` of `piece` falls between the halves of a surrogate pair. */
function midPair(piece: Y.Text, i: number): boolean {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (i < n + it.length) {
      if (!(it.content instanceof Y.ContentString) || i === n) return false;
      const c = it.content.str.charCodeAt(i - n);
      return c >= 0xdc00 && c <= 0xdfff;
    }
    n += it.length;
  }
  return false;
}

/** One random raw write into `doc`. */
function randomWrite(r: () => number, doc: Y.Doc): void {
  const docMap = getDocMap(doc);
  if (docMap === null) return;
  const { pieces, flows, subArrays, maps } = storageOf(docMap);
  const piece = pick(r, pieces);
  if (piece === undefined) return;
  // Raw writes never land inside a surrogate pair: Yjs splitting a string there rewrites
  // both halves to U+FFFD, and a peer receiving that split for an item that is already
  // deleted gets no event for it (a Yjs quirk, see the M2 report). Commands never split
  // a pair (R15); only a foreign writer could.
  const cut = (i: number): number => (midPair(piece, i) ? i - 1 : i);
  const at = cut(Math.floor(r() * (piece.length + 1)));
  const roll = r();
  if (roll < 0.25) {
    piece.insert(at, pick(r, ["a", "bc", "def ", "é"]) ?? "a", r() < 0.3 ? { bold: true } : r() < 0.2 ? { italic: true } : {});
  } else if (roll < 0.37) {
    const keys: Record<string, string | number | boolean | null> = {};
    if (r() < 0.5) keys[pick(r, P_KEYS) ?? "p:type"] = pick(r, P_VALUES) ?? null;
    piece.insertEmbed(at, newParagraphMark(keys));
  } else if (roll < 0.5) {
    if (piece.length > 0) {
      const from = cut(Math.floor(r() * piece.length));
      const to = cut(Math.min(piece.length, from + 1 + Math.floor(r() * 4)));
      if (to > from) piece.delete(from, to - from);
    }
  } else if (roll < 0.56) {
    if (piece.length > 0) {
      const from = cut(Math.floor(r() * piece.length));
      const to = cut(Math.min(piece.length, from + 1 + Math.floor(r() * 5)));
      if (to > from) piece.format(from, to - from, { bold: r() < 0.5 ? true : null });
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
      // A chain of nested sub-flows, sometimes past the read's depth cap (read as inert).
      let tip = inner;
      for (let n = r() < 0.3 ? 1 + Math.floor(r() * 7) : 0; n > 0; n--) {
        const deeper = new Y.Text();
        deeper.insert(0, "deep");
        if (r() < 0.5) deeper.insertEmbed(2, newParagraphMark());
        tip.insertEmbed(2, newSubflow(deeper));
        tip = deeper;
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
    if (midPair(p.piece, p.index)) return;
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

// Yield a macrotask between tests: the long synchronous seed chunks otherwise starve the worker's
// RPC replies, and vitest reports a "Timeout calling onTaskUpdate" after 60 s of file time.
beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

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
  // Seeds run in chunks: one long test would time out the vitest worker RPC at MODEL_SEEDS=1500.
  for (const [from, to] of seedChunks(seeds)) it(`holds over seeds ${from}–${to} × ${steps} random transactions (local + remote)`, () => {
    for (let seed = from; seed <= to; seed++) {
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

  it("peer-controlled nesting is bounded: sub-flows past the depth cap and footnotes outside the body are inert", () => {
    const f = fixture();
    f.piece.insert(0, "ab");
    const model = new Model(f.doc);
    // 3000 nested sub-flows (well past any recursion-safe read without the cap), one level
    // per transaction as a peer could. Yjs itself is O(depth²) here, so not 10⁴.
    let cur = f.piece;
    let at = 1;
    for (let i = 0; i < 3000; i++) {
      const inner = new Y.Text();
      cur.insertEmbed(at, newSubflow(inner));
      inner.insert(0, `${i % 10}`);
      cur = inner;
      at = 1;
    }
    cur.insert(0, "deep");
    // A footnote chain: a footnote in a footnote body in a footnote body …
    f.piece.insertEmbed(0, newFootnote());
    let body = childMap(mapAt(f.piece, 0), BODY_KEY);
    for (let i = 0; i < 1000 && body !== null; i++) {
      const piece = flowOf(body)?.get(0);
      if (!(piece instanceof Y.Text)) break;
      piece.insertEmbed(0, newFootnote());
      body = childMap(mapAt(piece, 0), BODY_KEY);
    }
    const scratch = deriveDocument(f.doc, BUILTIN_OBJECT_KINDS);
    expectSameVersion(model.version, scratch);
    // Read in place down to the cap (depth 1..4 hold "0".."3"); deeper levels read as nothing.
    const para = childrenOf(scratch, "block", `${f.rootId}/final`)[0];
    expect(textOf(para)).toBe("￼a0123b");
    // Exactly one footnote body: the anchor inside it is inert.
    expect([...scratch.flows.entries()].filter(([, fs]) => fs.tree === "embedContent")).toHaveLength(1);
    model.destroy();
  }, 30_000); // ~5 s: Yjs is O(depth²) building the chain

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

// ---------------------------------------------------------------------------
// Commands on two peers (M2): every command's Plan is total on any reachable state,
// Apply never throws, incremental == scratch, peers converge; single-user runs keep
// W1 / W2 / A1 / A2.
// ---------------------------------------------------------------------------

/** The marker embeds of a version, all trees — footnote bodies only when `other` has them too (deleting a footnote deletes its body's markers). */
function markerCount(d: Document, other: Document): number {
  let n = 0;
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    for (const [, b] of d.trees[tree].entries()) {
      if (tree === "embedContent" && !other.flows.has(b.parentId ?? "")) continue;
      for (const i of b.inlineContent?.items ?? []) if (i.kind === "embed" && i.embedType === "marker") n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// A brute-force reader of one flow's storage, independent of the model's layout code:
// the oracle for exact mapping. Units in reading order, sub-flows read in place.
// ---------------------------------------------------------------------------

interface BruteUnit {
  readonly piece: Y.Text;
  readonly index: number;
  readonly kind: "read" | "inert" | "para" | "toc" | "S";
  readonly id: string;
}

function bruteUnits(fs: FlowState): { units: BruteUnit[]; gaps: Map<Y.Text, number[]> } {
  const units: BruteUnit[] = [];
  const gaps = new Map<Y.Text, number[]>();
  const footnotes = fs.tree === "block";
  const visit = (piece: Y.Text, depth: number): void => {
    const g: number[] = [];
    gaps.set(piece, g);
    let idx = 0;
    for (let it = piece._start; it !== null; it = it.right) {
      if (it.deleted || !it.countable) continue;
      const push = (kind: BruteUnit["kind"], i: number): void => {
        units.push({ piece, index: i, kind, id: `${it.id.client}:${it.id.clock}` });
      };
      const c = it.content;
      for (let k = 0; k < it.length; k++) g[idx + k] = units.length + k;
      if (c instanceof Y.ContentString) for (let k = 0; k < it.length; k++) push("read", idx + k);
      else if (c instanceof Y.ContentType && c.type instanceof Y.Map) {
        const m = c.type;
        const k = kindOf(m);
        if (k === "para") push("para", idx);
        else if (k === "toc") push("toc", idx);
        else if (k === "sectionBreak") push("S", idx);
        else if (k === "object" || k === "hr") push("read", idx);
        else if (k === "footnote") push(footnotes ? "read" : "inert", idx);
        else if (k === "marker") {
          const edge = m.get("edge");
          push(typeof m.get("ns") === "string" && typeof m.get("id") === "string" && (edge === "start" || edge === "end") ? "read" : "inert", idx);
        } else if (k === "sub" && depth < SUBFLOW_DEPTH_CAP) {
          const arr = m.get(PIECES_KEY);
          if (arr instanceof Y.Array) for (const sp of arr.toArray()) if (sp instanceof Y.Text) visit(sp, depth + 1);
        } else push("inert", idx);
      } else for (let k = 0; k < it.length; k++) push("inert", idx + k);
      idx += it.length;
    }
    g[idx] = units.length;
  };
  for (const p of fs.array?.toArray() ?? []) if (p instanceof Y.Text) visit(p, 0);
  return { units, gaps };
}

const isTerm = (u: BruteUnit | undefined): boolean => u !== undefined && (u.kind === "para" || u.kind === "toc" || u.kind === "S");

/** The flow holding paragraph `id` of `d`. */
function flowOfId(d: Document, id: string): FlowState | undefined {
  for (const [, fs] of d.flows.entries()) if (flowOrder(d, fs.holderId).includes(id)) return fs;
  return undefined;
}

/** Brute force: the storage point a position is anchored at (assoc −1: after the unit before it; 1: at the unit after it). */
function bruteAnchor(fs: FlowState, pos: ModelPosition, assoc: -1 | 1): { piece: Y.Text; index: number } | null {
  const { units } = bruteUnits(fs);
  const endIdx = pos.blockId.endsWith("/end") ? units.length : units.findIndex((u) => isTerm(u) && u.id === (pos.blockId.endsWith("/pre") ? pos.blockId.slice(0, -4) : pos.blockId));
  if (endIdx < 0) return null;
  let startIdx = endIdx - 1;
  while (startIdx >= 0 && !isTerm(units[startIdx])) startIdx--;
  const reads = units.slice(startIdx + 1, endIdx).filter((u) => u.kind === "read");
  const at = (u: BruteUnit | undefined, after: boolean): { piece: Y.Text; index: number } | null => (u === undefined ? null : { piece: u.piece, index: u.index + (after ? 1 : 0) });
  if (assoc < 0) {
    if (pos.offset > 0) return at(reads[pos.offset - 1], true);
    if (startIdx >= 0) return at(units[startIdx], true);
    const first = fs.array?.get(0);
    return first instanceof Y.Text ? { piece: first, index: 0 } : null;
  }
  if (pos.offset < reads.length) return at(reads[pos.offset], false);
  if (endIdx < units.length) return at(units[endIdx], false);
  const lastPiece = fs.array?.get((fs.array?.length ?? 1) - 1);
  return lastPiece instanceof Y.Text ? { piece: lastPiece, index: lastPiece.length } : null;
}

/** Brute force: the position at storage point (piece, index) — R1 / R2 / R17, else the nearest paragraph on the assoc side. */
function brutePosition(fs: FlowState, piece: Y.Text, index: number, assoc: -1 | 1): ModelPosition | null {
  const { units, gaps } = bruteUnits(fs);
  const g0 = gaps.get(piece)?.[index];
  if (g0 === undefined) return null;
  const synthetic = !units.some((u) => u.kind === "para" || u.kind === "toc" || u.kind === "read");
  const lenBefore = (term: number): number => {
    let n = 0;
    for (let i = term - 1; i >= 0 && !isTerm(units[i]); i--) if (units[i]?.kind === "read") n++;
    return n;
  };
  const at = (g: number): ModelPosition | { next: number | null; prev: number | null } => {
    let j = g;
    let after = 0;
    for (; j < units.length && !isTerm(units[j]); j++) if (units[j]?.kind === "read") after++;
    let i = g - 1;
    let before = 0;
    for (; i >= 0 && !isTerm(units[i]); i--) if (units[i]?.kind === "read") before++;
    const t = units[j];
    if (t !== undefined && t.kind === "para") return { blockId: t.id, offset: before };
    if (before + after > 0) return { blockId: t === undefined ? `${fs.holderId}/end` : `${t.id}/pre`, offset: before };
    if (t === undefined && synthetic) return { blockId: `${fs.holderId}/end`, offset: 0 };
    return { next: t === undefined ? null : j, prev: i >= 0 ? i : null };
  };
  const walk = (dir: -1 | 1): ModelPosition | null => {
    let p = at(g0);
    for (;;) {
      if ("blockId" in p) return p;
      if (dir > 0) {
        if (p.next === null) return null;
        p = at(p.next + 1);
      } else {
        if (p.prev === null) return null;
        const u = units[p.prev];
        if (u?.kind === "para") return { blockId: u.id, offset: lenBefore(p.prev) };
        p = at(p.prev);
      }
    }
  };
  return walk(assoc) ?? walk(assoc < 0 ? 1 : -1);
}

/** The blocks of a flow in reading order (ids). */
function flowOrder(d: Document, holderId: string): string[] {
  const fs = d.flows.get(holderId);
  if (fs === undefined) return [];
  const tree = d.trees[fs.tree];
  const out: string[] = [];
  for (const c of fs.isRoot ? fs.sections.map((x) => x.id) : [holderId]) {
    for (let id = tree.get(c)?.firstChildId ?? null; id !== null; ) {
      out.push(id);
      id = tree.get(id)?.nextSiblingId ?? null;
    }
  }
  return out;
}

/**
 * "Writes land only on the edited paragraphs, items the command creates and items it
 * deletes": every storage write of a selection command lands within the paragraphs
 * from the one before the selection to the one after it.
 */
function expectWritesLocal(cmd: RandomCommand): void {
  const p = cmd.plan;
  if (p === null || cmd.anywhere) return;
  const d = cmd.ctx.version;
  // Focus-based commands ignore an anchor in another flow (a cross-flow range is refused).
  const focusL = paragraphLayout(d, cmd.ctx.selection.focus.blockId);
  const fsOf = focusL?.fs;
  if (fsOf === undefined) return;
  const ends = [paragraphLayout(d, cmd.ctx.selection.anchor.blockId), focusL].filter((L) => L?.fs === fsOf);
  const order = flowOrder(d, fsOf.holderId);
  const idx = ends.map((L) => order.indexOf(L?.block.id ?? ""));
  const lo = Math.max(0, Math.min(...idx) - 1);
  const hi = Math.max(...idx) + 1;
  const allowed = new Set(order.slice(lo, hi + 1));
  // The paragraph at a point (a point between a terminator and a block object belongs to either
  // neighbour). A point the version cannot resolve is a failure.
  const ok = (piece: Y.Text, index: number): boolean => {
    for (const [, fs] of d.flows.entries()) {
      if (!fs.segIndex.has(piece)) continue;
      const sides = [positionAtPoint(d, fs, piece, index, -1)?.blockId, positionAtPoint(d, fs, piece, index, 1)?.blockId];
      return sides.some((id) => id !== undefined && allowed.has(id));
    }
    return false;
  };
  // An embedded item map's storage point (its parent piece and index).
  const mapPoint = (m: Y.Map<unknown>): { piece: Y.Text; index: number } | null => {
    const it = m._item;
    if (it === null || !(it.parent instanceof Y.Text)) return null;
    let n = 0;
    for (let x = it.parent._start; x !== null; x = x.right) {
      if (x === it) return { piece: it.parent, index: n };
      if (!x.deleted && x.countable) n += x.length;
    }
    return null;
  };
  const bodies = childMap(d.docMap, BODIES_KEY);
  for (const w of p.writes) {
    const fail = (where: string): never => {
      throw new Error(`write ${w.k} at ${where} outside ${[...allowed].join(",")} (roll ${cmd.roll})`);
    };
    if (w.k === "insert" || w.k === "delete" || w.k === "format") {
      const at = [w.index, ...(w.k === "insert" ? [] : [w.index + w.len - 1])];
      for (const i of at) if (!ok(w.piece, i)) fail(String(i));
    } else if (w.k === "keys") {
      // A ¶ of an allowed paragraph, an object in one, or a section owner ([S] / DocMap: C15, S2).
      if (w.map === d.docMap || kindOf(w.map) === "sectionBreak") continue;
      const id = typeId(w.map);
      if (id !== null && kindOf(w.map) === "para" && allowed.has(id)) continue;
      const pt = mapPoint(w.map);
      if (pt === null || !ok(pt.piece, pt.index)) fail(`map ${id ?? "detached"}`);
    } else if (w.k === "entry") {
      if (w.map !== bodies) fail("entry");
    }
  }
}

/** {@link wellFormed} on every flow of `d`. */
function expectWellFormed(d: Document, where: string): void {
  for (const [holderId, fs] of d.flows.entries()) {
    if (!wellFormed(fs)) throw new Error(`${where}: flow ${holderId} breaks R17 / R2 / A1 / A2 / W2: ${fs.segments.flatMap((seg) => seg.tokens.map((t) => t.k)).join(" ")}`);
  }
}

describe("commands (M2)", () => {
  const seeds = envNumber("MODEL_SEEDS", 150);
  const steps = 120;

  for (const [from, to] of seedChunks(seeds)) it(`two peers × seeds ${from}–${to} × ${steps} steps: commands + raw writes + undo; incremental == scratch; convergence; exact mapping == brute-force RelativePosition oracle`, () => {
    let oracleChecks = 0;
    for (let seed = from; seed <= to; seed++) {
      const r = rng(seed * 7919);
      const a = fixture(1);
      const b = new Y.Doc();
      b.clientID = 2;
      sync(a.doc, b);
      const peers = [
        { doc: a.doc, model: new Model(a.doc), origin: createEditorOrigin(), versions: 0 },
        { doc: b, model: new Model(b), origin: createEditorOrigin(), versions: 0 },
      ];
      for (const x of peers) x.model.subscribe(() => x.versions++);
      const um = new Y.UndoManager(a.doc.getMap("v4"), { trackedOrigins: new Set([peers[0]?.origin]), deleteFilter: flowContainerDeleteFilter, captureTimeout: 0 });
      for (let step = 0; step < steps; step++) {
        try {
          const peer = peers[r() < 0.5 ? 0 : 1];
          if (peer === undefined) continue;
          const u = r();
          const before = peer.model.version;
          peer.versions = 0;
          // A RelativePosition oracle for the exact mapping: anchored as Yjs anchors (assoc).
          const probeId = pick(r, paragraphIds(before));
          const probeAssoc: -1 | 1 = r() < 0.5 ? -1 : 1;
          const probeFs = probeId === undefined ? undefined : flowOfId(before, probeId);
          const probePos = probeId === undefined ? null : { blockId: probeId, offset: Math.floor(r() * (lengthOf(before, probeId) + 1)) };
          const probePt = probeFs === undefined || probePos === null ? null : bruteAnchor(probeFs, probePos, probeAssoc);
          const oracle = probePt === null ? null : Y.createRelativePositionFromTypeIndex(probePt.piece, probePt.index, probeAssoc < 0 ? -1 : 0);
          if (u < 0.05) um.undo();
          else if (u < 0.07) um.redo();
          else if (u < 0.17) peer.doc.transact(() => randomWrite(r, peer.doc), peer.origin);
          else {
            const c = randomCommand(r, before);
            if (c.plan !== null) expect(applyPlan(peer.model, c.plan, peer.origin)).not.toBeNull();
          }
          if (r() < 0.3) sync(a.doc, b);
          if (r() < 0.3) sync(b, a.doc);
          for (const x of peers) expectSameVersion(x.model.version, deriveDocument(x.doc, BUILTIN_OBJECT_KINDS));
          // An exactly mapped position resolves in the new version.
          if (oracle !== null && probePos !== null) {
            const now = peer.model.version;
            const m = mapPosition(before, now, probePos, probeAssoc);
            // Once the anchored unit is deleted, a later concurrent insert at that tombstone is
            // ordered by Yjs item order, which a delta does not carry: compare live anchors only.
            // Over ONE version step (one transaction). Across several, each intermediate position is
            // normalized into a paragraph, which a raw storage anchor is not.
            if (!m.deleted && peer.versions === 1) {
              const abs = Y.createAbsolutePositionFromRelativePosition(oracle, peer.doc);
              const nfs = probeFs === undefined ? undefined : now.flows.get(probeFs.holderId);
              const expected = abs === null || !(abs.type instanceof Y.Text) || nfs === undefined ? null : brutePosition(nfs, abs.type, abs.index, probeAssoc);
              expect(m.position).toEqual(expected);
              oracleChecks++;
            }
            if (m.position !== null) expect(paragraphIds(now)).toContain(m.position.blockId);
          }
        } catch (e) {
          throw new Error(`seed ${seed} step ${step}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`, { cause: e });
        }
      }
      sync(a.doc, b);
      sync(b, a.doc);
      try {
        expectSameVersion(deriveDocument(b, BUILTIN_OBJECT_KINDS), deriveDocument(a.doc, BUILTIN_OBJECT_KINDS));
        for (const x of peers) expectSameVersion(x.model.version, deriveDocument(x.doc, BUILTIN_OBJECT_KINDS));
      } catch (e) {
        throw new Error(`seed ${seed} convergence: ${e instanceof Error ? e.message : String(e)}`);
      }
      um.destroy();
      for (const x of peers) x.model.destroy();
    }
    // The oracle actually ran (most steps are one transaction).
    expect(oracleChecks).toBeGreaterThan((to - from + 1) * 20);
  }, 600_000);

  for (const [from, to] of seedChunks(seeds)) it(`single user × seeds ${from}–${to} × ${steps} commands keeps W1 / W2 / A1 / A2 (O5(a) subset, O7); writes stay local; markers survive Backspace / Delete`, () => {
    for (let seed = from; seed <= to; seed++) {
      const r = rng(seed * 104729);
      const f = fixture(1);
      const model = new Model(f.doc);
      const origin = createEditorOrigin();
      for (let step = 0; step < steps; step++) {
        try {
          const before = model.version;
          const c = randomCommand(r, before);
          expectWritesLocal(c);
          if (c.plan !== null) expect(applyPlan(model, c.plan, origin)).not.toBeNull();
          if (c.keepsMarkers) expect(markerCount(model.version, before)).toBe(markerCount(before, model.version));
          expectWellFormed(model.version, "single user");
        } catch (e) {
          throw new Error(`seed ${seed} step ${step}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        }
      }
      expectSameVersion(model.version, deriveDocument(f.doc, BUILTIN_OBJECT_KINDS));
      model.destroy();
    }
  }, 600_000);
});
