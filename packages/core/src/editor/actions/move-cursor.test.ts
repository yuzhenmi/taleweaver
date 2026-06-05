/**
 * MOVE_CURSOR handler tests (P4-C.2.3 §E): ArrowLeft/Right perform VISUAL-order
 * caret motion through bidi-reordered lines, with the dual-caret boundary
 * affinity, while pure-LTR motion stays byte-identical to the prior logical
 * ±1-grapheme behavior.
 *
 * These drive the REAL reducer end-to-end (render → cascade → layout →
 * moveVisually), so they cover the wiring (line resolution, grapheme stepper,
 * affinity threading, central-reset exemption) — not just the pure primitive in
 * line-bidi.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  getBlock,
  createPosition,
  createSpan,
  type EditorConfig,
  type EditorState,
  type BlockId,
} from "../../index";

function makeConfig(): EditorConfig {
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
  };
}

/** The (only) paragraph block id in a fresh editor. */
function paragraphId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("test setup");
  return root.firstChildId;
}

/** Type a literal string into the editor. */
function type(editor: EditorState, text: string, config: EditorConfig): EditorState {
  let cur = editor;
  for (const ch of text) {
    cur = reduceEditor(cur, { type: "INSERT_TEXT", text: ch }, config);
  }
  return cur;
}

/** Place a collapsed caret at `(blockId, offset)`, clearing any affinity. */
function caretAt(
  editor: EditorState,
  blockId: BlockId,
  offset: number,
  config: EditorConfig,
): EditorState {
  const pos = createPosition(blockId, offset);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(pos, pos) }, config);
}

function right(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "forward" }, config);
}
function left(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "backward" }, config);
}

/** Compact "(offset/affinity)" snapshot of the collapsed caret. */
function snap(editor: EditorState): string {
  return `${editor.selection.focus.offset}/${editor.caretAffinity ?? "none"}`;
}

describe("MOVE_CURSOR — pure-LTR (byte-identical to logical motion)", () => {
  it("ArrowRight advances one offset; ArrowLeft retreats", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 0, config);
    editor = right(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 1));
    editor = right(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 2));

    editor = left(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 1));
  });

  it("expanded selection + ArrowRight collapses to the end (no move)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcdef", config);
    const pid = paragraphId(editor);
    const sel = createSpan(createPosition(pid, 1), createPosition(pid, 4));
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: sel }, config);

    editor = right(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 4));
    expect(editor.selection.anchor).toEqual(createPosition(pid, 4));

    // And ArrowLeft on an expanded selection collapses to the start.
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: sel }, config);
    editor = left(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 1));
  });
});

describe("MOVE_CURSOR — uniform-RTL", () => {
  it("ArrowRight moves toward logical START (offset−1)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 3, config);
    editor = right(editor, config);
    expect(editor.selection.focus.offset).toBe(2);
    editor = right(editor, config);
    expect(editor.selection.focus.offset).toBe(1);
    editor = right(editor, config);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("ArrowLeft moves toward logical END (offset+1)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 0, config);
    editor = left(editor, config);
    expect(editor.selection.focus.offset).toBe(1);
    editor = left(editor, config);
    expect(editor.selection.focus.offset).toBe(2);
  });
});

describe("MOVE_CURSOR — mixed LTR+RTL (the dual-caret boundary)", () => {
  it("ArrowRight from offset 0 walks the visual glyph order incl. the flip", () => {
    // "abcאבג": Latin [0,3) LTR, Hebrew [3,6) RTL. Glyphs L→R: a b c ג ב א. The
    // sequence is derived + locked in line-bidi.test.ts; here we confirm the
    // REDUCER threads (offset, caretAffinity) through the same way.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcאבג", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);

    const seq: string[] = [];
    for (let i = 0; i < 7; i++) {
      editor = right(editor, config);
      seq.push(snap(editor));
    }
    expect(seq).toEqual([
      "1/before",
      "2/before",
      "3/before",
      "6/before", // dual-caret flip into the Hebrew run (same x, different offset)
      "5/after",
      "4/after",
      "3/after",
    ]);
  });

  it("same-parity boundary (bold/plain split) advances with NO affinity flip", () => {
    // Type "ab", bold it, then type "cd" un-bolded → two adjacent LTR runs.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcd", config);
    const pid = paragraphId(editor);
    // Bold the first two chars so the IFC splits the line into two LTR runs.
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(pid, 0), createPosition(pid, 2)) },
      config,
    );
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, config);

    editor = caretAt(editor, pid, 2, config);
    editor = right(editor, config);
    // Advances to 3 immediately — never a same-offset (2/2) flip.
    expect(editor.selection.focus.offset).toBe(3);
  });
});

describe("MOVE_CURSOR — affinity lifecycle", () => {
  it("sets caretAffinity at a bidi boundary and the central reset preserves it", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcאבג", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);
    // Three ArrowRights land at the Latin run's right edge (offset 3, "before").
    editor = right(editor, config);
    editor = right(editor, config);
    editor = right(editor, config);
    expect(editor.caretAffinity).toBe("before");
  });

  it("a subsequent edit clears caretAffinity (central reset)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcאבג", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);
    editor = right(editor, config); // 1/before
    editor = right(editor, config); // 2/before
    editor = right(editor, config); // 3/before (Latin right edge)
    editor = right(editor, config); // flips into the Hebrew run → 6/before
    expect(editor.caretAffinity).toBeDefined();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(editor.caretAffinity).toBeUndefined();
  });
});
