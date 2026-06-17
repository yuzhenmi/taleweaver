/**
 * FN-6.3 final — `SET_FOOTNOTE_POLICY` editor action + handler.
 *
 * Dispatching SET_FOOTNOTE_POLICY writes the document-wide footnote numbering
 * policy (`footnoteNumberingReset` / `footnoteNumberingFormat`) onto the
 * document ROOT block. The policy is read back by `documentFootnotePolicy`,
 * threaded by render, and DISPLAYED:
 *  - `restart-per-section` restarts numbering at each section boundary;
 *  - `lower-roman` (etc.) changes the displayed format;
 *  - `restart-per-page` runs FN-6.4's layout-dependent second pass so the
 *    page-2 footnote restarts at "1".
 *
 * Tests run through the real `reduceEditor`. The section/format/undo/no-op
 * cases use a non-paginated two-section fixture; the restart-per-page case
 * drives a paginated editor built straight from a multi-page footnote State.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
} from "./test-helpers";
import { documentFootnotePolicy } from "../../footnotes";
import type { EditorState } from "../editor-state";
import { render } from "../../render/render";
import type { State, BlockId } from "../../state";

// Phase 0b: core's `EditorState` carries NO render output. The policy WRITE is a
// geometry-free core action (it stamps `footnoteNumberingReset`/`Format` on the
// document root, read back by `documentFootnotePolicy`). The displayed NUMBERS
// are a render-pass product — so these tests run `render(state, ...)` directly
// (what the backend driver does) to assert the numbering map the policy drives.
// The layout-dependent restart-per-page DISPLAY (FN-6.4's second pass) lives in
// the print backend; its end-to-end action→display coverage is the dom
// `footnote-restart-per-page.test.ts`.
function footnoteNumbersOf(state: State): ReadonlyMap<BlockId, { value: number; formatted: string }> {
  return render(state, config.componentRegistry, config.attrRegistry).footnoteNumbers;
}

/**
 * Build a two-section document (non-paginated config), each section's paragraph
 * carrying a footnote. Mirrors `render/footnote-policy-threading.test.ts`.
 */
function twoSectionDocWithFootnotes(): EditorState {
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
  editor = reduceEditor(editor, { type: "SECTION_BREAK" }, config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
  editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
  return editor;
}

/** The sorted footnote VALUES from an editor's render-derived numbering map. */
function numberValues(editor: EditorState): number[] {
  return [...footnoteNumbersOf(editor.state).values()]
    .map((n) => n.value)
    .sort((x, y) => x - y);
}

/** The sorted footnote FORMATTED strings from an editor's render-derived map. */
function numberFormats(editor: EditorState): string[] {
  return [...footnoteNumbersOf(editor.state).values()]
    .map((n) => n.formatted)
    .sort();
}

describe("handleSetFootnotePolicy — SET_FOOTNOTE_POLICY", () => {
  it("reset: restart-per-section writes the policy AND restarts numbering at the section boundary", () => {
    const editor = twoSectionDocWithFootnotes();
    // Baseline: continuous default → 1, 2 across both sections.
    expect(documentFootnotePolicy(editor.state).reset).toBe("continuous");
    expect(numberValues(editor)).toEqual([1, 2]);

    const next = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-section" },
      config,
    );

    // The policy attr is now on the root, and numbering restarts: each
    // section's footnote is "1".
    expect(documentFootnotePolicy(next.state).reset).toBe("restart-per-section");
    expect(numberValues(next)).toEqual([1, 1]);
    // A real change happened (new state reference).
    expect(next.state).not.toBe(editor.state);
  });

  it("format: lower-roman changes only the format; numbers render i, ii", () => {
    const editor = twoSectionDocWithFootnotes();
    const next = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", format: "lower-roman" },
      config,
    );

    expect(documentFootnotePolicy(next.state).format).toBe("lower-roman");
    // reset untouched (still continuous): values 1, 2 formatted i, ii.
    expect(documentFootnotePolicy(next.state).reset).toBe("continuous");
    expect(numberFormats(next)).toEqual(["i", "ii"]);
  });

  it("sets reset and format INDEPENDENTLY — setting one leaves the other untouched", () => {
    const editor = twoSectionDocWithFootnotes();
    const withReset = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-section" },
      config,
    );
    // Now set ONLY the format; reset must stay restart-per-section.
    const withFormat = reduceEditor(
      withReset,
      { type: "SET_FOOTNOTE_POLICY", format: "upper-alpha" },
      config,
    );
    expect(documentFootnotePolicy(withFormat.state).reset).toBe(
      "restart-per-section",
    );
    expect(documentFootnotePolicy(withFormat.state).format).toBe("upper-alpha");
  });

  it("undo restores the prior policy AND the prior numbering", () => {
    const editor = twoSectionDocWithFootnotes();
    const next = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-section" },
      config,
    );
    expect(documentFootnotePolicy(next.state).reset).toBe("restart-per-section");
    expect(numberValues(next)).toEqual([1, 1]);

    const undone = reduceEditor(next, { type: "UNDO" }, config);
    // Policy back to the default (continuous), numbering back to 1, 2.
    expect(documentFootnotePolicy(undone.state).reset).toBe("continuous");
    expect(numberValues(undone)).toEqual([1, 2]);
  });

  it("an invalid reset value is ignored (no-op, editor unchanged)", () => {
    const editor = twoSectionDocWithFootnotes();
    const next = reduceEditor(
      editor,
      // Force an out-of-set value past the type via a cast on the action shape.
      {
        type: "SET_FOOTNOTE_POLICY",
        reset: "restart-per-paragraph" as never,
      },
      config,
    );
    // No valid field → no-op: the document `state` is untouched (same reference,
    // no history commit). The editor WRAPPER may differ only by the reducer's
    // Phase 0b entry-clear of `lastDirtyIds` — so assert on `state` identity, the
    // real "nothing was written" signal, not the wrapper reference.
    expect(next.state).toBe(editor.state);
    expect(documentFootnotePolicy(next.state).reset).toBe("continuous");
  });

  it("setting the SAME value already on the root is a no-op (same editor reference)", () => {
    const editor = twoSectionDocWithFootnotes();
    const withReset = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-section" },
      config,
    );
    const again = reduceEditor(
      withReset,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-section" },
      config,
    );
    // mergeBlockAttrs is a no-op → no document mutation, no history commit. The
    // `state` reference is preserved; the editor wrapper may differ only by the
    // reducer's Phase 0b entry-clear of `lastDirtyIds`.
    expect(again.state).toBe(withReset.state);
  });

  it("selection is unchanged across a policy change", () => {
    const editor = twoSectionDocWithFootnotes();
    const before = editor.selection;
    const next = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", format: "upper-roman" },
      config,
    );
    expect(next.selection.anchor.blockId).toBe(before.anchor.blockId);
    expect(next.selection.anchor.offset).toBe(before.anchor.offset);
    expect(next.selection.focus.blockId).toBe(before.focus.blockId);
    expect(next.selection.focus.offset).toBe(before.focus.offset);
  });
});
