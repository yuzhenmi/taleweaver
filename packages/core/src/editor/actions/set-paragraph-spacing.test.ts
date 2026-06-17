/**
 * `SET_PARAGRAPH_SPACING` handler + `handleSetParagraphSpacing` (P5 paragraph
 * spacing — Google Docs "Add space before/after paragraph").
 *
 * Sets the per-block `marginBlockStart` (edge `"before"`) or `marginBlockEnd`
 * (edge `"after"`) attr — the vertical margins, in px — on the target LEAF
 * block(s): the focus block for a collapsed selection, or every leaf the span
 * covers for a range selection. Container blocks (sections, lists) are NEVER
 * spaced — paragraph spacing is a paragraph property; a container owns no text
 * of its own. The attr flows render → cascade → BFC, which applies in-flow
 * blocks' block margins WITH CSS margin collapsing, so the page reflows. The
 * reflow proof (geometry) lives in the integration test
 * (`integration/state-render-cascade-layout.test.ts`); these behavior tests
 * assert the attr write, leaf/container targeting, the clear-to-default path,
 * selection preservation, the no-op identity contract, and undo — exactly
 * mirroring `set-line-spacing.test.ts`.
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

describe("handleSetParagraphSpacing — SET_PARAGRAPH_SPACING action", () => {
  it("edge 'after' value 40: sets marginBlockEnd on the focus block", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    // Baseline: no marginBlockEnd attr (the component default em margin applies).
    expect(getBlock(editor.state, paraId)?.attrs.marginBlockEnd).toBeUndefined();

    const next = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 },
      config,
    );

    expect(getBlock(next.state, paraId)?.attrs.marginBlockEnd).toBe(40);
    // The OTHER edge is untouched.
    expect(getBlock(next.state, paraId)?.attrs.marginBlockStart).toBeUndefined();
    // A real change → new state reference.
    expect(next.state).not.toBe(editor.state);
  });

  it("edge 'before' value 24: sets marginBlockStart on the focus block", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    const next = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "before", value: 24 },
      config,
    );

    expect(getBlock(next.state, paraId)?.attrs.marginBlockStart).toBe(24);
    expect(getBlock(next.state, paraId)?.attrs.marginBlockEnd).toBeUndefined();
  });

  it("value 0 is a valid explicit override (NOT treated as clear)", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    const next = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 0 },
      config,
    );

    // 0 is set explicitly — a user choosing "no space after" overrides the
    // component's default 0.5em margin.
    expect(getBlock(next.state, paraId)?.attrs.marginBlockEnd).toBe(0);
  });

  it("value null clears the attr (reverts to the component default)", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    editor = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 },
      config,
    );
    expect(getBlock(editor.state, paraId)?.attrs.marginBlockEnd).toBe(40);

    const cleared = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: null },
      config,
    );
    // Clearing removes the attr entirely → component default em margin applies.
    expect(getBlock(cleared.state, paraId)?.attrs.marginBlockEnd).toBeUndefined();
  });

  it("preserves the selection (paragraph spacing does not move the caret)", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);

    const next = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "before", value: 16 },
      config,
    );

    expect(next.selection).toEqual(editor.selection);
  });

  it("multi-block selection: spaces every covered LEAF, NOT the section/list containers", () => {
    // Same fixture as set-line-spacing's multi-block test: a top-level
    // paragraph, then a SECTION containing a LIST (container) whose list-item is
    // a leaf, then a trailing paragraph. A span from p0 → p2 covers p0 (leaf),
    // the section (container), the list (container), the list-item (leaf), and
    // p2 (leaf).
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
          firstChildId: "li",
          lastChildId: "li",
        }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "sec",
          attrs: { listId: "L1", listLevel: 0 },
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
    const editor: EditorState = {
      state: initialState,
      selection: {
        anchor: createPosition("p0" as BlockId, 0),
        focus: createPosition("p2" as BlockId, 2),
      },
      history: createHistory(initialState),
      lastDirtyIds: null,
      containerWidth: config.containerWidth,
      targetX: null,
    };

    const next = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 32 },
      config,
    );

    // Every LEAF in the span is spaced.
    expect(getBlock(next.state, "p0" as BlockId)?.attrs.marginBlockEnd).toBe(32);
    expect(getBlock(next.state, "li" as BlockId)?.attrs.marginBlockEnd).toBe(32);
    expect(getBlock(next.state, "p2" as BlockId)?.attrs.marginBlockEnd).toBe(32);

    // Containers are NOT spaced: their attrs are untouched.
    expect(getBlock(next.state, "sec" as BlockId)?.attrs.marginBlockEnd).toBeUndefined();
    // The flat list-item is a leaf, so it gets spaced; its list attrs are kept.
    expect(getBlock(next.state, "li" as BlockId)?.attrs).toEqual({
      listId: "L1",
      listLevel: 0,
      marginBlockEnd: 32,
    });
  });

  it("undo restores the prior spacing", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    const paraId = firstChildId(editor.state) as BlockId;

    // First set to 16 so the prior spacing is a concrete value.
    editor = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 16 },
      config,
    );
    expect(getBlock(editor.state, paraId)?.attrs.marginBlockEnd).toBe(16);

    const bumped = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 },
      config,
    );
    expect(getBlock(bumped.state, paraId)?.attrs.marginBlockEnd).toBe(40);

    const undone = reduceEditor(bumped, { type: "UNDO" }, config);
    expect(getBlock(undone.state, paraId)?.attrs.marginBlockEnd).toBe(16);
  });

  it("no-op: setting the spacing a block already has returns the same editor", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, config);
    editor = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 },
      config,
    );

    const again = reduceEditor(
      editor,
      { type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 },
      config,
    );

    // No commit, no state change (T7 identity contract). Phase 0b: the no-op
    // identity is `state` reference equality — the editor OBJECT differs because
    // the dispatch entry-clear strips the prior mutating action's stale
    // `lastDirtyIds` hint (the SET_PARAGRAPH_SPACING above set a non-null set).
    expect(again.state).toBe(editor.state);
    expect(again.lastDirtyIds).toBeNull();
  });
});
