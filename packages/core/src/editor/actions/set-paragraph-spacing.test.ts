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
  createEditor, firstChildId, createPosition } from "./test-helpers";
import { type Editor } from "../editor";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";
import { buildDocument, buildBlock, inlineContent, text } from "../../test-utils/document-builders";

describe("handleSetParagraphSpacing — SET_PARAGRAPH_SPACING action", () => {
  it("edge 'after' value 40: sets marginBlockEnd on the focus block", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(initial.document) as BlockId;

    // Baseline: no marginBlockEnd attr (the component default em margin applies).
    expect(getBlock(initial.document, paraId)?.attrs.marginBlockEnd).toBeUndefined();

    const before = initial.snapshot();
    initial.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 });

    expect(getBlock(initial.document, paraId)?.attrs.marginBlockEnd).toBe(40);
    // The OTHER edge is untouched.
    expect(getBlock(initial.document, paraId)?.attrs.marginBlockStart).toBeUndefined();
    // A real change → new state reference.
    expect(initial.document).not.toBe(before.document);
  });

  it("edge 'before' value 24: sets marginBlockStart on the focus block", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(initial.document) as BlockId;

    initial.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "before", value: 24 });

    expect(getBlock(initial.document, paraId)?.attrs.marginBlockStart).toBe(24);
    expect(getBlock(initial.document, paraId)?.attrs.marginBlockEnd).toBeUndefined();
  });

  it("value 0 is a valid explicit override (NOT treated as clear)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const paraId = firstChildId(initial.document) as BlockId;

    initial.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 0 });

    // 0 is set explicitly — a user choosing "no space after" overrides the
    // component's default 0.5em margin.
    expect(getBlock(initial.document, paraId)?.attrs.marginBlockEnd).toBe(0);
  });

  it("value null clears the attr (reverts to the component default)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    const paraId = firstChildId(editor.document) as BlockId;

    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 });
    expect(getBlock(editor.document, paraId)?.attrs.marginBlockEnd).toBe(40);

    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: null });
    // Clearing removes the attr entirely → component default em margin applies.
    expect(getBlock(editor.document, paraId)?.attrs.marginBlockEnd).toBeUndefined();
  });

  it("preserves the selection (paragraph spacing does not move the caret)", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });

    const before = initial.snapshot();
    initial.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "before", value: 16 });

    expect(initial.selection).toEqual(before.selection);
  });

  it("multi-block selection: spaces every covered LEAF, NOT the section/list containers", () => {
    // Same fixture as set-line-spacing's multi-block test: a top-level
    // paragraph, then a SECTION containing a LIST (container) whose list-item is
    // a leaf, then a trailing paragraph. A span from p0 → p2 covers p0 (leaf),
    // the section (container), the list (container), the list-item (leaf), and
    // p2 (leaf).
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
    const editor: Editor = createEditor(config, { document: initialDocument, selection: {
        anchor: createPosition("p0" as BlockId, 0),
        focus: createPosition("p2" as BlockId, 2),
      } });

    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 32 });

    // Every LEAF in the span is spaced.
    expect(getBlock(editor.document, "p0" as BlockId)?.attrs.marginBlockEnd).toBe(32);
    expect(getBlock(editor.document, "li" as BlockId)?.attrs.marginBlockEnd).toBe(32);
    expect(getBlock(editor.document, "p2" as BlockId)?.attrs.marginBlockEnd).toBe(32);

    // Containers are NOT spaced: their attrs are untouched.
    expect(getBlock(editor.document, "sec" as BlockId)?.attrs.marginBlockEnd).toBeUndefined();
    // The flat list-item is a leaf, so it gets spaced; its list attrs are kept.
    expect(getBlock(editor.document, "li" as BlockId)?.attrs).toEqual({
      listId: "L1",
      listLevel: 0,
      marginBlockEnd: 32,
    });
  });

  it("undo restores the prior spacing", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    const paraId = firstChildId(editor.document) as BlockId;

    // First set to 16 so the prior spacing is a concrete value.
    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 16 });
    expect(getBlock(editor.document, paraId)?.attrs.marginBlockEnd).toBe(16);

    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 });
    expect(getBlock(editor.document, paraId)?.attrs.marginBlockEnd).toBe(40);

    editor.dispatch({ type: "UNDO" });
    expect(getBlock(editor.document, paraId)?.attrs.marginBlockEnd).toBe(16);
  });

  it("no-op: setting the spacing a block already has returns the same editor", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    let editor = initial;
    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 });

    const before = editor.snapshot();
    editor.dispatch({ type: "SET_PARAGRAPH_SPACING", edge: "after", value: 40 });

    // No commit, no state change (the identity-no-op contract). Phase 0b: the no-op
    // identity is `document` reference equality — the editor OBJECT differs because
    // the dispatch entry-clear strips the prior mutating action's stale
    // `lastDirtyIds` hint (the SET_PARAGRAPH_SPACING above set a non-null set).
    expect(editor.document).toBe(before.document);
    expect(editor.lastDirtyIds).toBeNull();
  });
});
