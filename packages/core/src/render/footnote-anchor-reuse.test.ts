/**
 * FN-8 (footnote-BEARING incremental): a document WITH footnotes must NOT
 * re-walk all N blocks every keystroke. The full anchor list (its document
 * order, hence numbering) only changes when an edit adds, removes, or moves an
 * anchor-bearing block — and every such block is in `dirtyIds`. So a plain text
 * edit to a NON-anchor block can REUSE the previous render cycle's cached
 * anchors + numbers instead of running the O(N_blocks) `collectFootnoteAnchors`
 * walk.
 *
 * These tests drive the real editor (`reduceEditor`) and spy on
 * `collectFootnoteAnchors` to observe the walk being skipped (the win) and
 * correctly RE-run on edits that could change the anchor list (correctness).
 * Numbering correctness is asserted via the cached `renderOutput.footnoteNumbers`
 * map (the cycle's authoritative anchor→number map, reused or recomputed).
 */
import { describe, it, expect, vi } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
} from "../editor/actions/test-helpers";
import * as footnotesModule from "../footnotes";

describe("FN-8 — footnote-bearing incremental skips the anchor walk when no anchor changed", () => {
  it("does NOT call collectFootnoteAnchors for a text edit to a NON-anchor block", () => {
    // Doc with a footnote anchor on paragraph 1, then a second paragraph.
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "abc" }, config);
    editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "xyz" }, config);
    // Cursor is now in the SECOND paragraph (no anchor). Typing there cannot
    // change the anchor list, so the walk must be skipped.
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    reduceEditor(editor, { type: "INSERT_TEXT", text: "d" }, config);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("DOES call collectFootnoteAnchors when an edit ADDS a footnote", () => {
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
    // The doc already has a footnote; inserting a SECOND one must re-walk
    // (the dirty block gains a new anchor → rule 2).
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    const after = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    // Both footnotes are numbered (1 and 2) in the cached map.
    const formattedValues = [...after.renderOutput.footnoteNumbers.values()]
      .map((n) => n.formatted)
      .sort();
    expect(formattedValues).toEqual(["1", "2"]);
  });

  it("DOES call collectFootnoteAnchors when an edit DELETES the anchor (and renumbers)", () => {
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
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    const after = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    // Exactly one anchor remains, still numbered "1".
    const formattedValues = [...after.renderOutput.footnoteNumbers.values()].map(
      (n) => n.formatted,
    );
    expect(formattedValues).toEqual(["1"]);
  });

  it("DOES call collectFootnoteAnchors when editing the anchor's OWN host block text", () => {
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
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    reduceEditor(editor, { type: "INSERT_TEXT", text: "z" }, config);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
    const after = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);

    // Invariant: every footnote body's RENDERED leading number (markerText,
    // baked from ctx.footnoteNumber at render time) must track its current
    // number. The body marker is the bare call-marker number plus the list-
    // style "." suffix (decimal default), so it reads `${formatted}.`. A stale
    // reused body node keeps the OLD number while the numbers map + call marker
    // show the new one — the render-audit I1 bug.
    expect(after.renderOutput.footnoteNumbers.size).toBe(3);
    for (const [contentBlockId, number] of after.renderOutput.footnoteNumbers) {
      const body = after.renderOutput.embedContents.get(contentBlockId);
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
    const spy = vi.spyOn(footnotesModule, "collectFootnoteAnchors");
    const after = reduceEditor(editor, { type: "INSERT_TEXT", text: "c" }, config);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    // The reused numbering map still has both footnotes numbered 1 and 2.
    const formattedValues = [...after.renderOutput.footnoteNumbers.values()]
      .map((n) => n.formatted)
      .sort();
    expect(formattedValues).toEqual(["1", "2"]);
  });
});
