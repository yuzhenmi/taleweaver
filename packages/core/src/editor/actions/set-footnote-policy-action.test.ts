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
import type { EditorConfig, EditorState } from "../editor-state";
import { createMockShaper } from "../../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";
import { createHistory, createPosition, createSpan } from "../../state";
import type { State, BlockId } from "../../state";
import type { PageConfig } from "../../layout/page-config";
import type { ElementBox } from "../../render/render-node";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../../test-utils/state-builders";

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

/** The sorted footnote VALUES from a rendered editor's numbering map. */
function numberValues(editor: EditorState): number[] {
  return [...editor.renderOutput.footnoteNumbers.values()]
    .map((n) => n.value)
    .sort((x, y) => x - y);
}

/** The sorted footnote FORMATTED strings from a rendered editor. */
function numberFormats(editor: EditorState): string[] {
  return [...editor.renderOutput.footnoteNumbers.values()]
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
    expect(numberFormats(next)).toEqual(["i.", "ii."]);
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
    // No valid field → no-op: same editor reference, policy unchanged.
    expect(next).toBe(editor);
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
    // mergeBlockAttrs is a no-op → handler returns the input editor unchanged.
    expect(again).toBe(withReset);
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

// ---------------------------------------------------------------------------
// Restart-per-page end-to-end: the ACTION → FN-6.4 second pass → display.
// Needs a paginated editor (a pageConfig small enough to push two footnotes
// onto two pages). Built straight from a multi-page footnote State, then the
// policy is flipped through `reduceEditor`.
// ---------------------------------------------------------------------------

const measurer = createMockShaper(8, 16);

// 80px content/page ⇒ 5 single-line (16px) paragraphs per page (no margins).
const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 80,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function paginatedConfig(): EditorConfig {
  return {
    measurer,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 600,
    pageConfig: PAGE_CONFIG,
  };
}

/** A footnote body (container root + paragraph leaf). */
function footnoteBody(rootId: string, leafId: string, leafText: string) {
  return [
    buildBlock({
      id: rootId,
      type: "footnote-body",
      firstChildId: leafId,
      lastChildId: leafId,
    }),
    buildBlock({
      id: leafId,
      type: "paragraph",
      parentId: rootId,
      inlineContent: inlineContent([text(leafText)]),
    }),
  ];
}

/**
 * Build a multi-page main-document State: paragraphs p0..p6 under a `document`
 * root, p0 carrying footnote fn0 and p5 carrying fn1 (so the two anchors land
 * on distinct pages). No policy attr → continuous by default.
 */
function twoFootnotesTwoPages(): State {
  const ids = ["p0", "p1", "p2", "p3", "p4", "p5", "p6"];
  const anchors: Record<string, string> = { p0: "fn0", p5: "fn1" };
  const blocks = [
    buildBlock({
      id: "doc",
      type: "document",
      firstChildId: ids[0],
      lastChildId: ids[ids.length - 1],
    }),
  ];
  ids.forEach((id, i) => {
    const items =
      anchors[id] !== undefined
        ? [text("x"), embed("footnote-anchor", { contentBlockId: anchors[id] })]
        : [text("x")];
    blocks.push(
      buildBlock({
        id,
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: i > 0 ? ids[i - 1] : null,
        nextSiblingId: i < ids.length - 1 ? ids[i + 1] : null,
        inlineContent: inlineContent(items),
      }),
    );
  });
  return buildState({
    rootId: "doc",
    blocks,
    embedContents: [
      ...footnoteBody("fn0", "fn0-p", "first"),
      ...footnoteBody("fn1", "fn1-p", "second"),
    ],
  });
}

/** Build a full paginated EditorState from a State. */
function buildEditorFull(state: State, cfg: EditorConfig): EditorState {
  const rendered = render(state, cfg.componentRegistry, cfg.attrRegistry);
  const cascadedRoot = cascadePass(rendered.root);
  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of rendered.embedContents) {
    const cascaded = cascadePass(body);
    if (cascaded.type !== "element") {
      throw new Error(`buildEditorFull: footnote body "${id}" is not an element`);
    }
    cascadedEmbedContents.set(id, cascaded);
  }
  const layout = layoutTree(
    cascadedRoot,
    cfg.containerWidth,
    measurer,
    cfg.pageConfig,
  );
  const cursor = createPosition("p0" as BlockId, 0);
  return {
    state,
    selection: createSpan(cursor, cursor),
    history: createHistory(state),
    renderTree: rendered.root,
    renderOutput: rendered,
    cascadedRoot,
    cascadedTemplateContents: new Map(),
    cascadedEmbedContents,
    layoutTree: layout,
    containerWidth: cfg.containerWidth,
    targetX: null,
  };
}

describe("handleSetFootnotePolicy — restart-per-page end-to-end (action → FN-6.4 → display)", () => {
  it("restart-per-page: the page-2 footnote renders 1 (NOT its continuous number 2)", () => {
    const cfg = paginatedConfig();
    const editor = buildEditorFull(twoFootnotesTwoPages(), cfg);

    // Baseline continuous: fn0 → 1, fn1 → 2.
    expect(editor.renderOutput.footnoteNumbers.get("fn0" as BlockId)?.formatted).toBe("1.");
    expect(editor.renderOutput.footnoteNumbers.get("fn1" as BlockId)?.formatted).toBe("2.");

    const next = reduceEditor(
      editor,
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-page" },
      cfg,
    );

    // The policy is written, and FN-6.4's per-page second pass restarts the
    // page-2 footnote to "1".
    expect(documentFootnotePolicy(next.state).reset).toBe("restart-per-page");
    expect(next.renderOutput.footnoteNumbers.get("fn0" as BlockId)?.formatted).toBe("1.");
    expect(next.renderOutput.footnoteNumbers.get("fn1" as BlockId)?.formatted).toBe("1.");
  });
});
