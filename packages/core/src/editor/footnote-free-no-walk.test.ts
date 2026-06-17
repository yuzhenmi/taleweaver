/**
 * FN-8 (footnote-free no-op): the per-cycle rebuild path must NOT run the
 * O(N_blocks) `collectFootnoteAnchors` document walk when the document has no
 * footnotes — the dominant case. The guard is `docHasFootnotes` (O(1), cached
 * embed-content root-id set); an empty anchor list is the identical result the
 * walk would have produced.
 *
 * Phase 0b: `reduceEditor` no longer renders (core is geometry-free; rendering
 * — including the anchor walk — relocated to the backend layout-driver). These
 * tests therefore drive `render(state, componentRegistry, attrRegistry, {prev,
 * prevState, dirtyIds: editor.lastDirtyIds})` DIRECTLY — the EXACT call the
 * driver's incremental cycle makes — and observe the walk being skipped vs
 * re-run via the cached anchor array: when the walk is skipped,
 * `rendered.footnoteAnchors === prev.footnoteAnchors` (the cached array is
 * reused by reference); when it re-runs, a FRESH array (`!==`) is produced.
 * That ref-equality is the faithful relocated observable for "skipped the walk".
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  componentRegistry,
  attrRegistry,
} from "./actions/test-helpers";
import { render, type RenderOutput } from "../render/render";
import type { State, BlockId } from "../state";

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
  });
}

describe("FN-8 — editor rebuild skips the anchor walk for footnote-free docs", () => {
  it("REUSES the cached anchor array during a footnote-free incremental update", () => {
    // A footnote-free doc: a plain text edit cannot change the (empty) anchor
    // list, so the walk must be skipped → the prev cycle's cached anchor array
    // is reused BY REFERENCE.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    const prevState = editor.state;
    const prev = renderFull(prevState);

    const after = reduceEditor(editor, { type: "INSERT_TEXT", text: "d" }, config);
    const rendered = renderIncrementalCycle(
      after.state,
      prev,
      prevState,
      after.lastDirtyIds ?? new Set<BlockId>(),
    );
    expect(rendered.footnoteAnchors).toBe(prev.footnoteAnchors);
  });

  it("RE-WALKS (fresh anchor array) when an edit changes the anchor set", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    const hostId = editor.selection.focus.blockId;
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // INSERT_FOOTNOTE drops the caret into the footnote body; move it back into
    // the main host paragraph (after "abc" + anchor → offset 4) so the next
    // INSERT_FOOTNOTE lands in body text and genuinely ADDS a second anchor —
    // the edit that must re-walk (adding an anchor invalidates the cache).
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

    const after = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    const rendered = renderIncrementalCycle(
      after.state,
      prev,
      prevState,
      after.lastDirtyIds ?? new Set<BlockId>(),
    );
    expect(rendered.footnoteAnchors).not.toBe(prev.footnoteAnchors);
  });

  it("REUSES the cached anchors when typing in a footnote body (anchors unchanged)", () => {
    // FN-8 footnote-BEARING reuse: a doc WITH a footnote, edited where no anchor
    // changes (typing into the footnote body), must REUSE the cached anchors —
    // the per-cycle O(N_blocks) walk is skipped even though the doc has
    // footnotes.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    // Caret is inside the footnote body after INSERT_FOOTNOTE.
    const prevState = editor.state;
    const prev = renderFull(prevState);

    const after = reduceEditor(editor, { type: "INSERT_TEXT", text: "d" }, config);
    const rendered = renderIncrementalCycle(
      after.state,
      prev,
      prevState,
      after.lastDirtyIds ?? new Set<BlockId>(),
    );
    expect(rendered.footnoteAnchors).toBe(prev.footnoteAnchors);
  });
});
