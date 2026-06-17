/**
 * FN-8 (footnote-BEARING incremental): a document WITH footnotes must NOT
 * re-walk all N blocks every keystroke. The full anchor list (its document
 * order, hence numbering) only changes when an edit adds, removes, or moves an
 * anchor-bearing block — and every such block is in `dirtyIds`. So a plain text
 * edit to a NON-anchor block can REUSE the previous render cycle's cached
 * anchors + numbers instead of running the O(N_blocks) `collectFootnoteAnchors`
 * walk.
 *
 * Phase 0b: `reduceEditor` no longer produces a `renderOutput` (core is
 * geometry-free; render moved to the print backend's layout-driver). These
 * tests therefore drive `render(state, componentRegistry, attrRegistry, {prev,
 * prevState, dirtyIds: editor.lastDirtyIds})` DIRECTLY — the EXACT call the
 * driver's incremental cycle makes — and OBSERVE the walk being skipped (the
 * win) vs re-run (correctness) via the cached anchor array: when the walk is
 * skipped, `rendered.footnoteAnchors === prev.footnoteAnchors` (the cached array
 * is reused by reference); when it re-runs, a FRESH array (`!==`) is produced.
 * That ref-equality is the faithful relocated observable for "skipped the walk"
 * (it is exactly the gate `footnoteAnchorsUnchanged` controls). Numbering
 * correctness is asserted via the cycle's `rendered.footnoteNumbers` map and the
 * footnote-body leading marker baked into `rendered.embedContents`.
 *
 * Migrated from `packages/core/src/render/footnote-anchor-reuse.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  render,
  type EditorConfig,
  type State,
  type BlockId,
  type RenderOutput,
} from "@taleweaver/core";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = {
  componentRegistry,
  attrRegistry,
  containerWidth: 200,
};

/** A FULL render of `state` (the driver's first / non-incremental cycle). */
function renderFull(state: State): RenderOutput {
  return render(state, componentRegistry, attrRegistry);
}

/**
 * One INCREMENTAL render — the exact call the layout-driver makes after a
 * dispatch: prev render output + prev state + the dispatch's `lastDirtyIds`.
 */
function renderIncrementalCycle(
  state: State,
  prev: RenderOutput,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
): RenderOutput {
  return render(state, componentRegistry, attrRegistry, {
    prev,
    prevState,
    dirtyIds,
    suggestionView: prev.suggestionView,
  });
}

describe("FN-8 — footnote-bearing incremental skips the anchor walk when no anchor changed", () => {
  it("REUSES the cached anchor array for a text edit to a NON-anchor block (walk skipped)", () => {
    // Doc with a footnote anchor on paragraph 1, then a second paragraph.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "xyz" }, config);
    const prevState = editor.state;
    const prev = renderFull(prevState);

    // Cursor is now in the SECOND paragraph (no anchor). Typing there cannot
    // change the anchor list, so the walk must be skipped → the prev cycle's
    // cached anchor array is reused BY REFERENCE.
    const after = reduceEditor(editor, { type: "INSERT_TEXT", text: "d" }, config);
    const rendered = renderIncrementalCycle(after.state, prev, prevState, after.lastDirtyIds ?? new Set<BlockId>());
    expect(rendered.footnoteAnchors).toBe(prev.footnoteAnchors);
  });

  it("RE-WALKS (fresh anchor array) when an edit ADDS a footnote", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    const hostId = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // After INSERT_FOOTNOTE the caret is inside the footnote BODY — a second
    // INSERT_FOOTNOTE there is refused (no footnotes-in-footnotes). Move the
    // caret back into the main host paragraph (after "abc" + anchor → offset 4)
    // so the second insert lands in body text.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: hostId, offset: 4 },
          focus: { blockId: hostId, offset: 4 },
        },
      },
      config,
    );
    const prevState = editor.state;
    const prev = renderFull(prevState);

    // The doc already has a footnote; inserting a SECOND one must re-walk
    // (the dirty block gains a new anchor → rule 2).
    const after = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    const rendered = renderIncrementalCycle(after.state, prev, prevState, after.lastDirtyIds ?? new Set<BlockId>());
    expect(rendered.footnoteAnchors).not.toBe(prev.footnoteAnchors);
    // Both footnotes are numbered (1 and 2) in the cycle's map.
    const formattedValues = [...rendered.footnoteNumbers.values()]
      .map((n) => n.formatted)
      .sort();
    expect(formattedValues).toEqual(["1", "2"]);
  });

  it("RE-WALKS when an edit DELETES the anchor (and renumbers)", () => {
    // Two footnotes across two paragraphs; delete the SECOND anchor; the first
    // stays numbered "1" and the deleting edit must re-walk.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
    const firstHost = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // Back to main doc (after "a" + anchor → offset 2), new paragraph, 2nd fn.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: firstHost, offset: 2 },
          focus: { blockId: firstHost, offset: 2 },
        },
      },
      config,
    );
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
    const secondHost = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    expect(secondHost).not.toBe(firstHost);
    // Caret to right after the SECOND anchor ("b" + anchor → offset 2) and
    // backspace it out.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: secondHost, offset: 2 },
          focus: { blockId: secondHost, offset: 2 },
        },
      },
      config,
    );
    const prevState = editor.state;
    const prev = renderFull(prevState);

    const after = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);
    const rendered = renderIncrementalCycle(after.state, prev, prevState, after.lastDirtyIds ?? new Set<BlockId>());
    expect(rendered.footnoteAnchors).not.toBe(prev.footnoteAnchors);
    // Exactly one anchor remains, still numbered "1".
    const formattedValues = [...rendered.footnoteNumbers.values()].map((n) => n.formatted);
    expect(formattedValues).toEqual(["1"]);
  });

  it("RE-WALKS when editing the anchor's OWN host block text", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    const hostId = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // INSERT_FOOTNOTE drops the caret into the body; move it back into the
    // anchor's HOST block ("abc" + anchor → offset 4). Typing there dirties the
    // anchor-bearing block → rule 2 forces a recompute (the dirty block carries
    // the anchor, so the cached list cannot be reused).
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: hostId, offset: 4 },
          focus: { blockId: hostId, offset: 4 },
        },
      },
      config,
    );
    const prevState = editor.state;
    const prev = renderFull(prevState);

    const after = reduceEditor(editor, { type: "INSERT_TEXT", text: "z" }, config);
    const rendered = renderIncrementalCycle(after.state, prev, prevState, after.lastDirtyIds ?? new Set<BlockId>());
    expect(rendered.footnoteAnchors).not.toBe(prev.footnoteAnchors);
  });

  it("re-renders footnote BODY slot numbers (not just call markers) when an insert renumbers (render-audit I1)", () => {
    // Build two footnotes across two paragraphs (fn1 on para 1, fn2 on para 2).
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
    const firstHost = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: firstHost, offset: 2 },
          focus: { blockId: firstHost, offset: 2 },
        },
      },
      config,
    );
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);

    // Insert a NEW footnote at the very start of para 1 — BEFORE fn1's anchor —
    // bumping the existing footnotes 1→2 and 2→3. fn2's host is NOT dirty (only
    // renumbered), so its body slot is a prime stale-reuse candidate.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: firstHost, offset: 0 },
          focus: { blockId: firstHost, offset: 0 },
        },
      },
      config,
    );
    const prevState = editor.state;
    const prev = renderFull(prevState);

    const after = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    const rendered = renderIncrementalCycle(after.state, prev, prevState, after.lastDirtyIds ?? new Set<BlockId>());

    // Invariant: every footnote body's RENDERED leading number (markerText,
    // baked from ctx.footnoteNumber at render time) must track its current
    // number. The body marker is the bare call-marker number plus the list-
    // style "." suffix (decimal default), so it reads `${formatted}.`. A stale
    // reused body node keeps the OLD number while the numbers map + call marker
    // show the new one — the render-audit I1 bug.
    expect(rendered.footnoteNumbers.size).toBe(3);
    for (const [contentBlockId, number] of rendered.footnoteNumbers) {
      const body = rendered.embedContents.get(contentBlockId);
      if (body === undefined || body.type !== "element") {
        throw new Error(`expected an element body node for ${contentBlockId}`);
      }
      expect(body.style.markerText).toBe(`${number.formatted}.`);
    }
  });

  it("reuses CORRECT numbers across a skipped (reused) cycle", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
    const firstHost = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // Back to main doc, new paragraph, second footnote.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: firstHost, offset: 2 },
          focus: { blockId: firstHost, offset: 2 },
        },
      },
      config,
    );
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
    const secondHost = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // Move caret to a third, anchor-free paragraph and type — reused cycle.
    editor = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: secondHost, offset: 2 },
          focus: { blockId: secondHost, offset: 2 },
        },
      },
      config,
    );
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    const prevState = editor.state;
    const prev = renderFull(prevState);

    const after = reduceEditor(editor, { type: "INSERT_TEXT", text: "c" }, config);
    const rendered = renderIncrementalCycle(after.state, prev, prevState, after.lastDirtyIds ?? new Set<BlockId>());
    // Walk skipped (anchor-free dirty block) → cached anchor array reused.
    expect(rendered.footnoteAnchors).toBe(prev.footnoteAnchors);
    // The reused numbering map still has both footnotes numbered 1 and 2.
    const formattedValues = [...rendered.footnoteNumbers.values()]
      .map((n) => n.formatted)
      .sort();
    expect(formattedValues).toEqual(["1", "2"]);
  });
});
