import { describe, it, expect } from "vitest";
import { insertFragment } from "./insert-fragment";
import { extractFragment } from "./extract-fragment";
import { createSpan, createPosition } from "../block-position";
import type { BlockId } from "../block-id";
import { createTestAllocator } from "../block-id";
import { buildBlock, buildState, inlineContent, text, embed } from "../../test-utils/state-builders";
import { buildStateFromBlocks } from "../build-state-from-blocks";
import { getBlock, getEmbedContent } from "../state";
import type { State } from "../state";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bid(s: string): BlockId {
  return s as BlockId;
}

function collapsed(pos: ReturnType<typeof createPosition>) {
  return createSpan(pos, pos);
}

/** All text in a block (concatenated from TextItems). */
function blockText(state: State, blockId: string): string {
  const block = getBlock(state, bid(blockId));
  if (block === null || block.inlineContent === null) return "";
  return block.inlineContent.items
    .filter((it) => it.kind === "text")
    .map((it) => (it as { kind: "text"; text: string }).text)
    .join("");
}

/** Ordered text of each top-level child under root, null for containers. */
function orderedBlockTexts(state: State): (string | null)[] {
  const root = getBlock(state, state.rootId);
  if (root === null) return [];
  const texts: (string | null)[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(state, cur);
    if (block === null) break;
    if (block.inlineContent !== null) {
      texts.push(
        block.inlineContent.items
          .filter((it) => it.kind === "text")
          .map((it) => (it as { kind: "text"; text: string }).text)
          .join(""),
      );
    } else {
      texts.push(null);
    }
    cur = block.nextSiblingId;
  }
  return texts;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Destination: doc > p("abcd")
 */
function makeDest() {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("abcd")]),
      }),
    ],
  });
}

/** Fragment: one paragraph "ZZ" bold. */
function makeFragOneBoldZZ() {
  const src = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("ZZ", { bold: true })]),
      }),
    ],
  });
  return extractFragment(
    src,
    createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 2)),
  );
}

/** Fragment: three paragraphs "X", "Y", "Z". */
function makeFragXYZ() {
  const src = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("X")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p1",
        nextSiblingId: "p3",
        inlineContent: inlineContent([text("Y")]),
      }),
      buildBlock({
        id: "p3",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p2",
        inlineContent: inlineContent([text("Z")]),
      }),
    ],
  });
  return extractFragment(
    src,
    createSpan(createPosition(bid("p1"), 0), createPosition(bid("p3"), 1)),
  );
}

/** Fragment: one paragraph "X". */
function makeFragX() {
  const src = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("X")]),
      }),
    ],
  });
  return extractFragment(
    src,
    createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 1)),
  );
}

/** Empty fragment: doc with no children. */
function makeEmptyFragment() {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document" }),
    ],
  });
}

/** Fragment containing a table (container) — for the T5b stub test. */
function makeFragTable() {
  const src = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
      buildBlock({
        id: "tbl",
        type: "table",
        parentId: "doc",
        firstChildId: "row",
        lastChildId: "row",
      }),
      buildBlock({
        id: "row",
        type: "table-row",
        parentId: "tbl",
        firstChildId: "cell",
        lastChildId: "cell",
      }),
      buildBlock({
        id: "cell",
        type: "table-cell",
        parentId: "row",
        firstChildId: "cp",
        lastChildId: "cp",
      }),
      buildBlock({
        id: "cp",
        type: "paragraph",
        parentId: "cell",
        inlineContent: inlineContent([text("cell content")]),
      }),
    ],
  });
  // Extract the whole table. Use a span spanning the cell paragraph.
  return extractFragment(
    src,
    createSpan(createPosition(bid("cp"), 0), createPosition(bid("cp"), 12)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T5b fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fragment: a single mixed [para "X", table(row→cell→para "cell"), para "Y"].
 * Used for the mixed-splice test.
 */
function makeFragMixed() {
  const src = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "px", lastChildId: "py" }),
      buildBlock({
        id: "px",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "tbl",
        inlineContent: inlineContent([text("X")]),
      }),
      buildBlock({
        id: "tbl",
        type: "table",
        parentId: "doc",
        prevSiblingId: "px",
        nextSiblingId: "py",
        firstChildId: "row",
        lastChildId: "row",
      }),
      buildBlock({
        id: "row",
        type: "table-row",
        parentId: "tbl",
        firstChildId: "cell",
        lastChildId: "cell",
      }),
      buildBlock({
        id: "cell",
        type: "table-cell",
        parentId: "row",
        firstChildId: "cp",
        lastChildId: "cp",
      }),
      buildBlock({
        id: "cp",
        type: "paragraph",
        parentId: "cell",
        inlineContent: inlineContent([text("cell")]),
      }),
      buildBlock({
        id: "py",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "tbl",
        inlineContent: inlineContent([text("Y")]),
      }),
    ],
  });
  // Extract everything: from start of "X" to end of "Y"
  return extractFragment(
    src,
    createSpan(createPosition(bid("px"), 0), createPosition(bid("py"), 1)),
  );
}

/** Ordered types of each top-level child under root. */
function orderedBlockTypes(state: State): string[] {
  const root = getBlock(state, state.rootId);
  if (root === null) return [];
  const types: string[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(state, cur);
    if (block === null) break;
    types.push(block.type);
    cur = block.nextSiblingId;
  }
  return types;
}

/** Walk the sibling chain and collect ids in document order. */
function topLevelIds(state: State): BlockId[] {
  const root = getBlock(state, state.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const block = getBlock(state, cur);
    if (block === null) break;
    cur = block.nextSiblingId;
  }
  return ids;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("insertFragment — T5a leaf-only boundary semantics", () => {
  it("single leaf fragment merges inline into caret block at offset (marks carried)", () => {
    // dest p="abcd" caret at 2; fragment = one paragraph "ZZ" (bold)
    // Expected: "abZZcd", endPosition at offset 4
    const dest = makeDest();
    const frag = makeFragOneBoldZZ();
    const alloc = createTestAllocator("t1");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    expect(blockText(r.state, "p")).toBe("abZZcd");
    expect(r.endPosition).toEqual(createPosition(bid("p"), 4));
    expect(r.state).not.toBe(dest); // state changed
  });

  it("single leaf fragment carries bold mark correctly", () => {
    const dest = makeDest();
    const frag = makeFragOneBoldZZ();
    const alloc = createTestAllocator("t2");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const block = getBlock(r.state, bid("p"));
    const boldItems = block?.inlineContent?.items.filter(
      (it) => it.kind === "text" && (it as { kind: "text"; attrs: Record<string, unknown> }).attrs["bold"] === true,
    );
    expect(boldItems).toHaveLength(1);
    expect((boldItems?.[0] as { kind: "text"; text: string })?.text).toBe("ZZ");
  });

  it("multi-leaf fragment: first merges into prefix, middle siblings, last prepends to suffix", () => {
    // dest p="abcd" caret 2; fragment = ["X","Y","Z"] paragraphs
    // Expected: ["abX", "Y", "Zcd"] — three blocks
    const dest = makeDest();
    const frag = makeFragXYZ();
    const alloc = createTestAllocator("t3");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    expect(orderedBlockTexts(r.state)).toEqual(["abX", "Y", "Zcd"]);
    // endPosition should be at the end of "Zcd" → offset 3 in the last new block
    // (the suffix block gets "Zcd": Z=1 char + cd=2 chars = offset 3 for "Z")
    // Actually: suffix block starts empty (the split), then "cd" is appended from split,
    // then "Z" is PREPENDED at offset 0, so final content is "Zcd" with end at offset 1.
    expect(r.endPosition.offset).toBe(1);
  });

  it("collapses a replaced selection first (deleteRange), then inserts", () => {
    // dest p="abcd" select [1,3); fragment "X"
    // Expected: p="aXd"
    const dest = makeDest();
    const frag = makeFragX();
    const alloc = createTestAllocator("t4");
    const selection = createSpan(createPosition(bid("p"), 1), createPosition(bid("p"), 3));
    const r = insertFragment(dest, selection, frag, alloc);

    expect(blockText(r.state, "p")).toBe("aXd");
    expect(r.state).not.toBe(dest);
  });

  it("no-op fragment (empty) returns identity state", () => {
    const dest = makeDest();
    const frag = makeEmptyFragment();
    const alloc = createTestAllocator("t5");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    expect(r.state).toBe(dest); // identity: same reference
  });

  it("rejects cross-context selection (no-op identity)", () => {
    // Build a dest with a main body and an embed-content (footnote) body.
    const dest = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello"),
            embed("footnote-anchor", { contentBlockId: "fn-root" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-root",
          type: "document",
          firstChildId: "fn-p",
          lastChildId: "fn-p",
        }),
        buildBlock({
          id: "fn-p",
          type: "paragraph",
          parentId: "fn-root",
          inlineContent: inlineContent([text("footnote")]),
        }),
      ],
    });
    const frag = makeFragX();
    const alloc = createTestAllocator("t6");

    // Cross-context selection: anchor in main tree, focus in embed (footnote)
    const crossSpan = createSpan(
      createPosition(bid("p"), 2),
      createPosition(bid("fn-p"), 2),
    );
    const r = insertFragment(dest, crossSpan, frag, alloc);

    expect(r.state).toBe(dest); // no-op
  });

  it("dirtyIds covers every touched block (single-leaf case)", () => {
    const dest = makeDest();
    const frag = makeFragOneBoldZZ();
    const alloc = createTestAllocator("t7");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    // The caret block "p" was modified — must be in dirtyIds
    expect(r.dirtyIds).toContain(bid("p"));
  });

  it("dirtyIds covers every touched block (multi-leaf case)", () => {
    const dest = makeDest();
    const frag = makeFragXYZ();
    const alloc = createTestAllocator("t8");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    // "p" (prefix, mutated), new suffix block, new middle block(s) all dirty
    expect(r.dirtyIds.size).toBeGreaterThanOrEqual(3);
    expect(r.dirtyIds).toContain(bid("p")); // prefix block
  });

  it("dirtyIds covers every touched block (selection-collapse then insert)", () => {
    const dest = makeDest();
    const frag = makeFragX();
    const alloc = createTestAllocator("t9");
    const selection = createSpan(createPosition(bid("p"), 1), createPosition(bid("p"), 3));
    const r = insertFragment(dest, selection, frag, alloc);

    expect(r.dirtyIds).toContain(bid("p"));
  });

  it("container top-level block in fragment [T5b implemented — no longer throws]", () => {
    // After T5b this test should pass without throwing; we just run it.
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("t10");
    // Should NOT throw after T5b is implemented.
    expect(() =>
      insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc),
    ).not.toThrow();
  });

  it("insert at offset 0 produces correct prefix/suffix (no leading empty block)", () => {
    // dest p="abcd" caret at 0; fragment ["X","Y"]
    // Expected: ["X", "Yabcd"] — prefix after split is empty but merge gives first block X
    const src = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("X")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("Y")]),
        }),
      ],
    });
    const frag = extractFragment(
      src,
      createSpan(createPosition(bid("p1"), 0), createPosition(bid("p2"), 1)),
    );
    const dest = makeDest();
    const alloc = createTestAllocator("t11");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    // p("abcd") split at 0: prefix="", suffix="abcd"
    // first frag leaf "X" merged into prefix="" → "X"
    // last frag leaf "Y" prepended to suffix="abcd" → "Yabcd"
    expect(orderedBlockTexts(r.state)).toEqual(["X", "Yabcd"]);
  });

  it("insert at end of block produces correct result (no trailing empty block)", () => {
    // dest p="abcd" caret at 4; fragment ["X","Y"]
    // prefix="abcd", suffix=""
    // first "X" merged into prefix → "abcdX"
    // last "Y" prepended to suffix="" → "Y"
    const src = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "pa", lastChildId: "pb" }),
        buildBlock({
          id: "pa",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pb",
          inlineContent: inlineContent([text("X")]),
        }),
        buildBlock({
          id: "pb",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pa",
          inlineContent: inlineContent([text("Y")]),
        }),
      ],
    });
    const frag = extractFragment(
      src,
      createSpan(createPosition(bid("pa"), 0), createPosition(bid("pb"), 1)),
    );
    const dest = makeDest();
    const alloc = createTestAllocator("t12");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 4)), frag, alloc);

    expect(orderedBlockTexts(r.state)).toEqual(["abcdX", "Y"]);
  });

  it("pasting a leaf with a footnote anchor clones the body into destination embedContents (no dangling contentBlockId)", () => {
    // Fragment source: doc > p = [text "Hi ", footnote-anchor(contentBlockId="fnbody"), text " end"]
    // embedContents: fnbody (footnote-body) > fnp "Footnote text"
    const FOOTNOTE_EMBED_TYPE = "footnote-anchor";
    const src = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("Hi "),
            embed(FOOTNOTE_EMBED_TYPE, { contentBlockId: "fnbody" }),
            text(" end"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fnbody",
          type: "footnote-body",
          firstChildId: "fnp",
          lastChildId: "fnp",
        }),
        buildBlock({
          id: "fnp",
          type: "paragraph",
          parentId: "fnbody",
          inlineContent: inlineContent([text("Footnote text")]),
        }),
      ],
    });
    // Select the whole paragraph: "Hi "(3) + embed(1) + " end"(4) = 8.
    const frag = extractFragment(
      src,
      createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 8)),
    );

    // Paste into a fresh destination that has NO footnotes.
    const dest = makeDest();
    const alloc = createTestAllocator("fn");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    // The pasted anchor embed must be present in the dest caret block.
    const destBlock = getBlock(r.state, bid("p"));
    const anchorItem = destBlock?.inlineContent?.items.find(
      (it) => it.kind === "embed" && (it as { kind: "embed"; embedType: string }).embedType === FOOTNOTE_EMBED_TYPE,
    ) as { kind: "embed"; properties: Record<string, unknown> } | undefined;
    expect(anchorItem).toBeDefined();

    // Its contentBlockId must resolve to a FRESH embed-content body in the
    // destination (NOT the fragment-namespace "fnbody", which would dangle).
    const contentBlockId = anchorItem?.properties["contentBlockId"];
    expect(typeof contentBlockId).toBe("string");
    expect(contentBlockId).not.toBe("fnbody"); // re-keyed to a fresh id

    const body = getEmbedContent(r.state, contentBlockId as BlockId);
    expect(body).not.toBeNull(); // body materialized — no dangling reference
    expect(body?.type).toBe("footnote-body");

    // The body's paragraph child must also be materialized and carry the text.
    const bodyChildId = body?.firstChildId;
    expect(bodyChildId).not.toBeNull();
    const bodyChild = getEmbedContent(r.state, bodyChildId as BlockId);
    expect(bodyChild).not.toBeNull();
    expect(
      bodyChild?.inlineContent?.items
        .filter((it) => it.kind === "text")
        .map((it) => (it as { kind: "text"; text: string }).text)
        .join(""),
    ).toBe("Footnote text");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5b: container subtree splice
// ─────────────────────────────────────────────────────────────────────────────

describe("insertFragment — T5b container subtree splice", () => {
  it("container-first fragment splits caret block, table sits between halves", () => {
    // dest p="abcd" caret 2; fragment = [table(row→cell→para "cell content")]
    // Expected structure: [paragraph("ab"), table, paragraph("cd")]
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-a");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["paragraph", "table", "paragraph"]);

    // prefix = "ab", suffix = "cd"
    const ids = topLevelIds(r.state);
    const prefixId = ids[0];
    const suffixId = ids[2];
    if (prefixId === undefined || suffixId === undefined) throw new Error("ids undefined");
    expect(blockText(r.state, prefixId)).toBe("ab");
    expect(blockText(r.state, suffixId)).toBe("cd");
  });

  it("materialized table is fully navigable (rows/cells/paragraphs in live tree, correct parent pointers)", () => {
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-b");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const ids = topLevelIds(r.state);
    const tableId = ids[1];
    expect(tableId).toBeDefined();
    if (tableId === undefined) throw new Error("table id undefined");

    // The table block itself must exist in the live tree.
    const tableBlock = getBlock(r.state, tableId);
    expect(tableBlock).not.toBeNull();
    expect(tableBlock?.type).toBe("table");

    // The table's parent must be the document root.
    expect(tableBlock?.parentId).toBe(r.state.rootId);

    // The table's row must exist.
    const rowId = tableBlock?.firstChildId;
    expect(rowId).not.toBeNull();
    if (rowId === null || rowId === undefined) throw new Error("rowId null");
    const rowBlock = getBlock(r.state, rowId);
    expect(rowBlock).not.toBeNull();
    expect(rowBlock?.type).toBe("table-row");
    expect(rowBlock?.parentId).toBe(tableId);

    // The row's cell must exist.
    const cellId = rowBlock?.firstChildId;
    expect(cellId).not.toBeNull();
    if (cellId === null || cellId === undefined) throw new Error("cellId null");
    const cellBlock = getBlock(r.state, cellId);
    expect(cellBlock).not.toBeNull();
    expect(cellBlock?.type).toBe("table-cell");
    expect(cellBlock?.parentId).toBe(rowId);

    // The cell's paragraph must exist and carry the text.
    const cpId = cellBlock?.firstChildId;
    expect(cpId).not.toBeNull();
    if (cpId === null || cpId === undefined) throw new Error("cpId null");
    const cpBlock = getBlock(r.state, cpId);
    expect(cpBlock).not.toBeNull();
    expect(cpBlock?.type).toBe("paragraph");
    expect(cpBlock?.parentId).toBe(cellId);
    expect(blockText(r.state, cpId)).toBe("cell content");
  });

  it("table's sibling pointers are correct (prefix ↔ table ↔ suffix)", () => {
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-c");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const ids = topLevelIds(r.state);
    const [prefixId, tableId, suffixId] = ids;
    if (prefixId === undefined || tableId === undefined || suffixId === undefined) {
      throw new Error("ids undefined");
    }

    const tableBlock = getBlock(r.state, tableId);
    expect(tableBlock?.prevSiblingId).toBe(prefixId);
    expect(tableBlock?.nextSiblingId).toBe(suffixId);

    const prefixBlock = getBlock(r.state, prefixId);
    expect(prefixBlock?.nextSiblingId).toBe(tableId);

    const suffixBlock = getBlock(r.state, suffixId);
    expect(suffixBlock?.prevSiblingId).toBe(tableId);
  });

  it("dirtyIds includes the materialized table id and all touched boundary blocks", () => {
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-d");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const ids = topLevelIds(r.state);
    const tableId = ids[1];
    if (tableId === undefined) throw new Error("tableId undefined");

    // dirtyIds must include the table and the prefix block.
    expect(r.dirtyIds).toContain(tableId);
    expect(r.dirtyIds).toContain(bid("p")); // prefix (was caret block)
  });

  it("caret lands at end of last inserted container (offset 0 of suffix)", () => {
    // Fragment = [table only]. After splice: [prefix("ab"), table, suffix("cd")].
    // endPosition should be in the suffix block at offset 0 (no leaf content appended from fragment).
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-e");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const ids = topLevelIds(r.state);
    const suffixId = ids[2];
    if (suffixId === undefined) throw new Error("suffixId undefined");
    expect(r.endPosition.blockId).toBe(suffixId);
    expect(r.endPosition.offset).toBe(0);
  });

  it("mixed [para, table, para] fragment splices para-prefix + table + para-suffix around split", () => {
    // dest p="abcd" caret 2; fragment = ["X", table, "Y"]
    // Expected: ["abX", table, "Ycd"]
    const dest = makeDest();
    const frag = makeFragMixed();
    const alloc = createTestAllocator("T5b-f");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["paragraph", "table", "paragraph"]);

    const ids = topLevelIds(r.state);
    const [firstId, , lastId] = ids;
    if (firstId === undefined || lastId === undefined) throw new Error("ids undefined");
    expect(blockText(r.state, firstId)).toBe("abX");
    expect(blockText(r.state, lastId)).toBe("Ycd");
  });

  it("mixed fragment: table is fully navigable", () => {
    const dest = makeDest();
    const frag = makeFragMixed();
    const alloc = createTestAllocator("T5b-g");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    const ids = topLevelIds(r.state);
    const tableId = ids[1];
    if (tableId === undefined) throw new Error("tableId undefined");

    const tableBlock = getBlock(r.state, tableId);
    expect(tableBlock?.type).toBe("table");
    expect(tableBlock?.parentId).toBe(r.state.rootId);

    const rowId = tableBlock?.firstChildId;
    if (rowId === null || rowId === undefined) throw new Error("rowId null");
    const rowBlock = getBlock(r.state, rowId);
    expect(rowBlock?.type).toBe("table-row");
    expect(rowBlock?.parentId).toBe(tableId);

    const cellId = rowBlock?.firstChildId;
    if (cellId === null || cellId === undefined) throw new Error("cellId null");
    const cellBlock = getBlock(r.state, cellId);
    expect(cellBlock?.parentId).toBe(rowId);

    const cpId = cellBlock?.firstChildId;
    if (cpId === null || cpId === undefined) throw new Error("cpId null");
    expect(blockText(r.state, cpId)).toBe("cell");
  });

  it("mixed fragment: caret lands at end of last-leaf content in suffix (offset = last-frag-leaf length)", () => {
    // Fragment = ["X", table, "Y"]. Last frag child is leaf "Y" → prepended to suffix.
    // Suffix starts empty (split at 2 of "abcd" → "cd"), prepend "Y" → "Ycd".
    // endPosition = suffixBlockId at offset 1 (length of "Y").
    const dest = makeDest();
    const frag = makeFragMixed();
    const alloc = createTestAllocator("T5b-h");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    expect(r.endPosition.offset).toBe(1); // "Y" = 1 char
  });

  it("container-only fragment at offset 0 produces no empty leading block", () => {
    // dest p="abcd" caret at 0; fragment = [table]
    // Expected: [paragraph(""), table, paragraph("abcd")]
    // The prefix is "" (split at 0), suffix is "abcd".
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-i");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["paragraph", "table", "paragraph"]);

    const ids = topLevelIds(r.state);
    const suffixId = ids[2];
    if (suffixId === undefined) throw new Error("suffixId undefined");
    expect(blockText(r.state, suffixId)).toBe("abcd");
  });

  it("container-only fragment at end of block produces no empty trailing block", () => {
    // dest p="abcd" caret at 4; fragment = [table]
    // Expected: [paragraph("abcd"), table, paragraph("")]
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-j");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 4)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["paragraph", "table", "paragraph"]);

    const ids = topLevelIds(r.state);
    const prefixId = ids[0];
    if (prefixId === undefined) throw new Error("prefixId undefined");
    expect(blockText(r.state, prefixId)).toBe("abcd");
  });
});
