// packages/print/src/layout-driver/incremental-reuse.test.ts
//
// Phase 0b PERF GUARD for the layout-driver's incremental reuse. The driver
// (`createLayoutDriver`) retains the prior render→cascade→layout cycle's trees
// as closure state; on the next `rebuild(state, width, lastDirtyIds)` the
// incremental path reuses every subtree the edit did NOT touch BY REFERENCE
// (keyed off `lastDirtyIds`), rebuilding only the edited subtree. This is what
// makes a keystroke O(edited blocks), not O(document). Without it, the driver
// would re-cascade / re-layout the whole document every keystroke.
//
// These tests pin that reference-reuse contract through the PUBLIC editor API
// (core is geometry-free, so docs are authored via `reduceEditor` and the
// dirty-id hand-off is read straight off `editor.lastDirtyIds`):
//
//   CASE 1 (block-subtree reuse): on the NON-paginated `LayoutBox` path (whose
//   direct children are the per-block boxes — the layer the reuse contract acts
//   on, mirroring core's `layout-reuse.test.ts`), edit one block of a many-block
//   doc; an untouched block's box is `toBe`-identical across rebuilds, the edited
//   block's box is `.not.toBe` (genuinely rebuilt).
//
//   CASE 2 (template + footnote-body retention): on the PAGINATED path of a
//   multi-page doc carrying a header template AND a footnote, type one char in a
//   body block on a LATER page; an earlier page (which the edit did not touch) is
//   reused by reference — and with it its `headerSlot` (the template body) and
//   `footnoteSlot` (the footnote body) are each `toBe`-identical across rebuilds.
//   Without the driver's `prevCascadedTemplate` / `prevCascadedEmbed` retention
//   (and per-page reuse) those subtrees would rebuild on every keystroke.
import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, getBlock, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, type EditorConfig, type EditorState, type BlockId, type PageConfig } from "@taleweaver/core";
import { type PageBox } from "../index";
import { createLayoutDriver } from "./layout-driver";
import type { LayoutConfig } from "./layout-config";

const measurer = createMockShaper(8, 16); // 16px line-height, 8px/char.

// Small pages (16px line-height ⇒ 5 single-line paragraphs / page) so a couple
// dozen one-line paragraphs span several pages — page-level reuse + slot
// retention are then the meaningful assertions.
const SMALL_PAGE: PageConfig = {
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
function caretTo(
  editor: EditorState,
  blockId: BlockId,
  offset: number,
  config: EditorConfig,
): EditorState {
  return reduceEditor(
    editor,
    { type: "SET_SELECTION", selection: { anchor: { blockId, offset }, focus: { blockId, offset } } },
    config,
  );
}

interface BoxLike {
  readonly type: string;
  readonly key?: string;
  readonly children?: readonly BoxLike[];
}

/**
 * Depth-first search for the first box whose `key` equals `blockId`. A block's
 * layout box carries its block id as `key`, so this resolves the per-block
 * subtree the reuse contract is about.
 */
function findBoxByKey(box: BoxLike, key: string): BoxLike | null {
  if (box.key === key) return box;
  for (const child of box.children ?? []) {
    const hit = findBoxByKey(child, key);
    if (hit !== null) return hit;
  }
  return null;
}

/** The first body block id of a fresh editor. */
function firstBodyBlockId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no body block");
  return root.firstChildId;
}

describe("layout-driver incremental reuse (perf guard)", () => {
  it("CASE 1: an untouched block's subtree is reused by reference; the edited one is rebuilt", () => {
    // Non-paginated path: the driver yields a `LayoutBox` whose direct children
    // are per-block boxes — the layer block-subtree reuse acts on.
    const config = makeEditorConfig();
    let editor = createInitialEditorState(config);

    const blockIds: BlockId[] = [];
    for (let i = 0; i < 24; i++) {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `Paragraph ${i}` }, config);
      blockIds.push(editor.selection.focus.blockId);
      if (i < 23) editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    }

    const driver = createLayoutDriver(makeLayoutConfig());
    const before = driver.rebuild(editor.state, editor.containerWidth, null);
    if (before.type !== "block") throw new Error("expected a non-paginated LayoutBox");

    const editedId = blockIds[12];
    const untouchedId = blockIds[3];
    if (editedId === undefined || untouchedId === undefined) throw new Error("missing block ids");

    const editedBoxBefore = findBoxByKey(before, editedId);
    const untouchedBoxBefore = findBoxByKey(before, untouchedId);
    if (editedBoxBefore === null || untouchedBoxBefore === null) {
      throw new Error("could not resolve block boxes in the before-tree");
    }

    // Type into block 12, then incrementally rebuild off its dirty ids.
    editor = caretTo(editor, editedId, 0, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "Z" }, config);
    const dirty = editor.lastDirtyIds;
    expect(dirty).not.toBeNull();
    if (dirty === null) return;
    expect(dirty.has(editedId)).toBe(true);

    const after = driver.rebuild(editor.state, editor.containerWidth, dirty);
    if (after.type !== "block") throw new Error("expected a non-paginated LayoutBox");

    const editedBoxAfter = findBoxByKey(after, editedId);
    const untouchedBoxAfter = findBoxByKey(after, untouchedId);
    if (editedBoxAfter === null || untouchedBoxAfter === null) {
      throw new Error("could not resolve block boxes in the after-tree");
    }

    // The untouched block's subtree is the SAME object (reused by reference).
    expect(untouchedBoxAfter).toBe(untouchedBoxBefore);
    // The edited block's subtree was genuinely rebuilt (a new object).
    expect(editedBoxAfter).not.toBe(editedBoxBefore);
  });

  it("CASE 2: a header-template + footnote-body page is retained across a later-page body edit", () => {
    const config = makeEditorConfig(SMALL_PAGE);
    let editor = createInitialEditorState(config);

    // A header template (shown on every page) + a footnote on the FIRST body
    // block (its body lands in page 0's footnote slot).
    editor = reduceEditor(editor, { type: "INSERT_HEADER" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "Header" }, config);

    const bodyFirst = firstBodyBlockId(editor);
    editor = caretTo(editor, bodyFirst, 0, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "host" }, config);
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // INSERT_FOOTNOTE drops the caret into the footnote body; type into it.
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "note" }, config);
    // Return the caret to the host body block (offset 5 = "host" + anchor).
    editor = caretTo(editor, bodyFirst, 5, config);

    // Fill enough one-line paragraphs to span several pages.
    const bodyIds: BlockId[] = [bodyFirst];
    for (let i = 0; i < 24; i++) {
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `P${i}` }, config);
      bodyIds.push(editor.selection.focus.blockId);
    }

    const driver = createLayoutDriver(makeLayoutConfig(SMALL_PAGE));
    const before = driver.rebuild(editor.state, editor.containerWidth, null);
    if (before.type !== "virtual-root") throw new Error("expected a paginated tree");
    expect(before.plan.entries.length).toBeGreaterThan(1); // genuinely multi-page

    const page0Before: PageBox = before.getPage(0);
    // Page 0 carries the header template body AND the footnote body slot.
    expect(page0Before.headerSlot).not.toBeNull();
    expect(page0Before.footnoteSlot).not.toBeNull();

    // Edit the LAST body block (a far later page) — touches neither page 0's
    // body nor the header/footnote bodies.
    const lastId = bodyIds[bodyIds.length - 1];
    if (lastId === undefined) throw new Error("missing last body id");
    editor = caretTo(editor, lastId, 0, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "Z" }, config);
    const dirty = editor.lastDirtyIds;
    expect(dirty).not.toBeNull();
    if (dirty === null) return;
    expect(dirty.has(lastId)).toBe(true);

    const after = driver.rebuild(editor.state, editor.containerWidth, dirty);
    if (after.type !== "virtual-root") throw new Error("expected a paginated tree");
    const page0After: PageBox = after.getPage(0);

    // Page 0 (far from the edit) is reused by reference, and with it the header
    // template body + footnote body slots — the driver's prevCascadedTemplate /
    // prevCascadedEmbed retention + per-page reuse working in concert.
    expect(page0After).toBe(page0Before);
    expect(page0After.headerSlot).toBe(page0Before.headerSlot);
    expect(page0After.footnoteSlot).toBe(page0Before.footnoteSlot);
  });
});
