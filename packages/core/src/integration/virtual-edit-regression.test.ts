// Behavior regression tests for the virtualized-layout caret + paint path.
// These reproduce two user-reported regressions (2026-05-24):
//   Bug A: ArrowUp after Enter doesn't move the caret until pressed twice
//          (caret pixel position on the virtual tree diverges from the truth).
//   Bug B: Enter at the start of the first line still PAINTS the old text on
//          line 0 (the materialized page-0 content is stale).
//
// Root cause (fixed): `materializePage` threaded a per-page `prevLayoutCache`
// built from the prior tree's PageBox so unchanged blocks reused their boxes —
// but a SHIFTED block (e.g. text pushed to the next line by an inserted empty
// paragraph) was reused at its STALE offset instead of being repositioned.
//
// Oracle: a FRESH, non-incremental `layoutTree` of the editor's CURRENT state
// (render → cascade → layoutTree, no prevTree → no carry-forward, no reuse) is
// the independent ground truth. The editor's INCREMENTAL layout must agree with
// it. (Comparing the virtual tree to its own `materializeAll` is NOT
// independent — `materializeAll` calls the same `getPage`, so both go stale
// together; the earlier version of this test had that flaw.)
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  render,
  cascadePass,
  layoutTree,
  getBlock,
  createPosition,
  createSpan,
  type EditorConfig,
  type PageConfig,
  type EditorState,
  type BlockId,
  type LayoutBox,
  type VirtualLayoutTree,
} from "../index";

function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 816,
    pageBlockSize: 1056,
    pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
    pageGap: 24,
  };
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
    pageConfig,
  };
}

/** Independent ground truth: a fresh, non-incremental layout of the state. */
function freshLayout(editor: EditorState, config: EditorConfig): LayoutBox | VirtualLayoutTree {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascadedRoot = cascadePass(rendered.root);
  return layoutTree(cascadedRoot, config.containerWidth, config.measurer, config.pageConfig);
}

/**
 * Force every page of the editor's CURRENT virtual tree to materialize, exactly
 * as the DOM controller does each frame when it paints visible pages. This is
 * load-bearing for these regressions: the per-page subtree-reuse path only
 * engages when the PRIOR tree (the one handed to the next edit as `prevTree`)
 * already had its pages materialized. A test that edits without ever painting
 * never exercises that path and passes even when it is broken.
 */
function paintAllPages(editor: EditorState): void {
  const lt = editor.layoutTree;
  if (lt.type === "virtual-root") {
    for (let i = 0; i < lt.plan.entries.length; i++) lt.getPage(i);
  }
}

function firstBlockId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no first block");
  return root.firstChildId;
}

/** Build a small multi-paragraph doc (each paragraph one line). */
function buildDoc(config: EditorConfig, paras: number): EditorState {
  let editor = createInitialEditorState(config);
  const firstId = firstBlockId(editor);
  editor = reduceEditor(editor, {
    type: "SET_SELECTION",
    selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)),
  }, config);
  for (let i = 0; i < paras; i++) {
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: `para ${i}` }, config);
    if (i < paras - 1) editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
  }
  return editor;
}

describe("virtual-layout caret/paint regressions", () => {
  it("Bug A: ArrowUp after Enter-at-start moves the caret up on the FIRST press", () => {
    // User repro: from the initial doc, Enter at the very start of line 1, then
    // ArrowUp. The caret must move up immediately (the bug needed two presses
    // because the stale page geometry left the text overlapping line 0).
    const config = makeConfig();
    let editor = buildDoc(config, 5);
    const firstId = firstBlockId(editor);
    editor = reduceEditor(editor, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)),
    }, config);
    paintAllPages(editor); // controller paints page 0 before the edit
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    paintAllPages(editor); // ...and again before ArrowUp (the visible frame)

    // SANITY CHECK (not the regression guard): MOVE_LINE moves the caret to a
    // different block on the first press. The MODEL navigation was already
    // robust to the stale-geometry bug, so this passed even when the bug was
    // present — it only documents the expected model behavior, and must NOT be
    // mistaken for (or removed in favor of) the geometry guard below.
    const beforeUp = editor.selection.focus;
    editor = reduceEditor(editor, { type: "MOVE_LINE", direction: "up" }, config);
    expect(editor.selection.focus.blockId).not.toEqual(beforeUp.blockId);

    // THE BUG-A REGRESSION GUARD: the user saw "ArrowUp doesn't move" because
    // the PAINTED page was stale (text overlapping line 0), even though the
    // model moved. MOVE_LINE changes only the selection, not the layout, so the
    // page the controller would paint is still the post-Enter page — it MUST
    // match a fresh layout, not the stale memoized geometry. This assertion is
    // what fails when the bug is present; do not drop it.
    const incremental = editor.layoutTree;
    if (incremental.type !== "virtual-root") throw new Error("expected virtual-root");
    const fresh = freshLayout(editor, config);
    if (fresh.type !== "virtual-root") throw new Error("expected fresh virtual-root");
    expect(incremental.getPage(0)).toEqual(fresh.getPage(0));
  });

  it("Bug B: page 0 from the incremental tree matches a fresh layout after Enter-at-start", () => {
    const config = makeConfig();
    let editor = buildDoc(config, 5);
    const firstId = firstBlockId(editor);
    // Caret at the very start of the first block, then Enter.
    editor = reduceEditor(editor, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)),
    }, config);
    paintAllPages(editor); // controller paints page 0 before the edit
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    const incremental = editor.layoutTree;
    if (incremental.type !== "virtual-root") throw new Error("expected virtual-root");
    const fresh = freshLayout(editor, config);
    if (fresh.type !== "virtual-root") throw new Error("expected fresh virtual-root");

    // getPage(0) (the box the controller paints) must match a FRESH layout's
    // page 0 — i.e. it must NOT be a stale page still showing old text on line 0.
    expect(incremental.getPage(0)).toEqual(fresh.getPage(0));
  });
});
