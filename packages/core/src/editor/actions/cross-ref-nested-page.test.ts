/**
 * Plan Task 2.5 — the END-TO-END proof that a `cross-ref-page` field whose target
 * is a block NESTED inside a container (a paragraph inside a table cell) resolves to
 * a real page number through the REAL editor build.
 *
 * The nested-block page-resolution foundation (`pageOfFieldTarget` + `BlockParentLookup`)
 * is exercised ONLY when the editor entry points BUILD a `parentOf` lookup and thread it
 * into `layoutTree` / `layoutTreeIncremental`. Without the entry-point wiring (Part A),
 * `parentOf` is `undefined` at runtime, so `pageOfFieldTarget` short-circuits to `-1`
 * (broken-ref) for ANY non-top-level target — the table-cell paragraph here is nested, so
 * `plan.pageSpanOfBlock(targetId)` is null and resolution falls back to the parent walk.
 *
 * RED→GREEN: pre-wiring this test fails — the body cross-ref reads
 * `BROKEN_CROSS_REFERENCE_TEXT` because the layout pass never received `parentOf`. After
 * Part A wires the three entry points, the producer walks the nested target's ancestor
 * chain to the indexed top-level TABLE and resolves to the table's 1-based page number.
 *
 * Harness mirrors `section-pagination.test.ts`: the real `createInitialEditorState` /
 * `reduceEditor` pipeline, a small page so a handful of one-line paragraphs paginate, and
 * a `VirtualLayoutTree` read per-page via `getPage(i)`. The cross-ref atom is located on
 * the materialized host page by its inline render-key suffix (`${hostId}/inline/…`) and its
 * resolved display text is collected from the laid-out subtree.
 */
import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, getBlock, createPosition, createSpan, render, cascadePass, makeBlockParentLookup, type EditorConfig, type PageConfig, type EditorState, type BlockId } from "../../index";
import { layoutTree } from "@taleweaver/print";
import type { LayoutBox } from "@taleweaver/print";
import type { PageBox } from "@taleweaver/print";
import type { VirtualLayoutTree } from "@taleweaver/print";
import { BROKEN_CROSS_REFERENCE_TEXT } from "../../render/resolve-cross-reference";

// Mock shaper: line height 16, char width 8. A short page (block-size 64, no margins)
// fits 4 one-line paragraphs, so a handful of filler paragraphs ahead of the table push
// it onto a later page — making the resolved page number a meaningful (non-page-1) digit.
function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize: 64,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig,
  };
}

// Phase 0b: `measurer` left core's `EditorConfig` for the backend's layout
// driver. Tests build the layout tree directly via core's pipeline (what the
// driver does) to assert the resolved cross-ref page geometry.
const measurer = createMockShaper(8, 16);

/**
 * Build the layout tree the backend driver would (render → cascade → layout),
 * threading the `parentOf` block-parent lookup (`makeBlockParentLookup`) exactly
 * as the driver does — REQUIRED for nested cross-ref-page resolution, which walks
 * a nested target's ancestor chain to its indexed top-level block.
 */
function layoutOf(editor: EditorState, config: EditorConfig): LayoutBox | VirtualLayoutTree {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  const parentOf = makeBlockParentLookup(editor.state);
  return layoutTree(
    cascaded,
    config.containerWidth,
    measurer,
    config.pageConfig,
    undefined, // cascadedTemplateContents (no header/footer in this fixture)
    undefined, // cascadedEmbedContents
    undefined, // footnoteAnchors
    parentOf,
  );
}

/** The document root's direct children, in order. */
function rootChildIds(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  const ids: BlockId[] = [];
  let id: BlockId | null = root?.firstChildId ?? null;
  while (id !== null) {
    ids.push(id);
    id = getBlock(editor.state, id)?.nextSiblingId ?? null;
  }
  return ids;
}

/** Caret at the end of `blockId` (its inline-content length). */
function caretAtEnd(editor: EditorState, blockId: BlockId, config: EditorConfig): EditorState {
  const block = getBlock(editor.state, blockId);
  const len =
    block?.inlineContent === null || block?.inlineContent === undefined
      ? 0
      : block.inlineContent.items.reduce(
          (n, it) => n + (it.kind === "text" ? it.text.length : 1),
          0,
        );
  const pos = createPosition(blockId, len);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(pos, pos) }, config);
}

/** Concatenate all text in a laid-out box subtree (block + column children). */
function collectText(box: LayoutBox): string {
  let s = "";
  if ("text" in box && typeof box.text === "string") s += box.text;
  if ("children" in box) for (const child of box.children) s += collectText(child);
  if ("columns" in box) for (const col of box.columns) s += collectText(col);
  return s;
}

/**
 * Locate the cross-reference inline-block atom on a materialized page by the host
 * paragraph's inline render-key prefix. The IFC stamps an inline-block box with a key
 * ending in the source render key (`…${hostId}/inline/${i}`); we match by that substring.
 */
function findCrossRefAtom(box: LayoutBox, hostId: BlockId, embedIndex: number): LayoutBox | null {
  const needle = `${hostId}/inline/${embedIndex}`;
  let result: LayoutBox | null = null;
  const visit = (node: LayoutBox): void => {
    if (result !== null) return;
    if (typeof node.key === "string" && node.key.endsWith(needle)) {
      result = node;
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
    if ("columns" in node) for (const col of node.columns) visit(col);
  };
  visit(box);
  return result;
}

/** The materialized layout tree as a VirtualLayoutTree (paginated mode). */
function virtualTree(editor: EditorState, config: EditorConfig): VirtualLayoutTree {
  const tree = layoutOf(editor, config);
  if (tree.type !== "virtual-root") throw new Error("expected a paginated VirtualLayoutTree");
  return tree;
}

/** Find which 0-based page a top-level block id is on (via the plan span). */
function pageOf(editor: EditorState, blockId: BlockId, config: EditorConfig): number {
  const span = virtualTree(editor, config).plan.pageSpanOfBlock(blockId);
  if (span === null) throw new Error(`block ${blockId} has no page span`);
  return span.first;
}

/** Walk a page's box tree (and its columns) collecting text on the page body. */
function findCrossRefTextOnPage(page: PageBox, hostId: BlockId, embedIndex: number): string {
  const body = page.children[0];
  if (body === undefined) throw new Error("page has no body box");
  const atom = findCrossRefAtom(body, hostId, embedIndex);
  if (atom === null) throw new Error("no cross-ref atom on this page");
  return collectText(atom);
}

describe("cross-ref-page to a NESTED (table-cell) target resolves end-to-end (Task 2.5)", () => {
  it("a body cross-ref targeting a paragraph inside a table cell shows the table's page number, not broken-ref", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);

    // The host paragraph (page 0, holds the cross-ref) is the seed empty paragraph; give
    // it a short label so it stays on page 0.
    const hostId = rootChildIds(editor)[0];
    if (hostId === undefined) throw new Error("no seed paragraph");
    editor = caretAtEnd(editor, hostId, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "see " }, config);

    // Append several one-line filler paragraphs AFTER the host so the table lands on a
    // later page (page index >= 1). Each SPLIT_NODE + INSERT_TEXT is a fresh paragraph.
    for (let i = 0; i < 9; i++) {
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `fill ${i}` }, config);
    }

    // After the last filler, split once more and insert a table at the fresh paragraph's
    // start. INSERT_TABLE lands the caret in cell (0,0)'s paragraph — the NESTED target.
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TABLE", rows: 1, cols: 1 }, config);
    const nestedTargetId = editor.selection.focus.blockId; // the cell (0,0) paragraph
    // Type something into the cell so the target is genuinely inline-bearing content.
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "target" }, config);

    // Sanity: the target is genuinely NESTED — its parent is a table-cell (NOT the root),
    // so the page plan does NOT index it directly; only its top-level TABLE ancestor is.
    const targetParent = getBlock(editor.state, nestedTargetId)?.parentId;
    expect(targetParent).not.toBeNull();
    expect(getBlock(editor.state, targetParent as BlockId)?.type).toBe("table-cell");
    expect(virtualTree(editor, config).plan.pageSpanOfBlock(nestedTargetId)).toBeNull();

    // The top-level TABLE ancestor IS indexed and lands on a later page.
    const tableId = rootChildIds(editor).find(
      (id) => getBlock(editor.state, id)?.type === "table",
    );
    if (tableId === undefined) throw new Error("no table at top level");
    const tablePage = pageOf(editor, tableId, config);
    expect(tablePage).toBeGreaterThanOrEqual(1); // not page 0 → a meaningful, non-"1" value

    // Put the caret back at the end of the host paragraph (page 0) and insert a page-mode
    // cross-reference to the NESTED target.
    editor = caretAtEnd(editor, hostId, config);
    const offsetBefore = editor.selection.focus.offset;
    editor = reduceEditor(
      editor,
      { type: "INSERT_CROSS_REFERENCE", targetId: nestedTargetId, refMode: "page" },
      config,
    );
    // The ref was actually inserted (page mode accepts an inline-bearing nested target).
    expect(editor.selection.focus.offset).toBe(offsetBefore + 1);

    // Resolve: read the cross-ref atom's display text on the HOST's page. It must be the
    // TABLE's 1-based page number — proving the nested target resolved via the parentOf
    // ancestor walk threaded by the wired entry points — NOT the broken-ref sentinel.
    const hostPage = pageOf(editor, hostId, config);
    const embedIndex = 1; // host inline content: text "see " (i=0), the cross-ref (i=1)
    const value = findCrossRefTextOnPage(virtualTree(editor, config).getPage(hostPage), hostId, embedIndex);

    expect(value).not.toBe(BROKEN_CROSS_REFERENCE_TEXT); // the pre-wiring failure mode
    expect(value).toBe(String(tablePage + 1)); // 0-based plan page → 1-based display
  });
});
