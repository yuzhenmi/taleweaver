/**
 * FN-6.3: render threads the DOCUMENT-LEVEL footnote numbering policy (read
 * from the root block's raw attrs via `documentFootnotePolicy`) instead of a
 * hardcoded continuous-decimal default. This test drives the real editor to
 * build a footnote-bearing document, then renders states whose ROOT carries a
 * policy attr, asserting:
 *
 *   1. restart-per-section actually restarts numbering at a section boundary
 *      (distinct from continuous) — proves the policy is read, not ignored.
 *   2. restart-per-page falls back to continuous in render (no pageAssignment
 *      available) WITHOUT throwing — the documented FN-6.3 → FN-6.4 phasing.
 *   3. The FN-8 anchor/number cache is INVALIDATED when the root (policy-bearing)
 *      block is dirty: changing the policy through an incremental cycle
 *      recomputes the numbering map rather than reusing the stale one.
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import {
  config,
  componentRegistry,
  attrRegistry,
  createInitialEditorState,
  reduceEditor,
} from "../editor/actions/test-helpers";
import { mergeBlockAttrs } from "../state";
import type { State, BlockId } from "../state";
import type { RenderOutput } from "./render";

/** Render `state` fully (no incremental options). */
function fullRender(state: State): RenderOutput {
  return render(state, componentRegistry, attrRegistry);
}

/** Set a policy attr on the document root, returning new state + dirtyIds. */
function setRootPolicy(
  state: State,
  attrs: Record<string, unknown>,
): { state: State; dirtyIds: ReadonlySet<BlockId> } {
  const result = mergeBlockAttrs(state, state.rootId, attrs, attrRegistry);
  return { state: result.state, dirtyIds: result.dirtyIds };
}

/**
 * Build a two-section document, each section's paragraph carrying a footnote.
 * Returns the editor (its `state` + `renderOutput`) plus the two footnote-body
 * (contentBlock) ids in document order.
 */
function twoSectionDocWithFootnotes() {
  let editor = createInitialEditorState(config);
  // Section 1: a paragraph with a footnote.
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "a" }, config);
  const firstHost = editor.selection.focus.blockId;
  editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
  // Back into the host paragraph (after "a" + anchor → offset 2).
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
  // New paragraph, then a SECTION break so the next paragraph is in section 2.
  editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
  editor = reduceEditor(editor, { type: "SECTION_BREAK" }, config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "b" }, config);
  const secondHost = editor.selection.focus.blockId;
  editor = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
  return { editor, firstHost, secondHost };
}

describe("FN-6.3 — render threads documentFootnotePolicy", () => {
  it("defaults to continuous when the root has no policy attrs", () => {
    const { editor } = twoSectionDocWithFootnotes();
    const out = fullRender(editor.state);
    const values = [...out.footnoteNumbers.values()]
      .map((n) => n.value)
      .sort((x, y) => x - y);
    // Continuous: 1, 2 across both sections.
    expect(values).toEqual([1, 2]);
  });

  it("restart-per-section restarts numbering at the section boundary", () => {
    const { editor } = twoSectionDocWithFootnotes();
    const { state } = setRootPolicy(editor.state, {
      footnoteNumberingReset: "restart-per-section",
    });
    const out = fullRender(state);
    const values = [...out.footnoteNumbers.values()].map((n) => n.value).sort();
    // Each section's footnote is "1" — distinct from continuous's [1, 2].
    expect(values).toEqual([1, 1]);
  });

  it("restart-per-page falls back to continuous in render WITHOUT throwing", () => {
    const { editor } = twoSectionDocWithFootnotes();
    const { state } = setRootPolicy(editor.state, {
      footnoteNumberingReset: "restart-per-page",
    });
    let out: RenderOutput | undefined;
    expect(() => {
      out = fullRender(state);
    }).not.toThrow();
    const values = [...(out?.footnoteNumbers.values() ?? [])]
      .map((n) => n.value)
      .sort((x, y) => x - y);
    // Falls back to continuous (1, 2) until FN-6.4 supplies per-page numbers.
    expect(values).toEqual([1, 2]);
  });

  it("formats numbers using the document format attr", () => {
    const { editor } = twoSectionDocWithFootnotes();
    const { state } = setRootPolicy(editor.state, {
      footnoteNumberingFormat: "lower-roman",
    });
    const out = fullRender(state);
    const formatted = [...out.footnoteNumbers.values()]
      .map((n) => n.formatted)
      .sort();
    expect(formatted).toEqual(["i", "ii"]);
  });
});

describe("FN-6.3 — FN-8 cache invalidates on a policy change (root dirty)", () => {
  it("recomputes numbers when the root policy changes through an incremental cycle", () => {
    const { editor } = twoSectionDocWithFootnotes();
    // Baseline full render under the default (continuous) policy: numbers 1, 2.
    const prev = fullRender(editor.state);
    const before = [...prev.footnoteNumbers.values()]
      .map((n) => n.value)
      .sort((x, y) => x - y);
    expect(before).toEqual([1, 2]);

    // Flip the policy to restart-per-section by editing the ROOT block's attrs.
    // The root is the ONLY dirty block, and it carries NO footnote anchor and is
    // not a section — so without the `dirtyIds.has(rootId)` FN-8 fix, the
    // anchor/number cache would be (wrongly) reused and numbers would stay 1, 2.
    const { state, dirtyIds } = setRootPolicy(editor.state, {
      footnoteNumberingReset: "restart-per-section",
    });
    const out = render(state, componentRegistry, attrRegistry, {
      prev,
      prevState: editor.state,
      dirtyIds,
    });
    const after = [...out.footnoteNumbers.values()].map((n) => n.value).sort();
    // Recomputed under restart-per-section: both footnotes are "1".
    expect(after).toEqual([1, 1]);
  });
});
