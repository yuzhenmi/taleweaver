/**
 * Regression for the bidi Shift+Arrow visual-selection oscillation (#503): an RTL
 * Hebrew run embedded in an LTR paragraph ("ab זאב cd"). Pressing Shift+ArrowLeft
 * through the RTL run must GROW the highlighted region monotonically in VISUAL
 * order — never collapse to empty mid-word. Pre-fix (logical-range highlight) the
 * covered extent was `[min(offsetStart,offsetEnd), max(...))` which is EMPTY at
 * press 4 (focus logical offset returns to 3, the anchor's offset → `[3,3)`),
 * so the whole-word highlight vanished and reappeared.
 *
 * The fix (slice 5) reads `EditorState.anchorAffinity` / `caretAffinity` to render
 * the VISUAL extent between the anchor's and the focus's resolved visual coords —
 * a single contiguous interval that only grows. This test drives the REAL reducer
 * end-to-end and derives the covered x-extent via `computeSelectionRects`, the
 * user's exact path.
 *
 * Slice 4 already seeds/persists `anchorAffinity`; slice 5 makes the geometry
 * read it. The transparency test pins that a PURE-LTR selection (no affinity →
 * undefined → logical path) is byte-identical to the four-arg logical output.
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
  computeSelectionRects,
  adaptShaperToMeasurer,
  type TextMeasurer,
  type EditorConfig,
  type EditorState,
  type BlockId,
} from "../../index";
import { positionTreeForTest } from "../../test-utils/position-tree";
import type { SelectionRect } from "../../cursor/selection-geometry";

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

function expandBack(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "EXPAND_SELECTION", direction: "backward" }, config);
}
function expandFwd(editor: EditorState, config: EditorConfig): EditorState {
  return reduceEditor(editor, { type: "EXPAND_SELECTION", direction: "forward" }, config);
}

const sharedMeasurer: TextMeasurer = adaptShaperToMeasurer(createMockShaper(8, 16));

/**
 * The covered visual x-extent of the current selection: `[lo, hi]` = the
 * min `rect.x` and max `rect.x + rect.width` across the visual-extent rects,
 * threading the editor's anchor/focus affinities (the user's exact path).
 * Returns `{ lo, hi }`; an empty rect-set is `{ lo: NaN, hi: NaN }`.
 */
function coveredExtent(editor: EditorState): { lo: number; hi: number; rects: SelectionRect[] } {
  const positioned = positionTreeForTest(editor.layoutTree);
  const rects = computeSelectionRects(
    editor.state,
    editor.selection,
    positioned,
    sharedMeasurer,
    editor.anchorAffinity,
    editor.caretAffinity,
  );
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < lo) lo = r.x;
    if (r.x + r.width > hi) hi = r.x + r.width;
  }
  return rects.length === 0 ? { lo: NaN, hi: NaN, rects } : { lo, hi, rects };
}

describe("EXPAND_SELECTION — visual-extent through an RTL run in LTR text (#503)", () => {
  // "ab זאב cd", 8px/glyph. Logical: a0 b1 sp2 ז3 א4 ב5 sp6 c7 d8.
  // Hebrew run [3,6) RTL. Visual L→R: a[0] b[8] sp[16] ב[24] א[32] ז[40] sp[48] c[56] d[64].
  // Hebrew run's visual extent is [24, 48].

  it("Shift+ArrowLeft from the Hebrew run's right edge grows monotonically — never empty at press 4", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "ab זאב cd", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 3, config);
    editor = { ...editor, caretAffinity: "after" };

    const extents: Array<{ lo: number; hi: number }> = [];
    for (let press = 0; press < 7; press++) {
      editor = expandBack(editor, config);
      const { lo, hi } = coveredExtent(editor);
      extents.push({ lo, hi });
    }

    // Press 4 (index 3) is the fix: the LOGICAL path gives `[3,3)` = EMPTY; the
    // VISUAL-extent path gives the whole Hebrew word `[24,48]`.
    expect(extents[3].hi - extents[3].lo).toBeGreaterThan(0);

    // By press 3 (index 2) the whole Hebrew run [24,48] is covered.
    expect(extents[2].lo).toBeLessThanOrEqual(24 + 1e-6);
    expect(extents[2].hi).toBeGreaterThanOrEqual(48 - 1e-6);

    // MONOTONE: each press is a SUPERSET of the previous (lo non-increasing, hi
    // non-decreasing) — the highlight only grows.
    for (let i = 1; i < extents.length; i++) {
      expect(extents[i].lo).toBeLessThanOrEqual(extents[i - 1].lo + 1e-6);
      expect(extents[i].hi).toBeGreaterThanOrEqual(extents[i - 1].hi - 1e-6);
    }
  });

  it("Shift+ArrowRight from the Hebrew run's left edge grows monotonically — mirror", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "ab זאב cd", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 6, config);
    editor = { ...editor, caretAffinity: "before" };

    const extents: Array<{ lo: number; hi: number }> = [];
    for (let press = 0; press < 7; press++) {
      editor = expandFwd(editor, config);
      const { lo, hi } = coveredExtent(editor);
      extents.push({ lo, hi });
    }

    // No press collapses to empty.
    for (const e of extents) expect(e.hi - e.lo).toBeGreaterThan(0);

    // The whole Hebrew run [24,48] is covered once the focus has crossed it.
    expect(extents[2].lo).toBeLessThanOrEqual(24 + 1e-6);
    expect(extents[2].hi).toBeGreaterThanOrEqual(48 - 1e-6);

    // MONOTONE growth.
    for (let i = 1; i < extents.length; i++) {
      expect(extents[i].lo).toBeLessThanOrEqual(extents[i - 1].lo + 1e-6);
      expect(extents[i].hi).toBeGreaterThanOrEqual(extents[i - 1].hi - 1e-6);
    }
  });

  it("pure-LTR EXPAND is byte-identical to the four-arg logical path (transparency)", () => {
    const config = makeConfig();
    let editor = type(createInitialEditorState(config), "abc", config);
    const pid = paragraphId(editor);
    editor = caretAt(editor, pid, 0, config);

    // EXPAND forward twice → focus at offset 2; anchorAffinity stays undefined
    // (a pure-LTR line never seeds a meaningful affinity), so the geometry takes
    // the LOGICAL path.
    editor = expandFwd(editor, config);
    editor = expandFwd(editor, config);
    expect(editor.anchorAffinity).toBeUndefined();

    const positioned = positionTreeForTest(editor.layoutTree);
    // Four-arg (no affinity) logical output.
    const logical = computeSelectionRects(
      editor.state,
      editor.selection,
      positioned,
      sharedMeasurer,
    );
    // Six-arg with the editor's (undefined) affinities → must be identical.
    const withAffinity = computeSelectionRects(
      editor.state,
      editor.selection,
      positioned,
      sharedMeasurer,
      editor.anchorAffinity,
      editor.caretAffinity,
    );
    expect(withAffinity).toEqual(logical);
    expect(logical.length).toBe(1);
    expect(logical[0].x).toBe(0);
    expect(logical[0].width).toBe(16); // "ab" → 16px
  });
});
