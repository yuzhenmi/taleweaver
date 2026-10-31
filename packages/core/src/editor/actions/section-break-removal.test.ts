/**
 * SBR-T2: Backspace / Delete remove a section break.
 *
 * (Word) A section break IS the ¶ of its section's
 * last paragraph (a section-end item). Backspace at the first caret after it, or
 * Delete at the end of the paragraph it terminates, removes that item in ONE
 * step (`deleteSectionBreak`): the paragraphs merge by the paragraph rule
 * (survivor = the right paragraph) and the content joins the FOLLOWING
 * section. A break inserted at a paragraph start leaves an empty paragraph H
 * carrying it, so removing it leaves the boundary text paragraphs separate.
 *
 * These are behavior-level tests through the real `reduceEditor` reducer
 * (mirroring `section-break.test.ts`'s harness), not internal-unit tests.
 */
import { describe, it, expect } from "vitest";
import { config, reduceEditor } from "./test-helpers";
import { createEditorStateFromState, type EditorState } from "../editor-state";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/state-builders";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Build a multi-paragraph editor `document → [p1, p2, p3, p4]` with the
 * cursor collapsed at the start of `cursorBlock`. Mirrors the up-front
 * render/cascade/layout the real `createInitialEditorState` performs.
 */
function makeEditor(
  cursorBlock: BlockId,
  cursorOffset = 0,
): EditorState {
  const initialState = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p1",
        lastChildId: "p4",
      }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p1",
        nextSiblingId: "p3",
        inlineContent: inlineContent([text("two")]),
      }),
      buildBlock({
        id: "p3",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p2",
        nextSiblingId: "p4",
        inlineContent: inlineContent([text("three")]),
      }),
      buildBlock({
        id: "p4",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p3",
        inlineContent: inlineContent([text("four")]),
      }),
    ],
  });
  const cursor = { blockId: cursorBlock, offset: cursorOffset };
  return createEditorStateFromState(initialState, { anchor: cursor, focus: cursor }, config);
}

/** Ordered list of the document root's direct children (its sections). */
function rootChildren(editor: EditorState): BlockId[] {
  const root = getBlock(editor.document, editor.document.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(editor.document, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

/** Ordered list of a block's direct children. */
function childrenOf(editor: EditorState, parentId: BlockId): BlockId[] {
  const parent = getBlock(editor.document, parentId);
  if (parent === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = parent.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(editor.document, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

/** Count of doc-root `section` children. */
function sectionCount(editor: EditorState): number {
  return rootChildren(editor).filter(
    (id) => getBlock(editor.document, id)?.type === "section",
  ).length;
}

/** Plain text of a block. */
function textOf(editor: EditorState, blockId: BlockId): string {
  const b = getBlock(editor.document, blockId);
  if (b === null || b.inlineContent === null) return "";
  return b.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/** The top-level body blocks in document order (every section's children). */
function bodyBlocks(editor: EditorState): BlockId[] {
  return rootChildren(editor).flatMap((s) => childrenOf(editor, s));
}

/**
 * Apply a SECTION_BREAK with the cursor at the start of `p3`, producing
 * `doc → [secA{p1,p2,H}, secB{p3,p4}]` (H = the split's empty head carrying the
 * section end) with the cursor at `{p3, 0}`. Returns the editor, the
 * two section ids and H.
 */
function brokenEditor(): {
  editor: EditorState;
  secA: BlockId;
  secB: BlockId;
  head: BlockId;
} {
  const initial = makeEditor("p3" as BlockId);
  const editor = reduceEditor(initial, { type: "SECTION_BREAK" });
  const children = rootChildren(editor);
  if (children.length !== 2) {
    // Guard: if SECTION_BREAK ever fails to produce exactly two sections, fail
    // LOUDLY here rather than silently contaminate every test built on this.
    throw new Error(
      `brokenEditor fixture: expected 2 sections after SECTION_BREAK, got ${children.length}`,
    );
  }
  const secA = nth(children, 0, "section");
  const secB = nth(children, 1, "section");
  const head = nth(childrenOf(editor, secA), 2, "break-carrying head");
  return { editor, secA, secB, head };
}

describe("section-break removal — Backspace at the section boundary", () => {
  it("removes the break and keeps the boundary paragraphs SEPARATE", () => {
    const { editor, secA, head } = brokenEditor();

    // Pre-condition: two sections, cursor at the boundary block start.
    expect(sectionCount(editor)).toBe(2);
    expect(editor.selection.focus).toEqual({
      blockId: "p3" as BlockId,
      offset: 0,
    });

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });

    // The break is gone in ONE step: its item (¶H) is deleted, H's empty content
    // merges into p3 (survivor R), and the content joins the final section.
    expect(next.document).not.toBe(editor.document);
    expect(sectionCount(next)).toBe(1);
    expect(getBlock(next.document, secA)).toBeNull();
    expect(getBlock(next.document, head)).toBeNull();
    expect(bodyBlocks(next)).toEqual([
      "p1" as BlockId,
      "p2" as BlockId,
      "p3" as BlockId,
      "p4" as BlockId,
    ]);

    // Boundary paragraphs STILL SEPARATE: p2 ("two") and p3 ("three") are
    // distinct blocks, not merged.
    expect(textOf(next, "p2" as BlockId)).toBe("two");
    expect(textOf(next, "p3" as BlockId)).toBe("three");
    expect(getBlock(next.document, "p2" as BlockId)?.nextSiblingId).toBe("p3");

    // Cursor unchanged — p3 kept its id.
    expect(next.selection.focus).toEqual({
      blockId: "p3" as BlockId,
      offset: 0,
    });
    expect(next.selection.anchor).toEqual({
      blockId: "p3" as BlockId,
      offset: 0,
    });
  });

  it("a SECOND Backspace then merges the boundary paragraphs (same-parent path)", () => {
    const { editor } = brokenEditor();

    const afterBreakRemoval = reduceEditor(
      editor,
      { type: "DELETE_BACKWARD" },
    );
    // Sanity: p2 and p3 still separate after the first backspace.
    expect(textOf(afterBreakRemoval, "p2" as BlockId)).toBe("two");
    expect(textOf(afterBreakRemoval, "p3" as BlockId)).toBe("three");

    const merged = reduceEditor(
      afterBreakRemoval,
      { type: "DELETE_BACKWARD" },
    );

    // Now the two boundary paragraphs merge into one: ¶p2 goes and the right
    // paragraph p3 survives, holding "twothree".
    expect(getBlock(merged.document, "p2" as BlockId)).toBeNull();
    expect(textOf(merged, "p3" as BlockId)).toBe("twothree");
    // Cursor at the join ("two".length === 3).
    expect(merged.selection.focus).toEqual({
      blockId: "p3" as BlockId,
      offset: 3,
    });
  });
});

describe("section-break removal — Delete (forward) at the section boundary", () => {
  it("removes the break from the end of the previous section's last block", () => {
    const { editor, secA, head } = brokenEditor();

    // The previous section's last paragraph is H (empty): Delete at (H, len) removes ¶H,
    // which IS the section-end item.
    const cursor = { blockId: head, offset: 0 };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
    );

    const next = reduceEditor(positioned, { type: "DELETE_FORWARD" });

    // Same one-step result as Backspace: one (final) section, H merged into p3.
    expect(next.document).not.toBe(positioned.document);
    expect(sectionCount(next)).toBe(1);
    expect(getBlock(next.document, secA)).toBeNull();
    expect(bodyBlocks(next)).toEqual([
      "p1" as BlockId,
      "p2" as BlockId,
      "p3" as BlockId,
      "p4" as BlockId,
    ]);

    // Boundary paragraphs still separate.
    expect(textOf(next, "p2" as BlockId)).toBe("two");
    expect(textOf(next, "p3" as BlockId)).toBe("three");

    // The caret's paragraph merged into p3 (survivor R): the caret is at p3's start.
    expect(next.selection.focus).toEqual({ blockId: "p3" as BlockId, offset: 0 });
  });

  it("Delete at the end of a non-empty paragraph before the break-carrying ¶ merges that paragraph into it (not a section removal)", () => {
    const { editor, secA, head } = brokenEditor();
    const cursor = { blockId: "p2" as BlockId, offset: 3 };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
    );

    const next = reduceEditor(positioned, { type: "DELETE_FORWARD" });

    // ¶p2 is a plain ¶: p2 merges into H, which keeps the section end.
    expect(sectionCount(next)).toBe(2);
    expect(getBlock(next.document, "p2" as BlockId)).toBeNull();
    expect(textOf(next, head)).toBe("two");
    expect(childrenOf(next, secA)).toEqual(["p1" as BlockId, head]);
  });
});

describe("section-break removal — non-section-boundary cases unchanged", () => {
  it("Backspace at the start of the FIRST section's first block is a no-op", () => {
    const { editor, secA } = brokenEditor();
    const secABlock = getBlock(editor.document, secA);
    if (secABlock === null || secABlock.firstChildId === null) {
      throw new Error("test fixture: secA missing firstChildId");
    }
    const firstBlock = secABlock.firstChildId;

    const cursor = { blockId: firstBlock, offset: 0 };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
    );

    const next = reduceEditor(positioned, { type: "DELETE_BACKWARD" });

    // No change: state reference unchanged (start of doc, no prev section).
    expect(next).toBe(positioned);
  });

  it("Backspace at the start of a NON-first block within a section does the normal same-parent merge", () => {
    const { editor, secA, head } = brokenEditor();

    // secA holds [p1, p2, H]; put cursor at the start of p2 (NOT the section's
    // first child). This must hit the existing mergeAdjacentBlocks path, not
    // the section op.
    const cursor = { blockId: "p2" as BlockId, offset: 0 };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
    );

    const next = reduceEditor(positioned, { type: "DELETE_BACKWARD" });

    // ¶p1 removed; the right paragraph p2 survives holding "onetwo";
    // section count unchanged.
    expect(getBlock(next.document, "p1" as BlockId)).toBeNull();
    expect(textOf(next, "p2" as BlockId)).toBe("onetwo");
    expect(sectionCount(next)).toBe(2);
    expect(childrenOf(next, secA)).toEqual(["p2" as BlockId, head]);
    // Cursor at the join ("one".length === 3).
    expect(next.selection.focus).toEqual({
      blockId: "p2" as BlockId,
      offset: 3,
    });
  });
});

describe("section-break removal — undo", () => {
  it("Undo restores the section break after a Backspace removal", () => {
    const { editor } = brokenEditor();
    const sectionsBefore = sectionCount(editor);
    expect(sectionsBefore).toBe(2);

    const removed = reduceEditor(editor, { type: "DELETE_BACKWARD" });
    // Removing the only break leaves the final section alone.
    expect(sectionCount(removed)).toBe(1);

    const undone = reduceEditor(removed, { type: "UNDO" });

    // The break is back: two sections, the original structure restored.
    expect(sectionCount(undone)).toBe(2);
    const [secA, secB] = rootChildren(undone);
    expect(getBlock(undone.document, "p1" as BlockId)?.parentId).toBe(secA);
    expect(getBlock(undone.document, "p2" as BlockId)?.parentId).toBe(secA);
    expect(getBlock(undone.document, "p3" as BlockId)?.parentId).toBe(secB);
    expect(getBlock(undone.document, "p4" as BlockId)?.parentId).toBe(secB);
  });
});

describe("section-break removal — section-less doc unaffected", () => {
  it("Backspace at the start of a non-first plain block still merges (no section involved)", () => {
    // doc → [p1, p2, p3, p4] with NO section break. Cursor at start of p2.
    const editor = makeEditor("p2" as BlockId, 0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });

    // Normal merge: ¶p1 removed, survivor R = p2.
    expect(getBlock(next.document, "p1" as BlockId)).toBeNull();
    expect(textOf(next, "p2" as BlockId)).toBe("onetwo");
    expect(next.selection.focus).toEqual({
      blockId: "p2" as BlockId,
      offset: 3,
    });
  });

  it("Backspace at the start of the doc's first block is a no-op (no section)", () => {
    const editor = makeEditor("p1" as BlockId, 0);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" });
    expect(next).toBe(editor);
  });

  it("Delete (forward) mid-doc still merges the next block (no section)", () => {
    // Cursor at end of p1 ("one", len 3), DELETE_FORWARD merges p2 in.
    const editor = makeEditor("p1" as BlockId, 3);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" });
    // ¶p1 removed, survivor R = p2.
    expect(getBlock(next.document, "p1" as BlockId)).toBeNull();
    expect(textOf(next, "p2" as BlockId)).toBe("onetwo");
    expect(next.selection.focus).toEqual({
      blockId: "p2" as BlockId,
      offset: 3,
    });
  });
});
