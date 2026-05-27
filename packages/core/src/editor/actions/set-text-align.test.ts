/**
 * `SET_TEXT_ALIGN` editor action + `handleSetTextAlign` (P4).
 *
 * Sets the per-block `textAlign` attr on the target LEAF block(s): the focus
 * block for a collapsed selection, or every leaf the span covers for a range
 * selection. Container blocks (sections, lists) are NEVER aligned — Google Docs
 * aligns paragraphs only (C-3). The attr flows render → cascade → IFC (P1/P2/P3)
 * which honors it, so these behavior tests assert BOTH the attr AND real layout
 * geometry (the laid-out line's absolute X reflects centering).
 *
 * Harness mirrors `set-block-type.test.ts` (unpaginated `config` from
 * test-helpers) and `toggle-section-landscape.test.ts` (the closest action
 * pattern: a targeted-block merge with selection preserved + no-op identity).
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
  createPosition,
} from "./test-helpers";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory } from "../../state";
import type { BlockId } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";
import { getLineIndex } from "../../cursor/line-flatten";

/**
 * The absolute X of the FIRST line owned by `blockId` in the editor's
 * (non-paginated) layout tree. Used to prove the alignment offset actually
 * fired through render→cascade→IFC reflow, not just the attr write.
 */
function firstLineX(editor: EditorState, blockId: BlockId): number {
  const tree = editor.layoutTree;
  // The unpaginated test `config` (no pageConfig) produces a plain LayoutBox
  // tree, not a VirtualLayoutTree — narrow so getLineIndex accepts it.
  if (tree.type === "virtual-root") throw new Error("expected a non-paginated LayoutBox tree");
  const index = getLineIndex(tree);
  const lines = index.byBlock.get(blockId);
  if (lines === undefined || lines.length === 0) {
    throw new Error(`no lines for block ${blockId}`);
  }
  return lines[0].absoluteX;
}

describe("handleSetTextAlign — SET_TEXT_ALIGN action", () => {
  it("collapsed selection: aligns the focus block + centers the laid-out line", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    // Baseline: default alignment (start) → line begins at x === 0.
    expect(getBlock(editor.state, paraId)?.attrs.textAlign).toBeUndefined();
    const startX = firstLineX(editor, paraId);
    expect(startX).toBe(0);

    const next = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "center" }, config);

    // Attr set on the focus block.
    expect(getBlock(next.state, paraId)?.attrs.textAlign).toBe("center");
    // A real change → new state reference.
    expect(next.state).not.toBe(editor.state);

    // GEOMETRY: the line is now centered — its absolute X moved RIGHT of 0.
    // "hi" = 2 chars × 8px = 16px content; containerWidth 200 ⇒ x = (200-16)/2 = 92.
    const centeredX = firstLineX(next, paraId);
    expect(centeredX).toBeGreaterThan(startX);
    expect(centeredX).toBe((200 - 16) / 2);
  });

  it("preserves the selection (alignment does not move the caret)", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);

    const next = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "center" }, config);

    expect(next.selection).toEqual(editor.selection);
  });

  it("multi-block selection: aligns every covered LEAF, NOT the section/list containers (C-3)", () => {
    // Build a doc with a top-level paragraph, then a SECTION containing a LIST
    // (container) whose list-item is a leaf, then a trailing paragraph. A span
    // from p0 → p2 covers p0 (leaf), the section (container), the list
    // (container), the list-item (leaf), and p2 (leaf).
    const initialState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p2" }),
        buildBlock({
          id: "p0",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "sec",
          inlineContent: inlineContent([text("p0")]),
        }),
        buildBlock({
          id: "sec",
          type: "section",
          parentId: "doc",
          prevSiblingId: "p0",
          nextSiblingId: "p2",
          firstChildId: "list",
          lastChildId: "list",
        }),
        buildBlock({
          id: "list",
          type: "list",
          parentId: "sec",
          firstChildId: "li",
          lastChildId: "li",
          attrs: { listType: "unordered" },
        }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "list",
          attrs: { listType: "unordered" },
          inlineContent: inlineContent([text("li")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "sec",
          inlineContent: inlineContent([text("p2")]),
        }),
      ],
    });
    const rendered = render(initialState, config.componentRegistry, config.attrRegistry);
    const cascadedRoot = cascadePass(rendered.root);
    const layout = layoutTree(cascadedRoot, config.containerWidth, config.measurer, config.pageConfig);
    const editor: EditorState = {
      state: initialState,
      selection: {
        anchor: createPosition("p0" as BlockId, 0),
        focus: createPosition("p2" as BlockId, 2),
      },
      history: createHistory(initialState),
      renderTree: rendered.root,
      renderOutput: rendered,
      cascadedRoot,
      cascadedTemplateContents: new Map(),
      layoutTree: layout,
      containerWidth: config.containerWidth,
      targetX: null,
    };

    const next = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "center" }, config);

    // Every LEAF in the span is aligned.
    expect(getBlock(next.state, "p0" as BlockId)?.attrs.textAlign).toBe("center");
    expect(getBlock(next.state, "li" as BlockId)?.attrs.textAlign).toBe("center");
    expect(getBlock(next.state, "p2" as BlockId)?.attrs.textAlign).toBe("center");

    // Containers are NOT aligned (C-3): their attrs are untouched.
    expect(getBlock(next.state, "sec" as BlockId)?.attrs.textAlign).toBeUndefined();
    expect(getBlock(next.state, "list" as BlockId)?.attrs.textAlign).toBeUndefined();
    // The list keeps exactly its original attrs (no textAlign smuggled in).
    expect(getBlock(next.state, "list" as BlockId)?.attrs).toEqual({ listType: "unordered" });
  });

  it("undo restores the prior alignment", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    // First set to "end" so the prior alignment is a concrete value.
    editor = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "end" }, config);
    expect(getBlock(editor.state, paraId)?.attrs.textAlign).toBe("end");

    const centered = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "center" }, config);
    expect(getBlock(centered.state, paraId)?.attrs.textAlign).toBe("center");

    const undone = reduceEditor(centered, { type: "UNDO" }, config);
    expect(getBlock(undone.state, paraId)?.attrs.textAlign).toBe("end");
  });

  it("no-op: setting the alignment a block already has returns the same editor", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "center" }, config);

    const again = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align: "center" }, config);

    // Same editor reference — no commit, no state change (T7 identity contract).
    expect(again).toBe(editor);
  });

  it("all four keywords dispatch and set the attr", () => {
    const initial = createInitialEditorState(config);
    const base = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(base.state) as BlockId;

    for (const align of ["start", "center", "end", "justify"] as const) {
      // Start from a different alignment each time so the merge is never a no-op.
      let editor = reduceEditor(base, { type: "SET_TEXT_ALIGN", align: align === "start" ? "center" : "start" }, config);
      editor = reduceEditor(editor, { type: "SET_TEXT_ALIGN", align }, config);
      expect(getBlock(editor.state, paraId)?.attrs.textAlign).toBe(align);
    }
  });
});
