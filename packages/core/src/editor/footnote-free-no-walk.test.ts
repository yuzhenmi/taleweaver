/**
 * FN-8 (footnote-free no-op): the per-keystroke editor rebuild path
 * (`helpers.ts` `rebuildTrees` → and the initial build in `editor-state.ts`)
 * must NOT run the O(N_blocks) `collectFootnoteAnchors` document walk when the
 * document has no footnotes — the dominant case. The guard is `docHasFootnotes`
 * (O(1), cached embed-content root-id set); an empty anchor list is the
 * identical result the walk would have produced.
 *
 * The optimization is output-invisible (a footnote-free doc already produced an
 * empty anchor list / numbering map), so this proves it by observing that
 * `collectFootnoteAnchors` is NOT invoked for a footnote-free update and IS
 * invoked once the document has a footnote.
 */
import { describe, it, expect, vi } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
} from "./actions/test-helpers";
import * as footnotesModule from "../footnotes";

describe("FN-8 — editor rebuild skips the anchor walk for footnote-free docs", () => {
  it("does NOT call collectFootnoteAnchors during a footnote-free incremental update", () => {
    const initial = createInitialEditorState(config);
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    // A plain text edit on a footnote-free document drives the per-keystroke
    // rebuild (render incremental + editor rebuildTrees) — both anchor-walk
    // call sites are now guarded by docHasFootnotes, so neither fires.
    reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("DOES call collectFootnoteAnchors when an edit changes the anchor set", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const hostId = typed.selection.focus.blockId;
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
    // INSERT_FOOTNOTE drops the caret into the footnote body; move it back into
    // the main host paragraph (after "abc" + anchor → offset 4) so the next
    // INSERT_FOOTNOTE lands in body text and genuinely ADDS a second anchor —
    // the edit that must re-walk (FN-8 reuses the anchors only when no anchor
    // changed; adding one invalidates the cache).
    const backInBody = reduceEditor(
      withFn,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: hostId, offset: 4 },
          focus: { blockId: hostId, offset: 4 },
        },
      },
      config,
    );
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    reduceEditor(backInBody, { type: "INSERT_FOOTNOTE" }, config);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does NOT call collectFootnoteAnchors when typing in a footnote body (anchors unchanged)", () => {
    // FN-8 footnote-BEARING reuse: a doc WITH a footnote, edited where no anchor
    // changes (typing into the footnote body), must REUSE the cached anchors —
    // the per-keystroke O(N_blocks) walk is skipped even though the doc has
    // footnotes.
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
    // Caret is inside the footnote body after INSERT_FOOTNOTE.
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    reduceEditor(withFn, { type: "INSERT_TEXT", text: "d" }, config);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
