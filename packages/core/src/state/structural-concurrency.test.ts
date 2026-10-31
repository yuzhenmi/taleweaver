/**
 * Structural identity under concurrency, part 2: implicit-entity materialization
 * and joins, MOVE semantics, table grids, dirty tiers, schema-3 upgrade + the
 * compatibility gate (legacy peer, second Yjs instance).
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";

// Minimal Node surface (the core tsconfig omits `@types/node`; see encapsulation.test.ts).
declare function require(id: "node:module"): { createRequire(url: string): (id: string) => unknown };
const { createRequire } = require("node:module");
import { createState, getBlock, type Document } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { insertText } from "./ops/insert-text";
import { removeBlock } from "./ops/remove-block";
import { insertBlock } from "./ops/insert-block";
import { deleteRange } from "./ops/delete-range";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { applyAttrsToRange } from "./ops/apply-attrs";
import { reparentChildren } from "./ops/reparent-children";
import { createTable } from "./ops/create-table";
import { insertTableRow } from "./ops/insert-table-row";
import { insertTableColumn } from "./ops/insert-table-column";
import { deleteTableColumn } from "./ops/delete-table-column";
import { mergeCells } from "./ops/merge-cells";
import { resolveTableContext, getChildIds } from "./table-context";
import { resolveCellRange } from "./table-cell-range";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { upgradeDocument, inspectDocument, type IncompatibleDocumentReport } from "./upgrade";
import { subscribeForeignChanges } from "./collab";
import { captureDirtyIds } from "./yjs-doc";
import { TEST_RESOLVER, buildBlock, buildState, inlineContent, text, withTestAttrs } from "../test-utils/state-builders";
import { legacyDoc } from "../test-utils/legacy-fixture";
import type { Block } from "./block";
import { readCtx, ownerOfUnit } from "./flow-read";
import { liveMarks } from "./mark-index";
import { insertFragment } from "./ops/insert-fragment";
import { replaceAllMatches } from "./ops/replace-matches";
import { findMatches } from "./find-matches";
import { collectBookmarks } from "./bookmarks";
import { embed } from "../test-utils/state-builders";

const id = (s: string) => s as BlockId;
/** The final section: the parent of a section-less document's top-level blocks. */
const fin = (s: Document): BlockId => getBlock(s, s.rootId)?.lastChildId ?? id("doc");

function docOf(blocks: ReadonlyArray<{ id: string; type?: string; text?: string }>): Document {
  const ids = blocks.map((b) => b.id);
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }),
      ...blocks.map((b, k) =>
        buildBlock({
          id: b.id,
          type: b.type ?? "paragraph",
          parentId: "doc",
          prevSiblingId: ids[k - 1] ?? null,
          nextSiblingId: ids[k + 1] ?? null,
          inlineContent: b.type === "image" ? null : inlineContent(b.text === undefined || b.text === "" ? [] : [text(b.text)]),
        }),
      ),
    ],
  });
}

function peer(s: Document, clientID: number): Document {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[STATE_INTERNAL].doc));
  return createState({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

function sync(a: Document, b: Document): [Document, Document] {
  const da = a[STATE_INTERNAL].doc;
  const db = b[STATE_INTERNAL].doc;
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da), "remote");
  Y.applyUpdate(da, Y.encodeStateAsUpdate(db), "remote");
  return [createState({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: da }), createState({ resolver: TEST_RESOLVER, rootId: b.rootId, doc: db })];
}

const textOf = (b: Block | null): string =>
  (b?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "￼")).join("");

/** Every leaf in document order as `id:text` (objects as `id`). */
function read(s: Document): string {
  const out: string[] = [];
  const walk = (start: BlockId | null): void => {
    for (let cur = start; cur !== null; ) {
      const b = getBlock(s, cur);
      if (b === null) throw new Error(`dangling ${cur}`);
      if (b.inlineContent !== null) out.push(`${b.id}:${textOf(b)}`);
      else if (b.firstChildId === null) out.push(b.id);
      else walk(b.firstChildId);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(s, s.rootId)?.firstChildId ?? null);
  return out.join(" | ");
}

describe("implicit paragraphs: materialization, joins, collapse", () => {
  /**
   * [img][P "abc"][Q "q"][img2][Z]: peer A removes P (¶Q then follows the image) while
   * peer B types in P and removes Q (¶P then follows it) → content with no ¶ before img2.
   */
  function strayAfterImage(stray = "X"): [Document, Document] {
    let [a, b] = [peer(docOf([{ id: "img", type: "image" }, { id: "P", text: "abc" }, { id: "Q", text: "q" }, { id: "img2", type: "image" }, { id: "Z", text: "z" }]), 1), null as Document | null];
    b = peer(a, 2);
    a = removeBlock(a, id("P")).state;
    b = removeBlock(insertText(b, createPosition(id("P"), 2), stray, {}).state, id("Q")).state;
    return sync(a, b);
  }

  it("stray content after an object reads as `${obj}#i` on both peers", () => {
    const [a, b] = strayAfterImage();
    expect(read(a)).toBe("img | img#i:X | img2 | Z:z");
    expect(read(b)).toBe(read(a));
  });

  it("removing a table that follows a holder-start stray run (`doc#i`) reports the run gone: it joins the next paragraph", () => {
    // [P "abc"][Q "q"][table][Z]: A removes P, B types in P and removes Q → "X" with no ¶ before the table.
    const base = createTable(docOf([{ id: "P", text: "abc" }, { id: "Q", text: "q" }, { id: "Z", text: "z" }]), createPosition(id("Z"), 0), 1, 1, createTestAllocator("t"));
    let [a, b] = [peer(base.state, 1), null as Document | null];
    b = peer(a, 2);
    a = removeBlock(a, id("P")).state;
    b = removeBlock(insertText(b, createPosition(id("P"), 2), "X", {}).state, id("Q")).state;
    [a] = sync(a, b);
    expect(read(a)).toBe("doc#i:X | t-3: | Z:z");
    let removed = a;
    const dirty = captureDirtyIds(a[STATE_INTERNAL].doc, () => {
      removed = removeBlock(a, base.newTableId).state;
    });
    expect(read(removed)).toBe("Z:Xz");
    expect(dirty.has(id("doc#i"))).toBe(true);
    expect(getBlock(removed, id("doc#i"))).toBeNull();
  });

  it("moving `${obj}#i` materializes it first (no derived id becomes a registry key)", () => {
    let [a] = strayAfterImage();
    a = reparentChildren(a, [id("img#i")], fin(a), id("img")).state;
    expect(a[STATE_INTERNAL].doc.getMap("registry").has("img#i")).toBe(false);
    const leaves = read(a).split(" | ");
    // The source gap between the two images gets a fresh ¶ (invariant I).
    expect(leaves).toHaveLength(5);
    expect(leaves[0]?.endsWith(":X")).toBe(true);
    expect(leaves[0]?.startsWith("img#i")).toBe(false);
    expect(leaves[1]).toBe("img");
    expect(leaves[2]?.endsWith(":")).toBe(true);
    expect(read(peer(a, 8))).toBe(read(a));
  });

  it("concurrent materialization (p5) reads identically on both peers and merges attrs key-wise", () => {
    let [a, b] = strayAfterImage();
    a = setBlockAttrs(a, id("img#i"), { align: "center" }).state;
    b = setBlockAttrs(b, id("img#i"), { indent: 2 }).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    const leaves = read(a).split(" | ");
    expect(leaves).toHaveLength(4);
    const joinedId = (leaves[1] ?? "").split(":")[0] ?? "";
    expect(getBlock(a, id(joinedId))?.attrs).toEqual({ align: "center", indent: 2 });
    expect(getBlock(b, id(joinedId))?.attrs).toEqual({ align: "center", indent: 2 });
  });

  it("typing / formatting / replace-all at the END of `${obj}#i` materializes its ¶ once: the text and the ¶ props hit that paragraph", () => {
    const typed = insertText(withTestAttrs(strayAfterImage()[0]), createPosition(id("img#i"), 1), "Y", { bold: true }).state;
    const [, run] = read(typed).split(" | ");
    const runId = id((run ?? "").split(":")[0] ?? "");
    expect(run?.endsWith(":XY")).toBe(true);
    expect(runId.endsWith("#i")).toBe(false);
    expect(getBlock(typed, runId)?.markAttrs).toEqual({ bold: true });
    const formatted = applyAttrsToRange(withTestAttrs(strayAfterImage()[0]), createSpan(createPosition(id("img#i"), 0), createPosition(id("img#i"), 1)), { italic: true }).state;
    const fId = id((read(formatted).split(" | ")[1] ?? "").split(":")[0] ?? "");
    expect(getBlock(formatted, fId)?.inlineContent?.items).toEqual([text("X", { italic: true })]);
    expect(getBlock(formatted, fId)?.markAttrs).toEqual({ italic: true });
    // Replace-all of two matches in the run: the first write materializes it; the second
    // replacement deletes from the materialized paragraph, not the stale derived id.
    const [s] = strayAfterImage("XaX");
    const replaced = replaceAllMatches(withTestAttrs(s), findMatches(s, "X", { caseSensitive: true }), "Y").state;
    expect(read(replaced).split(" | ")[1]?.endsWith(":YaY")).toBe(true);
  });

  it("the first write to a joined entity collapses it; concurrent collapses converge", () => {
    let [a, b] = strayAfterImage();
    a = setBlockAttrs(a, id("img#i"), { align: "center" }).state;
    b = setBlockAttrs(b, id("img#i"), { indent: 2 }).state;
    [a, b] = sync(a, b);
    const joinedId = id((read(a).split(" | ")[1] ?? "").split(":")[0] ?? "");
    a = insertText(a, createPosition(joinedId, 0), "<", {}).state;
    a = setBlockAttrs(a, joinedId, { align: "center", indent: 2, level: 1 }).state;
    b = setBlockAttrs(b, joinedId, { align: "center", indent: 2, color: "red" }).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a).split(" | ")).toHaveLength(4);
    expect(read(a)).toContain("<X");
  });
});

describe("the placement repair's fresh ¶ takes the preceding run's inclusive markAttrs", () => {
  it("a fresh ¶ terminating stray content gets its run's INCLUSIVE keys — never a link or provenance", () => {
    let a = peer(docOf([{ id: "img", type: "image" }, { id: "P", text: "abc" }, { id: "Q", text: "q" }, { id: "img2", type: "image" }, { id: "Z", text: "z" }]), 1);
    let b = peer(a, 2);
    a = removeBlock(a, id("P")).state;
    b = removeBlock(insertText(b, createPosition(id("P"), 3), "X", { bold: true, link: "https://x", insertionSuggestionId: "s1" }).state, id("Q")).state;
    [a] = sync(a, b);
    withTestAttrs(a[STATE_INTERNAL].doc);
    // Placing an image right after the stray run ([img][stray "X"][new img][img2]) runs
    // the repair over it: the run gets a fresh ¶ right before the new image.
    a = insertBlock(a, fin(a), id("img2"), { type: "image" }, createTestAllocator("n")).state;
    const leaves = read(a).split(" | ");
    const stray = leaves.find((l) => l.endsWith("X")) ?? "";
    const strayId = id(stray.split(":")[0] ?? "");
    expect(strayId.endsWith("#i")).toBe(false);
    expect(getBlock(a, strayId)?.markAttrs).toEqual({ bold: true });
  });
});

describe("MOVE (same ids, re-minted content)", () => {
  const four = () => docOf([{ id: "A", text: "a" }, { id: "B", text: "b" }, { id: "C", text: "c" }, { id: "D", text: "d" }]);

  it("a move keeps the id and attrs; undo-free read on a peer matches", () => {
    let [a, b] = [peer(setBlockAttrs(four(), id("B"), { align: "center" }).state, 1), null as Document | null];
    b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe("A:a | C:c | D:d | B:b");
    expect(read(b)).toBe(read(a));
    expect(getBlock(a, id("B"))?.attrs).toEqual({ align: "center" });
  });

  it("an edit during a move stays visible (misplaced, never lost)", () => {
    let a = peer(four(), 1);
    let b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    b = insertText(b, createPosition(id("B"), 1), "X", {}).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a).replace(/[^a-dX]/g, "")).toContain("X");
    expect(read(a)).toContain("B:b");
  });

  it("move × move to the same target joins the copies (both contents shown once)", () => {
    let a = peer(four(), 1);
    let b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    b = reparentChildren(b, [id("B")], fin(b), null).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a).match(/\bB/g)).toHaveLength(1);
  });

  it("move × move to different targets keeps both copies visible (canonical keeps the id)", () => {
    let a = peer(four(), 1);
    let b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    b = reparentChildren(b, [id("B")], fin(b), id("A")).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    const leaves = read(a).split(" | ");
    expect(leaves.filter((l) => l.endsWith(":b"))).toHaveLength(2);
    expect(leaves.some((l) => l.startsWith("B:"))).toBe(true);
    expect(leaves.some((l) => /^B@\d+:\d+:b$/.test(l))).toBe(true);
  });

  it("copies made consecutive by removing what was between them join and read BOTH contents in flow order", () => {
    let a = peer(four(), 1);
    let b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    b = reparentChildren(b, [id("B")], fin(b), id("A")).state;
    [a, b] = sync(a, b);
    const ids = read(a).split(" | ").map((l) => l.slice(0, l.lastIndexOf(":")));
    const copies = ids.flatMap((x, i) => (x === "B" || x.startsWith("B@") ? [i] : []));
    const [first, second] = copies;
    if (first === undefined || second === undefined) throw new Error("expected two copies");
    for (const between of ids.slice(first + 1, second)) a = removeBlock(a, id(between)).state;
    // Content in flow order: the first copy's "b", then the second's.
    expect(read(a)).toContain("B:bb");
    expect(read(peer(a, 5))).toBe(read(a));
    // Offsets count the whole chain: the second copy's character (right before its ¶) is offset 1 of B.
    const doc = a[STATE_INTERNAL].doc;
    const ctx = readCtx(doc);
    const offsets = [...liveMarks(doc, "B")].map((m) => (m.left === null ? null : ownerOfUnit(ctx, m.left)));
    expect(offsets.map((o) => o?.id)).toEqual(["B", "B"]);
    expect(offsets.map((o) => o?.offset).sort()).toEqual([0, 1]);
  });

  it("moving a duplicate copy (`B@c:k`) moves that copy under its real id (no colliding registry key)", () => {
    let a = peer(four(), 1);
    let b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    b = reparentChildren(b, [id("B")], fin(b), id("A")).state;
    [a, b] = sync(a, b);
    const dup = read(a).split(" | ").map((l) => l.slice(0, l.lastIndexOf(":"))).find((x) => x.startsWith("B@"));
    if (dup === undefined) throw new Error("expected a duplicate copy");
    a = reparentChildren(a, [id(dup)], fin(a), id("D")).state;
    expect(a[STATE_INTERNAL].doc.getMap("registry").has(dup)).toBe(false);
    const leaves = read(a).split(" | ");
    expect(leaves.filter((l) => l.endsWith(":b"))).toHaveLength(2);
    expect(read(peer(a, 6))).toBe(read(a));
  });

  it("leaf move × delete: move wins (the entry survives the delete)", () => {
    let a = peer(setBlockAttrs(four(), id("B"), { align: "center" }).state, 1);
    let b = peer(a, 2);
    a = reparentChildren(a, [id("B")], fin(a), null).state;
    b = removeBlock(b, id("B")).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a)).toBe("A:a | C:c | D:d | B:b");
    expect(getBlock(a, id("B"))?.attrs).toEqual({ align: "center" });
  });
});

describe("tables are a grid", () => {
  function withTable(): { s: Document; tableId: BlockId } {
    const base = docOf([{ id: "P", text: "x" }]);
    const r = createTable(base, createPosition(id("P"), 1), 2, 2, createTestAllocator("t"));
    return { s: r.state, tableId: r.newTableId };
  }
  const cellPara = (s: Document, tableId: BlockId, r: number, c: number): BlockId => {
    const row = getChildIds(s, tableId)[r];
    const cell = row === undefined ? undefined : getChildIds(s, row)[c];
    const p = cell === undefined ? null : (getBlock(s, cell)?.firstChildId ?? null);
    if (p === null) throw new Error(`no cell paragraph at ${r},${c}`);
    return p;
  };
  const shape = (s: Document, tableId: BlockId) => getChildIds(s, tableId).map((r) => getChildIds(s, r).length);

  it("concurrent row × column inserts converge to a full grid (no ragged row)", () => {
    const { s, tableId } = withTable();
    let a = peer(s, 1);
    let b = peer(s, 2);
    const ctxA = resolveTableContext(a, cellPara(a, tableId, 0, 0));
    const ctxB = resolveTableContext(b, cellPara(b, tableId, 0, 0));
    if (ctxA === null || ctxB === null) throw new Error("no table context");
    a = insertTableRow(a, ctxA, "below", createTestAllocator("ra")).state;
    b = insertTableColumn(b, ctxB, "right", createTestAllocator("cb")).state;
    [a, b] = sync(a, b);
    expect(shape(a, tableId)).toEqual([3, 3, 3]);
    expect(shape(b, tableId)).toEqual([3, 3, 3]);
    expect(read(a)).toBe(read(b));
  });

  it("merge-cells moves nothing: covered text reads in the anchor; a peer typing in a covered cell stays visible", () => {
    const { s, tableId } = withTable();
    let a = peer(s, 1);
    a = insertText(a, createPosition(cellPara(a, tableId, 0, 1), 0), "right", {}).state;
    let b = peer(a, 2);
    const range = resolveCellRange(a, createSpan(createPosition(cellPara(a, tableId, 0, 0), 0), createPosition(cellPara(a, tableId, 0, 1), 0)));
    if (range === null) throw new Error("no range");
    a = mergeCells(a, range).state;
    b = insertText(b, createPosition(cellPara(b, tableId, 0, 1), 5), "!", {}).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(shape(a, tableId)).toEqual([1, 2]);
    expect(read(a)).toContain("right!");
  });

  it("column delete × typing in it: delete wins (container delete), the rest converges", () => {
    const { s, tableId } = withTable();
    let a = peer(s, 1);
    let b = peer(s, 2);
    const ctx = resolveTableContext(a, cellPara(a, tableId, 0, 1));
    if (ctx === null) throw new Error("no table context");
    a = deleteTableColumn(a, ctx).state;
    b = insertText(b, createPosition(cellPara(b, tableId, 1, 1), 0), "gone", {}).state;
    [a, b] = sync(a, b);
    expect(shape(a, tableId)).toEqual([1, 1]);
    expect(read(a)).toBe(read(b));
    expect(read(a)).not.toContain("gone");
  });
});

describe("dead pieces are skipped, and revive on insert", () => {
  it("a peer's typing inside a mass-deleted range reappears after the deleter has read across it", () => {
    const n = 3000;
    const s = docOf(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `t${i}` })));
    let a = peer(s, 1);
    let b = peer(s, 2);
    a = deleteRange(a, createSpan(createPosition(id("p0"), 1), createPosition(id(`p${n - 1}`), 1))).state;
    expect(read(a)).toBe(`p${n - 1}:t${n - 1}`); // walks (and caches) the dead pieces (the last ¶ survives)
    b = insertText(b, createPosition(id("p1500"), 0), "PEER", {}).state;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a)).toContain("PEER");
  }, 30_000);
});

describe("dirty tiers", () => {
  it("typing dirties only the owning block (siblings are never dirtied)", () => {
    const s = docOf([{ id: "A", text: "a" }, { id: "B", text: "b" }, { id: "C", text: "c" }]);
    const r = insertText(s, createPosition(id("B"), 1), "x", {});
    expect([...r.dirtyIds]).toEqual(["B"]);
  });

  it("a remote keystroke dirties only its block", () => {
    const s = docOf([{ id: "A", text: "abc" }, { id: "B", text: "b" }]);
    const b = peer(s, 2);
    const seen: BlockId[][] = [];
    const off = subscribeForeignChanges(b, "self-b", (d) => seen.push([...d]), () => {});
    const remote = insertText(peer(s, 3), createPosition(id("A"), 3), "!", {}).state;
    Y.applyUpdate(b[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(remote[STATE_INTERNAL].doc), "peer");
    off();
    expect(seen.flat()).toEqual(["A"]);
  });
});

describe("schema 3 upgrade and the compatibility gate", () => {
  it("upgrades a schema-1 document to schema 3 (frozen legacy roots by default); with no attr registry bound it throws and writes nothing", () => {
    const doc = legacyDoc([text("hello")], [text("world")]);
    expect(inspectDocument(doc).schemaVersion).toBe(1);
    expect(() => upgradeDocument(doc, { resolver: TEST_RESOLVER })).toThrow(/AttrRegistry/);
    expect(inspectDocument(doc).schemaVersion).toBe(1);
    const report = upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    expect(report.toVersion).toBe(3);
    expect(inspectDocument(doc).schemaVersion).toBe(3);
    const s = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc });
    expect(read(s)).toBe("p1:hello | p2:world");
    expect(doc.getMap("blocks").size).toBe(3); // frozen, not cleared
    // Idempotent without a bound registry: an unbound CURRENT doc rewrites nothing, so it needs none.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(upgradeDocument(copy, { resolver: TEST_RESOLVER }).fromVersion).toBe(3);
  });

  it("upgrades a schema-2 document (one Y.Text per block)", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap("meta").set("rootId", "doc");
      doc.getMap("meta").set("schemaVersion", 2);
      const blocks = doc.getMap<Y.Map<unknown>>("blocks");
      const mk = (fields: Record<string, unknown>): Y.Map<unknown> => {
        const m = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(fields)) m.set(k, v);
        m.set("attrs", new Y.Map<unknown>());
        return m;
      };
      const t = new Y.Text();
      t.insert(0, "two", { bold: true });
      blocks.set("doc", mk({ type: "document", parentId: null, prevSiblingId: null, nextSiblingId: null, firstChildId: "p", lastChildId: "p", inlineContent: null }));
      blocks.set("p", mk({ type: "paragraph", parentId: "doc", prevSiblingId: null, nextSiblingId: null, firstChildId: null, lastChildId: null, inlineContent: t }));
    });
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    const s = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc });
    expect(getBlock(s, id("p"))?.inlineContent?.items).toEqual([{ kind: "text", text: "two", attrs: { bold: true } }]);
  });

  it("clearLegacy empties the legacy roots", () => {
    const doc = legacyDoc([text("x")]);
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER, clearLegacy: true });
    expect(doc.getMap("blocks").size).toBe(0);
    expect(read(createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc }))).toBe("p1:x | p2:");
  });

  it("a legacy peer typing after the upgrade HALTS the subscription once, with the text in the report", () => {
    const legacy = legacyDoc([text("hello")]);
    const legacyPeer = new Y.Doc();
    Y.applyUpdate(legacyPeer, Y.encodeStateAsUpdate(legacy));
    upgradeDocument(withTestAttrs(legacy), { resolver: TEST_RESOLVER });
    const s = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc: legacy });
    const reports: IncompatibleDocumentReport[] = [];
    let changes = 0;
    const off = subscribeForeignChanges(s, "self", () => changes++, (r) => reports.push(r));
    // The legacy peer types into its (schema-1) run text.
    const runs = legacyPeer.getMap<Y.Map<unknown>>("blocks").get("p1")?.get("inlineContent");
    if (!(runs instanceof Y.Array)) throw new Error("fixture");
    const first = runs.get(0) as Y.Map<unknown>;
    const yText = first.get("text");
    if (!(yText instanceof Y.Text)) throw new Error("fixture");
    yText.insert(5, " world");
    Y.applyUpdate(legacy, Y.encodeStateAsUpdate(legacyPeer), "legacy-peer");
    Y.applyUpdate(legacy, Y.encodeStateAsUpdate(legacyPeer), "legacy-peer");
    off();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.reason).toBe("legacy-write");
    expect(reports[0]?.legacyBlocks).toContain("p1");
    expect(reports[0]?.legacyText.p1).toBe("hello world");
    expect(changes).toBe(0);
  });

  it("a legacy write landing BEFORE the subscription starts is detected when it starts", async () => {
    const legacy = legacyDoc([text("hello")]);
    const legacyPeer = new Y.Doc();
    Y.applyUpdate(legacyPeer, Y.encodeStateAsUpdate(legacy));
    upgradeDocument(withTestAttrs(legacy), { resolver: TEST_RESOLVER });
    const s = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc: legacy });
    // The legacy write lands between createState and the backend's watch.
    const runs = legacyPeer.getMap<Y.Map<unknown>>("blocks").get("p1")?.get("inlineContent");
    if (!(runs instanceof Y.Array)) throw new Error("fixture");
    const yText = (runs.get(0) as Y.Map<unknown>).get("text");
    if (!(yText instanceof Y.Text)) throw new Error("fixture");
    yText.delete(0, 1); // a delete-only legacy write counts too
    Y.applyUpdate(legacy, Y.encodeStateAsUpdate(legacyPeer), "legacy-peer");
    const reports: IncompatibleDocumentReport[] = [];
    let changes = 0;
    const off = subscribeForeignChanges(s, "self", () => changes++, (r) => reports.push(r));
    await Promise.resolve();
    // Withheld while halted.
    insertText(s, createPosition(id("p1"), 0), "z", {});
    off();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.reason).toBe("legacy-write");
    expect(reports[0]?.legacyBlocks).toContain("p1");
    expect(reports[0]?.legacyText.p1).toBe("ello");
    expect(changes).toBe(0);
    // Surfaced: a host resuming over the same Y.Doc starts a gate that does not re-report it…
    const again: IncompatibleDocumentReport[] = [];
    const off2 = subscribeForeignChanges(s, "self", () => {}, (r) => again.push(r));
    await Promise.resolve();
    off2();
    expect(again).toHaveLength(0);
    // …but a NEWER legacy write landing before the next gate starts is found.
    yText.insert(0, "Y");
    Y.applyUpdate(legacy, Y.encodeStateAsUpdate(legacyPeer), "legacy-peer");
    const third: IncompatibleDocumentReport[] = [];
    const off3 = subscribeForeignChanges(s, "self", () => {}, (r) => third.push(r));
    await Promise.resolve();
    off3();
    expect(third.map((r) => r.legacyText.p1)).toEqual(["Yello"]);
  });

  it("an upgraded document with untouched frozen roots starts compatible", async () => {
    const legacy = legacyDoc([text("hello")]);
    upgradeDocument(withTestAttrs(legacy), { resolver: TEST_RESOLVER });
    const reports: IncompatibleDocumentReport[] = [];
    const off = subscribeForeignChanges(createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc: legacy }), "self", () => {}, (r) => reports.push(r));
    await Promise.resolve();
    off();
    expect(reports).toHaveLength(0);
  });

  it("a second Yjs instance applying updates to a bound doc HALTS it", () => {
    const s = docOf([{ id: "A", text: "a" }]);
    const reports: IncompatibleDocumentReport[] = [];
    const off = subscribeForeignChanges(s, "self", () => {}, (r) => reports.push(r));
    const other = peer(s, 9);
    const edited = insertText(other, createPosition(id("A"), 1), "b", {}).state;
    const Y2 = createRequire(import.meta.url)("yjs") as typeof Y;
    expect(Y2.Item).not.toBe(Y.Item);
    Y2.applyUpdate(s[STATE_INTERNAL].doc, Y2.encodeStateAsUpdate(edited[STATE_INTERNAL].doc, Y2.encodeStateVector(s[STATE_INTERNAL].doc)), "foreign");
    off();
    expect(reports.map((r) => r.reason)).toEqual(["second-yjs-instance"]);
  });
});

describe("duplicate bookmark ids under concurrency", () => {
  /** A one-paragraph clip holding a bookmark pair `b` around "X" (a cut's fragment). */
  const clip = (): Document =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "c", lastChildId: "c" }),
        buildBlock({
          id: "c", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([embed("bookmark-start", { bookmarkId: "b" }), text("X"), embed("bookmark-end", { bookmarkId: "b" })]),
        }),
      ],
    });
  const paste = (s: Document, at: string, offset: number, tag: string): Document => {
    const pos = createPosition(id(at), offset);
    return insertFragment(s, createSpan(pos, pos), clip(), createTestAllocator(tag)).state;
  };

  it("two peers each paste a pair with the same id: both sides pair the SAME markers (first live start ↔ first end after it)", () => {
    for (const [atB, offB] of [["Q", 0], ["P", 1], ["P", 0]] as const) {
      const base = docOf([{ id: "P", text: "abc" }, { id: "Q", text: "def" }]);
      let a = peer(base, 1);
      let b = peer(base, 2);
      a = paste(a, "P", 0, "pa");
      b = paste(b, atB, offB, "pb");
      // Each peer kept its pasted pair: no live pair of `b` existed at paste time.
      expect(collectBookmarks(a).get("b")).toBeDefined();
      expect(collectBookmarks(b).get("b")).toBeDefined();
      [a, b] = sync(a, b);
      expect(read(a)).toBe(read(b));
      const pa = collectBookmarks(a);
      expect(pa).toEqual(collectBookmarks(b));
      expect([...pa.keys()]).toEqual(["b"]);
      const range = pa.get("b");
      expect(range?.start.blockId).toBe("P");
    }
  });
});
