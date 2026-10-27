import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState, createPosition, createSpan } from "../editor/actions/test-helpers";
import type { EditorAction } from "../editor/editor-action";
import type { EditorState } from "../editor/editor-state";
import { getBlock, iterateLeafBlocksInDocumentOrder, extractText } from "./index";
import type { BlockId, Position } from "./index";
import { createPositionMapping, diffRegions, IDENTITY_MAPPING } from "./position-mapping";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { createState } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { asBlockId } from "./block-id";
import { removeBlock } from "./ops/remove-block";
import { insertText } from "./ops/insert-text";

/** Read every leaf (what a backend render does), so the State's cache is warm. */
function warm(editor: EditorState): void {
  for (const b of iterateLeafBlocksInDocumentOrder(editor.state)) void b;
}

function step(editor: EditorState, action: EditorAction) {
  warm(editor);
  const next = reduceEditor(editor, action, config);
  const dirty = next.lastDirtyIds;
  const mapping =
    dirty === null ? IDENTITY_MAPPING : createPositionMapping(editor.state, next.state, dirty, editor.selection.focus, next.selection.focus);
  return { next, mapping };
}

function firstBlock(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root?.firstChildId == null) throw new Error("no block");
  return root.firstChildId;
}

function at(editor: EditorState, blockId: BlockId, offset: number): EditorState {
  const p = createPosition(blockId, offset);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(p, p) }, config);
}

function textAt(editor: EditorState, pos: Position | null, length: number): string {
  if (pos === null) throw new Error("unmapped");
  const end = createPosition(pos.blockId, pos.offset + length);
  return extractText(editor.state, createSpan(pos, end));
}

/** A one-paragraph editor holding `text`, caret at the end. */
function seeded(text: string): { editor: EditorState; p: BlockId } {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text }, config);
  return { editor, p: firstBlock(editor) };
}

describe("createPositionMapping", () => {
  it("typing before a position shifts it; typing after leaves it", () => {
    const { editor, p } = seeded("Hello Anna here");
    const anna = createPosition(p, 6);
    const { next, mapping } = step(at(editor, p, 0), { type: "INSERT_TEXT", text: ">> " });
    const m = mapping.map(anna);
    expect(m.deleted).toBe(false);
    expect(textAt(next, m.position, 4)).toBe("Anna");

    const fresh = seeded("Hello Anna here");
    const after = step(at(fresh.editor, fresh.p, 15), { type: "INSERT_TEXT", text: "!" });
    expect(after.mapping.map(createPosition(fresh.p, 6)).position).toEqual(createPosition(fresh.p, 6));
  });

  it("assoc decides which side an insertion exactly at the position lands on", () => {
    const { editor, p } = seeded("abcd");
    const { mapping } = step(at(editor, p, 2), { type: "INSERT_TEXT", text: "XY" });
    expect(mapping.map(createPosition(p, 2), -1).position?.offset).toBe(2);
    expect(mapping.map(createPosition(p, 2), 1).position?.offset).toBe(4);
  });

  it("the edit hint disambiguates insertion inside repeated text", () => {
    const { editor, p } = seeded("aaa");
    const { mapping } = step(at(editor, p, 1), { type: "INSERT_TEXT", text: "a" });
    // Inserted at 1, so the position at 2 (before the third 'a') moves to 3.
    expect(mapping.map(createPosition(p, 2), 1).position?.offset).toBe(3);
  });

  it("Backspace inside repeated text deletes the char before the caret, not a later twin", () => {
    const { editor, p } = seeded("xoo");
    const { mapping } = step(at(editor, p, 2), { type: "DELETE_BACKWARD" });
    // The surviving trailing "o" [2,3) moves to [1,2); it is not reported deleted.
    expect(mapping.map(createPosition(p, 2), 1)).toEqual({ position: createPosition(p, 1), deleted: false });
    expect(mapping.map(createPosition(p, 3), -1)).toEqual({ position: createPosition(p, 2), deleted: false });
  });

  it("an edit away from the prev caret resolves by the caret it leaves (programmatic delete)", () => {
    // "in Berlin" → delete " Berlin" while the caret sits at 0. Both texts end in "n", so
    // only the post-edit caret (at 2) says which "n" survived.
    const { editor, p } = seeded("in Berlin");
    const atStart = at(editor, p, 0);
    const { mapping } = step(atStart, { type: "DELETE_RANGE", span: createSpan(createPosition(p, 2), createPosition(p, 9)) });
    expect(mapping.map(createPosition(p, 3), 1).position?.offset).toBe(2);
    expect(mapping.map(createPosition(p, 9), -1).position?.offset).toBe(2);
    expect(mapping.map(createPosition(p, 1), 1)).toEqual({ position: createPosition(p, 1), deleted: false });
  });

  it("a position inside deleted text is reported deleted; touches() sees the change", () => {
    const { editor, p } = seeded("one two three");
    const del = createSpan(createPosition(p, 4), createPosition(p, 8));
    const { mapping } = step(editor, { type: "DELETE_RANGE", span: del });
    expect(mapping.map(createPosition(p, 5)).deleted).toBe(true);
    expect(mapping.map(createPosition(p, 9)).position?.offset).toBe(5);
    expect(mapping.touches(createPosition(p, 3), createPosition(p, 6))).toBe(true);
    expect(mapping.touches(createPosition(p, 0), createPosition(p, 3))).toBe(false);
  });

  it("Enter (split) moves positions after the split point into the new block", () => {
    const { editor, p } = seeded("first Anna second");
    const { next, mapping } = step(at(editor, p, 5), { type: "SPLIT_NODE" });
    const m = mapping.map(createPosition(p, 6));
    expect(m.deleted).toBe(false);
    expect(m.position?.blockId).not.toBe(p);
    expect(textAt(next, m.position, 4)).toBe("Anna");
    expect(mapping.map(createPosition(p, 2)).position).toEqual(createPosition(p, 2));
  });

  it("Backspace at a block start (merge) moves positions into the previous block", () => {
    const { editor, p } = seeded("first second");
    const split = step(at(editor, p, 5), { type: "SPLIT_NODE" }).next;
    const second = split.selection.focus.blockId;
    const { next, mapping } = step(split, { type: "DELETE_BACKWARD" });
    const m = mapping.map(createPosition(second, 1)); // " second" offset 1 = "s"
    expect(m.position?.blockId).toBe(p);
    expect(textAt(next, m.position, 5)).toBe("secon");
  });

  it("formatting changes are identity; undo maps back", () => {
    const { editor, p } = seeded("bold me");
    const sel = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(p, 0), createPosition(p, 4)) }, config);
    const bold = step(sel, { type: "TOGGLE_STYLE", style: "bold" });
    expect(bold.mapping.identity).toBe(true);

    const typed = step(at(bold.next, p, 0), { type: "INSERT_TEXT", text: "xx" }).next;
    const undo = step(typed, { type: "UNDO" });
    expect(undo.mapping.map(createPosition(p, 7)).position?.offset).toBe(5);
  });
});

describe("diffRegions", () => {
  it("emits separate hunks for disjoint edits (replace-all shape)", () => {
    const hunks = diffRegions("cat and cat and cat", "dog and dog and dog");
    expect(hunks.length).toBe(3);
  });
  it("falls back to one hunk past the distance bound", () => {
    const a = "x".repeat(2000);
    const b = "y".repeat(2000);
    expect(diffRegions(a, b)).toEqual([{ a0: 0, a1: 2000, b0: 0, b1: 2000 }]);
  });
});

describe("createPositionMapping — cold blocks (foreign changes)", () => {
  it("a cold block that existed is never mistaken for new when a deleted block preceded it", () => {
    // prev: K → Z → Y. A peer deletes Z and edits Y; our prev State never read Y.
    const prev = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "K", lastChildId: "Y" }),
        buildBlock({ id: "K", type: "paragraph", parentId: "doc", nextSiblingId: "Z", inlineContent: inlineContent([text("keep")]) }),
        buildBlock({ id: "Z", type: "paragraph", parentId: "doc", prevSiblingId: "K", nextSiblingId: "Y", inlineContent: inlineContent([text("gone")]) }),
        buildBlock({ id: "Y", type: "paragraph", parentId: "doc", prevSiblingId: "Z", inlineContent: inlineContent([text("tail text")]) }),
      ],
    });
    for (const id of ["doc", "K", "Z"]) getBlock(prev, asBlockId(id)); // warm everything but Y
    // The peer's edits, applied through an unrelated State over the same Y.Doc.
    const peer = createState({ rootId: prev.rootId, doc: prev[STATE_INTERNAL].doc });
    const r1 = removeBlock(peer, asBlockId("Z"));
    const r2 = insertText(r1.state, createPosition(asBlockId("Y"), 0), ">> ", {});
    const dirty = new Set([...r1.dirtyIds, ...r2.dirtyIds]);
    const m = createPositionMapping(prev, r2.state, dirty);
    // Y's previous text is unknown → conservative, never the stale offset on new text.
    expect(m.map(createPosition(asBlockId("Y"), 5))).toEqual({ position: null, deleted: true });
    expect(m.map(createPosition(asBlockId("K"), 2)).position).toEqual(createPosition(asBlockId("K"), 2));
  });
});
