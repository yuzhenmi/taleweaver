/**
 * `SET_LINE_SPACING` handler + `handleSetLineSpacing` (P5 paragraph spacing).
 *
 * Sets the per-block `lineHeight` attr (a unitless multiplier — Google Docs'
 * 1.0 / 1.15 / 1.5 / 2.0 control) on the target LEAF block(s): the focus block
 * for a collapsed selection, or every leaf the span covers for a range
 * selection. Container blocks (sections, lists) are NEVER spaced — line spacing
 * is a paragraph property; a container owns no text of its own. The attr flows
 * render → cascade (resolves the ratio to a px line-height in ComputedStyle) →
 * IFC (line-box height), so the page reflows. The reflow proof lives in the
 * integration test (`integration/state-render-cascade-layout.test.ts`); these
 * behavior tests assert the attr write, the leaf/container targeting, selection
 * preservation, the no-op identity contract, and undo — exactly mirroring
 * `set-text-align.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  firstChildId,
  createPosition,
} from "./test-helpers";
import { createEditorStateFromDocument, type EditorState } from "../editor-state";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";
import { buildDocument, buildBlock, inlineContent, text } from "../../test-utils/document-builders";

describe("handleSetLineSpacing — SET_LINE_SPACING action", () => {
  it("collapsed selection: sets lineHeight on the focus block", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(editor.document) as BlockId;

    // Baseline: default (no lineHeight attr).
    expect(getBlock(editor.document, paraId)?.attrs.lineHeight).toBeUndefined();

    const next = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 2 });

    expect(getBlock(next.document, paraId)?.attrs.lineHeight).toBe(2);
    // A real change → new state reference.
    expect(next.document).not.toBe(editor.document);
  });

  it("preserves the selection (line spacing does not move the caret)", () => {
    const initial = createInitialEditorState(config);
    const editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" });

    const next = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 1.5 });

    expect(next.selection).toEqual(editor.selection);
  });

  it("multi-block selection: spaces every covered LEAF, NOT the section/list containers", () => {
    // Build a doc with a top-level paragraph, then a SECTION containing a LIST
    // (container) whose list-item is a leaf, then a trailing paragraph. A span
    // from p0 → p2 covers p0 (leaf), the section (container), the list
    // (container), the list-item (leaf), and p2 (leaf).
    const initialDocument = buildDocument({
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
    const editor: EditorState = createEditorStateFromDocument(initialDocument, {
        anchor: createPosition("p0" as BlockId, 0),
        focus: createPosition("p2" as BlockId, 2),
      }, config);

    const next = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 1.5 });

    // Every LEAF in the span is spaced.
    expect(getBlock(next.document, "p0" as BlockId)?.attrs.lineHeight).toBe(1.5);
    expect(getBlock(next.document, "li" as BlockId)?.attrs.lineHeight).toBe(1.5);
    expect(getBlock(next.document, "p2" as BlockId)?.attrs.lineHeight).toBe(1.5);

    // Containers are NOT spaced: their attrs are untouched.
    expect(getBlock(next.document, "sec" as BlockId)?.attrs.lineHeight).toBeUndefined();
    // The flat list-item is a leaf, so it gets spaced; its list attrs are kept.
    expect(getBlock(next.document, "li" as BlockId)?.attrs).toEqual({
      listId: "L1",
      listLevel: 0,
      lineHeight: 1.5,
    });
  });

  it("undo restores the prior line spacing", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(editor.document) as BlockId;

    // First set to 1.15 so the prior spacing is a concrete value.
    editor = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 1.15 });
    expect(getBlock(editor.document, paraId)?.attrs.lineHeight).toBe(1.15);

    const doubled = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 2 });
    expect(getBlock(doubled.document, paraId)?.attrs.lineHeight).toBe(2);

    const undone = reduceEditor(doubled, { type: "UNDO" });
    expect(getBlock(undone.document, paraId)?.attrs.lineHeight).toBe(1.15);
  });

  it("no-op: setting the spacing a block already has returns the same editor", () => {
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" });
    editor = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 2 });

    const again = reduceEditor(editor, { type: "SET_LINE_SPACING", spacing: 2 });

    // No commit, no state change (the identity-no-op contract). Phase 0b: the no-op
    // identity is `document` reference equality — the editor OBJECT differs because
    // the dispatch entry-clear strips the prior mutating action's stale
    // `lastDirtyIds` hint (the SET_LINE_SPACING above set a non-null set).
    expect(again.document).toBe(editor.document);
    expect(again.lastDirtyIds).toBeNull();
  });
});
