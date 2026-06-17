// packages/core/src/editor/actions/header-boundary-guards.test.ts
//
// C.2c T7e: §6 boundary edge-case guards for editing in a header/footer body.
//
// A header/footer body is an ISOLATED editing context (Google Docs convention):
//   (A) Cross-CONTEXT selection refusal — a selection whose anchor and focus
//       live in DIFFERENT contexts (e.g. anchor in a header body, focus in the
//       main doc — constructable via a drag from header into body) must be
//       REFUSED: the edit handlers no-op rather than attempt a cross-tree
//       delete. The signal is `selectionContextOf(state, anchor.blockId) !==
//       selectionContextOf(state, focus.blockId)`.
//   (B) Backspace-at-header-start no-op — Backspace at offset 0 of a header
//       body's FIRST block, and forward-delete at the END of its last block,
//       must be no-ops (the body is isolated; there is no main-tree block to
//       merge with).
//
// SAME-context expanded selections (wholly within the header body, or wholly
// in the main doc) are NORMAL and must still work — only DIFFERENT contexts
// are refused.
//
// NO-REGRESSION for the main tree: main-tree expanded-selection delete,
// backspace-at-doc-start, and cross-block merges stay byte-identical (asserted
// here + the existing editor-flow / section-* suites).

import { describe, it, expect } from "vitest";
import { reduceEditor, type EditorState, type EditorConfig } from "../editor-state";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import {
  createHistory,
  createPosition,
  createSpan,
  getBlock,
  getTemplateContent,
} from "../../state";
import type { State, BlockId, Position } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = {
  componentRegistry,
  attrRegistry,
  containerWidth: 600,
};

const HDR_P1 = "hdr-c1" as BlockId;
const HDR_P2 = "hdr-c2" as BlockId;
const BODY_P1 = "p" as BlockId;
const BODY_P2 = "p2" as BlockId;

/**
 * A document with TWO main body paragraphs ("body text" / "more body") plus a
 * header template body in templateContents: a container ROOT (parentId null)
 * with two child paragraphs ("alpha" / "beta"). Two body paragraphs give a
 * same-context cross-block selection to exercise in the main tree; two header
 * children give a same-context cross-block selection inside the header body.
 */
function buildStateWithHeaderBody(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p2" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("body text")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p",
        inlineContent: inlineContent([text("more body")]),
      }),
    ],
    templateContents: [
      buildBlock({
        id: "hdr-root",
        type: "document",
        parentId: null,
        firstChildId: "hdr-c1",
        lastChildId: "hdr-c2",
      }),
      buildBlock({
        id: "hdr-c1",
        type: "paragraph",
        parentId: "hdr-root",
        nextSiblingId: "hdr-c2",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "hdr-c2",
        type: "paragraph",
        parentId: "hdr-root",
        prevSiblingId: "hdr-c1",
        inlineContent: inlineContent([text("beta")]),
      }),
    ],
  });
}

/**
 * Build a geometry-free EditorState (Phase 0b) with an arbitrary SELECTION. The
 * cross-context guards these tests exercise read no layout.
 */
function buildEditorWithSelection(state: State, anchor: Position, focus: Position): EditorState {
  return {
    state,
    selection: createSpan(anchor, focus),
    history: createHistory(state),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

function buildEditor(state: State, caret: Position): EditorState {
  return buildEditorWithSelection(state, caret, caret);
}

function joinText(
  items: ReadonlyArray<{ kind: string; text?: string }> | undefined,
): string {
  return (items ?? [])
    .map((i) => (i.kind === "text" ? (i as { text: string }).text : ""))
    .join("");
}

function headerText(state: State, id: BlockId): string {
  return joinText(getTemplateContent(state, id)?.inlineContent?.items);
}

function bodyText(state: State, id: BlockId): string {
  return joinText(getBlock(state, id)?.inlineContent?.items);
}

/** A whole-document text snapshot for byte-identity assertions. */
function docSnapshot(state: State): string {
  return [
    `body[p]=${bodyText(state, BODY_P1)}`,
    `body[p2]=${bodyText(state, BODY_P2)}`,
    `hdr[c1]=${headerText(state, HDR_P1)}`,
    `hdr[c2]=${headerText(state, HDR_P2)}`,
  ].join("|");
}

// ════════════════════════════════════════════════════════════════════
// (A) Cross-CONTEXT selection refusal — anchor in header, focus in body.
// ════════════════════════════════════════════════════════════════════
describe("C.2c T7e — cross-context selection is REFUSED (no-op)", () => {
  // anchor in header body, focus in main body — a span no editing op supports.
  const crossAnchor = (): Position => createPosition(HDR_P1, 2); // inside "alpha"
  const crossFocus = (): Position => createPosition(BODY_P1, 3); // inside "body text"

  it("DELETE_BACKWARD over a cross-context selection no-ops (document byte-identical)", () => {
    const editor = buildEditorWithSelection(buildStateWithHeaderBody(), crossAnchor(), crossFocus());
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(next.state).toBe(editor.state); // identity: state object unchanged
    expect(docSnapshot(next.state)).toBe(before);
    expect(next.selection).toBe(editor.selection);
  });

  it("DELETE_FORWARD over a cross-context selection no-ops (document byte-identical)", () => {
    const editor = buildEditorWithSelection(buildStateWithHeaderBody(), crossAnchor(), crossFocus());
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
  });

  it("SPLIT_NODE (Enter) over a cross-context selection no-ops (document byte-identical)", () => {
    const editor = buildEditorWithSelection(buildStateWithHeaderBody(), crossAnchor(), crossFocus());
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
  });

  it("INSERT_TEXT (typing over a cross-context selection) no-ops (document byte-identical)", () => {
    const editor = buildEditorWithSelection(buildStateWithHeaderBody(), crossAnchor(), crossFocus());
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
  });

  it("is refused regardless of anchor/focus order (focus in header, anchor in body)", () => {
    // Reverse: anchor in main body, focus in header — still cross-context.
    const editor = buildEditorWithSelection(
      buildStateWithHeaderBody(),
      createPosition(BODY_P1, 3),
      createPosition(HDR_P1, 2),
    );
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
  });
});

// ════════════════════════════════════════════════════════════════════
// SAME-context expanded selections still work — NO false refusal.
// ════════════════════════════════════════════════════════════════════
describe("C.2c T7e — same-context expanded selections are NOT refused", () => {
  it("expanded selection WHOLLY within the header body deletes (cross-block, T7c path)", () => {
    // anchor at "al|pha" (offset 2 of c1) → focus at "be|ta" (offset 2 of c2).
    const editor = buildEditorWithSelection(
      buildStateWithHeaderBody(),
      createPosition(HDR_P1, 2),
      createPosition(HDR_P2, 2),
    );
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // The selected range across the two header paragraphs is deleted and they
    // merge: "al" + "ta" = "alta" in c1, c2 consumed.
    expect(headerText(next.state, HDR_P1)).toBe("alta");
    expect(getTemplateContent(next.state, HDR_P2)).toBeNull();
    expect(next.state).not.toBe(editor.state);
    // Main body untouched.
    expect(bodyText(next.state, BODY_P1)).toBe("body text");
    expect(bodyText(next.state, BODY_P2)).toBe("more body");
  });

  it("expanded selection WHOLLY within the header body accepts typing (replaceRange)", () => {
    const editor = buildEditorWithSelection(
      buildStateWithHeaderBody(),
      createPosition(HDR_P1, 1),
      createPosition(HDR_P1, 4),
    );
    // "alpha", replace offsets 1..4 ("lph") with "X" → "aXa".
    const next = reduceEditor(editor, { type: "INSERT_TEXT", text: "X" }, config);
    expect(headerText(next.state, HDR_P1)).toBe("aXa");
    expect(next.state).not.toBe(editor.state);
  });

  it("expanded selection WHOLLY within the main body deletes (no-regression)", () => {
    // anchor at "body |text" (offset 5 of p) → focus at "more| body" (offset 4 of p2).
    const editor = buildEditorWithSelection(
      buildStateWithHeaderBody(),
      createPosition(BODY_P1, 5),
      createPosition(BODY_P2, 4),
    );
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // Cross-block delete + merge: "body " + " body" = "body  body" in p.
    expect(bodyText(next.state, BODY_P1)).toBe("body  body");
    expect(getBlock(next.state, BODY_P2)).toBeNull();
    expect(next.state).not.toBe(editor.state);
    // Header untouched.
    expect(headerText(next.state, HDR_P1)).toBe("alpha");
    expect(headerText(next.state, HDR_P2)).toBe("beta");
  });
});

// ════════════════════════════════════════════════════════════════════
// (B) Backspace-at-header-start / forward-delete-at-header-end no-op.
// ════════════════════════════════════════════════════════════════════
describe("C.2c T7e — header-body boundary collapses are no-ops", () => {
  it("Backspace at offset 0 of the header body's FIRST block is a no-op (no merge into main)", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), createPosition(HDR_P1, 0));
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
    // Header body intact, NOT merged into any main block.
    expect(headerText(next.state, HDR_P1)).toBe("alpha");
    expect(headerText(next.state, HDR_P2)).toBe("beta");
    expect(bodyText(next.state, BODY_P1)).toBe("body text");
  });

  it("Forward-delete at END of the header body's LAST block is a no-op (does not pull main content in)", () => {
    // caret at end of "beta" (offset 4 of c2).
    const editor = buildEditor(buildStateWithHeaderBody(), createPosition(HDR_P2, 4));
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
    expect(headerText(next.state, HDR_P1)).toBe("alpha");
    expect(headerText(next.state, HDR_P2)).toBe("beta");
    expect(bodyText(next.state, BODY_P1)).toBe("body text");
  });
});

// ════════════════════════════════════════════════════════════════════
// NO-REGRESSION: main-tree doc-start backspace stays a no-op (control).
// ════════════════════════════════════════════════════════════════════
describe("C.2c T7e — main-tree boundary no-regression", () => {
  it("Backspace at offset 0 of the main doc's FIRST block is a no-op", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), createPosition(BODY_P1, 0));
    const before = docSnapshot(editor.state);
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    expect(next.state).toBe(editor.state);
    expect(docSnapshot(next.state)).toBe(before);
  });
});
