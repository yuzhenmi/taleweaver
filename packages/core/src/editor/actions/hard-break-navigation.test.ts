/**
 * Hard-break (`<br>`) caret / selection / hit-test / line-navigation behavior
 * (#504, plan Task 5). A hard-break embed (`HARD_BREAK_EMBED_TYPE`) is ONE
 * state-model offset (one cursor stop) that the IFC turns into a FORCED line
 * break. These tests VERIFY — through the REAL editor+controller (reduceEditor)
 * and the REAL cursor modules (hit-test, line-navigation) — that caret motion,
 * Home/End, line-nav, hit-test, and selection behave correctly ACROSS the break
 * (NOT just IFC-internal). The spec (§3) flagged this VERIFY-not-assume: the
 * cursor model anchors on LineBoxes / a generic `isLineBreak`, so an
 * embed-derived forced break should inherit the same machinery as a `\n`-text
 * LINE_BREAK with no `\n`-vs-embed divergence.
 *
 * Model: paragraph inlineContent = [ text "AB", hard-break embed, text "CD" ].
 * Offsets: A=0..1, B=1..2, hard-break=2..3 (one unit), C=3..4, D=4..5; block
 * length 5. Lays out as TWO visual lines — "AB" (line 0, offsets [0,2]) and
 * "CD" (line 1, offsets [3,5]) — with the break occupying offset 2→3.
 */
import { describe, it, expect } from "vitest";
import {
  reduceEditor,
  createMockShaper,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createPosition,
  createSpan,
  getBlock,
  HARD_BREAK_EMBED_TYPE,
  type EditorConfig,
  type EditorState,
  type BlockId,
  type State,
} from "../../index";
import { createEditorStateFromState } from "../editor-state";
import { buildState, buildBlock, text, embed, inlineContent } from "../../test-utils/state-builders";
import { resolvePositionFromPixel } from "../../cursor/hit-test";
import { resolvePixelPosition } from "../../cursor/cursor-position";

const CHAR_W = 8;
const LINE_H = 16;

function makeConfig(): EditorConfig {
  return {
    measurer: createMockShaper(CHAR_W, LINE_H),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 200,
  };
}

const PARA = "para" as BlockId;

/** A document with one paragraph "AB" <hard-break> "CD" (block length 5). */
function hardBreakState(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "para", lastChildId: "para" }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("AB"), embed(HARD_BREAK_EMBED_TYPE), text("CD")]),
      }),
    ],
  });
}

/** Editor over the hard-break doc with a collapsed caret at `offset` in the paragraph. */
function editorAt(offset: number, config: EditorConfig): EditorState {
  const caret = createPosition(PARA, offset);
  return createEditorStateFromState(hardBreakState(), createSpan(caret, caret), config);
}

function caretAt(editor: EditorState, offset: number, config: EditorConfig): EditorState {
  const pos = createPosition(PARA, offset);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(pos, pos) }, config);
}

function right(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "forward" }, config);
}
function left(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "backward" }, config);
}
function down(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_LINE", direction: "down" }, config);
}
function up(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_LINE", direction: "up" }, config);
}

/** Rendered caret pixel position for the editor's current focus. */
function caretPixel(editor: EditorState, config: EditorConfig) {
  const r = resolvePixelPosition(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    editor.caretPageHint,
    editor.caretAffinity,
  );
  if (r === null) throw new Error("caret did not resolve");
  return r;
}

describe("hard-break — layout is two visual lines", () => {
  it("offset 2 (end of AB) and offset 3 (start of CD) sit on DIFFERENT lines", () => {
    const config = makeConfig();
    const editor = editorAt(0, config);

    const endOfAB = caretPixel(caretAt(editor, 2, config), config);
    const startOfCD = caretPixel(caretAt(editor, 3, config), config);

    // The break forces a new line: offset 3 is one line-height BELOW offset 2.
    expect(startOfCD.lineY).toBeGreaterThan(endOfAB.lineY);
    expect(startOfCD.lineY - endOfAB.lineY).toBeCloseTo(LINE_H, 5);
    // ...and offset 3 is at the line's inline start (x === 0), not glued after "AB".
    expect(startOfCD.x).toBeCloseTo(0, 5);
    expect(endOfAB.x).toBeCloseTo(2 * CHAR_W, 5);
  });
});

describe("hard-break — caret across the break (MOVE_CURSOR)", () => {
  it("ArrowRight from end of line 0 (offset 2) lands at start of line 1 (offset 3) in ONE step", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 2, config);

    const moved = right(editor, config);
    expect(moved.selection.focus).toEqual(createPosition(PARA, 3));
    // Collapsed caret.
    expect(moved.selection.anchor).toEqual(createPosition(PARA, 3));
  });

  it("ArrowLeft from start of line 1 (offset 3) returns to end of line 0 (offset 2)", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 3, config);

    const moved = left(editor, config);
    expect(moved.selection.focus).toEqual(createPosition(PARA, 2));
  });

  it("ArrowRight from inside AB to past the break walks 0→1→2→3→4 (the break is one stop)", () => {
    const config = makeConfig();
    let editor = caretAt(editorAt(0, config), 0, config);
    const seen: number[] = [editor.selection.focus.offset];
    for (let i = 0; i < 4; i++) {
      editor = right(editor, config);
      seen.push(editor.selection.focus.offset);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("hard-break — Home/End resolve per sub-line (MOVE_LINE_BOUNDARY)", () => {
  function home(editor: EditorState, config: EditorConfig): EditorState {
    return reduceEditor(editor, { type: "MOVE_LINE_BOUNDARY", boundary: "start" }, config);
  }
  function end(editor: EditorState, config: EditorConfig): EditorState {
    return reduceEditor(editor, { type: "MOVE_LINE_BOUNDARY", boundary: "end" }, config);
  }

  it("End on line 0 (caret in AB) → line 0's inlineOffsetEnd (offset 3, owning the break) — NOT end of block — and renders at the VISUAL end of line 0", () => {
    // VERIFY parity with the `\n` LINE_BREAK forced break: the current line OWNS
    // the break offset, so line 0 ("AB" + break) has inlineOffsetEnd === 3. End
    // therefore returns offset 3 (NOT 5 = end of block), and the handler seeds
    // caretAffinity "before" so the boundary RENDERS at the visual end of line 0
    // (the end of "AB"), not pushed onto line 1. This is byte-identical to the
    // shipped `\n` forced-break behavior — there is NO `\n`-vs-embed divergence.
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 1, config); // inside "AB"
    const moved = end(editor, config);
    expect(moved.selection.focus).toEqual(createPosition(PARA, 3));
    expect(moved.caretAffinity).toBe("before");
    const px = caretPixel(moved, config);
    // "before" affinity pins the offset-3 boundary to the END of line 0 (x = 2
    // chars, line 0's y), not to line 1's start.
    expect(px.x).toBeCloseTo(2 * CHAR_W, 5);
    const startOfCD = caretPixel(caretAt(editor, 3, config), config); // affinity "after" → line 1
    expect(px.lineY).toBeLessThan(startOfCD.lineY);
  });

  it("Home on line 1 (caret in CD) → start of CD (offset 3), NOT start of block — and renders at the start of line 1", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 4, config); // inside "CD"
    const moved = home(editor, config);
    expect(moved.selection.focus).toEqual(createPosition(PARA, 3));
    // Home seeds "after" → the offset-3 boundary renders at the START of line 1.
    expect(moved.caretAffinity).toBe("after");
    const px = caretPixel(moved, config);
    expect(px.x).toBeCloseTo(0, 5);
    const endOfAB = caretPixel(caretAt(editor, 2, config), config); // line 0
    expect(px.lineY).toBeGreaterThan(endOfAB.lineY);
  });

  it("End on line 1 → end of block (offset 5)", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 4, config);
    const moved = end(editor, config);
    expect(moved.selection.focus).toEqual(createPosition(PARA, 5));
  });
});

describe("hard-break — line navigation across the break (MOVE_LINE)", () => {
  it("ArrowDown from line 0 lands on line 1 at a corresponding x (goal-x preserved)", () => {
    const config = makeConfig();
    // Caret at offset 1 (between A and B) → x = 1*CHAR_W on line 0.
    const editor = caretAt(editorAt(0, config), 1, config);
    const before = caretPixel(editor, config);

    const moved = down(editor, config);
    // Lands on line 1 (offsets 3..5), at the x-corresponding offset (between C and D → 4).
    expect(moved.selection.focus.blockId).toBe(PARA);
    expect(moved.selection.focus.offset).toBe(4);
    const after = caretPixel(moved, config);
    expect(after.lineY).toBeGreaterThan(before.lineY);
    expect(after.x).toBeCloseTo(before.x, 5);
  });

  it("ArrowUp from line 1 returns to line 0 at the corresponding x", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 4, config); // between C and D on line 1
    const before = caretPixel(editor, config);

    const moved = up(editor, config);
    expect(moved.selection.focus.offset).toBe(1); // between A and B
    const after = caretPixel(moved, config);
    expect(after.lineY).toBeLessThan(before.lineY);
    expect(after.x).toBeCloseTo(before.x, 5);
  });
});

describe("hard-break — hit-test lands on the clicked sub-line", () => {
  it("a click on line 1's CD resolves to an offset within CD (>= 3)", () => {
    const config = makeConfig();
    const editor = editorAt(0, config);
    if (editor.layoutTree.type === "virtual-root") {
      throw new Error("test expects a materialized (non-virtual) layout tree for a one-page doc");
    }

    // Pixel target: line 1 is one line-height down; aim mid-"CD" (x just past C).
    const startOfCD = caretPixel(caretAt(editor, 3, config), config);
    const x = startOfCD.x + CHAR_W; // between C and D
    const y = startOfCD.lineY + LINE_H / 2;

    const hit = resolvePositionFromPixel(editor.state, editor.layoutTree, config.measurer, x, y);
    expect(hit).not.toBeNull();
    expect(hit?.position.blockId).toBe(PARA);
    expect(hit?.position.offset).toBeGreaterThanOrEqual(3);
    expect(hit?.position.offset).toBeLessThanOrEqual(5);
  });

  it("a click on line 0's AB resolves to an offset within AB (<= 2)", () => {
    const config = makeConfig();
    const editor = editorAt(0, config);
    if (editor.layoutTree.type === "virtual-root") {
      throw new Error("test expects a materialized layout tree");
    }
    const endOfAB = caretPixel(caretAt(editor, 2, config), config);
    const x = CHAR_W; // between A and B
    const y = endOfAB.lineY + LINE_H / 2;

    const hit = resolvePositionFromPixel(editor.state, editor.layoutTree, config.measurer, x, y);
    expect(hit?.position.blockId).toBe(PARA);
    expect(hit?.position.offset).toBeGreaterThanOrEqual(0);
    expect(hit?.position.offset).toBeLessThanOrEqual(2);
  });
});

describe("hard-break — selection spans the break (EXPAND_SELECTION / EXPAND_LINE)", () => {
  it("Shift+ArrowRight from end of line 0 (offset 2) extends the focus past the break into CD", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 2, config);

    const expanded = reduceEditor(
      editor,
      { type: "EXPAND_SELECTION", direction: "forward" },
      config,
    );
    // Anchor pinned at 2; focus advanced across the break to 3 (start of CD).
    expect(expanded.selection.anchor).toEqual(createPosition(PARA, 2));
    expect(expanded.selection.focus).toEqual(createPosition(PARA, 3));
  });

  it("Shift+ArrowDown from line 0 extends the selection onto line 1 (focus reaches into CD)", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 1, config); // line 0, between A and B

    const expanded = reduceEditor(editor, { type: "EXPAND_LINE", direction: "down" }, config);
    expect(expanded.selection.anchor).toEqual(createPosition(PARA, 1));
    // Focus lands on line 1 (offset >= 3), covering the break.
    expect(expanded.selection.focus.blockId).toBe(PARA);
    expect(expanded.selection.focus.offset).toBeGreaterThanOrEqual(3);
  });

  it("the spanning selection actually covers the break offset (2→3 contiguous)", () => {
    const config = makeConfig();
    const editor = caretAt(editorAt(0, config), 2, config);
    let expanded = reduceEditor(editor, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    expanded = reduceEditor(expanded, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    // anchor 2, focus 4 → the selection contains the break (offset 2..3) and into CD.
    expect(expanded.selection.anchor.offset).toBe(2);
    expect(expanded.selection.focus.offset).toBe(4);
    // Sanity: the paragraph still has its full 5-offset content.
    const block = getBlock(expanded.state, PARA);
    expect(block?.inlineContent?.items.length).toBe(3);
  });
});
