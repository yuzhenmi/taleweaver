/**
 * `INDENT` / `OUTDENT` actions + `handleIndent` (indent / outdent — the Google
 * Docs increase/decrease-indent toolbar control).
 *
 * Each action steps the per-block `marginInlineStart` attr by ±`INDENT_STEP`
 * (48px ≈ 0.5in) on the target LEAF block(s): the focus block for a collapsed
 * selection, or every leaf the span covers for a range selection. The step is
 * read-modify-write PER BLOCK so blocks at different current indents each move
 * independently, and outdenting to 0 CLEARS the attr (so the block renders
 * identically to a never-indented one). The attr flows render (component
 * synthesizes `marginInlineStart` onto the ElementBox style) → layout (the BFC
 * insets the in-flow block and narrows its width). The reflow proof lives in the
 * integration test (`integration/state-render-cascade-layout.test.ts`); these
 * behavior tests assert the attr write, the step arithmetic, the clamp at 0,
 * per-block independence, selection preservation, and undo — mirroring
 * `set-line-spacing.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
  createPosition,
  createSpan,
} from "./test-helpers";
import { INDENT_STEP } from "./indent";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory } from "../../state";
import type { BlockId } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";

describe("handleIndent — INDENT / OUTDENT actions", () => {
  it("INDENT on a fresh block: sets marginInlineStart to one step", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    // Baseline: no marginInlineStart attr.
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBeUndefined();

    const next = reduceEditor(editor, { type: "INDENT" }, config);

    expect(getBlock(next.state, paraId)?.attrs.marginInlineStart).toBe(INDENT_STEP);
    expect(INDENT_STEP).toBe(48);
    // A real change → new state reference.
    expect(next.state).not.toBe(editor.state);
  });

  it("INDENT twice: accumulates to two steps", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    editor = reduceEditor(editor, { type: "INDENT" }, config);
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBe(48);

    editor = reduceEditor(editor, { type: "INDENT" }, config);
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBe(96);
  });

  it("OUTDENT from one step: clears the attr (back to 0 / undefined)", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    editor = reduceEditor(editor, { type: "INDENT" }, config);
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBe(48);

    editor = reduceEditor(editor, { type: "OUTDENT" }, config);
    // Outdent to 0 removes the attr entirely (renders like a never-indented block).
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBeUndefined();
  });

  it("OUTDENT from 0: no-op (clamped — same editor reference via T7 identity)", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBeUndefined();

    const next = reduceEditor(editor, { type: "OUTDENT" }, config);

    // Already at 0 → clamped → nothing changed → same editor reference.
    expect(next).toBe(editor);
  });

  it("multi-block selection with DIFFERENT current indents: each +1 step independently", () => {
    // p0 starts un-indented; p2's list-item starts at 48. After INDENT over the
    // whole span, each LEAF advances by exactly one step from ITS OWN current
    // indent — proving the read-modify-write is per-block, not a shared set.
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
          attrs: { listType: "unordered", marginInlineStart: 48 },
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
      cascadedEmbedContents: new Map(),
      layoutTree: layout,
      containerWidth: config.containerWidth,
      targetX: null,
    };

    const next = reduceEditor(editor, { type: "INDENT" }, config);

    // p0: 0 → 48; li: 48 → 96. Each leaf stepped from its own start.
    expect(getBlock(next.state, "p0" as BlockId)?.attrs.marginInlineStart).toBe(48);
    expect(getBlock(next.state, "li" as BlockId)?.attrs.marginInlineStart).toBe(96);
    expect(getBlock(next.state, "p2" as BlockId)?.attrs.marginInlineStart).toBe(48);

    // Containers are NOT indented.
    expect(getBlock(next.state, "sec" as BlockId)?.attrs.marginInlineStart).toBeUndefined();
    expect(getBlock(next.state, "list" as BlockId)?.attrs.marginInlineStart).toBeUndefined();
  });

  it("preserves the selection (indent does not move the caret)", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;
    const selection = createSpan(createPosition(paraId, 0), createPosition(paraId, 2));
    const selected = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection },
      config,
    );

    const next = reduceEditor(selected, { type: "INDENT" }, config);

    expect(next.selection).toEqual(selected.selection);
  });

  it("undo restores the prior indent", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    editor = reduceEditor(editor, { type: "INDENT" }, config);
    expect(getBlock(editor.state, paraId)?.attrs.marginInlineStart).toBe(48);

    const indented = reduceEditor(editor, { type: "INDENT" }, config);
    expect(getBlock(indented.state, paraId)?.attrs.marginInlineStart).toBe(96);

    const undone = reduceEditor(indented, { type: "UNDO" }, config);
    expect(getBlock(undone.state, paraId)?.attrs.marginInlineStart).toBe(48);
  });
});
