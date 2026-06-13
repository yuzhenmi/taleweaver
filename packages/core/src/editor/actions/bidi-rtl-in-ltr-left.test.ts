/**
 * Regression for the bidi LEFT-arrow warp (#502): an RTL Hebrew run embedded in
 * an LTR paragraph (the example doc: "...oaks — זאב, the old tales...") and a
 * pure-RTL word. Pressing ArrowLeft on/within the RTL run must advance the caret
 * VISUALLY-LEFTWARD (its rendered x must move monotonically left), never warp
 * rightward.
 *
 * Two independent fixes are exercised here:
 *  1. In-run affinity (line-bidi): an RTL run reaching its visual-left edge must
 *     stay owned by THAT run (`"before"`), not flip onto the next run — fixing
 *     the WITHIN-line oscillation in an RTL-run-in-LTR-paragraph.
 *  2. Exit logical direction (moveVisually → handler): leaving a line on its
 *     visual edge steps `moveByCharacter` in the bidi-correct logical direction
 *     (visual-left of an RTL run = logical-FORWARD), fixing the pure-RTL warp.
 *
 * Drives the REAL reducer end-to-end and measures rendered caret-x via
 * resolvePixelPosition (threaded with the returned caretAffinity) — the user's
 * exact path.
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
  resolvePixelPosition,
  adaptShaperToMeasurer,
  type TextMeasurer,
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

function paragraphId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("test setup");
  return root.firstChildId;
}

function type(editor: EditorState, text: string, config: EditorConfig): EditorState {
  let cur = editor;
  for (const ch of text) {
    cur = reduceEditor(cur, { type: "INSERT_TEXT", text: ch }, config);
  }
  return cur;
}

function caretAt(
  editor: EditorState,
  blockId: BlockId,
  offset: number,
  config: EditorConfig,
): EditorState {
  const pos = createPosition(blockId, offset);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(pos, pos) }, config);
}

function left(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "backward" }, config);
}
function right(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "MOVE_CURSOR", direction: "forward" }, config);
}

const sharedMeasurer: TextMeasurer = adaptShaperToMeasurer(createMockShaper(8, 16));

/** Rendered caret x for the current collapsed caret, threading caretAffinity. */
function caretX(editor: EditorState): number {
  const px = resolvePixelPosition(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    sharedMeasurer,
    editor.caretPageHint,
    editor.caretAffinity,
  );
  if (px === null) throw new Error("no pixel position");
  return px.x;
}

/** Assert the caret-x sequence is non-increasing within `tol` (monotone left). */
function expectNonIncreasing(xs: readonly number[]): void {
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] + 1e-6);
  }
}
/** Assert the caret-x sequence is non-decreasing within `tol` (monotone right). */
function expectNonDecreasing(xs: readonly number[]): void {
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-6);
  }
}

describe("MOVE_CURSOR — RTL run inside LTR paragraph (#502)", () => {
  it("LEFT from the boundary owned by the Hebrew run steps monotonically left (no warp)", () => {
    // "ab זאב cd": "ab " [0,3) LTR, "זאב" [3,6) RTL, " cd" [6,9) LTR. Visual L→R:
    // a b _ ב א ז _ c d. Offset 3 with "after" affinity belongs to the Hebrew
    // run (its visual-RIGHT edge) — the state after walking RIGHT into the run.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "ab זאב cd", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 3, config);
    editor = { ...editor, caretAffinity: "after" };

    const xs: number[] = [caretX(editor)];
    for (let i = 0; i < 7; i++) {
      editor = left(editor, config);
      xs.push(caretX(editor));
    }
    // Pre-fix this oscillated 48→40→32→48(warp)→…; the fix makes it monotone.
    expectNonIncreasing(xs);
    // And it actually progresses past the Hebrew run to its visual left and beyond.
    expect(xs[xs.length - 1]).toBeLessThan(xs[0]);
  });

  it("LEFT from the LTR tail walks monotonically left across the whole line", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "ab זאב cd", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 9, config); // visual far right

    const xs: number[] = [caretX(editor)];
    for (let i = 0; i < 9; i++) {
      editor = left(editor, config);
      xs.push(caretX(editor));
    }
    expectNonIncreasing(xs);
  });
});

describe("MOVE_CURSOR — pure-RTL word in an LTR paragraph (#502 exit-direction)", () => {
  it("LEFT walks all the way through and STAYS at the visual-left edge (no warp back)", () => {
    // "זאב" is a single RTL run inside an LTR paragraph. Visual L→R: ב א ז.
    // logStart(0)=visual-RIGHT edge, logEnd(3)=visual-LEFT edge.
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "זאב", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config); // visual-right edge

    const xs: number[] = [caretX(editor)];
    const offsets: number[] = [editor.selection.focus.offset];
    for (let i = 0; i < 5; i++) {
      editor = left(editor, config);
      xs.push(caretX(editor));
      offsets.push(editor.selection.focus.offset);
    }
    // Monotone left through 0→1→2→3, then it must NOT warp back rightward (the
    // pre-fix bug stepped logical-backward at the visual-left edge → offset 2,
    // x jumped right). After reaching the visual-left edge it pins there.
    expectNonIncreasing(xs);
    expect(editor.selection.focus.offset).toBe(3); // logical end = visual-left edge
  });

  it("RIGHT walks monotonically right and STAYS at the visual-right edge (no warp back)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "זאב", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 3, config); // logical end = visual-left edge

    const xs: number[] = [caretX(editor)];
    for (let i = 0; i < 5; i++) {
      editor = right(editor, config);
      xs.push(caretX(editor));
    }
    // Pre-fix RIGHT oscillated 0↔1 forever; now it walks 3→2→1→0 (visual right)
    // and pins at the visual-right edge (offset 0).
    expectNonDecreasing(xs);
    expect(editor.selection.focus.offset).toBe(0);
  });
});
