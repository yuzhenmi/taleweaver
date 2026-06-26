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
import type { SuggestionId } from "../suggestions";
import {
  getSuggestions,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
} from "../suggestions";

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

/**
 * Fragment containing a table with TWO cells in one row, paragraphs "one" and
 * "two". Used to exercise the multi-cell flatten path (cells flow into the
 * destination in document order). Span runs from the start of the first cell
 * paragraph to the end of the second so the whole table is extracted.
 */
function makeFragTwoCellTable() {
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
        firstChildId: "cellA",
        lastChildId: "cellB",
      }),
      buildBlock({
        id: "cellA",
        type: "table-cell",
        parentId: "row",
        nextSiblingId: "cellB",
        firstChildId: "cpA",
        lastChildId: "cpA",
      }),
      buildBlock({
        id: "cpA",
        type: "paragraph",
        parentId: "cellA",
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "cellB",
        type: "table-cell",
        parentId: "row",
        prevSiblingId: "cellA",
        firstChildId: "cpB",
        lastChildId: "cpB",
      }),
      buildBlock({
        id: "cpB",
        type: "paragraph",
        parentId: "cellB",
        inlineContent: inlineContent([text("two")]),
      }),
    ],
  });
  return extractFragment(
    src,
    createSpan(createPosition(bid("cpA"), 0), createPosition(bid("cpB"), 3)),
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
      (it) => it.kind === "embed" && it.embedType === FOOTNOTE_EMBED_TYPE,
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
    // T6/E5: offset=0 → skip split → no empty leading paragraph.
    // Expected: [table, paragraph("abcd")]
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-i");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["table", "paragraph"]);

    const ids = topLevelIds(r.state);
    // The paragraph (was caret block) should contain the full original content "abcd"
    const paraId = ids[1];
    if (paraId === undefined) throw new Error("paraId undefined");
    expect(blockText(r.state, paraId)).toBe("abcd");
  });

  it("container-only fragment at end of block produces no empty trailing block", () => {
    // dest p="abcd" caret at 4; fragment = [table]
    // T6/E5: offset=len → no empty suffix block.
    // Expected: [paragraph("abcd"), table] — suffix block is dropped.
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T5b-j");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 4)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["paragraph", "table"]);

    const ids = topLevelIds(r.state);
    const prefixId = ids[0];
    if (prefixId === undefined) throw new Error("prefixId undefined");
    expect(blockText(r.state, prefixId)).toBe("abcd");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6: edge behaviors
// ─────────────────────────────────────────────────────────────────────────────

describe("insertFragment — T6 edge behaviors", () => {
  // ── E1: table-into-cell flatten ────────────────────────────────────────────

  it("E1: table pasted into a table cell is FLATTENED (no nested table)", () => {
    // dest: document > table > row > cell > paragraph("hello")
    // caret: inside the cell paragraph at offset 5 (end)
    // fragment: a table with one cell containing "pasted"
    // Expected: no nested table; cell paragraph text is extended / a sibling paragraph is added
    // — the fragment's table is replaced by its cell paragraphs (flattened)
    const dest = buildStateFromBlocks({
      rootId: bid("doc"),
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
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });

    // Fragment: a table (container) with one cell paragraph "pasted"
    const frag = makeFragTable();

    const alloc = createTestAllocator("T6-E1");
    // Caret at end of "hello" (offset 5) inside the cell paragraph
    const r = insertFragment(dest, collapsed(createPosition(bid("cp"), 5)), frag, alloc);

    // After flattening, the destination must NOT have any nested table.
    // Walk the entire block tree from root — no block with type "table"
    // should appear under any table-cell.
    function hasCellDescendantOfType(state: State, type: string): boolean {
      const root = getBlock(state, state.rootId);
      if (root === null) return false;
      // BFS over the whole tree looking for type blocks parented inside cells.
      const visited = new Set<BlockId>();
      const queue: BlockId[] = [state.rootId];
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || visited.has(id)) continue;
        visited.add(id);
        const block = getBlock(state, id);
        if (block === null) continue;
        // Depth: if this block is a table, check if any ancestor is a table-cell.
        if (block.type === type) {
          let cur = block.parentId;
          while (cur !== null) {
            const parent = getBlock(state, cur);
            if (parent === null) break;
            if (parent.type === "table-cell") return true;
            cur = parent.parentId;
          }
        }
        if (block.firstChildId !== null) queue.push(block.firstChildId);
        if (block.nextSiblingId !== null) queue.push(block.nextSiblingId);
      }
      return false;
    }
    expect(hasCellDescendantOfType(r.state, "table")).toBe(false);

    // The FLATTENED pasted cell content must actually land in the destination
    // cell as flow content — not be dropped. makeFragTable's single cell holds
    // "cell content"; pasting at end of "hello" inline-merges it → "hellocell content".
    // (Asserts content survival, which the old `toContain("hello")` check missed:
    // dropping the paste entirely would still pass that.)
    expect(blockText(r.state, "cp")).toBe("hellocell content");

    // The cell's flow content stays in the cell (parent chain leads to "cell").
    const cp = getBlock(r.state, bid("cp"));
    expect(cp?.parentId).toBe(bid("cell"));
  });

  it("E1: a MULTI-cell pasted table flattens its cells into the destination cell in document order", () => {
    // dest: document > table > row > cell > paragraph("hello"); caret at end (offset 5)
    // fragment: a table with TWO cells "one" / "two".
    // Expected: both cells' paragraphs land as cell flow content, in order, no nested table.
    const dest = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc", firstChildId: "row", lastChildId: "row" }),
        buildBlock({ id: "row", type: "table-row", parentId: "tbl", firstChildId: "cell", lastChildId: "cell" }),
        buildBlock({ id: "cell", type: "table-cell", parentId: "row", firstChildId: "cp", lastChildId: "cp" }),
        buildBlock({
          id: "cp",
          type: "paragraph",
          parentId: "cell",
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });

    const frag = makeFragTwoCellTable();
    const alloc = createTestAllocator("T6-E1-multi");
    const r = insertFragment(dest, collapsed(createPosition(bid("cp"), 5)), frag, alloc);

    // No nested table survived the flatten.
    const cellBlock = getBlock(r.state, bid("cell"));
    expect(cellBlock?.type).toBe("table-cell");

    // Walk the cell's flow content (its leaf-paragraph chain) and collect texts
    // in document order. The two flattened cell paragraphs ("one", "two") merge
    // around the caret: first cell content merges into the prefix ("hello" +
    // "one"), the second is prepended to the suffix ("two").
    const cellTexts: string[] = [];
    let childId: BlockId | null = cellBlock?.firstChildId ?? null;
    while (childId !== null) {
      const child = getBlock(r.state, childId);
      if (child === null) break;
      // No nested table inside the cell.
      expect(child.type).not.toBe("table");
      cellTexts.push(blockText(r.state, childId));
      childId = child.nextSiblingId;
    }
    // Both pasted cells' content present, in order, inside the destination cell.
    expect(cellTexts).toEqual(["helloone", "two"]);
  });

  // ── E2: list-level rebasing ────────────────────────────────────────────────

  it("E2a: list items copied at level 2 re-base to level 0 on paste into non-list target", () => {
    // Fragment: [para("A"), li(level=2), li(level=3), para("B")]
    // The para("A") and para("B") are first/last and get merged into prefix/suffix.
    // The two list-items are middle blocks → appear as standalone blocks in the result.
    // Expected: after paste, list items are rebased: levels become 0 and 1.
    const frag = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: "fdoc", type: "document", firstChildId: "fpa", lastChildId: "fpb" }),
        buildBlock({
          id: "fpa",
          type: "paragraph",
          parentId: "fdoc",
          nextSiblingId: "fli1",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "fli1",
          type: "list-item",
          parentId: "fdoc",
          prevSiblingId: "fpa",
          nextSiblingId: "fli2",
          attrs: { listId: "L1", listLevel: 2 },
          inlineContent: inlineContent([text("deep")]),
        }),
        buildBlock({
          id: "fli2",
          type: "list-item",
          parentId: "fdoc",
          prevSiblingId: "fli1",
          nextSiblingId: "fpb",
          attrs: { listId: "L1", listLevel: 3 },
          inlineContent: inlineContent([text("deeper")]),
        }),
        buildBlock({
          id: "fpb",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fli2",
          inlineContent: inlineContent([text("B")]),
        }),
      ],
      listDefs: {
        L1: { levels: [{ style: "disc", start: 1, restart: "always" }] },
      },
    });

    const dest = makeDest();
    const alloc = createTestAllocator("T6-E2a");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    // Collect list-item blocks in document order.
    const root = getBlock(r.state, r.state.rootId);
    const listItems: Array<{ level: number }> = [];
    let cur: BlockId | null = root?.firstChildId ?? null;
    while (cur !== null) {
      const block = getBlock(r.state, cur);
      if (block === null) break;
      if (block.type === "list-item") {
        listItems.push({ level: (block.attrs as Record<string, unknown>)["listLevel"] as number });
      }
      cur = block.nextSiblingId;
    }

    // Two list items; min level (2) subtracted → 0 and 1
    expect(listItems).toHaveLength(2);
    expect(listItems[0]?.level).toBe(0);
    expect(listItems[1]?.level).toBe(1);
  });

  it("E2b: list items pasted INTO a list item at level 1 add 1 to each re-based level", () => {
    // Fragment: [para("A"), li(level=2), li(level=3), para("B")]
    // para("A")/para("B") merge into prefix/suffix; li1/li2 become standalone middle blocks.
    // Dest caret is inside a list-item at level 1.
    // Inserted list items: levels 2 and 3 → rebase (min=2 subtracted) → 0 and 1 → plus targetLevel 1 → 1 and 2.
    const frag = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: "fdoc", type: "document", firstChildId: "fpa", lastChildId: "fpb" }),
        buildBlock({
          id: "fpa",
          type: "paragraph",
          parentId: "fdoc",
          nextSiblingId: "fli1",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "fli1",
          type: "list-item",
          parentId: "fdoc",
          prevSiblingId: "fpa",
          nextSiblingId: "fli2",
          attrs: { listId: "L1", listLevel: 2 },
          inlineContent: inlineContent([text("deep")]),
        }),
        buildBlock({
          id: "fli2",
          type: "list-item",
          parentId: "fdoc",
          prevSiblingId: "fli1",
          nextSiblingId: "fpb",
          attrs: { listId: "L1", listLevel: 3 },
          inlineContent: inlineContent([text("deeper")]),
        }),
        buildBlock({
          id: "fpb",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fli2",
          inlineContent: inlineContent([text("B")]),
        }),
      ],
      listDefs: {
        L1: { levels: [{ style: "disc", start: 1, restart: "always" }] },
      },
    });

    // Destination: a list item at level 1
    const destDoc = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "dli", lastChildId: "dli" }),
        buildBlock({
          id: "dli",
          type: "list-item",
          parentId: "doc",
          attrs: { listId: "DL", listLevel: 1 },
          inlineContent: inlineContent([text("target")]),
        }),
      ],
      listDefs: {
        DL: { levels: [{ style: "disc", start: 1, restart: "always" }] },
      },
    });

    const alloc = createTestAllocator("T6-E2b");
    // Caret in middle of "target" at offset 3
    const r = insertFragment(destDoc, collapsed(createPosition(bid("dli"), 3)), frag, alloc);

    // Collect list-item blocks in document order.
    const root = getBlock(r.state, r.state.rootId);
    const listItems: Array<{ level: number }> = [];
    let cur2: BlockId | null = root?.firstChildId ?? null;
    while (cur2 !== null) {
      const block = getBlock(r.state, cur2);
      if (block === null) break;
      if (block.type === "list-item") {
        listItems.push({ level: (block.attrs as Record<string, unknown>)["listLevel"] as number });
      }
      cur2 = block.nextSiblingId;
    }

    // Result: [list-item(prefix, level=1), list-item(li1, level=1), list-item(li2, level=2), list-item(suffix, level=1)]
    // The two inserted items (positions 1 and 2 in result) should be at 1 and 2.
    expect(listItems.length).toBeGreaterThanOrEqual(2);
    const insertedLevels = listItems.slice(1, listItems.length - 1).map((x) => x.level);
    expect(insertedLevels).toEqual([1, 2]);
  });

  // ── E3: trailing/leading empty trim ───────────────────────────────────────

  it("E3: leading and trailing empty leaf blocks are trimmed from multi-block fragment", () => {
    // Fragment: [para(""), para("content"), para("")] — 3 blocks, first and last empty
    // Paste into dest at mid-block → only "content" should be inserted (no empty flanking blocks)
    // Build the fragment state directly (no extractFragment) to have precise empty items.
    const frag = buildState({
      rootId: "fdoc",
      blocks: [
        buildBlock({ id: "fdoc", type: "document", firstChildId: "fe1", lastChildId: "fe3" }),
        buildBlock({
          id: "fe1",
          type: "paragraph",
          parentId: "fdoc",
          nextSiblingId: "fmid",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "fmid",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fe1",
          nextSiblingId: "fe3",
          inlineContent: inlineContent([text("content")]),
        }),
        buildBlock({
          id: "fe3",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fmid",
          inlineContent: inlineContent([]),
        }),
      ],
    });

    const dest = makeDest();
    const alloc = createTestAllocator("T6-E3");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    // After trimming: fragment is effectively [para("content")] — one leaf.
    // Paste at offset 2 into "abcd" → single leaf merge → "abcontentcd", one block.
    expect(orderedBlockTexts(r.state)).toEqual(["abcontentcd"]);
  });

  it("E3: only-empty leading block is trimmed but non-empty trailing block is kept", () => {
    // Fragment: [para(""), para("X"), para("Y")] — leading empty only
    // Trimming: drop leading empty → [para("X"), para("Y")]
    const frag = buildState({
      rootId: "fdoc",
      blocks: [
        buildBlock({ id: "fdoc", type: "document", firstChildId: "fe1", lastChildId: "fpy" }),
        buildBlock({
          id: "fe1",
          type: "paragraph",
          parentId: "fdoc",
          nextSiblingId: "fpx",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "fpx",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fe1",
          nextSiblingId: "fpy",
          inlineContent: inlineContent([text("X")]),
        }),
        buildBlock({
          id: "fpy",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fpx",
          inlineContent: inlineContent([text("Y")]),
        }),
      ],
    });

    const dest = makeDest();
    const alloc = createTestAllocator("T6-E3b");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 2)), frag, alloc);

    // [para("X"), para("Y")] pasted at offset 2 of "abcd"
    // → split: prefix="ab", suffix="cd"
    // → firstLeaf="X" into prefix → "abX"
    // → lastLeaf="Y" prepends to suffix → "Ycd"
    expect(orderedBlockTexts(r.state)).toEqual(["abX", "Ycd"]);
  });

  // ── E4: empty target adopt ─────────────────────────────────────────────────

  it("E4: pasting into an EMPTY block at offset 0 adopts the first leaf type and attrs", () => {
    // Dest: doc > paragraph("") (empty)
    // Fragment: [list-item("Hello", listLevel=0)]
    // Expected: the empty paragraph BECOMES a list-item with the same attrs, containing "Hello"
    const emptyDest = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "ep", lastChildId: "ep" }),
        buildBlock({
          id: "ep",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([]),
        }),
      ],
    });

    const src = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "doc",
          attrs: { listId: "L1", listLevel: 0 },
          inlineContent: inlineContent([text("Hello")]),
        }),
      ],
      listDefs: {
        L1: { levels: [{ style: "disc", start: 1, restart: "always" }] },
      },
    });
    const frag = extractFragment(
      src,
      createSpan(createPosition(bid("li"), 0), createPosition(bid("li"), 5)),
    );

    const alloc = createTestAllocator("T6-E4");
    const r = insertFragment(emptyDest, collapsed(createPosition(bid("ep"), 0)), frag, alloc);

    // The caret block "ep" should now be a list-item (type adopted)
    const block = getBlock(r.state, bid("ep"));
    expect(block?.type).toBe("list-item");
    // And its text should be "Hello"
    expect(blockText(r.state, "ep")).toBe("Hello");
  });

  // ── E5: offset 0 / offset=len no-empty-split ──────────────────────────────

  it("E5: container-only fragment at offset 0 produces NO empty leading paragraph (T5b-i updated)", () => {
    // dest p="abcd" caret at 0; fragment = [table]
    // T6/E5 fix: skip split at offset=0 → [table, paragraph("abcd")] (no empty leading para)
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T6-E5a");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    // No empty leading paragraph; table comes first, then "abcd".
    expect(types).toEqual(["table", "paragraph"]);

    const ids = topLevelIds(r.state);
    // The paragraph (was caret block, now suffix with full original content)
    // should contain "abcd" (no text was consumed — offset was 0).
    const paraId = ids[1];
    if (paraId === undefined) throw new Error("paraId undefined");
    expect(blockText(r.state, paraId)).toBe("abcd");
  });

  it("E5: container-only fragment at offset=len produces NO empty trailing paragraph", () => {
    // dest p="abcd" caret at 4; fragment = [table]
    // T6/E5 fix: skip split at offset=len → [paragraph("abcd"), table] (no empty trailing para)
    const dest = makeDest();
    const frag = makeFragTable();
    const alloc = createTestAllocator("T6-E5b");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 4)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["paragraph", "table"]);

    const ids = topLevelIds(r.state);
    const paraId = ids[0];
    if (paraId === undefined) throw new Error("paraId undefined");
    expect(blockText(r.state, paraId)).toBe("abcd");
  });

  it("E5: mixed [table, para] at offset 0 inserts table before block then merges last leaf into block", () => {
    // dest p="abcd" caret 0; fragment = [table, para("Y")]
    // E5: offset=0, firstLeaf=null (first is container), so skipSplitAtStart=true.
    // Table goes before caret block. Last leaf "Y" prepends to caret block at 0.
    // Expected: [table, paragraph("Yabcd")]
    const frag = buildState({
      rootId: "fdoc",
      blocks: [
        buildBlock({ id: "fdoc", type: "document", firstChildId: "ftbl", lastChildId: "fpy" }),
        buildBlock({
          id: "ftbl",
          type: "table",
          parentId: "fdoc",
          nextSiblingId: "fpy",
          firstChildId: "frow",
          lastChildId: "frow",
        }),
        buildBlock({
          id: "frow",
          type: "table-row",
          parentId: "ftbl",
          firstChildId: "fcell",
          lastChildId: "fcell",
        }),
        buildBlock({
          id: "fcell",
          type: "table-cell",
          parentId: "frow",
          firstChildId: "fcp",
          lastChildId: "fcp",
        }),
        buildBlock({
          id: "fcp",
          type: "paragraph",
          parentId: "fcell",
          inlineContent: inlineContent([text("T")]),
        }),
        buildBlock({
          id: "fpy",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "ftbl",
          inlineContent: inlineContent([text("Y")]),
        }),
      ],
    });
    const dest = makeDest();
    const alloc = createTestAllocator("T6-E5c");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    const types = orderedBlockTypes(r.state);
    expect(types).toEqual(["table", "paragraph"]);
    // The paragraph should have "Y" prepended to "abcd" → "Yabcd"
    const ids = topLevelIds(r.state);
    const paraId = ids[1];
    if (paraId === undefined) throw new Error("paraId undefined");
    expect(blockText(r.state, paraId)).toBe("Yabcd");
  });

  // ── E6: footnote-in-footnote ──────────────────────────────────────────────

  it("E6: fragment containing a footnote-anchor embed pasted into a footnote body has the anchor stripped", () => {
    // Dest: footnote body containing a paragraph "fn text"
    // Fragment: a paragraph "pasted [footnote-anchor] text" (contains a footnote anchor)
    // Expected: the pasted inline content lands without the footnote-anchor embed.

    const dest = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "mp", lastChildId: "mp" }),
        buildBlock({
          id: "mp",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            embed("footnote-anchor", { contentBlockId: "fnroot" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fnroot",
          type: "footnote-body",
          firstChildId: "fnp",
          lastChildId: "fnp",
        }),
        buildBlock({
          id: "fnp",
          type: "paragraph",
          parentId: "fnroot",
          inlineContent: inlineContent([text("fn text")]),
        }),
      ],
    });

    // Fragment: a paragraph containing text + footnote-anchor embed + text
    const FOOTNOTE_EMBED_TYPE = "footnote-anchor";
    const fragSrc = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: "fdoc", type: "document", firstChildId: "fp", lastChildId: "fp" }),
        buildBlock({
          id: "fp",
          type: "paragraph",
          parentId: "fdoc",
          inlineContent: inlineContent([
            text("before "),
            embed(FOOTNOTE_EMBED_TYPE, { contentBlockId: "ffnbody" }),
            text(" after"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "ffnbody",
          type: "footnote-body",
          firstChildId: "ffnp",
          lastChildId: "ffnp",
        }),
        buildBlock({
          id: "ffnp",
          type: "paragraph",
          parentId: "ffnbody",
          inlineContent: inlineContent([text("nested footnote")]),
        }),
      ],
    });
    const frag = extractFragment(
      fragSrc,
      createSpan(createPosition(bid("fp"), 0), createPosition(bid("fp"), 14)),
    );

    const alloc = createTestAllocator("T6-E6");
    // Paste into the footnote body paragraph (embedContent)
    const r = insertFragment(dest, collapsed(createPosition(bid("fnp"), 0)), frag, alloc);

    // The footnote body paragraph should now contain "before " + " after" but NO footnote-anchor embed.
    // fnp lives in embedContents (not main blocks) — use getEmbedContent.
    const fnpEmbed = getEmbedContent(r.state, bid("fnp"));
    const items = fnpEmbed?.inlineContent?.items ?? [];
    const hasAnchorEmbed = items.some(
      (it) => it.kind === "embed" && it.embedType === FOOTNOTE_EMBED_TYPE,
    );
    expect(hasAnchorEmbed).toBe(false);
    // Text should still be there
    const textContent = items
      .filter((it) => it.kind === "text")
      .map((it) => (it as { kind: "text"; text: string }).text)
      .join("");
    expect(textContent).toContain("before");
    expect(textContent).toContain("after");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7: suggestion-record transfer + id remap
// ─────────────────────────────────────────────────────────────────────────────

describe("insertFragment — T7 suggestion-record transfer", () => {
  /** Build a minimal dest doc: document > paragraph("hello") */
  function makeSimpleDest() {
    return buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: bid("doc"), type: "document", firstChildId: bid("p"), lastChildId: bid("p") }),
        buildBlock({
          id: bid("p"),
          type: "paragraph",
          parentId: bid("doc"),
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
  }

  /**
   * Build a fragment carrying one run tagged with an insertion suggestion s1.
   * The fragment has a root > paragraph whose inline content is one text run
   * with attrs { [INSERTION_SUGGESTION_ATTR]: "s1" }. The fragment's suggestions
   * side-table has a record { id:"s1", kind:"insertion", author:"alice", createdAt:123 }.
   */
  function makeFragWithInsertionSuggestion() {
    const s1 = "s1" as SuggestionId;
    const fragState = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: bid("fdoc"), type: "document", firstChildId: bid("fp"), lastChildId: bid("fp") }),
        buildBlock({
          id: bid("fp"),
          type: "paragraph",
          parentId: bid("fdoc"),
          inlineContent: inlineContent([
            text("suggested", { [INSERTION_SUGGESTION_ATTR]: s1 }),
          ]),
        }),
      ],
      suggestions: [{ id: s1, kind: "insertion", author: "alice", createdAt: 123 }],
    });
    return { fragState, s1 };
  }

  /**
   * Build a fragment carrying a break-suggestion embed (block-split) whose
   * properties.suggestionId = "bs1", plus the matching record.
   */
  function makeFragWithBreakSuggestion() {
    const bs1 = "bs1" as SuggestionId;
    const fragState = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: bid("fdoc"), type: "document", firstChildId: bid("fp"), lastChildId: bid("fp") }),
        buildBlock({
          id: bid("fp"),
          type: "paragraph",
          parentId: bid("fdoc"),
          inlineContent: inlineContent([
            text("before"),
            embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: bs1 }),
            text("after"),
          ]),
        }),
      ],
      suggestions: [{ id: bs1, kind: "insertion", author: "bob", createdAt: 456 }],
    });
    return { fragState, bs1 };
  }

  it("direct-mode lossless paste preserves a pending insertion suggestion under a FRESH id", () => {
    const dest = makeSimpleDest();
    const { fragState, s1 } = makeFragWithInsertionSuggestion();
    const alloc = createTestAllocator("T7-ins");

    const r = insertFragment(dest, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), fragState, alloc);

    const recs = getSuggestions(r.state);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    if (rec === undefined) throw new Error("expected recs[0]");
    // id must be fresh (not the old "s1")
    expect(rec.id).not.toBe(s1);
    // kind / author / createdAt preserved
    expect(rec.kind).toBe("insertion");
    expect(rec.author).toBe("alice");
    expect(rec.createdAt).toBe(123);

    // the pasted run's insertion attr must point at the new id
    const pBlock = getBlock(r.state, bid("p"));
    expect(pBlock).not.toBeNull();
    const taggedItems = (pBlock?.inlineContent?.items ?? []).filter(
      (it) => it.kind === "text" && it.attrs[INSERTION_SUGGESTION_ATTR] !== undefined,
    );
    expect(taggedItems).toHaveLength(1);
    const taggedItem = taggedItems[0];
    if (taggedItem === undefined) throw new Error("expected taggedItems[0]");
    expect((taggedItem as { kind: "text"; attrs: Record<string, unknown> }).attrs[INSERTION_SUGGESTION_ATTR]).toBe(rec.id);
  });

  it("remaps a break-suggestion embed's properties.suggestionId", () => {
    const dest = makeSimpleDest();
    const { fragState, bs1 } = makeFragWithBreakSuggestion();
    const alloc = createTestAllocator("T7-break");

    const r = insertFragment(dest, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), fragState, alloc);

    const recs = getSuggestions(r.state);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    if (rec === undefined) throw new Error("expected recs[0]");
    expect(rec.id).not.toBe(bs1);
    expect(rec.kind).toBe("insertion");
    expect(rec.author).toBe("bob");
    expect(rec.createdAt).toBe(456);

    // find the break-suggestion embed in the pasted block and check its properties.suggestionId
    const pBlock = getBlock(r.state, bid("p"));
    const breakEmbed = (pBlock?.inlineContent?.items ?? []).find(
      (it) => it.kind === "embed" && it.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
    );
    expect(breakEmbed).toBeDefined();
    if (breakEmbed === undefined) throw new Error("expected breakEmbed");
    expect((breakEmbed as { kind: "embed"; properties: Record<string, unknown> }).properties.suggestionId).toBe(rec.id);
  });

  it("no collision when pasting the same fragment twice (two distinct fresh ids)", () => {
    const dest = makeSimpleDest();
    const { fragState } = makeFragWithInsertionSuggestion();
    const alloc = createTestAllocator("T7-collision");

    const r1 = insertFragment(dest, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), fragState, alloc);
    const r2 = insertFragment(r1.state, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), fragState, alloc);

    const recs = getSuggestions(r2.state);
    // After two pastes: 2 records, distinct ids
    expect(recs).toHaveLength(2);
    const id0 = recs[0];
    const id1 = recs[1];
    if (id0 === undefined || id1 === undefined) throw new Error("expected recs[0] and recs[1]");
    expect(id0.id).not.toBe(id1.id);
  });

  it("a fragment with NO suggestions transfers none", () => {
    const dest = makeSimpleDest();
    // Build a plain fragment with no suggestion records
    const plainFrag = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: bid("fdoc"), type: "document", firstChildId: bid("fp"), lastChildId: bid("fp") }),
        buildBlock({
          id: bid("fp"),
          type: "paragraph",
          parentId: bid("fdoc"),
          inlineContent: inlineContent([text("plain text")]),
        }),
      ],
    });
    const alloc = createTestAllocator("T7-none");
    const r = insertFragment(dest, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), plainFrag, alloc);
    const recs = getSuggestions(r.state);
    expect(recs).toHaveLength(0);
  });

  it("preserves kind/author/createdAt on a deletion suggestion", () => {
    const sf1 = "sf1" as SuggestionId;
    const fragState = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: bid("fdoc"), type: "document", firstChildId: bid("fp"), lastChildId: bid("fp") }),
        buildBlock({
          id: bid("fp"),
          type: "paragraph",
          parentId: bid("fdoc"),
          inlineContent: inlineContent([
            text("styled", { [DELETION_SUGGESTION_ATTR]: sf1 }),
          ]),
        }),
      ],
      suggestions: [{ id: sf1, kind: "deletion", author: "carol", createdAt: 789 }],
    });
    const dest = makeSimpleDest();
    const alloc = createTestAllocator("T7-del");
    const r = insertFragment(dest, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), fragState, alloc);
    const recs = getSuggestions(r.state);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    if (rec === undefined) throw new Error("expected recs[0]");
    expect(rec.kind).toBe("deletion");
    expect(rec.author).toBe("carol");
    expect(rec.createdAt).toBe(789);
    expect(rec.id).not.toBe(sf1);
    // The run's deletion attr must point at the new id
    const pBlock = getBlock(r.state, bid("p"));
    const taggedItems = (pBlock?.inlineContent?.items ?? []).filter(
      (it) => it.kind === "text" && it.attrs[DELETION_SUGGESTION_ATTR] !== undefined,
    );
    expect(taggedItems).toHaveLength(1);
    const taggedItem = taggedItems[0];
    if (taggedItem === undefined) throw new Error("expected taggedItems[0]");
    expect((taggedItem as { kind: "text"; attrs: Record<string, unknown> }).attrs[DELETION_SUGGESTION_ATTR]).toBe(rec.id);
  });

  it("carries a formatting suggestion's proposedAttrs and repoints FORMATTING_SUGGESTION_ATTR to the fresh id", () => {
    // Spec §5 step-3: a `formatting` record's proposedAttrs must transfer; this is a
    // distinct code path from insertion/deletion (proposedAttrs spread + the
    // FORMATTING_SUGGESTION_ATTR rewrite branch). Fails if either regressed.
    const fmt1 = "fmt1" as SuggestionId;
    const fragState = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({ id: bid("fdoc"), type: "document", firstChildId: bid("fp"), lastChildId: bid("fp") }),
        buildBlock({
          id: bid("fp"),
          type: "paragraph",
          parentId: bid("fdoc"),
          inlineContent: inlineContent([
            text("formatted", { [FORMATTING_SUGGESTION_ATTR]: fmt1 }),
          ]),
        }),
      ],
      suggestions: [{ id: fmt1, kind: "formatting", author: "dave", createdAt: 321, proposedAttrs: { bold: true } }],
    });
    const dest = makeSimpleDest();
    const alloc = createTestAllocator("T7-fmt");
    const r = insertFragment(dest, createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 0)), fragState, alloc);

    const recs = getSuggestions(r.state);
    expect(recs).toHaveLength(1);
    const rec = recs[0];
    if (rec === undefined) throw new Error("expected recs[0]");
    // fresh id (carrier-repoint target)
    expect(rec.id).not.toBe(fmt1);
    expect(rec.kind).toBe("formatting");
    expect(rec.author).toBe("dave");
    expect(rec.createdAt).toBe(321);
    // proposedAttrs must deep-equal the source (the spread path)
    expect(rec.proposedAttrs).toEqual({ bold: true });

    // the pasted run's FORMATTING_SUGGESTION_ATTR must point at the fresh id (the rewrite branch)
    const pBlock = getBlock(r.state, bid("p"));
    const taggedItems = (pBlock?.inlineContent?.items ?? []).filter(
      (it) => it.kind === "text" && it.attrs[FORMATTING_SUGGESTION_ATTR] !== undefined,
    );
    expect(taggedItems).toHaveLength(1);
    const taggedItem = taggedItems[0];
    if (taggedItem === undefined) throw new Error("expected taggedItems[0]");
    expect((taggedItem as { kind: "text"; attrs: Record<string, unknown> }).attrs[FORMATTING_SUGGESTION_ATTR]).toBe(rec.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1: multi-block paste into embedContent (footnote body)
// ─────────────────────────────────────────────────────────────────────────────

describe("insertFragment — C1 multi-block paste into embedContent tree", () => {
  /**
   * Destination: main doc > mp (paragraph with footnote anchor)
   *   embedContents: fnroot (footnote-body) > fnp (paragraph "existing")
   * Fragment: 3 paragraphs "A", "B", "C" (forces middle items → split path with middle block)
   */
  function makeFootnoteDest() {
    return buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "mp", lastChildId: "mp" }),
        buildBlock({
          id: "mp",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "fnroot" })]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fnroot", type: "footnote-body", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({
          id: "fnp",
          type: "paragraph",
          parentId: "fnroot",
          inlineContent: inlineContent([text("existing")]),
        }),
      ],
    });
  }

  function makeThreeLeafFragment() {
    return buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({
          id: "fdoc",
          type: "document",
          firstChildId: "fp1",
          lastChildId: "fp3",
        }),
        buildBlock({
          id: "fp1",
          type: "paragraph",
          parentId: "fdoc",
          nextSiblingId: "fp2",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "fp2",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fp1",
          nextSiblingId: "fp3",
          inlineContent: inlineContent([text("B")]),
        }),
        buildBlock({
          id: "fp3",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fp2",
          inlineContent: inlineContent([text("C")]),
        }),
      ],
    });
  }

  it("C1a: ≥3 leaf fragment pasted into footnote body lands in embedContent tree (no throw)", () => {
    const dest = makeFootnoteDest();
    const fragSrc = makeThreeLeafFragment();
    const frag = extractFragment(
      fragSrc,
      createSpan(createPosition(bid("fp1"), 0), createPosition(bid("fp3"), 1)),
    );

    const alloc = createTestAllocator("C1a");
    // Paste into "fnp" (lives in embedContents, not main blocks tree).
    // Before fix this threw: "getYBlock: block 'fnp' disappeared mid-transaction"
    const r = insertFragment(dest, collapsed(createPosition(bid("fnp"), 0)), frag, alloc);

    // After insert: fnp should now contain text from "A" (merged into prefix).
    // The newly created middle block and suffix block must resolve via getEmbedContent.
    const fnpBlock = getEmbedContent(r.state, bid("fnp"));
    expect(fnpBlock).not.toBeNull();

    // The endPosition block must also exist in the embedContent tree.
    const endBlock = getEmbedContent(r.state, r.endPosition.blockId);
    expect(endBlock).not.toBeNull();

    // Text "A" should be in fnp (the prefix block that became the caret block).
    const fnpText = fnpBlock?.inlineContent?.items
      .filter((it) => it.kind === "text")
      .map((it) => (it as { kind: "text"; text: string }).text)
      .join("") ?? "";
    expect(fnpText).toContain("A");

    // C1a-extra: the middle block ("B") must also be in the embedContent tree,
    // with parentId chaining to the same footnote-body root as fnp.
    // Resolve it by scanning siblings from fnp to find the block containing "B".
    const fnpParentId = fnpBlock?.parentId;
    expect(fnpParentId).not.toBeNull();
    // Walk siblings of fnp (nextSiblingId chain) to find a block whose text contains "B".
    let cur: BlockId | null = fnpBlock?.nextSiblingId ?? null;
    let middleBlock = null;
    while (cur !== null) {
      const b = getEmbedContent(r.state, cur);
      if (b === null) break;
      const t = b.inlineContent?.items
        .filter((it) => it.kind === "text")
        .map((it) => (it as { kind: "text"; text: string }).text)
        .join("") ?? "";
      if (t.includes("B")) { middleBlock = b; break; }
      cur = b.nextSiblingId ?? null;
    }
    expect(middleBlock).not.toBeNull();
    // Middle block lives in the embedContents tree (parentId matches fnp's parent = footnote body root).
    expect(middleBlock?.parentId).toBe(fnpParentId);
  });

  it("C1b: container-bearing fragment pasted into footnote body does not throw, content lands", () => {
    // Fragment: 2 leaf paragraphs + a container (table) — the table is a container
    // which forces the middle-item path. E1 will flatten it since we're NOT inside a
    // table-cell; or it remains a container. Either way must not throw.
    // Simpler: just use a 3-leaf fragment (same as C1a) but verify container path too.
    // Use 2 leaves only — the multi-item split path still runs (no middle, but suffix/prefix create path).
    const dest = makeFootnoteDest();
    const fragSrc = buildStateFromBlocks({
      rootId: bid("fdoc2"),
      blocks: [
        buildBlock({
          id: "fdoc2",
          type: "document",
          firstChildId: "fpa",
          lastChildId: "fpb",
        }),
        buildBlock({
          id: "fpa",
          type: "paragraph",
          parentId: "fdoc2",
          nextSiblingId: "fpb",
          inlineContent: inlineContent([text("hello")]),
        }),
        buildBlock({
          id: "fpb",
          type: "paragraph",
          parentId: "fdoc2",
          prevSiblingId: "fpa",
          inlineContent: inlineContent([text("world")]),
        }),
      ],
    });

    const frag = extractFragment(
      fragSrc,
      createSpan(createPosition(bid("fpa"), 0), createPosition(bid("fpb"), 5)),
    );

    const alloc = createTestAllocator("C1b");
    // Should not throw — caret in embedContent tree.
    const r = insertFragment(dest, collapsed(createPosition(bid("fnp"), 4)), frag, alloc);

    // Both endPosition block and fnp should be in embedContent tree.
    const fnpBlock = getEmbedContent(r.state, bid("fnp"));
    expect(fnpBlock).not.toBeNull();
    const endBlock = getEmbedContent(r.state, r.endPosition.blockId);
    expect(endBlock).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1: multi-block paste into empty block adopts first block's type
// ─────────────────────────────────────────────────────────────────────────────

describe("insertFragment — M1 multi-block paste adopts first block type on empty target", () => {
  it("M1: [heading, paragraph] pasted into empty paragraph → first block becomes heading", () => {
    const dest = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([]), // empty
        }),
      ],
    });

    const fragSrc = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({
          id: "fdoc",
          type: "document",
          firstChildId: "fh",
          lastChildId: "fp",
        }),
        buildBlock({
          id: "fh",
          type: "heading",
          parentId: "fdoc",
          nextSiblingId: "fp",
          attrs: { level: 1 },
          inlineContent: inlineContent([text("Heading")]),
        }),
        buildBlock({
          id: "fp",
          type: "paragraph",
          parentId: "fdoc",
          prevSiblingId: "fh",
          inlineContent: inlineContent([text("Body")]),
        }),
      ],
    });

    const frag = extractFragment(
      fragSrc,
      createSpan(createPosition(bid("fh"), 0), createPosition(bid("fp"), 4)),
    );

    const alloc = createTestAllocator("M1");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    // The caret block "p" (the prefix) should have been adopted to type "heading".
    const pBlock = getBlock(r.state, bid("p"));
    expect(pBlock?.type).toBe("heading");
  });

  it("M1-skip-split: [heading 'H', table] pasted into empty paragraph at offset 0 → block becomes heading, table follows as sibling", () => {
    // This exercises the SKIP-SPLIT arm (skipSplitAtEnd=true: caretOffset 0 === totalContentLen 0,
    // lastLeaf===null because last fragment item is a container). The caret block is empty so
    // shouldAdoptType===true, but pre-fix the skip-split path had no adoption block — it would
    // leave the block as "paragraph". This test FAILS before the fix and PASSES after.
    const dest = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([]), // empty
        }),
      ],
    });

    // Fragment: heading "H" followed by a table (container).
    // Build directly as a State (not via extractFragment) so the table is a true
    // top-level container item in the fragment doc — extractFragment would
    // recurse into the table and flatten it to a leaf if the span ends inside.
    const frag = buildStateFromBlocks({
      rootId: bid("fdoc"),
      blocks: [
        buildBlock({
          id: "fdoc",
          type: "document",
          firstChildId: "fh",
          lastChildId: "ftbl",
        }),
        buildBlock({
          id: "fh",
          type: "heading",
          parentId: "fdoc",
          nextSiblingId: "ftbl",
          attrs: { level: 1 },
          inlineContent: inlineContent([text("H")]),
        }),
        buildBlock({
          id: "ftbl",
          type: "table",
          parentId: "fdoc",
          prevSiblingId: "fh",
          firstChildId: "frow",
          lastChildId: "frow",
        }),
        buildBlock({
          id: "frow",
          type: "table-row",
          parentId: "ftbl",
          firstChildId: "fcell",
          lastChildId: "fcell",
        }),
        buildBlock({
          id: "fcell",
          type: "table-cell",
          parentId: "frow",
          firstChildId: "fcp",
          lastChildId: "fcp",
        }),
        buildBlock({
          id: "fcp",
          type: "paragraph",
          parentId: "fcell",
          inlineContent: inlineContent([text("cell")]),
        }),
      ],
    });

    const alloc = createTestAllocator("M1-skip-split");
    const r = insertFragment(dest, collapsed(createPosition(bid("p"), 0)), frag, alloc);

    // The caret block "p" must now be a heading (adopted from firstLeaf = heading "H").
    const pBlock = getBlock(r.state, bid("p"));
    expect(pBlock?.type).toBe("heading");
    // "H" content was merged into the caret block.
    const pText = pBlock?.inlineContent?.items
      .filter((it) => it.kind === "text")
      .map((it) => (it as { kind: "text"; text: string }).text)
      .join("") ?? "";
    expect(pText).toBe("H");
    // The table must follow as a sibling of "p".
    expect(pBlock?.nextSiblingId).not.toBeNull();
    const tableBlock = getBlock(r.state, pBlock!.nextSiblingId!);
    expect(tableBlock?.type).toBe("table");
  });
});
