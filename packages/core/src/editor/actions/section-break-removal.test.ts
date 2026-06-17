/**
 * SBR-T2: Backspace / Delete remove a section break.
 *
 * Wires `mergeSectionWithPrevious` into the two cross-block delete handlers
 * so a section break is a removable unit. Word / Google Docs behavior:
 * Backspace at the start of a section's first block (and Delete at the end of
 * the previous section's last block) REMOVES the break — the section's blocks
 * rejoin the previous section — WITHOUT merging the two boundary paragraphs.
 * A second Backspace then merges the paragraphs via the normal same-parent
 * path.
 *
 * These are behavior-level tests through the real `reduceEditor` reducer
 * (mirroring `section-break.test.ts`'s harness), not internal-unit tests.
 */
import { describe, it, expect } from "vitest";
import { config, reduceEditor } from "./test-helpers";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory, inlineContentLength } from "../../state";
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
  return {
    state: initialState,
    selection: { anchor: cursor, focus: cursor },
    history: createHistory(initialState),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
    caretPageHint: undefined,
    caretAffinity: undefined,
    anchorAffinity: undefined,
  };
}

/** Ordered list of the document root's direct children. */
function rootChildren(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(editor.state, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

/** Ordered list of a block's direct children. */
function childrenOf(editor: EditorState, parentId: BlockId): BlockId[] {
  const parent = getBlock(editor.state, parentId);
  if (parent === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = parent.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(editor.state, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

/** Count of doc-root `section` children. */
function sectionCount(editor: EditorState): number {
  return rootChildren(editor).filter(
    (id) => getBlock(editor.state, id)?.type === "section",
  ).length;
}

/** Plain text of a block. */
function textOf(editor: EditorState, blockId: BlockId): string {
  const b = getBlock(editor.state, blockId);
  if (b === null || b.inlineContent === null) return "";
  return b.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/**
 * Apply a SECTION_BREAK with the cursor at the start of `p3`, producing
 * `doc → [secA{p1,p2}, secB{p3,p4}]` with the cursor at `{p3, 0}` (the
 * boundary block — section-break collapses the cursor to the first leaf of
 * the boundary subtree). Returns the editor + the two section ids.
 */
function brokenEditor(): {
  editor: EditorState;
  secA: BlockId;
  secB: BlockId;
} {
  const initial = makeEditor("p3" as BlockId);
  const editor = reduceEditor(initial, { type: "SECTION_BREAK" }, config);
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
  return { editor, secA, secB };
}

describe("section-break removal — Backspace at the section boundary", () => {
  it("removes the break and keeps the boundary paragraphs SEPARATE", () => {
    const { editor, secA } = brokenEditor();

    // Pre-condition: two sections, cursor at the boundary block start.
    expect(sectionCount(editor)).toBe(2);
    expect(editor.selection.focus).toEqual({
      blockId: "p3" as BlockId,
      offset: 0,
    });

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // The break is gone: one fewer section. secB removed; secA survives.
    expect(next.state).not.toBe(editor.state);
    expect(sectionCount(next)).toBe(1);
    expect(rootChildren(next)).toEqual([secA]);
    expect(getBlock(next.state, "p3" as BlockId)?.parentId).toBe(secA);

    // secA now holds p1→p2→p3→p4 in order — X's blocks follow P's.
    expect(childrenOf(next, secA)).toEqual([
      "p1" as BlockId,
      "p2" as BlockId,
      "p3" as BlockId,
      "p4" as BlockId,
    ]);

    // Boundary paragraphs STILL SEPARATE: p2 ("two") and p3 ("three") are
    // distinct blocks, not merged.
    expect(textOf(next, "p2" as BlockId)).toBe("two");
    expect(textOf(next, "p3" as BlockId)).toBe("three");
    expect(getBlock(next.state, "p2" as BlockId)?.nextSiblingId).toBe("p3");

    // Cursor unchanged — the block kept its id, just reparented.
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
      config,
    );
    // Sanity: p2 and p3 still separate after the first backspace.
    expect(textOf(afterBreakRemoval, "p2" as BlockId)).toBe("two");
    expect(textOf(afterBreakRemoval, "p3" as BlockId)).toBe("three");

    const merged = reduceEditor(
      afterBreakRemoval,
      { type: "DELETE_BACKWARD" },
      config,
    );

    // Now the two boundary paragraphs merge into one (mergeAdjacentBlocks).
    // p2 absorbs p3's content; p3 is removed.
    expect(getBlock(merged.state, "p3" as BlockId)).toBeNull();
    expect(textOf(merged, "p2" as BlockId)).toBe("twothree");
    // Cursor at the join — end of the former p2 content ("two".length === 3).
    expect(merged.selection.focus).toEqual({
      blockId: "p2" as BlockId,
      offset: 3,
    });
  });
});

describe("section-break removal — Delete (forward) at the section boundary", () => {
  it("removes the break from the end of the previous section's last block", () => {
    const { editor, secA } = brokenEditor();

    // Place the cursor at the END of secA's last block (p2 = "two", len 3).
    const p2 = getBlock(editor.state, "p2" as BlockId);
    if (p2 === null || p2.inlineContent === null) {
      throw new Error("test fixture: p2 missing inlineContent");
    }
    const p2Len = inlineContentLength(p2.inlineContent);
    const cursor = { blockId: "p2" as BlockId, offset: p2Len };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
      config,
    );

    const next = reduceEditor(positioned, { type: "DELETE_FORWARD" }, config);

    // Same structural result: one fewer section, blocks rejoined under secA.
    expect(next.state).not.toBe(positioned.state);
    expect(sectionCount(next)).toBe(1);
    expect(rootChildren(next)).toEqual([secA]);
    expect(childrenOf(next, secA)).toEqual([
      "p1" as BlockId,
      "p2" as BlockId,
      "p3" as BlockId,
      "p4" as BlockId,
    ]);

    // Boundary paragraphs still separate.
    expect(textOf(next, "p2" as BlockId)).toBe("two");
    expect(textOf(next, "p3" as BlockId)).toBe("three");

    // Cursor stays at the end of p2 (unchanged).
    expect(next.selection.focus).toEqual({
      blockId: "p2" as BlockId,
      offset: p2Len,
    });
  });
});

describe("section-break removal — non-section-boundary cases unchanged", () => {
  it("Backspace at the start of the FIRST section's first block is a no-op", () => {
    const { editor, secA } = brokenEditor();
    const secABlock = getBlock(editor.state, secA);
    if (secABlock === null || secABlock.firstChildId === null) {
      throw new Error("test fixture: secA missing firstChildId");
    }
    const firstBlock = secABlock.firstChildId;

    const cursor = { blockId: firstBlock, offset: 0 };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
      config,
    );

    const next = reduceEditor(positioned, { type: "DELETE_BACKWARD" }, config);

    // No change: state reference unchanged (start of doc, no prev section).
    expect(next).toBe(positioned);
  });

  it("Backspace at the start of a NON-first block within a section does the normal same-parent merge", () => {
    const { editor, secA } = brokenEditor();

    // secA holds [p1, p2]; put cursor at the start of p2 (NOT the section's
    // first child). This must hit the existing mergeAdjacentBlocks path, not
    // the section op.
    const cursor = { blockId: "p2" as BlockId, offset: 0 };
    const positioned = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: cursor, focus: cursor } },
      config,
    );

    const next = reduceEditor(positioned, { type: "DELETE_BACKWARD" }, config);

    // p2 merged into p1 (same-parent). p2 removed; section count unchanged.
    expect(getBlock(next.state, "p2" as BlockId)).toBeNull();
    expect(textOf(next, "p1" as BlockId)).toBe("onetwo");
    expect(sectionCount(next)).toBe(2);
    expect(childrenOf(next, secA)).toEqual(["p1" as BlockId]);
    // Cursor at the join (end of former p1 = "one".length === 3).
    expect(next.selection.focus).toEqual({
      blockId: "p1" as BlockId,
      offset: 3,
    });
  });
});

describe("section-break removal — undo", () => {
  it("Undo restores the section break after a Backspace removal", () => {
    const { editor } = brokenEditor();
    const sectionsBefore = sectionCount(editor);
    expect(sectionsBefore).toBe(2);

    const removed = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);
    expect(sectionCount(removed)).toBe(1);

    const undone = reduceEditor(removed, { type: "UNDO" }, config);

    // The break is back: two sections, the original structure restored.
    expect(sectionCount(undone)).toBe(2);
    const [secA, secB] = rootChildren(undone);
    expect(getBlock(undone.state, "p1" as BlockId)?.parentId).toBe(secA);
    expect(getBlock(undone.state, "p2" as BlockId)?.parentId).toBe(secA);
    expect(getBlock(undone.state, "p3" as BlockId)?.parentId).toBe(secB);
    expect(getBlock(undone.state, "p4" as BlockId)?.parentId).toBe(secB);
  });
});

describe("section-break removal — section-less doc unaffected", () => {
  it("Backspace at the start of a non-first plain block still merges (no section involved)", () => {
    // doc → [p1, p2, p3, p4] with NO section break. Cursor at start of p2.
    const editor = makeEditor("p2" as BlockId, 0);

    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // Normal same-parent merge: p2 → p1.
    expect(getBlock(next.state, "p2" as BlockId)).toBeNull();
    expect(textOf(next, "p1" as BlockId)).toBe("onetwo");
    expect(next.selection.focus).toEqual({
      blockId: "p1" as BlockId,
      offset: 3,
    });
  });

  it("Backspace at the start of the doc's first block is a no-op (no section)", () => {
    const editor = makeEditor("p1" as BlockId, 0);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);
    expect(next).toBe(editor);
  });

  it("Delete (forward) mid-doc still merges the next block (no section)", () => {
    // Cursor at end of p1 ("one", len 3), DELETE_FORWARD merges p2 in.
    const editor = makeEditor("p1" as BlockId, 3);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);
    expect(getBlock(next.state, "p2" as BlockId)).toBeNull();
    expect(textOf(next, "p1" as BlockId)).toBe("onetwo");
    expect(next.selection.focus).toEqual({
      blockId: "p1" as BlockId,
      offset: 3,
    });
  });
});

describe("section-break removal — defensive: next sibling is NOT a section", () => {
  it("Delete forward at the end of a section's last block falls through when the next sibling is not a section", () => {
    // Defensive guard coverage: the forward handler only merges when the
    // section's nextSibling is itself a `section`. Construct an (atypical)
    // doc → [secA{s1}, loose] where secA's next sibling is a plain paragraph.
    // Delete forward at the end of s1 must NOT fire the section merge — it
    // falls through to the cross-parent bail (no-op), never crashing or
    // wrongly merging a non-section into the section.
    const initialState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "secA", lastChildId: "loose" }),
        buildBlock({ id: "secA", type: "section", parentId: "doc", nextSiblingId: "loose", firstChildId: "s1", lastChildId: "s1" }),
        buildBlock({ id: "loose", type: "paragraph", parentId: "doc", prevSiblingId: "secA", inlineContent: inlineContent([text("loose")]) }),
        buildBlock({ id: "s1", type: "paragraph", parentId: "secA", inlineContent: inlineContent([text("alpha")]) }),
      ],
    });
    const s1Len = inlineContentLength(
      getBlock(initialState, "s1" as BlockId)?.inlineContent ?? { items: [] },
    );
    const cursor = { blockId: "s1" as BlockId, offset: s1Len };
    const editor: EditorState = {
      state: initialState,
      selection: { anchor: cursor, focus: cursor },
      history: createHistory(initialState),
      lastDirtyIds: null,
      containerWidth: config.containerWidth,
      targetX: null,
      caretPageHint: undefined,
      caretAffinity: undefined,
      anchorAffinity: undefined,
    };

    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);

    // No-op: the next sibling ("loose") is not a section, so the merge does not
    // fire; the cross-parent bail returns the same editor reference.
    expect(next).toBe(editor);
    // Structure untouched: secA still holds [s1], loose still a doc child.
    expect(getBlock(next.state, "s1" as BlockId)?.parentId).toBe("secA");
    expect(getBlock(next.state, "loose" as BlockId)?.parentId).toBe("doc");
  });
});
