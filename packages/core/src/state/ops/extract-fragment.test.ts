import { describe, it, expect } from "vitest";
import { extractFragment } from "./extract-fragment";
import { encodeHtml } from "../serialize/html-encode";
import { createSpan, createPosition } from "../block-position";
import type { BlockId } from "../block-id";
import { buildBlock, buildState, inlineContent, text, embed } from "../../test-utils/state-builders";
import { getBlock, getEmbedContent } from "../state";
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "../comments";
import {
  INSERTION_SUGGESTION_ATTR,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  readSuggestionRecordFromState,
  type SuggestionId,
  type SuggestionRecord,
} from "../suggestions";
import { suggestionIdsOnItem } from "./suggestion-ops";
import { buildStateFromBlocks } from "../build-state-from-blocks";

// ─── Small helpers to query a fragment State ────────────────────────────────

function bid(s: string): BlockId {
  return s as BlockId;
}

/** Top-level block types under the fragment's root. */
function fragTopLevelTypes(frag: ReturnType<typeof extractFragment>): string[] {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return [];
  const types: string[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    types.push(block.type);
    cur = block.nextSiblingId;
  }
  return types;
}

/** InlineContent items of the nth top-level block (0-indexed). */
function fragBlockItems(
  frag: ReturnType<typeof extractFragment>,
  n: number,
): Array<{ kind: string; text?: string; attrs?: Record<string, unknown> }> {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return [];
  let cur: BlockId | null = root.firstChildId;
  let i = 0;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    if (i === n) {
      if (block.inlineContent === null) return [];
      return block.inlineContent.items.map((item) =>
        item.kind === "text"
          ? { kind: "text", text: item.text, attrs: item.attrs as Record<string, unknown> }
          : { kind: "embed", attrs: item.attrs as Record<string, unknown> },
      );
    }
    i++;
    cur = block.nextSiblingId;
  }
  return [];
}

/** Concatenate all text of the nth top-level block. */
function fragBlockText(
  frag: ReturnType<typeof extractFragment>,
  n: number,
): string {
  const items = fragBlockItems(frag, n);
  return items
    .filter((it) => it.kind === "text")
    .map((it) => it.text ?? "")
    .join("");
}

/** True iff the fragment has any embed content (footnote bodies etc.). */
function fragHasEmbedContent(frag: ReturnType<typeof extractFragment>): boolean {
  // getEmbedContentIds iterates the embedContents map
  // We check by walking all top-level block inlineContent for an embed with contentBlockId
  const root = getBlock(frag, frag.rootId);
  if (root === null) return false;
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    if (block.inlineContent) {
      for (const item of block.inlineContent.items) {
        if (item.kind === "embed" && typeof item.properties["contentBlockId"] === "string") {
          const cbId = item.properties["contentBlockId"] as BlockId;
          const body = getEmbedContent(frag, cbId);
          if (body !== null) return true;
        }
      }
    }
    cur = block.nextSiblingId;
  }
  return false;
}

/** True iff any top-level block has a comment-start or comment-end embed. */
function fragHasCommentEmbed(frag: ReturnType<typeof extractFragment>): boolean {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return false;
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    if (block.inlineContent) {
      for (const item of block.inlineContent.items) {
        if (
          item.kind === "embed" &&
          (item.embedType === COMMENT_START_EMBED_TYPE ||
            item.embedType === COMMENT_END_EMBED_TYPE)
        ) {
          return true;
        }
      }
    }
    cur = block.nextSiblingId;
  }
  return false;
}

/**
 * Returns suggestion records stored in the fragment. Harvests provenance ids
 * via the canonical `suggestionIdsOnItem` (text attrs + break-embed
 * `properties.suggestionId` + embed FORMATTING_SUGGESTION_ATTR), then reads
 * each record back out of the fragment's suggestions side-table.
 */
function suggestionRecordsOf(
  frag: ReturnType<typeof extractFragment>,
): readonly SuggestionRecord[] {
  const root = getBlock(frag, frag.rootId);
  if (root === null) return [];
  const ids = new Set<string>();
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    const block = getBlock(frag, cur);
    if (block === null) break;
    if (block.inlineContent) {
      for (const item of block.inlineContent.items) {
        for (const id of suggestionIdsOnItem(item)) ids.add(id);
      }
    }
    cur = block.nextSiblingId;
  }
  return [...ids]
    .map((id) => readSuggestionRecordFromState(frag, id as SuggestionId))
    .filter((r): r is SuggestionRecord => r !== null);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("extractFragment", () => {
  // ── intra-block: trims to [start,end), preserves marks ──────────────────

  it("intra-block selection: trims to [start,end), preserves marks", () => {
    // doc: p = "ab" + "cd"(bold) + "ef"
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            text("cd", { bold: true }),
            text("ef"),
          ]),
        }),
      ],
    });

    // select offset 2..4 = "cd" (bold)
    const span = createSpan(createPosition(bid("p"), 2), createPosition(bid("p"), 4));
    const frag = extractFragment(state, span);

    expect(fragTopLevelTypes(frag)).toEqual(["paragraph"]);
    const items = fragBlockItems(frag, 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ kind: "text", text: "cd", attrs: { bold: true } });
  });

  // ── cross-leaf: first/last trimmed, interior whole ───────────────────────

  it("cross-leaf selection: first/last trimmed, interior whole, types kept", () => {
    // doc: h1 "Title" | p "body" | p "tail"
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "h1",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "h1",
          type: "heading",
          parentId: "doc",
          nextSiblingId: "p1",
          inlineContent: inlineContent([text("Title")]),
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h1",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("body")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("tail")]),
        }),
      ],
    });

    // Select: h1 offset 2 ("tle") to p2 offset 2 ("ta")
    const span = createSpan(createPosition(bid("h1"), 2), createPosition(bid("p2"), 2));
    const frag = extractFragment(state, span);

    expect(fragTopLevelTypes(frag)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(fragBlockText(frag, 0)).toBe("tle"); // h1 trimmed from offset 2
    expect(fragBlockText(frag, 1)).toBe("body"); // p1 whole
    expect(fragBlockText(frag, 2)).toBe("ta");  // p2 trimmed to offset 2
  });

  // ── whole-table selection clones the table subtree (rows/cells preserved) ──

  it("whole-table selection clones the table subtree (rows/cells preserved)", () => {
    // doc: table → row → cell → paragraph "Hello"
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "tbl",
          lastChildId: "tbl",
        }),
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
          inlineContent: inlineContent([text("Hello")]),
        }),
      ],
    });

    // Select the whole table: position in "cp" offset 0 to end (5)
    const wholeTableSpan = createSpan(
      createPosition(bid("cp"), 0),
      createPosition(bid("cp"), 5),
    );
    const frag = extractFragment(state, wholeTableSpan);

    // The table block is a container — the common ancestor of the span is "cp",
    // but we walk up to find the top-level children of the document.
    // In this case, cp is deeply nested; the top-level subtree is the "tbl" block.
    // Since the whole "cp" is selected (full block), and it's the only leaf,
    // the table subtree should be cloned whole.
    expect(fragTopLevelTypes(frag)).toEqual(["table"]);
    // walk into the cloned table: row/cell structure intact
    const fragRoot = getBlock(frag, frag.rootId);
    expect(fragRoot).not.toBeNull();
    const tblId = fragRoot?.firstChildId;
    expect(tblId).not.toBeNull();
    const tbl = getBlock(frag, tblId as BlockId);
    expect(tbl?.type).toBe("table");
    const rowId = tbl?.firstChildId;
    expect(rowId).not.toBeNull();
    const row = getBlock(frag, rowId as BlockId);
    expect(row?.type).toBe("table-row");
    const cellId = row?.firstChildId;
    expect(cellId).not.toBeNull();
    const cell = getBlock(frag, cellId as BlockId);
    expect(cell?.type).toBe("table-cell");
  });

  // ── footnote bodies carried as embedContents ─────────────────────────────

  it("carries footnote bodies (embedContents) referenced by selected embeds", () => {
    // doc: p → [text "Hello ", footnote-anchor(contentBlockId="fnbody"), text " World"]
    // embed: fnbody → paragraph "Footnote text"
    const FOOTNOTE_EMBED_TYPE = "footnote-anchor";
    const state = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("Hello "),
            embed(FOOTNOTE_EMBED_TYPE, { contentBlockId: "fnbody" }),
            text(" World"),
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

    // Select the entire paragraph content: offset 0 to 14 (6 + 1 + 7 = 14)
    // "Hello " = 6, footnote embed = 1, " World" = 6 → total 13
    const span = createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 13));
    const frag = extractFragment(state, span);

    expect(fragHasEmbedContent(frag)).toBe(true);
  });

  // ── comment markers stripped on partial arm ──────────────────────────────

  it("strips comment markers on the partial-block arm (M3)", () => {
    // p contains: "a" + comment-start + "bcd" + comment-end + "e"
    // select offsets 1..5 = "bcde" (spans the comment markers but they should be stripped)
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            text("bcd"),
            embed(COMMENT_END_EMBED_TYPE, { commentId: "c1" }),
            text("e"),
          ]),
        }),
      ],
    });

    // offsets: "a"=1, comment-start=1, "bcd"=3, comment-end=1, "e"=1 → total 7
    // select 1..5: starts after "a", ends after "cd" — covers comment-start + "bcd" + comment-end
    const span = createSpan(createPosition(bid("p"), 1), createPosition(bid("p"), 5));
    const frag = extractFragment(state, span);

    expect(fragHasCommentEmbed(frag)).toBe(false);
  });

  // ── suggestion records carried into fragment ─────────────────────────────

  it("carries referenced suggestion records into the fragment (feeds T4/T7)", () => {
    // p: text "hello" with insertionSuggestionId="s1"
    // suggestion record: { id:"s1", kind:"insertion", author:"Alice", createdAt:0 }
    const state = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello", { [INSERTION_SUGGESTION_ATTR]: "s1" }),
          ]),
        }),
      ],
      suggestions: [
        { id: "s1" as SuggestionId, kind: "insertion", author: "Alice", createdAt: 0 },
      ],
    });

    const span = createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 5));
    const frag = extractFragment(state, span);

    const records = suggestionRecordsOf(frag);
    expect(records.map((r) => r.id)).toContain("s1");
  });

  it("carries a break-suggestion embed's record (provenance via properties.suggestionId)", () => {
    // p: "ab" + block-split-suggestion embed (suggestionId="s2") + "cd"
    // The suggestion provenance lives on the embed's properties, NOT a text attr,
    // so the canonical harvester (suggestionIdsOnItem) must pick it up — a
    // fragment carrying the embed must carry its record (else lossless flavor
    // round-trips a dangling reference).
    const state = buildStateFromBlocks({
      rootId: bid("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: "s2" }),
            text("cd"),
          ]),
        }),
      ],
      suggestions: [
        { id: "s2" as SuggestionId, kind: "insertion", author: "Bob", createdAt: 1 },
      ],
    });

    // offsets: "ab"=2, embed=1, "cd"=2 → total 5. Select 1..4 to span the embed.
    const span = createSpan(createPosition(bid("p"), 1), createPosition(bid("p"), 4));
    const frag = extractFragment(state, span);

    const records = suggestionRecordsOf(frag);
    expect(records.map((r) => r.id)).toContain("s2");
  });

  // ── cross-cell same-table span: linear leaf extraction (no grid model) ────

  it("cross-cell same-table span extracts spanned leaf paragraphs linearly (no crash)", () => {
    // A 1-row, 2-cell table. Each cell holds one paragraph: pA="Alpha", pB="Beta".
    // A cross-cell span (pA offset 1 → pB offset 2) is STORED by the engine
    // (selectionContextOf walks both cells up to the doc root → same context),
    // but there is NO whole-cell grid-selection model (deferred — see
    // packages/print/src/cursor/selection-geometry.test.ts:1025). The defined
    // behavior is LINEAR leaf extraction (the spanned paragraphs as top-level
    // fragment blocks), consistent with extractText/plain-copy — not a crash.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc", firstChildId: "row", lastChildId: "row" }),
        buildBlock({ id: "row", type: "table-row", parentId: "tbl", firstChildId: "cellA", lastChildId: "cellB" }),
        buildBlock({ id: "cellA", type: "table-cell", parentId: "row", nextSiblingId: "cellB", firstChildId: "pA", lastChildId: "pA" }),
        buildBlock({ id: "cellB", type: "table-cell", parentId: "row", prevSiblingId: "cellA", firstChildId: "pB", lastChildId: "pB" }),
        buildBlock({ id: "pA", type: "paragraph", parentId: "cellA", inlineContent: inlineContent([text("Alpha")]) }),
        buildBlock({ id: "pB", type: "paragraph", parentId: "cellB", inlineContent: inlineContent([text("Beta")]) }),
      ],
    });

    // Span: pA offset 1 ("lpha") → pB offset 2 ("Be"). Partial table → recursion
    // flattens to the spanned leaves.
    const span = createSpan(createPosition(bid("pA"), 1), createPosition(bid("pB"), 2));
    const frag = extractFragment(state, span);

    // No crash; the spanned leaf paragraphs are present with trimmed text.
    expect(fragTopLevelTypes(frag)).toEqual(["paragraph", "paragraph"]);
    expect(fragBlockText(frag, 0)).toBe("lpha"); // pA trimmed from offset 1
    expect(fragBlockText(frag, 1)).toBe("Be");   // pB trimmed to offset 2
  });

  // ── encodeHtml accepts the fragment State ───────────────────────────────

  it("encodeHtml accepts the fragment State (valid mini-document)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("abcdef")]),
        }),
      ],
    });

    const span = createSpan(createPosition(bid("p"), 0), createPosition(bid("p"), 6));
    const frag = extractFragment(state, span);
    const html = encodeHtml(frag);
    expect(html).toContain("<p>");
  });
});
