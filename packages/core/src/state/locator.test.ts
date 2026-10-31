/**
 * The per-block locator cache: warm edits never re-walk a region, and the cached
 * read model always equals a cold read (fresh doc, no caches) through local edits,
 * remote transactions, undo and structural changes.
 */
import { afterEach, describe, it, expect } from "vitest";
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { createTestAllocator } from "./block-id";
import type { Block } from "./block";
import { createDocument, getBlock, type Document } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { insertText } from "./ops/insert-text";
import { deleteRange } from "./ops/delete-range";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { reparentChildren } from "./ops/reparent-children";
import { deleteSectionBreak } from "./ops/merge-section";
import { applySectionBreak } from "./ops/section-break";
import { insertBlock } from "./ops/insert-block";
import { removeBlock } from "./ops/remove-block";
import { createPosition, createSpan } from "./block-position";
import { TEST_RESOLVER, buildBlock, buildDocument, inlineContent, text, withTestAttrs } from "../test-utils/document-builders";
import { locatorStats } from "./locator";
import { sectionWalkStats } from "./flow-read";
import { dirtyCompareStats } from "./flow-dirty";
import { getRegistry } from "./registry";
import { isPiece, isSubflowItem } from "./y-flow";
import { applyOperation, freshDocument } from "./document";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { applyAttrsToRange } from "./ops/apply-attrs";
import { captureDirtyIds, dirtyIdsFromTransaction } from "./yjs-doc";
import { insertChildren, type TreeNode } from "./flow-ops";
import { assertInvariantI, storageViolation } from "../test-utils/invariant-i";

declare const process: { env: Record<string, string | undefined> };

const id = (s: string) => s as BlockId;

function docOf(texts: readonly string[]): Document {
  const ids = texts.map((_, i) => `p${i}`);
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }),
      ...texts.map((t, i) =>
        buildBlock({
          id: `p${i}`,
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: ids[i - 1] ?? null,
          nextSiblingId: ids[i + 1] ?? null,
          inlineContent: inlineContent(t === "" ? [] : [text(t)]),
        }),
      ),
    ],
  });
}

function peer(s: Document, clientID: number): Document {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[DOCUMENT_INTERNAL].doc));
  // Each peer binds the attr registry, as its editor would (¶ props are judged through it).
  return withTestAttrs(createDocument({ resolver: TEST_RESOLVER, rootId: s.rootId, doc }));
}

const textOf = (b: Block | null): string =>
  (b?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "￼")).join("");

/** Every block in document order (sections entered) with its parent, links and text. */
function read(s: Document): string {
  const out: string[] = [];
  const walk = (start: BlockId | null): void => {
    for (let cur = start; cur !== null; ) {
      const b = getBlock(s, cur);
      if (b === null) throw new Error(`dangling ${cur}`);
      out.push(`${b.id}^${b.parentId ?? ""}<${b.prevSiblingId ?? ""}>${b.nextSiblingId ?? ""}[${b.firstChildId ?? ""},${b.lastChildId ?? ""}]:${textOf(b)}${b.type}${JSON.stringify(b.attrs)}${JSON.stringify(b.markAttrs ?? null)}`);
      walk(b.firstChildId);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(s, s.rootId)?.firstChildId ?? null);
  return out.join(" | ");
}

/** The same document read cold: a fresh doc with no derived caches. */
function coldRead(s: Document): string {
  return read(peer(s, 999));
}

// This file runs ~1 min of synchronous work. Vitest awaits only microtasks between tests,
// so without a macrotask turn the worker's event loop never services the runner's RPC
// replies and, under load, its RPC timer expires ("Timeout calling onTaskUpdate").
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("locator cache — warm edits never re-walk the region", () => {
  it("local typing after the first build costs no locator build", () => {
    let s = docOf(["alpha", "beta", "gamma"]);
    s = insertText(s, createPosition(id("p1"), 2), "x", {}).document;
    getBlock(s, id("p1"));
    const before = locatorStats.builds;
    for (let i = 0; i < 50; i++) {
      s = insertText(s, createPosition(id("p1"), 3 + i), "y", {}).document;
      getBlock(s, id("p1"));
    }
    s = deleteRange(s, createSpan(createPosition(id("p1"), 1), createPosition(id("p1"), 4))).document;
    getBlock(s, id("p1"));
    expect(locatorStats.builds).toBe(before);
    expect(textOf(getBlock(s, id("p1")))).toBe("byy" + "y".repeat(47) + "ta");
  });

  it("a remote keystroke into a cached block is applied in place (no rebuild)", () => {
    const a = docOf(["alpha", "beta"]);
    let b = peer(a, 2);
    getBlock(b, id("p1"));
    const bDoc = b[DOCUMENT_INTERNAL].doc;
    let remote = a;
    const before = locatorStats.builds;
    const comparesBefore = dirtyCompareStats.compares;
    for (let i = 0; i < 20; i++) {
      remote = insertText(remote, createPosition(id("p1"), 4 + i), "z", {}).document;
      Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(remote[DOCUMENT_INTERNAL].doc, Y.encodeStateVector(bDoc)), "peer");
    }
    b = createDocument({ resolver: TEST_RESOLVER, rootId: b.rootId, doc: bDoc });
    // Built once for the (fresh) remote doc of `a`, never again on `b`.
    expect(locatorStats.builds - before).toBeLessThanOrEqual(1);
    // A keystroke (local or remote) moves no boundary: its dirty owner is dirty outright,
    // no previous-version record is derived or compared.
    expect(dirtyCompareStats.compares - comparesBefore).toBe(0);
    expect(textOf(getBlock(b, id("p1")))).toBe("beta" + "z".repeat(20));
  });

  it("keystrokes at the seam after deleting many paragraphs cross the tombstones once", () => {
    const n = 3000;
    let s = docOf(Array.from({ length: n }, () => "some paragraph text"));
    s = deleteRange(s, createSpan(createPosition(id("p0"), 3), createPosition(id(`p${n - 1}`), 3))).document;
    // The survivor of a cross-paragraph delete is the LAST paragraph (its ¶ ends the joined content).
    const last = id(`p${n - 1}`);
    s = insertText(s, createPosition(last, 3), "x", {}).document;
    getBlock(s, last);
    const before = locatorStats.builds;
    for (let i = 0; i < 20; i++) {
      s = insertText(s, createPosition(last, 4 + i), "x", {}).document;
      getBlock(s, last);
    }
    expect(locatorStats.builds).toBe(before);
    expect(textOf(getBlock(s, last))).toBe("som" + "x".repeat(21) + "e paragraph text");
  }, 30_000);

  it("Enter, Backspace-merge and a remote keystroke in a sectioned document walk no section", () => {
    // Section-walk steps of edits in the final and a middle section, per document size:
    // the same at 300 and 3000 paragraphs — a paragraph's registry entry moves no parent,
    // and the previous version reads through the current version's section memos.
    const cost = (n: number): number => {
      let s = docOf(Array.from({ length: n }, () => "some paragraph text"));
      s = applySectionBreak(s, createPosition(id(`p${Math.floor(n / 3)}`), 0), createTestAllocator("sa")).document;
      s = applySectionBreak(s, createPosition(id(`p${Math.floor((2 * n) / 3)}`), 0), createTestAllocator("sb")).document;
      const b = peer(s, 7);
      const alloc = createTestAllocator("e");
      const edit = (target: BlockId, warm: boolean): number => {
        const before = sectionWalkStats.steps;
        const r = splitBlockAtPosition(s, createPosition(target, 4), alloc);
        s = mergeAdjacentBlocks(r.document, r.newBlockId, target).document;
        s = insertText(s, createPosition(target, 2), "x", {}).document;
        Y.applyUpdate(b[DOCUMENT_INTERNAL].doc, Y.encodeStateAsUpdate(s[DOCUMENT_INTERNAL].doc, Y.encodeStateVector(b[DOCUMENT_INTERNAL].doc)), "peer");
        getBlock(s, target);
        return warm ? 0 : sectionWalkStats.steps - before;
      };
      const fin = id(`p${n - 1}`); // the document's last paragraph: the final section's last child
      const mid = id(`p${Math.floor(n / 2)}`);
      edit(fin, true);
      edit(mid, true);
      let steps = 0;
      for (let i = 0; i < 3; i++) steps += edit(fin, false) + edit(mid, false);
      expect(textOf(getBlock(s, fin))).toBe("so" + "x".repeat(4) + "me paragraph text");
      return steps;
    };
    const small = cost(300);
    expect(cost(3000)).toBeLessThanOrEqual(small);
    expect(small).toBeLessThan(200);
  }, 60_000);
});

describe("locator cache — cached reads equal cold reads", () => {
  it("deleting a section mark whose previous section ends in an object re-reads the previous section", () => {
    let s = docOf(["A", "B", "C"]);
    s = insertBlock(s, getBlock(s, id("p2"))?.parentId ?? id("doc"), id("p2"), { type: "image", inlineContent: null }, createTestAllocator("img")).document;
    s = applySectionBreak(s, createPosition(id("p1"), 0), createTestAllocator("sa")).document;
    s = applySectionBreak(s, createPosition(id("p2"), 0), createTestAllocator("sb")).document;
    read(s); // warm every snapshot
    const sec = getBlock(s, id("p1"))?.parentId ?? null;
    if (sec === null) throw new Error("no section");
    s = deleteSectionBreak(s, sec).document;
    expect(read(s)).toBe(coldRead(s));
  });

  /** Deterministic PRNG. */
  function rng(seed: number): () => number {
    let x = seed;
    return () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x7fffffff;
    };
  }

  /** Leaf blocks in document order (sections entered): text blocks and objects. */
  function leavesOf(s: Document): { text: BlockId[]; objects: BlockId[] } {
    const text: BlockId[] = [];
    const objects: BlockId[] = [];
    const walk = (start: BlockId | null): void => {
      for (let cur = start; cur !== null; cur = getBlock(s, cur)?.nextSiblingId ?? null) {
        const b = getBlock(s, cur);
        if (b === null) return;
        if (b.inlineContent !== null) text.push(cur);
        else if (b.firstChildId === null && b.type !== "section") objects.push(cur);
        walk(b.firstChildId);
      }
    };
    walk(getBlock(s, s.rootId)?.firstChildId ?? null);
    return { text, objects };
  }
  const parentOf = (s: Document, b: BlockId): BlockId => getBlock(s, b)?.parentId ?? id("doc");
  /** The doc-root section holding `b`, or null. */
  const sectionOf = (s: Document, b: BlockId): BlockId | null => {
    for (let cur = getBlock(s, b); cur !== null; cur = cur.parentId === null ? null : getBlock(s, cur.parentId)) {
      if (cur.type === "section" && cur.parentId === s.rootId) return cur.id;
    }
    return null;
  };

  /** An undo manager scoped like `History`'s (pieces / sub-flows are never deleted by undo). */
  function undoManagerOf(s: Document): Y.UndoManager {
    return new Y.UndoManager([getRegistry(s[DOCUMENT_INTERNAL].doc)], {
      captureTimeout: 0,
      deleteFilter: (item: Y.Item) => !(isSubflowItem(item) || (item.content instanceof Y.ContentType && isPiece(item.content.type))),
    });
  }

  /** A fresh 1×1 table node (one empty paragraph in its cell). */
  function tableNode(alloc: ReturnType<typeof createTestAllocator>): TreeNode {
    const t = alloc.allocate();
    return {
      id: t,
      type: "table",
      attrs: {},
      inlineContent: null,
      children: [
        {
          id: alloc.allocate(),
          type: "table-row",
          attrs: {},
          inlineContent: null,
          children: [
            {
              id: alloc.allocate(),
              type: "table-cell",
              attrs: {},
              inlineContent: null,
              children: [{ id: alloc.allocate(), type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [] }],
            },
          ],
        },
      ],
    };
  }

  /**
   * One fuzz run: random local edits (text, split, merge, cross-block delete, moves,
   * objects, tables, section breaks / deletions, removals), undo / redo and two-way
   * syncs on two peers. After EVERY step: the op's result Document reads like a cold doc
   * (the dirty-set acceptance), and invariant I holds — in STORAGE after a local
   * primitive op on a peer whose storage satisfied it (+ the plain-¶ state check), in
   * the READ MODEL always (remote / undo / redo: every violation covered by an
   * implicit paragraph, nothing lost).
   */
  function fuzzRun(seed: number, steps: number): void {
    const r = rng(seed);
    const pick = <T,>(xs: readonly T[]): T => {
      const x = xs[Math.floor(r() * xs.length)];
      if (x === undefined) throw new Error("empty");
      return x;
    };
    let peers: Document[] = [peer(docOf(["one", "two two", "three", ""]), 1)];
    peers.push(peer(peers[0] as Document, 2));
    const alloc = createTestAllocator(`f${seed}`);
    const undos = peers.map(undoManagerOf);
    for (let step = 0; step < steps; step++) {
      const k = r() < 0.5 ? 0 : 1;
      let s = peers[k] as Document;
      const storageOk = storageViolation(s) === null;
      let local = true;
      const { text: ids, objects } = leavesOf(s);
      const target = pick(ids);
      const len = textOf(getBlock(s, target)).length;
      const at = Math.floor(r() * (len + 1));
      const op = r();
      const i = ids.indexOf(target);
      const where = `seed ${seed} step ${step} op ${op.toFixed(3)} target ${target}`;
      try {
        if (op < 0.25) s = insertText(s, createPosition(target, at), pick(["a", "bc", "def "]), {}).document;
        else if (op < 0.27) s = setBlockAttrs(s, target, { textAlign: r() < 0.3 ? undefined : pick(["center", "right"]) }).document;
        else if (op < 0.3) {
          // Formatting that may cover the target's ¶ (its `markAttrs`) and run into the next block.
          const next = ids[i + 1];
          const end = next !== undefined && r() < 0.5 ? createPosition(next, 0) : createPosition(target, len);
          s = applyAttrsToRange(s, createSpan(createPosition(target, at), end), { bold: r() < 0.5 ? true : undefined }).document;
        }
        else if (op < 0.4 && len > 0) {
          const end = Math.min(len, at + 1 + Math.floor(r() * 3));
          if (end > at) s = deleteRange(s, createSpan(createPosition(target, at), createPosition(target, end))).document;
        } else if (op < 0.5) s = splitBlockAtPosition(s, createPosition(target, at), alloc).document;
        else if (op < 0.57) {
          const next = getBlock(s, target)?.nextSiblingId ?? null;
          if (next !== null && getBlock(s, next)?.inlineContent != null) s = mergeAdjacentBlocks(s, target, next).document;
        } else if (op < 0.61 && ids.length > 1) {
          const moved = r() < 0.7 || objects.length === 0 ? target : pick(objects);
          const dest = pick([...ids, ...objects]);
          if (dest !== moved) s = reparentChildren(s, [moved], parentOf(s, dest), dest).document;
        } else if (op < 0.64 && ids.length > 2) {
          const far = ids[Math.min(ids.length - 1, i + 2)];
          const mid = ids[i + 1];
          const sib = (a: BlockId | undefined, b: BlockId | undefined): boolean => a !== undefined && b !== undefined && getBlock(s, a)?.nextSiblingId === b;
          if (far !== undefined && far !== target && sib(target, mid) && sib(mid, far)) {
            const flen = textOf(getBlock(s, far)).length;
            s = deleteRange(s, createSpan(createPosition(target, at), createPosition(far, Math.floor(r() * (flen + 1))))).document;
          }
        } else if (op < 0.68) {
          // An object before the target (a section break at a later target then leaves a section ending in it).
          s = insertBlock(s, parentOf(s, target), target, { type: "image", inlineContent: null }, alloc).document;
        } else if (op < 0.7) {
          const parent = parentOf(s, target);
          const node = tableNode(alloc);
          s = applyOperation(s, (doc) => insertChildren(doc, parent, r() < 0.5 ? target : null, [node], "block")).document;
        } else if (op < 0.73 && objects.length > 0) s = removeBlock(s, pick(objects)).document;
        else if (op < 0.75) s = removeBlock(s, target).document;
        else if (op < 0.79) s = applySectionBreak(s, createPosition(target, 0), alloc).document;
        else if (op < 0.83) {
          const sec = sectionOf(s, target);
          if (sec !== null) s = deleteSectionBreak(s, sec).document;
        } else if (op < 0.92) {
          local = false;
          const um = undos[k];
          const undo = r() < 0.6;
          // Advanced by its dirty set (like `History`), so the snapshot check covers undo / redo.
          s = freshDocument(s, captureDirtyIds(s[DOCUMENT_INTERNAL].doc, () => (undo ? um?.undo() : um?.redo())));
        } else {
          local = false;
          // Sync both ways (remote transactions on each side).
          const da = (peers[0] as Document)[DOCUMENT_INTERNAL].doc;
          const db = (peers[1] as Document)[DOCUMENT_INTERNAL].doc;
          // Each peer's Document advances by the remote transactions' dirty sets (the collab path).
          const remote = (from: Y.Doc, to: Y.Doc): Set<BlockId> => {
            const dirty = new Set<BlockId>();
            const on = (tx: Y.Transaction): void => {
              for (const d of dirtyIdsFromTransaction(to, tx)) dirty.add(d);
            };
            to.on("afterTransaction", on);
            Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "remote");
            to.off("afterTransaction", on);
            return dirty;
          };
          const dirtyB = remote(da, db);
          const dirtyA = remote(db, da);
          peers = [freshDocument(peers[0] as Document, dirtyA), freshDocument(peers[1] as Document, dirtyB)];
          s = peers[k] as Document;
        }
      } catch (e) {
        throw new Error(`${where}: ${String(e)}`);
      }
      // The op's result Document (its snapshot cache, invalidated by the dirty set) reads like a cold doc.
      let snap = "";
      try {
        snap = read(s);
      } catch (e) {
        throw new Error(`${where}: ${String(e)}`);
      }
      expect(snap, `${where} (result Document)`).toBe(coldRead(s));
      assertInvariantI(s, local && storageOk ? "storage" : "read", where);
      peers[k] = s;
      for (const p of peers) {
        expect(read(p), `${where} (peer Document)`).toBe(coldRead(p));
        const fresh = createDocument({ resolver: TEST_RESOLVER, rootId: p.rootId, doc: p[DOCUMENT_INTERNAL].doc });
        expect(read(fresh), where).toBe(coldRead(fresh));
        assertInvariantI(fresh, "read", where);
      }
    }
  }

  // Seeds 142 / 154: an implicit section lead emptied; a merge across a dropped empty section.
  // 305: a merge whose right paragraph is a derived duplicate copy (`X@c:k`) — the survivor id must be resolved before ¶L goes.
  // 752: deleting a section break whose section has a duplicate copy renames the copy — its children re-read (rename closure).
  // 946: a cross-block deleteRange from a duplicate copy (`X@c:k`) — removing the intervening block renames the anchor; it is re-derived from its ¶ item.
  const SEEDS = [...Array.from({ length: 24 }, (_, i) => i + 25), 142, 154, 305, 752, 946];
  // One test per seed: the work is fixed (120 steps per seed, undo capture is count-based),
  // so no wall-clock budget is shared across the whole seed set.
  it.each(SEEDS)("through random local edits, undo / redo, remote syncs and structural changes (objects, tables, sections, moves) on two peers (seed %i)", (seed) => {
    fuzzRun(seed, 120);
  }, 60_000);

  // The long acceptance run (≥ 1000 seeds): `TW_FUZZ_SEEDS=1000 npm test --workspace=packages/core -- locator`.
  // (Node globals are not in core's typed environment; vitest runs under Node.)
  const LONG = Number(process.env.TW_FUZZ_SEEDS ?? "0");
  it.skipIf(LONG === 0)(`long run: ${LONG} seeds`, () => {
    for (let seed = 1; seed <= LONG; seed++) fuzzRun(seed, 120);
  }, 3_600_000);
});
