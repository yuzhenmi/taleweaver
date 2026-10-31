/**
 * Backspace / Delete next to objects (Word + Google Docs). The ¶ is a unit: Delete at (P, len) removes ¶P and Backspace
 * at (N, 0) removes the ¶ before N. Next to a table:
 *   - Delete at the end of a NON-empty paragraph above a table is a no-op; in an EMPTY
 *     one it removes the paragraph and the caret goes to the table's first cell.
 *   - Backspace at the start of a NON-empty paragraph below a table is a no-op; in an
 *     EMPTY one it removes the paragraph (unless invariant I needs it) and the caret goes
 *     to the end of the table's last cell.
 * Next to an image (select-first): Delete in an EMPTY paragraph above it
 * removes the paragraph and selects the image.
 */
import { describe, it, expect } from "vitest";
import { config, reduceEditor, createPosition, createSpan } from "./test-helpers";
import { createEditorStateFromState, type EditorState } from "../editor-state";
import { getBlock, topLevelBlockIds, extractText } from "../../state";
import type { BlockId, State } from "../../state";
import { buildFlowDoc } from "../../test-utils/state-builders";

function at(state: State, blockId: string, offset: number): EditorState {
  const p = createPosition(blockId as BlockId, offset);
  return createEditorStateFromState(state, createSpan(p, p), config);
}

describe("Delete / Backspace next to a table", () => {
  it("Delete at the end of a NON-empty paragraph above a table is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { table: "T", cells: ["c1", "c2"] }, { p: "z" }]), "a", 2);
    expect(reduceEditor(editor, { type: "DELETE_FORWARD" })).toBe(editor);
  });

  it("Delete in an EMPTY paragraph above a table removes it; the caret goes to the first cell", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "e" }, { table: "T", cells: ["c1", "c2"] }, { p: "z" }]), "e", 0);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });
    expect(getBlock(next.document, "e" as BlockId)).toBeNull();
    expect(topLevelBlockIds(next.document)).toEqual(["a", "T", "z"]);
    expect(next.selection.focus).toEqual({ blockId: "c1", offset: 0 });
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });

  it("Backspace at the start of a NON-empty paragraph below a table is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1", "c2"] }, { p: "z", t: "zz" }]), "z", 0);
    expect(reduceEditor(editor, { type: "DELETE_BACKWARD" })).toBe(editor);
  });

  it("Backspace in an EMPTY paragraph below a table removes it; the caret goes to the end of the last cell", () => {
    const state = buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1", "c2"] }, { p: "e" }, { p: "z", t: "zz" }]);
    const editor = at(state, "e", 0);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });
    expect(getBlock(next.document, "e" as BlockId)).toBeNull();
    expect(topLevelBlockIds(next.document)).toEqual(["a", "T", "z"]);
    expect(next.selection.focus).toEqual({ blockId: "c2", offset: 0 });
  });

  it("Backspace in the EMPTY paragraph invariant I needs after a table (the flow's last) is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1"] }, { p: "e" }]), "e", 0);
    expect(reduceEditor(editor, { type: "DELETE_BACKWARD" })).toBe(editor);
  });
});

describe("Delete / Backspace at a flow's ends and between paragraphs", () => {
  it("Delete at the final ¶ of the flow is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "b", t: "q" }]), "b", 1);
    expect(reduceEditor(editor, { type: "DELETE_FORWARD" })).toBe(editor);
  });

  it("Delete at (P, len) removes ¶P: the right paragraph survives and the caret stays at the seam", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "b", t: "q" }]), "a", 2);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });
    expect(getBlock(next.document, "a" as BlockId)).toBeNull();
    expect(getBlock(next.document, "b" as BlockId)?.inlineContent?.items).toEqual([{ kind: "text", text: "xyq", attrs: {} }]);
    expect(next.selection.focus).toEqual({ blockId: "b", offset: 2 });
  });
});

describe("selecting exactly the ¶", () => {
  it("(P, len)–(N, 0) copies as \"\\n\" and Delete merges", () => {
    const state = buildFlowDoc([{ p: "a", t: "xy" }, { p: "b", t: "q" }]);
    const span = createSpan(createPosition("a" as BlockId, 2), createPosition("b" as BlockId, 0));
    expect(extractText(state, span)).toBe("\n");
    const editor = createEditorStateFromState(state, span, config);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });
    expect(topLevelBlockIds(next.document)).toEqual(["b"]);
    expect(getBlock(next.document, "b" as BlockId)?.inlineContent?.items).toEqual([{ kind: "text", text: "xyq", attrs: {} }]);
    expect(next.selection.focus).toEqual({ blockId: "b", offset: 2 });
  });
});

describe("Delete next to an image (select-first)", () => {
  it("Delete in an EMPTY paragraph above an image removes it and selects the image", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "e" }, { img: "I" }, { p: "z" }]), "e", 0);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });
    expect(getBlock(next.document, "e" as BlockId)).toBeNull();
    expect(getBlock(next.document, "I" as BlockId)?.type).toBe("image");
    expect(next.selection.focus).toEqual({ blockId: "I", offset: 0 });
    expect(next.selection.anchor).toEqual({ blockId: "I", offset: 0 });
  });
});

describe("suggesting mode next to objects: a tracked ¶ deletion", () => {
  const suggesting = { ...config, suggestingAuthor: "alice" };

  it("Delete in an EMPTY paragraph above a table keys its ¶ (no removal yet); accept removes it, reject keeps it", () => {
    const mk = (): EditorState => at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "e" }, { table: "T", cells: ["c1", "c2"] }, { p: "z" }]), "e", 0);
    const next = reduceEditor({ ...mk(), config: suggesting }, { type: "DELETE_FORWARD" });
    expect(getBlock(next.document, "e" as BlockId)?.breakSuggestion?.deletionId).toEqual(expect.any(String));
    expect(topLevelBlockIds(next.document)).toEqual(["a", "e", "T", "z"]);
    expect(next.selection.focus).toEqual({ blockId: "e", offset: 0 });
    const accepted = reduceEditor(next, { type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(topLevelBlockIds(accepted.document)).toEqual(["a", "T", "z"]);
    const again = reduceEditor({ ...mk(), config: suggesting }, { type: "DELETE_FORWARD" });
    const rejected = reduceEditor(again, { type: "REJECT_ALL_SUGGESTIONS" });
    expect(topLevelBlockIds(rejected.document)).toEqual(["a", "e", "T", "z"]);
    expect(getBlock(rejected.document, "e" as BlockId)?.breakSuggestion).toBeUndefined();
  });

  it("Backspace in an EMPTY paragraph below a table keys its own ¶; the required one (the flow's last) is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1", "c2"] }, { p: "e" }, { p: "z", t: "zz" }]), "e", 0);
    const next = reduceEditor({ ...editor, config: suggesting }, { type: "DELETE_BACKWARD" });
    expect(getBlock(next.document, "e" as BlockId)?.breakSuggestion?.deletionId).toEqual(expect.any(String));
    const required = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1"] }, { p: "e" }]), "e", 0);
    expect(reduceEditor({ ...required, config: suggesting }, { type: "DELETE_BACKWARD" }).document).toBe(required.document);
  });

  it("Delete in an EMPTY paragraph above an image keys its ¶", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "x" }, { p: "e" }, { img: "img" }, { p: "z" }]), "e", 0);
    const next = reduceEditor({ ...editor, config: suggesting }, { type: "DELETE_FORWARD" });
    expect(getBlock(next.document, "e" as BlockId)?.breakSuggestion?.deletionId).toEqual(expect.any(String));
  });
});

describe("DELETE_RANGE across a ¶", () => {
  it("collapses the caret into the survivor R at the seam, never onto the removed left paragraph", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "Anna" }, { p: "b", t: "Rosa" }]), "b", 1);
    const span = createSpan(createPosition("a" as BlockId, 2), createPosition("b" as BlockId, 1));
    const next = reduceEditor(editor, { type: "DELETE_RANGE", span });
    expect(getBlock(next.document, "a" as BlockId)).toBeNull();
    expect(extractText(next.document, createSpan(createPosition("b" as BlockId, 0), createPosition("b" as BlockId, 5)))).toBe("Anosa");
    expect(next.selection.focus).toEqual({ blockId: "b", offset: 2 });
    expect(next.selection.anchor).toEqual(next.selection.focus);
  });
});
