/**
 * FN-6.4 — the layout-driver's restart-per-page second pass (Phase 0b: moved
 * to the print backend), driven END-TO-END through the public editor API.
 *
 * `restart-per-page` footnote numbers depend on which PAGE each anchor lands
 * on, known only after the layout pass. The driver's first render→cascade→layout
 * pass renders the documented continuous fallback; the FN-6.4 second pass reads
 * the layout's `footnoteAnchorPages`, recomputes the per-page numbers, and
 * re-renders the changed markers with a numbering override.
 *
 * Phase 0b: this logic relocated from core's `rebuildTrees` into
 * `createLayoutDriver`. Core is geometry-free, so these tests build the document
 * through the public editor reducer (`reduceEditor` + `INSERT_FOOTNOTE` etc. —
 * NOT core-internal test-utils, which don't cross the package boundary), then
 * rebuild via the driver and assert the user-visible MATERIALIZED outcome: the
 * digit glyphs on each page's call markers (page content) and footnote-body
 * leading markers (`page.footnoteSlot`), plus the `footnoteAnchorPages` page
 * assignment. Under restart-per-page each page's first footnote reads "1" and
 * the continuous "2" never materializes.
 */
import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, type EditorConfig, type EditorState, type BlockId, type PageConfig } from "@taleweaver/core";
import { type LayoutBox, type VirtualLayoutTree, type PageBox } from "./index";
import { createLayoutDriver } from "./layout-driver/layout-driver";
import type { LayoutConfig } from "./layout-driver/layout-config";

const measurer = createMockShaper(8, 16); // 16px line-height, 8px/char.

// 80px content / page ⇒ 5 single-line (16px) paragraphs per page, no margins.
const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 80,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function makeEditorConfig(pageConfig?: PageConfig): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 600,
    pageConfig,
  };
}

function makeLayoutConfig(pageConfig?: PageConfig): LayoutConfig {
  return {
    measurer,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    pageConfig,
  };
}

/** Move the caret to (blockId, offset). */
function caretTo(editor: EditorState, blockId: BlockId, offset: number, config: EditorConfig): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: { anchor: { blockId, offset }, focus: { blockId, offset } },
    },
    config,
  );
}

/**
 * Build a doc through the editor API: a host paragraph with a footnote, then
 * `filler` empty paragraphs, then a second host paragraph with a footnote.
 * Returns the editor (its `state` is fed to the driver).
 */
function twoFootnotes(config: EditorConfig, filler: number): EditorState {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
  const firstHost = editor.selection.focus.blockId;
  editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
  // INSERT_FOOTNOTE drops the caret into the body; return to the main host
  // ("a" + anchor → offset 2) before splitting off the filler paragraphs.
  editor = caretTo(editor, firstHost, 2, config);
  for (let i = 0; i < filler; i++) {
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
  }
  // One more split → the second host paragraph; type + add the second footnote.
  editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
  editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
  return editor;
}

/** Build the driver-produced layout tree for an editor's state (full rebuild). */
function driverLayout(editor: EditorState, config: LayoutConfig): LayoutBox | VirtualLayoutTree {
  return createLayoutDriver(config).rebuild(editor.state, 600, null);
}

/**
 * Collect every glyph-bearing text in a layout subtree: `text-run` boxes AND
 * `marker` boxes (the footnote-body leading number is a generated `MarkerBox`
 * carrying its number string in `.text`).
 */
function collectRunTexts(box: LayoutBox, out: string[]): void {
  if (box.type === "text-run") out.push(box.text);
  if (box.type === "marker") out.push(box.text);
  const anyBox = box as { children?: readonly LayoutBox[] };
  if (anyBox.children !== undefined) {
    for (const child of anyBox.children) collectRunTexts(child, out);
  }
}

/** The materialized PageBoxes of a virtual layout tree. */
function pagesOf(layout: LayoutBox | VirtualLayoutTree): PageBox[] {
  if (layout.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated path)");
  }
  return layout.getPages(0, 100);
}

/** Every digit glyph (call markers in content + body markers in the slot) on a page. */
function pageDigits(page: PageBox): string[] {
  const texts: string[] = [];
  for (const child of page.children) collectRunTexts(child, texts);
  if (page.footnoteSlot !== null) collectRunTexts(page.footnoteSlot, texts);
  return texts.filter((t) => /^\d+$/.test(t));
}

/** Every digit glyph across all pages of a virtual tree. */
function allDigits(layout: LayoutBox | VirtualLayoutTree): string[] {
  const digits: string[] = [];
  for (const page of pagesOf(layout)) digits.push(...pageDigits(page));
  return digits;
}

describe("FN-6.4 — layout-driver restart-per-page second pass", () => {
  it("restart-per-page: every page's first footnote restarts at 1 (the continuous 2 never materializes)", () => {
    // Two footnotes pushed onto different pages by filler paragraphs. Continuous
    // numbering would render a "2"; restart-per-page renders "1" on each page.
    const editorConfig = makeEditorConfig(PAGE_CONFIG);
    let editor = twoFootnotes(editorConfig, 6);
    editor = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-page" },
      editorConfig,
    );

    const layout = driverLayout(editor, makeLayoutConfig(PAGE_CONFIG));
    if (layout.type !== "virtual-root") throw new Error("expected a paginated tree");
    // Genuinely multi-page (otherwise the per-page restart is vacuous).
    expect(layout.plan.entries.length).toBeGreaterThan(1);

    const digits = allDigits(layout);
    expect(digits).toContain("1");
    expect(digits).not.toContain("2");
  });

  it("continuous policy: both 1 and 2 materialize (the second pass never runs)", () => {
    const editorConfig = makeEditorConfig(PAGE_CONFIG);
    const editor = twoFootnotes(editorConfig, 6); // no policy → continuous default

    const layout = driverLayout(editor, makeLayoutConfig(PAGE_CONFIG));
    if (layout.type !== "virtual-root") throw new Error("expected a paginated tree");
    expect(layout.plan.entries.length).toBeGreaterThan(1);

    const digits = allDigits(layout);
    expect(digits).toContain("1");
    expect(digits).toContain("2");
  });

  it("restart-per-page with both footnotes on ONE (tall) page: numbers equal continuous (1,2)", () => {
    // A tall page so both anchors AND both footnote slots fit on page 0.
    const tall: PageConfig = { ...PAGE_CONFIG, pageBlockSize: 400 };
    const editorConfig = makeEditorConfig(tall);
    let editor = twoFootnotes(editorConfig, 0);
    editor = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-page" },
      editorConfig,
    );

    const layout = driverLayout(editor, makeLayoutConfig(tall));
    if (layout.type !== "virtual-root") throw new Error("expected a paginated tree");

    // Same page ⇒ per-page == continuous: both 1 and 2 materialize.
    const digits = allDigits(layout);
    expect(digits).toContain("1");
    expect(digits).toContain("2");
  });

  it("restart-per-page on a NON-virtual layout (no pageConfig) keeps the continuous fallback (1,2)", () => {
    const editorConfig = makeEditorConfig(undefined); // no pageConfig
    let editor = twoFootnotes(editorConfig, 0);
    editor = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-page" },
      editorConfig,
    );

    const layout = driverLayout(editor, makeLayoutConfig(undefined));
    // Non-virtual layout: no footnoteAnchorPages ⇒ the driver keeps the
    // continuous fallback (1, 2) rather than crashing or restarting.
    expect(layout.type).not.toBe("virtual-root");
    if (layout.type === "virtual-root") throw new Error("expected a positioned LayoutBox");
    const texts: string[] = [];
    collectRunTexts(layout, texts);
    const digits = texts.filter((t) => /^\d+$/.test(t));
    expect(digits).toContain("1");
    expect(digits).toContain("2");
  });
});
