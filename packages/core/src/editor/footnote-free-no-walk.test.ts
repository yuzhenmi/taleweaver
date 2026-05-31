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

  it("DOES call collectFootnoteAnchors once the document has a footnote", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
    // Spy AFTER the footnote exists; the next edit must walk anchors so the
    // marker numbering stays correct.
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    reduceEditor(withFn, { type: "INSERT_TEXT", text: "d" }, config);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
