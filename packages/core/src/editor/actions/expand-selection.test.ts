/**
 * EXPAND_SELECTION handler tests (P4-C.2.4 §E.2): Shift+ArrowLeft/Right extend
 * the selection FOCUS in VISUAL order through bidi-reordered lines (coherent with
 * MOVE_CURSOR's caret motion), keeping the ANCHOR fixed; pure-LTR extension stays
 * byte-identical to the prior logical ±1-grapheme focus motion.
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

function expandRight(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "EXPAND_SELECTION", direction: "forward" }, config);
}
function expandLeft(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "EXPAND_SELECTION", direction: "backward" }, config);
}
function moveRight(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "forward" }, config);
}

/** Compact "(focusOffset/affinity)" snapshot of the moving head. */
function snap(editor: EditorState): string {
  return `${editor.selection.focus.offset}/${editor.caretAffinity ?? "none"}`;
}

describe("EXPAND_SELECTION — pure-LTR (byte-identical to logical focus motion)", () => {
  it("Shift+ArrowRight extends the focus forward (offset+1); Shift+ArrowLeft backward; anchor fixed", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 0, config);
    editor = expandRight(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 0));
    expect(editor.selection.focus).toEqual(createPosition(pid, 1));
    editor = expandRight(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 0)); // anchor fixed
    expect(editor.selection.focus).toEqual(createPosition(pid, 2));

    editor = expandLeft(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 0)); // anchor fixed
    expect(editor.selection.focus).toEqual(createPosition(pid, 1));
  });

  it("extends an already-expanded selection from its focus (anchor stays put)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcdef", config);
    const pid = paragraphId(editor);
    const sel = createSpan(createPosition(pid, 1), createPosition(pid, 3));
    editor = reduceEditor(editor, { type: "SET_SELECTION", selection: sel }, config);

    editor = expandRight(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 1));
    expect(editor.selection.focus).toEqual(createPosition(pid, 4));
  });
});

describe("EXPAND_SELECTION — uniform-RTL", () => {
  it("Shift+ArrowRight extends the focus visual-right = logical-backward (offset−1)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 3, config);
    editor = expandRight(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 3)); // anchor fixed
    expect(editor.selection.focus.offset).toBe(2);
    editor = expandRight(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 3)); // anchor fixed
    expect(editor.selection.focus.offset).toBe(1);
    editor = expandRight(editor, config);
    expect(editor.selection.focus.offset).toBe(0);
  });

  it("Shift+ArrowLeft extends the focus visual-left = logical-forward (offset+1)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 0, config);
    editor = expandLeft(editor, config);
    expect(editor.selection.anchor).toEqual(createPosition(pid, 0));
    expect(editor.selection.focus.offset).toBe(1);
    editor = expandLeft(editor, config);
    expect(editor.selection.focus.offset).toBe(2);
  });
});

describe("EXPAND_SELECTION — mixed LTR+RTL (the dual-caret boundary, focus head)", () => {
  it("Shift+ArrowRight from offset 0 walks the visual glyph order incl. the flip; anchor fixed", () => {
    // "abcאבג": Latin [0,3) LTR, Hebrew [3,6) RTL. Glyphs L→R: a b c ג ב א. The
    // focus follows the SAME moveVisually sequence as the collapsed caret in
    // move-cursor.test.ts / line-bidi.test.ts; the anchor stays at 0 throughout.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcאבג", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);

    const seq: string[] = [];
    for (let i = 0; i < 7; i++) {
      editor = expandRight(editor, config);
      seq.push(snap(editor));
      // Anchor never moves.
      expect(editor.selection.anchor).toEqual(createPosition(pid, 0));
    }
    expect(seq).toEqual([
      "1/before", // within latin
      "2/before",
      "3/before", // latin right edge
      "6/before", // dual-caret flip into the Hebrew run (same x, different offset)
      "5/after", // within hebrew, moving visual-right = logical-backward
      "4/after",
      "3/after", // hebrew right edge (logStart)
    ]);
    // After the last in-line step the next press exits the line's visual edge and
    // falls back to logical focus-extension (cross-block) — affinity clears.
    // TODO(C.2.7 browser-confirm): the cross-line/edge visual target is carried
    // from C.2.3 as a logical fallback; confirm against Google Docs.
  });
});

describe("EXPAND_SELECTION — coherence with MOVE_CURSOR (C.2.3)", () => {
  it("the extended focus lands where a plain ArrowRight caret would (same visual direction)", () => {
    // Uniform-RTL: confirm Shift+ArrowRight's focus tracks ArrowRight's caret.
    const config = makeConfig();
    const base = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(base);

    let caretEditor = caretAt(base, pid, 3, config);
    let selEditor = caretAt(base, pid, 3, config);
    for (let i = 0; i < 3; i++) {
      caretEditor = moveRight(caretEditor, config);
      selEditor = expandRight(selEditor, config);
      expect(selEditor.selection.focus.offset).toBe(caretEditor.selection.focus.offset);
    }
    // And the mixed line: the focus walks the same offsets as the caret.
    const baseMixed = type(createInitialEditorState(config), "abcאבג", config);
    const pidMixed = paragraphId(baseMixed);
    let caretMixed = caretAt(baseMixed, pidMixed, 0, config);
    let selMixed = caretAt(baseMixed, pidMixed, 0, config);
    for (let i = 0; i < 7; i++) {
      caretMixed = moveRight(caretMixed, config);
      selMixed = expandRight(selMixed, config);
      expect(selMixed.selection.focus.offset).toBe(caretMixed.selection.focus.offset);
      expect(selMixed.caretAffinity).toBe(caretMixed.caretAffinity);
    }
  });
});

describe("EditorState.anchorAffinity lifecycle (#503 slice 3)", () => {
  // Slice 3 is pure state plumbing: nothing READS anchorAffinity yet, so the
  // lifecycle is tested directly — set anchorAffinity on a state, dispatch an
  // action, and assert reduceEditor clears or preserves it per the predicate.
  function withAnchorAffinity(editor: EditorState): EditorState {
    return { ...editor, anchorAffinity: "after" };
  }

  it("a non-managing action (INSERT_TEXT) clears anchorAffinity (central reset)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = withAnchorAffinity(editor);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(editor.anchorAffinity).toBeUndefined();
  });

  it("SET_SELECTION clears anchorAffinity (a new anchor has no bidi context)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = withAnchorAffinity(editor);
    const pos = createPosition(pid, 1);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(pos, pos) },
      config,
    );
    expect(editor.anchorAffinity).toBeUndefined();
  });

  it("MOVE_CURSOR explicitly clears anchorAffinity (not carried by the ...editor spread)", () => {
    // MOVE_CURSOR is in the predicate (central reset skipped) AND collapses the
    // selection, so without an explicit clear the spread would carry the stale
    // anchorAffinity forward — this asserts it is cleared.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = withAnchorAffinity(editor);
    editor = moveRight(editor, config);
    expect(editor.anchorAffinity).toBeUndefined();
  });

  it("MOVE_LINE_BOUNDARY explicitly clears anchorAffinity", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = withAnchorAffinity(editor);
    editor = reduceEditor(
      editor,
      { type: "MOVE_LINE_BOUNDARY", boundary: "start" },
      config,
    );
    expect(editor.anchorAffinity).toBeUndefined();
  });

  it("MOVE_LINE explicitly clears anchorAffinity (collapses → anchor has no bidi context)", () => {
    // MOVE_LINE (ArrowUp/Down) is in the predicate (central reset skipped) AND
    // collapses the selection — same R5 hazard as MOVE_CURSOR. It must clear
    // anchorAffinity explicitly (uniform invariant: every collapsing action clears).
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc\ndef", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = withAnchorAffinity(editor);
    const before = editor.selection.focus;
    editor = reduceEditor(editor, { type: "MOVE_LINE", direction: "down" }, config);
    // MOVE_LINE actually moved (not a no-op early return) and cleared the stale seed.
    expect(editor.selection.focus).not.toEqual(before);
    expect(editor.anchorAffinity).toBeUndefined();
  });

  it("a predicate action that spreads ...editor (EXPAND_LINE) PRESERVES anchorAffinity", () => {
    // EXPAND_LINE is in actionManagesAnchorAffinity and carries the field via its
    // {...editor} spread → the central reset must NOT clobber it. (EXPAND_SELECTION's
    // seeding logic is slice 4; here we only confirm the spread-persistence path.)
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc\ndef", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = withAnchorAffinity(editor);
    const before = editor.selection.focus;
    editor = reduceEditor(editor, { type: "EXPAND_LINE", direction: "down" }, config);
    // EXPAND_LINE moved the focus (so it was not a no-op early return) and kept
    // the anchorAffinity seed.
    expect(editor.selection.focus).not.toEqual(before);
    expect(editor.anchorAffinity).toBe("after");
  });
});

describe("EXPAND_SELECTION — affinity lifecycle", () => {
  it("sets the focus caretAffinity at a bidi boundary (survives the central reset)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcאבג", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);
    // Three Shift+ArrowRights land the focus at the Latin run's right edge
    // (offset 3, "before").
    editor = expandRight(editor, config);
    editor = expandRight(editor, config);
    editor = expandRight(editor, config);
    expect(editor.selection.focus.offset).toBe(3);
    expect(editor.caretAffinity).toBe("before");
  });

  it("a subsequent edit clears caretAffinity (central reset)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abcאבג", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);
    editor = expandRight(editor, config); // 1/before
    editor = expandRight(editor, config); // 2/before
    editor = expandRight(editor, config); // 3/before (Latin right edge)
    editor = expandRight(editor, config); // flips into the Hebrew run → 6/before
    expect(editor.caretAffinity).toBeDefined();
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(editor.caretAffinity).toBeUndefined();
  });
});
