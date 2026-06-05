/**
 * Home/End + Shift+Home/End caret-affinity wiring (P4-C.2.6 §G, CORRECTED — NO
 * offset swap). Home/End are LOGICAL line-boundary commands: Home →
 * `inlineOffsetStart`, End → `inlineOffsetEnd` in BOTH directions. C.2.6 does
 * NOT touch the offset; it sets a direction-independent `caretAffinity` so the
 * logical boundary RENDERS at the correct visual edge of an RTL line, and adds
 * the line-boundary actions to `actionManagesCaretAffinity` so the affinity
 * survives the central reset until the next edit clears it.
 *
 * These drive the REAL reducer end-to-end (render → cascade → layout →
 * moveToLineBoundary → handler affinity write → central reset), then cross-check
 * the rendered caret X via `resolvePixelPosition` with the set affinity — so they
 * cover the wiring, not just the pure boundary primitive in line-navigation.test.ts.
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
import { resolvePixelPosition } from "../../cursor/cursor-position";

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

function home(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_LINE_BOUNDARY", boundary: "start" }, config);
}
function end(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_LINE_BOUNDARY", boundary: "end" }, config);
}
function shiftHome(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "EXPAND_LINE_BOUNDARY", boundary: "start" }, config);
}
function shiftEnd(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "EXPAND_LINE_BOUNDARY", boundary: "end" }, config);
}

/** Rendered caret X for the editor's current focus, using its current affinity. */
function caretX(editor: EditorState, config: EditorConfig): number {
  const r = resolvePixelPosition(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    editor.caretPageHint,
    editor.caretAffinity,
  );
  expect(r).not.toBeNull();
  return r?.x ?? NaN;
}

describe("MOVE_LINE_BOUNDARY — offset logic UNCHANGED (logical boundaries, both directions)", () => {
  it("LTR Home → inlineOffsetStart (0); End → inlineOffsetEnd", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 2, config);
    editor = home(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 0));

    editor = end(editor, config);
    expect(editor.selection.focus).toEqual(createPosition(pid, 3));
  });

  it("RTL Home → logical START offset (NOT swapped); End → logical END offset", () => {
    // "אבג": one level-1 Hebrew run, [0,3). Home is the LOGICAL line start =
    // inlineOffsetStart = 0 (NOT inlineOffsetEnd). End = inlineOffsetEnd = 3.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 1, config);
    editor = home(editor, config);
    expect(editor.selection.focus.offset).toBe(0); // logical start, NOT 3

    editor = end(editor, config);
    expect(editor.selection.focus.offset).toBe(3); // logical end, NOT 0
  });
});

describe("MOVE_LINE_BOUNDARY — caretAffinity (direction-independent: Home→after, End→before)", () => {
  it("LTR Home sets affinity 'after', End sets 'before'", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 1, config);
    editor = home(editor, config);
    expect(editor.caretAffinity).toBe("after");

    editor = end(editor, config);
    expect(editor.caretAffinity).toBe("before");
  });

  it("RTL Home sets affinity 'after', End sets 'before' (same values as LTR)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 1, config);
    editor = home(editor, config);
    expect(editor.caretAffinity).toBe("after");

    editor = end(editor, config);
    expect(editor.caretAffinity).toBe("before");
  });
});

describe("MOVE_LINE_BOUNDARY — RTL caret renders at the correct visual edge", () => {
  it("RTL Home renders at the visual-RIGHT edge; End renders at the visual-LEFT edge", () => {
    // "אבג" at 8px/char → run x[0,24]. Logical start (offset 0) sits at the RTL
    // run's RIGHT edge (24); logical end (offset 3) sits at the LEFT edge (0).
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "אבג", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 1, config);
    editor = home(editor, config);
    const xHome = caretX(editor, config);

    editor = caretAt(editor, pid, 1, config);
    editor = end(editor, config);
    const xEnd = caretX(editor, config);

    // Visual-right (Home) is strictly greater than visual-left (End).
    expect(xHome).toBeGreaterThan(xEnd);
    expect(xHome).toBe(24); // right edge of the RTL run
    expect(xEnd).toBe(0); // left edge of the RTL run
  });
});

describe("MOVE_LINE_BOUNDARY — affinity lifecycle (survives reset; cleared by edit)", () => {
  it("MOVE_LINE_BOUNDARY is in actionManagesCaretAffinity — affinity survives the central reset", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = home(editor, config);
    // The reducer ran its central reset but kept the handler-set affinity.
    expect(editor.caretAffinity).toBe("after");
  });

  it("a subsequent edit clears caretAffinity (central reset)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = home(editor, config);
    expect(editor.caretAffinity).toBe("after");
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(editor.caretAffinity).toBeUndefined();
  });
});

describe("EXPAND_LINE_BOUNDARY — Shift+Home/End (focus to boundary, anchor fixed, focus affinity set)", () => {
  it("Shift+End extends focus to inlineOffsetEnd, keeps anchor, sets affinity 'before'", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 1, config);
    const anchor = editor.selection.anchor;
    editor = shiftEnd(editor, config);
    expect(editor.selection.anchor).toEqual(anchor); // anchor fixed
    expect(editor.selection.focus).toEqual(createPosition(pid, 3)); // logical end
    expect(editor.caretAffinity).toBe("before");
  });

  it("Shift+Home extends focus to inlineOffsetStart, keeps anchor, sets affinity 'after'", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);

    editor = caretAt(editor, pid, 2, config);
    const anchor = editor.selection.anchor;
    editor = shiftHome(editor, config);
    expect(editor.selection.anchor).toEqual(anchor); // anchor fixed
    expect(editor.selection.focus).toEqual(createPosition(pid, 0)); // logical start
    expect(editor.caretAffinity).toBe("after");
  });

  it("EXPAND_LINE_BOUNDARY affinity survives the reset and is cleared by a later edit", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 1, config);
    editor = shiftEnd(editor, config);
    expect(editor.caretAffinity).toBe("before");
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "x" }, config);
    expect(editor.caretAffinity).toBeUndefined();
  });
});
