/**
 * Smell B (#291): characterization + migration safety net for `handlePaste`.
 *
 * `handlePaste` had NO test coverage before this file. These tests pin down
 * the OBSERVABLE paste behavior (block content + cursor + block type
 * inheritance) so the migration from the per-line
 * `splitBlockAtPosition`+`insertText` chain onto the `insertBlocksAfter`
 * bulk primitive can be proven behavior-preserving: every test here must
 * pass against the ORIGINAL handler AND the migrated handler.
 *
 * Harness mirrors the other `actions/*.test.ts` (insert-node, section-break):
 * drive via `reduceEditor`, inspect via `getBlock` walking the block tree.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
  getTextOf,
  firstChildId,
  type EditorState,
} from "./test-helpers";
import { getBlock } from "../../state";
import type { BlockId } from "../../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Ordered list of the document root's direct children. */
function rootChildren(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  let guard = 0;
  while (cur !== null && guard++ < 100000) {
    ids.push(cur);
    const b = getBlock(editor.state, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

function paste(editor: EditorState, text: string): EditorState {
  return reduceEditor(editor, { type: "PASTE", text }, config);
}

describe("handlePaste — multi-line plain-text paste (characterization + migration)", () => {
  it("(1) single line into empty paragraph: para = text, cursor at end, ONE block", () => {
    const initial = createInitialEditorState(config);
    const paraId = firstChildId(initial.state) as BlockId;

    const next = paste(initial, "abc");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(paraId);
    expect(getTextOf(next.state, paraId)).toBe("abc");
    expect(next.selection.focus).toEqual({ blockId: paraId, offset: 3 });
    expect(next.selection.anchor).toEqual({ blockId: paraId, offset: 3 });
  });

  it("(2) three lines into empty doc: 3 paragraphs a/b/c, cursor at end of c", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\nb\nc");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(3);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("b");
    expect(getTextOf(next.state, nth(blocks, 2, "block"))).toBe("c");
    // Cursor collapsed at end of the last pasted line ("c", length 1).
    expect(next.selection.focus).toEqual({ blockId: blocks[2], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[2], offset: 1 });
  });

  it("(3) two lines into the MIDDLE of helloworld at offset 5", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "helloworld" }, config);
    // Place collapsed cursor at offset 5 (between "hello" and "world").
    const mid = { blockId: paraId, offset: 5 };
    s = reduceEditor(s, { type: "SET_SELECTION", selection: { anchor: mid, focus: mid } }, config);

    const next = paste(s, "X\nY");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    // First block: prefix "hello" + L0 "X".
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("helloX");
    // Second block: L1 "Y" + suffix "world".
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("Yworld");
    // Cursor at end of last pasted line "Y" (length 1) in the new block.
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 1 });
  });

  it("(4) trailing empty line a\\n: 'a' then an empty paragraph, cursor in empty para at 0", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\n");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("");
    // Last pasted line is "" (length 0): cursor at offset 0 of the empty para.
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 0 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 0 });
  });

  it("(5) empty MIDDLE line a\\n\\nb: 'a', empty para, 'b'", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\n\nb");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(3);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("");
    expect(getTextOf(next.state, nth(blocks, 2, "block"))).toBe("b");
    expect(next.selection.focus).toEqual({ blockId: blocks[2], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[2], offset: 1 });
  });

  it("(5b) leading empty line \\nY into a non-empty block: empty para, then Y+suffix", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "world" }, config);
    // Cursor at offset 0 (start of "world").
    const startPos = { blockId: paraId, offset: 0 };
    s = reduceEditor(
      s,
      { type: "SET_SELECTION", selection: { anchor: startPos, focus: startPos } },
      config,
    );

    const next = paste(s, "\nY");

    // L0 is empty → not inserted, pos stays at offset 0; split at 0 makes B
    // an empty prefix block and N_last the whole "world" suffix; L1 "Y"
    // prepends to N_last.
    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("Yworld");
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 1 });
  });

  it("(6) paste into an EXPANDED selection replaces it then inserts", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "helloworld" }, config);
    // Select "world" (offsets 5..10).
    const sel = {
      anchor: { blockId: paraId, offset: 5 },
      focus: { blockId: paraId, offset: 10 },
    };
    s = reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);

    const next = paste(s, "X\nY");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    // "world" deleted → prefix "hello", then "X" appended; new block "Y".
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("helloX");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("Y");
    expect(next.selection.focus).toEqual({ blockId: blocks[1], offset: 1 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[1], offset: 1 });
  });

  it("(7) new blocks inherit the target block's type (heading)", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(getBlock(s.state, paraId)?.type).toBe("heading");

    const next = paste(s, "a\nb");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    for (const id of blocks) {
      expect(getBlock(next.state, id)?.type).toBe("heading");
    }
    // New blocks also inherit the source attrs (level: 1).
    expect(getBlock(next.state, nth(blocks, 1, "block"))?.attrs).toEqual({ level: 1 });
  });

  it("(8) k=4 lines into the middle of a non-empty block: content + cursor match, no throw", () => {
    let s = createInitialEditorState(config);
    const paraId = firstChildId(s.state) as BlockId;
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "PREsuf" }, config);
    // Cursor at offset 3 (between "PRE" and "suf").
    const mid = { blockId: paraId, offset: 3 };
    s = reduceEditor(s, { type: "SET_SELECTION", selection: { anchor: mid, focus: mid } }, config);

    let next: EditorState | undefined;
    expect(() => {
      next = paste(s, "L0\nL1\nL2\nL3");
    }).not.toThrow();
    if (next === undefined) throw new Error("paste returned undefined");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(4);
    // B keeps prefix "PRE" + L0 "L0".
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("PREL0");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("L1");
    expect(getTextOf(next.state, nth(blocks, 2, "block"))).toBe("L2");
    // Last block: L3 + suffix "suf".
    expect(getTextOf(next.state, nth(blocks, 3, "block"))).toBe("L3suf");
    // Cursor at end of last pasted line "L3" (length 2) in the last block.
    expect(next.selection.focus).toEqual({ blockId: blocks[3], offset: 2 });
    expect(next.selection.anchor).toEqual({ blockId: blocks[3], offset: 2 });
  });

  it("empty rawText is a no-op (returns the same editor reference)", () => {
    const initial = createInitialEditorState(config);
    const next = paste(initial, "");
    expect(next).toBe(initial);
  });

  it("\\r\\n line endings normalize to \\n", () => {
    const initial = createInitialEditorState(config);

    const next = paste(initial, "a\r\nb");

    const blocks = rootChildren(next);
    expect(blocks).toHaveLength(2);
    expect(getTextOf(next.state, nth(blocks, 0, "block"))).toBe("a");
    expect(getTextOf(next.state, nth(blocks, 1, "block"))).toBe("b");
  });
});

describe("handlePaste — paste-then-select-all preserves content (regression)", () => {
  /**
   * Regression guard for the long-standing "paste-then-select-all reverts
   * content" report (`state-of-branch.md`, editor `[partial]`). This pins the
   * actual reported sequence — RAPID (sequential) paste immediately followed
   * by SELECT_ALL — and proves no pasted content is lost.
   *
   * SELECT_ALL is purely read-only (it sets `selection`, never mutating the
   * block tree); PASTE commits atomically in a single transaction; sequential
   * pastes each reduce against the prior result (the React `useReducer`
   * contract), so neither clobbers the other. The reducer path is therefore
   * provably content-preserving. (Any residual symptom would live only in the
   * browser event / hidden-textarea sync layer, covered by the user's
   * in-browser smoke — not reproducible at the reducer level, where this test
   * proves the core is safe.)
   */
  it("rapid sequential pastes then SELECT_ALL keeps all content + spans the whole doc", () => {
    const initial = createInitialEditorState(config);

    // first paste: "one" / "two" (cursor ends at "two"|). second paste at that
    // caret: "two" becomes "twothree", then a new "four" block. → 3 blocks,
    // content from BOTH pastes intact.
    const first = paste(initial, "one\ntwo");
    const second = paste(first, "three\nfour");
    const after = reduceEditor(second, { type: "SELECT_ALL" }, config);

    const blocks = rootChildren(after);
    expect(blocks.map((id) => getTextOf(after.state, id))).toEqual([
      "one",
      "twothree",
      "four",
    ]);
    // SELECT_ALL spans first-content-block start → last-content-block end
    // ("four", length 4) — and must not have touched the block tree.
    expect(after.selection.anchor).toEqual({ blockId: blocks[0], offset: 0 });
    expect(after.selection.focus).toEqual({ blockId: blocks[2], offset: 4 });
  });
});
