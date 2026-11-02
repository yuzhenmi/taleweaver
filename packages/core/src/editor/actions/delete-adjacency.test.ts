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
import { config, createPosition, createSpan } from "./test-helpers";
import { createEditor, type Editor } from "../editor";
import { getBlock, topLevelBlockIds, extractText } from "../../state";
import type { BlockId, Document } from "../../state";
import { buildFlowDoc } from "../../test-utils/document-builders";

function at(document: Document, blockId: string, offset: number): Editor {
  const p = createPosition(blockId as BlockId, offset);
  return createEditor(config, { document, selection: createSpan(p, p) });
}

describe("Delete / Backspace next to a table", () => {
  it("Delete at the end of a NON-empty paragraph above a table is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { table: "T", cells: ["c1", "c2"] }, { p: "z" }]), "a", 2);
    const before = editor.snapshot();
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
  });

  it("Delete in an EMPTY paragraph above a table removes it; the caret goes to the first cell", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "e" }, { table: "T", cells: ["c1", "c2"] }, { p: "z" }]), "e", 0);
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(getBlock(editor.document, "e" as BlockId)).toBeNull();
    expect(topLevelBlockIds(editor.document)).toEqual(["a", "T", "z"]);
    expect(editor.selection.focus).toEqual({ blockId: "c1", offset: 0 });
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });

  it("Backspace at the start of a NON-empty paragraph below a table is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1", "c2"] }, { p: "z", t: "zz" }]), "z", 0);
    const before = editor.snapshot();
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
  });

  it("Backspace in an EMPTY paragraph below a table removes it; the caret goes to the end of the last cell", () => {
    const document = buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1", "c2"] }, { p: "e" }, { p: "z", t: "zz" }]);
    const editor = at(document, "e", 0);
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(getBlock(editor.document, "e" as BlockId)).toBeNull();
    expect(topLevelBlockIds(editor.document)).toEqual(["a", "T", "z"]);
    expect(editor.selection.focus).toEqual({ blockId: "c2", offset: 0 });
  });

  it("Backspace in the EMPTY paragraph invariant I needs after a table (the flow's last) is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1"] }, { p: "e" }]), "e", 0);
    const before = editor.snapshot();
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
  });
});

describe("Delete / Backspace at a flow's ends and between paragraphs", () => {
  it("Delete at the final ¶ of the flow is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "b", t: "q" }]), "b", 1);
    const before = editor.snapshot();
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
  });

  it("Delete at (P, len) removes ¶P: the right paragraph survives and the caret stays at the seam", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "b", t: "q" }]), "a", 2);
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(getBlock(editor.document, "a" as BlockId)).toBeNull();
    expect(getBlock(editor.document, "b" as BlockId)?.inlineContent?.items).toEqual([{ kind: "text", text: "xyq", attrs: {} }]);
    expect(editor.selection.focus).toEqual({ blockId: "b", offset: 2 });
  });
});

describe("selecting exactly the ¶", () => {
  it("(P, len)–(N, 0) copies as \"\\n\" and Delete merges", () => {
    const document = buildFlowDoc([{ p: "a", t: "xy" }, { p: "b", t: "q" }]);
    const span = createSpan(createPosition("a" as BlockId, 2), createPosition("b" as BlockId, 0));
    expect(extractText(document, span)).toBe("\n");
    const editor = createEditor(config, { document, selection: span });
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(topLevelBlockIds(editor.document)).toEqual(["b"]);
    expect(getBlock(editor.document, "b" as BlockId)?.inlineContent?.items).toEqual([{ kind: "text", text: "xyq", attrs: {} }]);
    expect(editor.selection.focus).toEqual({ blockId: "b", offset: 2 });
  });
});

describe("Delete next to an image (select-first)", () => {
  it("Delete in an EMPTY paragraph above an image removes it and selects the image", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "e" }, { img: "I" }, { p: "z" }]), "e", 0);
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(getBlock(editor.document, "e" as BlockId)).toBeNull();
    expect(getBlock(editor.document, "I" as BlockId)?.type).toBe("image");
    expect(editor.selection.focus).toEqual({ blockId: "I", offset: 0 });
    expect(editor.selection.anchor).toEqual({ blockId: "I", offset: 0 });
  });
});

describe("suggesting mode next to objects: a tracked ¶ deletion", () => {
  const suggesting = { ...config, suggestingAuthor: "alice" };

  it("Delete in an EMPTY paragraph above a table keys its ¶ (no removal yet); accept removes it, reject keeps it", () => {
    const mk = (): Editor => at(buildFlowDoc([{ p: "a", t: "xy" }, { p: "e" }, { table: "T", cells: ["c1", "c2"] }, { p: "z" }]), "e", 0);
    const next = mk();
    next.setConfig(suggesting);
    next.dispatch({ type: "DELETE_FORWARD" });
    expect(getBlock(next.document, "e" as BlockId)?.breakSuggestion?.deletionId).toEqual(expect.any(String));
    expect(topLevelBlockIds(next.document)).toEqual(["a", "e", "T", "z"]);
    expect(next.selection.focus).toEqual({ blockId: "e", offset: 0 });
    next.dispatch({ type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(topLevelBlockIds(next.document)).toEqual(["a", "T", "z"]);
    const again = mk();
    again.setConfig(suggesting);
    again.dispatch({ type: "DELETE_FORWARD" });
    again.dispatch({ type: "REJECT_ALL_SUGGESTIONS" });
    expect(topLevelBlockIds(again.document)).toEqual(["a", "e", "T", "z"]);
    expect(getBlock(again.document, "e" as BlockId)?.breakSuggestion).toBeUndefined();
  });

  it("Backspace in an EMPTY paragraph below a table keys its own ¶; the required one (the flow's last) is a no-op", () => {
    const editor = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1", "c2"] }, { p: "e" }, { p: "z", t: "zz" }]), "e", 0);
    editor.setConfig(suggesting);
    editor.dispatch({ type: "DELETE_BACKWARD" });
    expect(getBlock(editor.document, "e" as BlockId)?.breakSuggestion?.deletionId).toEqual(expect.any(String));
    const required = at(buildFlowDoc([{ p: "a" }, { table: "T", cells: ["c1"] }, { p: "e" }]), "e", 0);
    const requiredDoc = required.document;
    required.setConfig(suggesting);
    required.dispatch({ type: "DELETE_BACKWARD" });
    expect(required.document).toBe(requiredDoc);
  });

  it("Delete in an EMPTY paragraph above an image keys its ¶", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "x" }, { p: "e" }, { img: "img" }, { p: "z" }]), "e", 0);
    editor.setConfig(suggesting);
    editor.dispatch({ type: "DELETE_FORWARD" });
    expect(getBlock(editor.document, "e" as BlockId)?.breakSuggestion?.deletionId).toEqual(expect.any(String));
  });
});

describe("DELETE_RANGE across a ¶", () => {
  it("collapses the caret into the survivor R at the seam, never onto the removed left paragraph", () => {
    const editor = at(buildFlowDoc([{ p: "a", t: "Anna" }, { p: "b", t: "Rosa" }]), "b", 1);
    const span = createSpan(createPosition("a" as BlockId, 2), createPosition("b" as BlockId, 1));
    editor.dispatch({ type: "DELETE_RANGE", span });
    expect(getBlock(editor.document, "a" as BlockId)).toBeNull();
    expect(extractText(editor.document, createSpan(createPosition("b" as BlockId, 0), createPosition("b" as BlockId, 5)))).toBe("Anosa");
    expect(editor.selection.focus).toEqual({ blockId: "b", offset: 2 });
    expect(editor.selection.anchor).toEqual(editor.selection.focus);
  });
});
