import { describe, it, expect } from "vitest";
import { buildAccessibilityTree } from "./build-accessibility-tree";
import { buildState, buildBlock, inlineContent, text, embed } from "../test-utils/state-builders";
import { buildStateWithListDefs } from "../state/build-state-from-blocks";
import { inlineRenderKey } from "../render/inline-render-key";
import {
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  INLINE_IMAGE_EMBED_TYPE,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  PAGE_FIELD_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
  asBlockId,
  type ListDef,
} from "../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const ORDERED_LIST_DEF: ListDef = {
  levels: [{ style: "decimal", start: 1, restart: "after-break" }],
};

describe("buildAccessibilityTree", () => {
  it("maps an empty document to a single document-role root with no children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    const tree = buildAccessibilityTree(state);
    expect(tree).toEqual({ role: "document", sourceBlockId: "doc", children: [] });
  });

  it("renders a document with one paragraph as a paragraph node carrying its text run", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const tree = buildAccessibilityTree(state);
    expect(tree.children).toHaveLength(1);
    const p = nth(tree.children, 0, "paragraph node");
    expect(p.role).toBe("paragraph");
    expect(p.sourceBlockId).toBe("p");
    expect(p.text).toEqual([{ text: "hello", sourceOffsetStart: 0, sourceOffsetEnd: 5 }]);
  });

  it("maps heading blocks to role:heading with the level attr (out-of-range coerces to 1)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h2", lastChildId: "h9" }),
        buildBlock({ id: "h2", type: "heading", parentId: "doc", attrs: { level: 2 },
          nextSiblingId: "h9", inlineContent: inlineContent([text("Intro")]) }),
        buildBlock({ id: "h9", type: "heading", parentId: "doc", attrs: { level: 9 },
          prevSiblingId: "h2", inlineContent: inlineContent([text("Bad")]) }),
      ],
    });
    const children = buildAccessibilityTree(state).children;
    expect(children).toHaveLength(2);
    const h2 = nth(children, 0, "h2 node");
    const h9 = nth(children, 1, "h9 node");
    expect(h2).toMatchObject({ role: "heading", level: 2, sourceBlockId: "h2" });
    expect(h2.text).toEqual([{ text: "Intro", sourceOffsetStart: 0, sourceOffsetEnd: 5 }]);
    expect(h9.level).toBe(1); // out-of-range coerces to 1
  });

  it("uses LITERAL block offsets that span an embed even when it serializes to FEWER display chars", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        // `image` serializes to "" under captionEmbedSerializer, so the display text is
        // "abcd" (4 chars) while the LITERAL span is 5 (2 text + 1 embed + 2 text). This
        // proves sourceOffsetEnd tracks inlineContentLength, NOT display.length.
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("ab"), embed("image"), text("cd")]) }),
      ],
    });
    const tree = buildAccessibilityTree(state);
    const runs = nth(tree.children, 0, "paragraph node").text;
    expect(runs).toHaveLength(1);
    const run0 = nth(runs ?? [], 0, "run");
    expect(run0.text).toBe("abcd"); // display: shorter than the literal span
    expect(run0.sourceOffsetStart).toBe(0);
    expect(run0.sourceOffsetEnd).toBe(5); // LITERAL, not display.length (4)
  });

  it("splits a link run out with its href and literal offsets", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("see "),
            text("here", { link: "https://x.test" }),
            text("."),
          ]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs).toEqual([
      { text: "see ", sourceOffsetStart: 0, sourceOffsetEnd: 4 },
      { text: "here", sourceOffsetStart: 4, sourceOffsetEnd: 8, link: "https://x.test" },
      { text: ".", sourceOffsetStart: 8, sourceOffsetEnd: 9 },
    ]);
  });

  it("emits a footnote-anchor as its own noteref run pointing at the body id (properties.contentBlockId)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("x"),
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: "fn1" }),
          ]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn1", type: "footnote-body", inlineContent: inlineContent([text("note")]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs).toContainEqual({ text: "", sourceOffsetStart: 1, sourceOffsetEnd: 2, noteref: "fn1" });
    expect(runs?.[0]).toEqual({ text: "x", sourceOffsetStart: 0, sourceOffsetEnd: 1 });
  });

  it("emits one noteref run per footnote-anchor, including at offset 0 and back-to-back", () => {
    // Two adjacent footnote-anchors with NO text between them: each flushes/skips the
    // (null) open run and emits its own standalone noteref run. The first is at literal
    // offset 0 (the open === null path).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: "fn1" }),
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: "fn2" }),
          ]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn1", type: "footnote-body", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "fn2", type: "footnote-body", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs).toEqual([
      { text: "", sourceOffsetStart: 0, sourceOffsetEnd: 1, noteref: "fn1" },
      { text: "", sourceOffsetStart: 1, sourceOffsetEnd: 2, noteref: "fn2" },
    ]);
  });

  it("emits an inline-image as its own standalone imageAlt run with empty display text", () => {
    // An inline image flows IN LINE with text: it FLUSHES the open run and emits its
    // own standalone run carrying imageAlt + an empty display text "" (the alt is the
    // accessible name; AT announces it as an image). Mirrors footnote-anchor's flush.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("see "),
            embed(INLINE_IMAGE_EMBED_TYPE, { alt: "a cat" }),
            text(" here"),
          ]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs).toEqual([
      { text: "see ", sourceOffsetStart: 0, sourceOffsetEnd: 4 },
      { text: "", sourceOffsetStart: 4, sourceOffsetEnd: 5, imageAlt: "a cat" },
      { text: " here", sourceOffsetStart: 5, sourceOffsetEnd: 10 },
    ]);
  });

  it("defaults a missing inline-image alt to imageAlt: \"\" (decorative/unlabeled)", () => {
    // No `alt` property on the embed → collectRuns defaults imageAlt to "" (the
    // intentional empty-string default, consistent with the block-image path). Pin
    // it so a future reader doesn't "fix" the default to undefined or a placeholder.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            embed(INLINE_IMAGE_EMBED_TYPE, {}),
            text("cd"),
          ]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs).toEqual([
      { text: "ab", sourceOffsetStart: 0, sourceOffsetEnd: 2 },
      { text: "", sourceOffsetStart: 2, sourceOffsetEnd: 3, imageAlt: "" },
      { text: "cd", sourceOffsetStart: 3, sourceOffsetEnd: 5 },
    ]);
  });

  it("attaches emphasis from the text item's format attrs in fixed order", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("X", { bold: true, italic: true })]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs).toEqual([{ text: "X", sourceOffsetStart: 0, sourceOffsetEnd: 1, emphasis: ["bold", "italic"] }]);
  });

  it("tags insertion/deletion runs with provenance, and merges adjacent same-suggestion items", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("keep "),
            // Two ADJACENT insertion items — must merge into ONE run.
            text("added", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
            text("more", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
            text(" "),
            text("removed", { [DELETION_SUGGESTION_ATTR]: "s2" }),
          ]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    // Finding 4: adjacent same-suggestion items merge into a single run.
    const mergedIns = runs?.find((r) => r.suggestion === "insertion");
    expect(mergedIns).toBeDefined();
    expect(mergedIns?.text).toBe("addedmore");
    // No second insertion run exists (they merged).
    expect(runs?.filter((r) => r.suggestion === "insertion")).toHaveLength(1);
    // Deletion is still split correctly.
    const del = runs?.find((r) => r.suggestion === "deletion");
    expect(del).toBeDefined();
    expect(del?.sourceOffsetStart).toBeGreaterThan(0);
  });

  it("flags runs between comment-start and comment-end as inComment", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            text("inside"),
            // A text item inside the comment range that also carries a suggestion —
            // the emitted run must have BOTH inComment:true AND suggestion:"insertion".
            text("also-inserted", { [INSERTION_SUGGESTION_ATTR]: "s3" }),
            embed(COMMENT_END_EMBED_TYPE, { commentId: "c1" }),
            text("b"),
          ]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state).children, 0, "paragraph node").text;
    expect(runs?.find((r) => r.text === "inside")?.inComment).toBe(true);
    expect(runs?.find((r) => r.text === "a")?.inComment).toBeUndefined();
    // Finding 3: item inside comment WITH a suggestion → both flags present
    const jointRun = runs?.find((r) => r.text === "also-inserted");
    expect(jointRun?.inComment).toBe(true);
    expect(jointRun?.suggestion).toBe("insertion");
  });

  it("drops a deletion run entirely under view:final, keeping surviving runs' literal offsets", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("keep"),
            text("gone", { [DELETION_SUGGESTION_ATTR]: "s2" }),
          ]) }),
      ],
    });
    const runs = nth(buildAccessibilityTree(state, { suggestionView: "final" }).children, 0, "paragraph node").text;
    // Under "final", a deletion item is projected away entirely — NO run is emitted for it.
    // The "keep" run is emitted with its original literal offsets (the deletion item still
    // occupies its literal offset span, so the keep run's offsets don't shift — the deletion
    // item comes AFTER "keep" in this case, so offsets are 0..4 regardless).
    const keep = runs?.find((r) => r.text === "keep");
    expect(keep).toEqual({ text: "keep", sourceOffsetStart: 0, sourceOffsetEnd: 4 });
    // The deletion run is NOT emitted at all under "final".
    expect(runs?.some((r) => r.suggestion === "deletion")).toBe(false);
    expect(runs?.some((r) => r.text === "gone")).toBe(false);
  });

  it("groups consecutive list-items sharing a listId into a synthetic list node", () => {
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "p" }),
        buildBlock({ id: "li1", type: "list-item", parentId: "doc", nextSiblingId: "li2",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "li2", type: "list-item", parentId: "doc", prevSiblingId: "li1", nextSiblingId: "p",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("two")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "li2",
          inlineContent: inlineContent([text("after")]) }),
      ],
      listDefs: { L1: ORDERED_LIST_DEF },
    });
    const children = buildAccessibilityTree(state).children;
    expect(children.map((c) => c.role)).toEqual(["list", "paragraph"]);
    const list = nth(children, 0, "list node");
    expect(list.sourceBlockId).toBeNull();           // synthetic
    expect(list.listOrdered).toBe(true);             // decimal def → ordered
    expect(list.children.map((c) => c.role)).toEqual(["listitem", "listitem"]);
    const listItem0 = nth(list.children, 0, "listitem");
    expect(listItem0).toMatchObject({ role: "listitem", level: 0, sourceBlockId: "li1" });
    expect(listItem0.text).toEqual([{ text: "one", sourceOffsetStart: 0, sourceOffsetEnd: 3 }]);
  });

  it("stamps the resolved ordinal on ORDERED listitems so AT numbers start-at/restart lists correctly (#555)", () => {
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", parentId: "doc", nextSiblingId: "li2",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "li2", type: "list-item", parentId: "doc", prevSiblingId: "li1",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("two")]) }),
      ],
      // A list whose level-0 numbering STARTS at 5: AT must announce 5, 6 — not 1, 2.
      listDefs: { L1: { levels: [{ style: "decimal", start: 5, restart: "after-break" }] } },
    });
    const list = nth(buildAccessibilityTree(state).children, 0, "list node");
    expect(nth(list.children, 0, "listitem").listOrdinal).toBe(5);
    expect(nth(list.children, 1, "listitem").listOrdinal).toBe(6);
  });

  it("does NOT stamp listOrdinal on UNORDERED (bullet) listitems (#555)", () => {
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li1" }),
        buildBlock({ id: "li1", type: "list-item", parentId: "doc",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("b")]) }),
      ],
      listDefs: { L1: { levels: [{ style: "disc", start: 1, restart: "after-break" }] } },
    });
    const list = nth(buildAccessibilityTree(state).children, 0, "list node");
    expect(nth(list.children, 0, "listitem").listOrdinal).toBeUndefined();
  });

  it("starts a new list when listId changes", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "list-item", parentId: "doc", nextSiblingId: "b",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "b", type: "list-item", parentId: "doc", prevSiblingId: "a",
          attrs: { listId: "L2", listLevel: 0 }, inlineContent: inlineContent([text("b")]) }),
      ],
    });
    expect(buildAccessibilityTree(state).children.map((c) => c.role)).toEqual(["list", "list"]);
  });

  it("nests a deeper-level list inside the preceding listitem (same listId)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "o", lastChildId: "i" }),
        buildBlock({ id: "o", type: "list-item", parentId: "doc", nextSiblingId: "i",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("outer")]) }),
        buildBlock({ id: "i", type: "list-item", parentId: "doc", prevSiblingId: "o",
          attrs: { listId: "L1", listLevel: 1 }, inlineContent: inlineContent([text("inner")]) }),
      ],
    });
    const top = buildAccessibilityTree(state).children;
    expect(top.map((c) => c.role)).toEqual(["list"]);
    const outerList = nth(top, 0, "outer list");
    expect(outerList.children.map((c) => c.role)).toEqual(["listitem"]);
    const outerItem = nth(outerList.children, 0, "outer item");
    expect(outerItem.sourceBlockId).toBe("o");
    // the level-1 item nests as a child LIST under the level-0 item
    expect(outerItem.children.map((c) => c.role)).toEqual(["list"]);
    const innerList = nth(outerItem.children, 0, "inner list");
    expect(innerList.children.map((c) => c.role)).toEqual(["listitem"]);
    expect(nth(innerList.children, 0, "inner item").sourceBlockId).toBe("i");
  });

  // ---------------------------------------------------------------------------
  // Table mapping (Task 7)
  // ---------------------------------------------------------------------------

  it("maps table/row/cell and marks the first headerRowCount rows' cells as columnheader", () => {
    // Table cells are CONTAINER blocks — they hold block children (paragraphs),
    // not inline content directly. This mirrors the real model in table-cell.ts
    // and how all table tests in state/ops/* are structured.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "t", lastChildId: "t" }),
        buildBlock({ id: "t", type: "table", parentId: "doc", attrs: { headerRowCount: 1 },
          firstChildId: "r0", lastChildId: "r1" }),
        buildBlock({ id: "r0", type: "table-row", parentId: "t", nextSiblingId: "r1",
          firstChildId: "c00", lastChildId: "c00" }),
        buildBlock({ id: "c00", type: "table-cell", parentId: "r0",
          firstChildId: "c00p", lastChildId: "c00p" }),
        buildBlock({ id: "c00p", type: "paragraph", parentId: "c00",
          inlineContent: inlineContent([text("H")]) }),
        buildBlock({ id: "r1", type: "table-row", parentId: "t", prevSiblingId: "r0",
          firstChildId: "c10", lastChildId: "c10" }),
        buildBlock({ id: "c10", type: "table-cell", parentId: "r1",
          firstChildId: "c10p", lastChildId: "c10p" }),
        buildBlock({ id: "c10p", type: "paragraph", parentId: "c10",
          inlineContent: inlineContent([text("D")]) }),
      ],
    });
    const table = nth(buildAccessibilityTree(state).children, 0, "table node");
    expect(table.role).toBe("table");
    expect(table.sourceBlockId).toBe("t");
    const r0 = nth(table.children, 0, "row 0");
    const r1 = nth(table.children, 1, "row 1");
    expect(r0.role).toBe("row");
    expect(r1.role).toBe("row");
    // header row (index 0 < headerRowCount 1)
    const r0c0 = nth(r0.children, 0, "cell 0,0");
    expect(r0c0.role).toBe("columnheader");
    expect(r0c0.sourceBlockId).toBe("c00");
    // cell content is in its paragraph child
    const r0c0p = nth(r0c0.children, 0, "cell paragraph");
    expect(r0c0p.role).toBe("paragraph");
    expect(r0c0p.text).toEqual([{ text: "H", sourceOffsetStart: 0, sourceOffsetEnd: 1 }]);
    // body row (index 1 >= headerRowCount 1)
    expect(nth(r1.children, 0, "cell 1,0").role).toBe("cell");
  });

  it("treats all cells as plain cells when headerRowCount is absent (default 0)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "t", lastChildId: "t" }),
        buildBlock({ id: "t", type: "table", parentId: "doc",
          firstChildId: "r0", lastChildId: "r0" }),
        buildBlock({ id: "r0", type: "table-row", parentId: "t",
          firstChildId: "c00", lastChildId: "c00" }),
        buildBlock({ id: "c00", type: "table-cell", parentId: "r0",
          firstChildId: "c00p", lastChildId: "c00p" }),
        buildBlock({ id: "c00p", type: "paragraph", parentId: "c00",
          inlineContent: inlineContent([text("x")]) }),
      ],
    });
    const table = nth(buildAccessibilityTree(state).children, 0, "table node");
    // no header rows → all cells are plain "cell"
    expect(nth(nth(table.children, 0, "row").children, 0, "cell").role).toBe("cell");
  });

  // ---------------------------------------------------------------------------
  // image, horizontal-line, table-of-contents, section (Task 8)
  // ---------------------------------------------------------------------------

  it("maps image (absent alt → name \"\"), horizontal-line, table-of-contents, and flattens section", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "sec" }),
        buildBlock({ id: "img", type: "image", parentId: "doc", nextSiblingId: "hr",
          attrs: { src: "x.png" } }),
        buildBlock({ id: "hr", type: "horizontal-line", parentId: "doc",
          prevSiblingId: "img", nextSiblingId: "toc" }),
        buildBlock({ id: "toc", type: "table-of-contents", parentId: "doc",
          prevSiblingId: "hr", nextSiblingId: "sec" }),
        // section wraps a paragraph; section emits the paragraph child, NO section node
        buildBlock({ id: "sec", type: "section", parentId: "doc", prevSiblingId: "toc",
          firstChildId: "sp", lastChildId: "sp" }),
        buildBlock({ id: "sp", type: "paragraph", parentId: "sec",
          inlineContent: inlineContent([text("in section")]) }),
      ],
    });
    const children = buildAccessibilityTree(state).children;
    // section is flattened: img, hr, toc, then the section's child paragraph inline
    expect(children.map((c) => c.role)).toEqual(["img", "separator", "navigation", "paragraph"]);
    const img = nth(children, 0, "img node");
    expect(img).toMatchObject({ role: "img", sourceBlockId: "img", name: "" }); // no alt attr → "" (unlabeled)
    const hr = nth(children, 1, "hr node");
    expect(hr).toMatchObject({ role: "separator", sourceBlockId: "hr", children: [] });
    const toc = nth(children, 2, "toc node");
    expect(toc).toMatchObject({ role: "navigation", sourceBlockId: "toc", name: "Table of contents" });
    const flattenedPara = nth(children, 3, "flattened paragraph");
    expect(flattenedPara.sourceBlockId).toBe("sp");
    expect(flattenedPara.text).toEqual([{ text: "in section", sourceOffsetStart: 0, sourceOffsetEnd: 10 }]);
  });

  it("projects the image's model-backed alt attr as its accessible name (3 states)", () => {
    // alt is set via SET_IMAGE_ALT; the a11y projection reads attrs.alt.
    //   non-empty → name === the alt string (labeled).
    //   "" (decorative) → name === "" (AT skips it).
    //   absent → name === "" (unlabeled; AT announces "image"/filename).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "labeled", lastChildId: "bare" }),
        buildBlock({ id: "labeled", type: "image", parentId: "doc", nextSiblingId: "deco",
          attrs: { src: "barn.png", alt: "A red barn" } }),
        buildBlock({ id: "deco", type: "image", parentId: "doc", prevSiblingId: "labeled",
          nextSiblingId: "bare", attrs: { src: "spacer.png", alt: "" } }),
        buildBlock({ id: "bare", type: "image", parentId: "doc", prevSiblingId: "deco",
          attrs: { src: "x.png" } }),
      ],
    });
    const children = buildAccessibilityTree(state).children;
    expect(children.map((c) => c.role)).toEqual(["img", "img", "img"]);
    expect(children[0]).toMatchObject({ role: "img", sourceBlockId: "labeled", name: "A red barn" });
    expect(children[1]).toMatchObject({ role: "img", sourceBlockId: "deco", name: "" });
    expect(children[2]).toMatchObject({ role: "img", sourceBlockId: "bare", name: "" });
  });

  it("section is a list-grouping boundary: list-items across a section boundary are NOT merged", () => {
    // A top-level list-item (L1), then a section containing a list-item (also L1),
    // then another top-level list-item (L1). The section is a grouping boundary —
    // the three items must NOT merge into one list. Expected result: three separate
    // synthetic "list" nodes (the outer two each contain one item; the middle list
    // is the flattened section child, also containing one item).
    //
    // This is acceptable v1 behavior: a section acts as a grouping fence. Items
    // inside the section are grouped within the recursive buildChildren(section)
    // call and do NOT merge with outer items.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li3" }),
        buildBlock({ id: "li1", type: "list-item", parentId: "doc", nextSiblingId: "sec",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("outer-1")]) }),
        // section acts as a grouping boundary between li1 and li3
        buildBlock({ id: "sec", type: "section", parentId: "doc",
          prevSiblingId: "li1", nextSiblingId: "li3",
          firstChildId: "li2", lastChildId: "li2" }),
        buildBlock({ id: "li2", type: "list-item", parentId: "sec",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("inner")]) }),
        buildBlock({ id: "li3", type: "list-item", parentId: "doc", prevSiblingId: "sec",
          attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("outer-2")]) }),
      ],
    });
    const children = buildAccessibilityTree(state).children;
    // li1 → list, sec (flattened) → list (li2 grouped within section), li3 → list
    // Three separate lists, NOT merged across the section boundary.
    expect(children.map((c) => c.role)).toEqual(["list", "list", "list"]);
    expect(nth(nth(children, 0, "list 0").children, 0, "item").sourceBlockId).toBe("li1");
    expect(nth(nth(children, 1, "list 1").children, 0, "item").sourceBlockId).toBe("li2");
    expect(nth(nth(children, 2, "list 2").children, 0, "item").sourceBlockId).toBe("li3");
  });

  it("appends footnote bodies (doc-footnote) and template bodies (banner/contentinfo) after the main body", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", attrs: { headerBlockId: "hdr", footerBlockId: "ftr" },
          firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("body")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn1", type: "footnote-body", firstChildId: "fp", lastChildId: "fp" }),
        buildBlock({ id: "fp", type: "paragraph", parentId: "fn1",
          inlineContent: inlineContent([text("note")]) }),
        buildBlock({ id: "fn2", type: "footnote-body", firstChildId: "fp2", lastChildId: "fp2" }),
        buildBlock({ id: "fp2", type: "paragraph", parentId: "fn2",
          inlineContent: inlineContent([text("note2")]) }),
      ],
      templateContents: [
        buildBlock({ id: "hdr", type: "template-body", firstChildId: "hp", lastChildId: "hp" }),
        buildBlock({ id: "hp", type: "paragraph", parentId: "hdr",
          inlineContent: inlineContent([text("Header")]) }),
        buildBlock({ id: "ftr", type: "template-body", firstChildId: "fpp", lastChildId: "fpp" }),
        buildBlock({ id: "fpp", type: "paragraph", parentId: "ftr",
          inlineContent: inlineContent([text("Footer")]) }),
      ],
    });
    const top = buildAccessibilityTree(state);
    expect(top.children.map((c) => c.role)).toEqual(
      ["paragraph", "doc-footnote", "doc-footnote", "banner", "contentinfo"],
    );
    const fn = top.children.find((c) => c.role === "doc-footnote");
    expect(fn?.sourceBlockId).toBe("fn1");
    expect(fn?.children[0]?.text).toEqual([{ text: "note", sourceOffsetStart: 0, sourceOffsetEnd: 4 }]);
    const footnotes = top.children.filter((c) => c.role === "doc-footnote");
    expect(footnotes.map((f) => f.sourceBlockId)).toEqual(["fn1", "fn2"]);
    expect(footnotes[1]?.children[0]?.text).toEqual([{ text: "note2", sourceOffsetStart: 0, sourceOffsetEnd: 5 }]);
    const banner = top.children.find((c) => c.role === "banner");
    expect(banner?.children[0]?.text).toEqual([{ text: "Header", sourceOffsetStart: 0, sourceOffsetEnd: 6 }]);
    const contentinfo = top.children.find((c) => c.role === "contentinfo");
    expect(contentinfo?.children[0]?.text).toEqual([{ text: "Footer", sourceOffsetStart: 0, sourceOffsetEnd: 6 }]);
  });

  it("classifies a template-body as contentinfo when a block links it via footerBlockId", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document", attrs: { footerBlockId: "ftr" } })],
      templateContents: [
        buildBlock({ id: "ftr", type: "template-body", firstChildId: "fpp", lastChildId: "fpp" }),
        buildBlock({ id: "fpp", type: "paragraph", parentId: "ftr",
          inlineContent: inlineContent([text("Footer")]) }),
      ],
    });
    expect(buildAccessibilityTree(state).children.map((c) => c.role)).toEqual(["contentinfo"]);
  });

  it("THROWS on an unmapped block type (a missing-from-AT node is an invisible regression)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "totally-unknown-block", parentId: "doc",
          inlineContent: inlineContent([text("?")]) }),
      ],
    });
    // Assert the distinctive new-guard phrase so this test genuinely fails if the
    // guard regresses to a vaguer message (the block-type name itself contains
    // "unknown", which a broader regex would spuriously match).
    expect(() => buildAccessibilityTree(state)).toThrow(/no accessibility role mapped/i);
  });

  it("is exported from the core barrel", async () => {
    const mod = await import("../index");
    expect(typeof mod.buildAccessibilityTree).toBe("function");
  });
});

describe("collectRuns — page-valued field runs", () => {
  /** Build a one-paragraph doc whose block "b1" carries `items` as its inline content. */
  function paragraphWith(items: ReadonlyArray<Parameters<typeof inlineContent>[0][number]>) {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "b1", lastChildId: "b1" }),
        buildBlock({ id: "b1", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent(items) }),
      ],
    });
  }

  it("emits a DISTINCT run with fieldKind + fieldKey + '' for a page-count field", () => {
    // inline items: [text "Page ", page-count embed] — the embed is array index 1.
    const state = paragraphWith([
      text("Page "),
      embed(PAGE_FIELD_EMBED_TYPE, { fieldKind: "page-count", numberStyle: "decimal" }),
    ]);
    const para = nth(buildAccessibilityTree(state, { suggestionView: "suggesting" }).children, 0, "paragraph node");
    const runs = para.text ?? [];
    const fieldRun = runs.find((r) => r.fieldKind !== undefined);
    expect(fieldRun).toBeDefined();
    expect(fieldRun?.fieldKind).toBe("page-count");
    expect(fieldRun?.text).toBe("");
    expect(fieldRun?.fieldKey).toBe(inlineRenderKey(asBlockId("b1"), 1));
    // not merged into the "Page " text run:
    expect(runs.filter((r) => r.fieldKind === undefined).some((r) => r.text === "Page ")).toBe(true);
  });

  it("emits fieldKind cross-ref-page for a cross-reference embed in page mode", () => {
    const state = paragraphWith([
      embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "tgt", refMode: "page" }),
    ]);
    const para = nth(buildAccessibilityTree(state, { suggestionView: "suggesting" }).children, 0, "paragraph node");
    const fieldRun = (para.text ?? []).find((r) => r.fieldKind !== undefined);
    expect(fieldRun?.fieldKind).toBe("cross-ref-page");
    expect(fieldRun?.text).toBe("");
    expect(fieldRun?.fieldKey).toBe(inlineRenderKey(asBlockId("b1"), 0));
  });

  it("emits fieldKind page-number for a page-number field", () => {
    const state = paragraphWith([
      embed(PAGE_FIELD_EMBED_TYPE, { fieldKind: "page-number", numberStyle: "decimal" }),
    ]);
    const para = nth(buildAccessibilityTree(state, { suggestionView: "suggesting" }).children, 0, "paragraph node");
    const fieldRun = (para.text ?? []).find((r) => r.fieldKind !== undefined);
    expect(fieldRun?.fieldKind).toBe("page-number");
    expect(fieldRun?.text).toBe("");
    expect(fieldRun?.fieldKey).toBe(inlineRenderKey(asBlockId("b1"), 0));
  });

  // A cross-reference NOT in page mode is not a page-valued field → no fieldKind run.
  it("does NOT mark a non-page-mode cross-reference as a field run", () => {
    const state = paragraphWith([
      embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "tgt", refMode: "label" }),
    ]);
    const para = nth(buildAccessibilityTree(state, { suggestionView: "suggesting" }).children, 0, "paragraph node");
    expect((para.text ?? []).some((r) => r.fieldKind !== undefined)).toBe(false);
  });

  // INDEX-DIVERGENCE: the fieldKey index must equal render-core's key even when the
  // field follows an item that hits one of collectRuns's `continue` paths.
  it("fieldKey index counts an invisible suggestion-deletion item before the field", () => {
    // items: [a DELETION_SUGGESTION_ATTR text item, page-count] — field is array index 1.
    // Built with { suggestionView: "final" } so the deletion item is FILTERED by
    // itemVisibleInView (its invisible-skip `continue` still increments render-core's i).
    const state = paragraphWith([
      text("gone", { [DELETION_SUGGESTION_ATTR]: "s1" }),
      embed(PAGE_FIELD_EMBED_TYPE, { fieldKind: "page-count", numberStyle: "decimal" }),
    ]);
    const para = nth(buildAccessibilityTree(state, { suggestionView: "final" }).children, 0, "paragraph node");
    const fieldRun = (para.text ?? []).find((r) => r.fieldKind !== undefined);
    expect(fieldRun?.fieldKey).toBe(inlineRenderKey(asBlockId("b1"), 1));
  });

  it("fieldKey index counts a comment-start marker before the field", () => {
    // items: [comment-start embed, page-count] → field is array index 1.
    const state = paragraphWith([
      embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
      embed(PAGE_FIELD_EMBED_TYPE, { fieldKind: "page-count", numberStyle: "decimal" }),
    ]);
    const para = nth(buildAccessibilityTree(state, { suggestionView: "suggesting" }).children, 0, "paragraph node");
    const fieldRun = (para.text ?? []).find((r) => r.fieldKind !== undefined);
    expect(fieldRun?.fieldKey).toBe(inlineRenderKey(asBlockId("b1"), 1));
  });

  it("fieldKey index counts a footnote-anchor before the field", () => {
    // items: [footnote-anchor embed, page-count] → field is array index 1.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "b1", lastChildId: "b1" }),
        buildBlock({ id: "b1", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            embed(FOOTNOTE_ANCHOR_EMBED_TYPE, { contentBlockId: "fn1" }),
            embed(PAGE_FIELD_EMBED_TYPE, { fieldKind: "page-count", numberStyle: "decimal" }),
          ]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn1", type: "footnote-body", inlineContent: inlineContent([text("note")]) }),
      ],
    });
    const para = nth(buildAccessibilityTree(state, { suggestionView: "suggesting" }).children, 0, "paragraph node");
    const fieldRun = (para.text ?? []).find((r) => r.fieldKind !== undefined);
    expect(fieldRun?.fieldKey).toBe(inlineRenderKey(asBlockId("b1"), 1));
  });
});

describe("collectRuns — TOC guard (OQ1)", () => {
  it("a table-of-contents block emits a navigation landmark with NO field runs and does not crash", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "toc", lastChildId: "toc" }),
        buildBlock({ id: "toc", type: "table-of-contents", parentId: "doc" }),
      ],
    });
    const tree = buildAccessibilityTree(state, { suggestionView: "suggesting" });
    const nav = tree.children.find((c) => c.role === "navigation");
    expect(nav?.role).toBe("navigation");
    expect(nav?.text ?? []).toEqual([]); // no field runs
  });
});
