// packages/core/src/editor/actions/select-all.test.ts
//
// SELECT_ALL must respect the editing CONTEXT (body vs header/footer).
//
// A header/footer body is an ISOLATED editing context (same principle as #327
// line-navigation isolation and T7e cross-context refusal): arrow keys never
// carry the caret across the body↔header boundary, and SELECT_ALL highlights
// ONLY the context the caret is in.
//
//   1. Caret in the MAIN body  → all-span is the main tree's first→last leaf.
//   2. Caret in a header body  → all-span is THAT header body's first→last leaf
//                                ONLY (does NOT include the main body or footer).
//   3. Caret in a footer body  → footer body only.
//
// NO-REGRESSION: a main-only doc (no header/footer) → SELECT_ALL spans the whole
// main tree, exactly as before.
//
// Fixture shape mirrors header-caret-edit.test.ts (a CONTAINER header body with
// two paragraph children, per #326) so the header has multiple leaves and the
// span endpoints are unambiguous.

import { describe, it, expect } from "vitest";
import { reduceEditor, type EditorState, type EditorConfig } from "../editor-state";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import {
  createHistory,
  createPosition,
  createSpan,
  selectionContextOf,
} from "../../state";
import type { State, BlockId } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = {
  componentRegistry,
  attrRegistry,
  containerWidth: 600,
};

const BODY_P1 = "bp0" as BlockId;
const BODY_P2 = "bp1" as BlockId;
const HDR_ROOT = "hdr-root" as BlockId;
const HDR_P1 = "hdr-c1" as BlockId;
const HDR_P2 = "hdr-c2" as BlockId;
const FTR_ROOT = "ftr-root" as BlockId;
const FTR_P1 = "ftr-c1" as BlockId;

/**
 * A document with TWO main body paragraphs plus a header CONTAINER body (two
 * paragraphs) and a footer CONTAINER body (one paragraph), all living in
 * templateContents (parentId === null roots, per #326).
 */
function buildStateWithHeaderFooter(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "bp0", lastChildId: "bp1" }),
      buildBlock({
        id: "bp0",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "bp1",
        inlineContent: inlineContent([text("body one")]),
      }),
      buildBlock({
        id: "bp1",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "bp0",
        inlineContent: inlineContent([text("body two")]),
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
      buildBlock({
        id: "ftr-root",
        type: "document",
        parentId: null,
        firstChildId: "ftr-c1",
        lastChildId: "ftr-c1",
      }),
      buildBlock({
        id: "ftr-c1",
        type: "paragraph",
        parentId: "ftr-root",
        inlineContent: inlineContent([text("footer text")]),
      }),
    ],
  });
}

/** A main-only doc (no header/footer): two body paragraphs. */
function buildMainOnlyState(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "bp0", lastChildId: "bp1" }),
      buildBlock({
        id: "bp0",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "bp1",
        inlineContent: inlineContent([text("body one")]),
      }),
      buildBlock({
        id: "bp1",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "bp0",
        inlineContent: inlineContent([text("body two")]),
      }),
    ],
  });
}

function buildEditor(state: State, caret: { blockId: BlockId; offset: number }): EditorState {
  // Phase 0b: SELECT_ALL is context-aware but reads no layout — geometry-free.
  const cursor = createPosition(caret.blockId, caret.offset);
  return {
    state,
    selection: createSpan(cursor, cursor),
    history: createHistory(state),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

describe("SELECT_ALL — context-aware span", () => {
  it("caret in the MAIN body selects the whole main tree (first→last main leaf)", () => {
    const editor = buildEditor(buildStateWithHeaderFooter(), { blockId: BODY_P1, offset: 2 });
    const next = reduceEditor(editor, { type: "SELECT_ALL" }, config);

    const { anchor, focus } = next.selection;
    // Both endpoints are MAIN-tree blocks.
    expect(anchor.blockId).toBe(BODY_P1);
    expect(anchor.offset).toBe(0);
    expect(focus.blockId).toBe(BODY_P2);
    expect(focus.offset).toBe("body two".length);
    // The whole span is in the main context.
    expect(selectionContextOf(next.state, anchor.blockId)).toBe(next.state.rootId);
    expect(selectionContextOf(next.state, focus.blockId)).toBe(next.state.rootId);
    // Does NOT touch the header/footer.
    expect(anchor.blockId).not.toBe(HDR_P1);
    expect(focus.blockId).not.toBe(HDR_P2);
    expect(focus.blockId).not.toBe(FTR_P1);
  });

  it("caret in a HEADER body selects ONLY that header (first→last header leaf)", () => {
    const editor = buildEditor(buildStateWithHeaderFooter(), { blockId: HDR_P1, offset: 1 });
    const next = reduceEditor(editor, { type: "SELECT_ALL" }, config);

    const { anchor, focus } = next.selection;
    // Both endpoints are in the HEADER body.
    expect(anchor.blockId).toBe(HDR_P1);
    expect(anchor.offset).toBe(0);
    expect(focus.blockId).toBe(HDR_P2);
    expect(focus.offset).toBe("beta".length);
    // Whole span is in the header context, NOT the main body.
    expect(selectionContextOf(next.state, anchor.blockId)).toBe(HDR_ROOT);
    expect(selectionContextOf(next.state, focus.blockId)).toBe(HDR_ROOT);
    expect(selectionContextOf(next.state, anchor.blockId)).not.toBe(next.state.rootId);
    // Does NOT include the main body or the footer.
    expect(anchor.blockId).not.toBe(BODY_P1);
    expect(focus.blockId).not.toBe(BODY_P2);
    expect(focus.blockId).not.toBe(FTR_P1);
  });

  it("caret in a FOOTER body selects ONLY that footer", () => {
    const editor = buildEditor(buildStateWithHeaderFooter(), { blockId: FTR_P1, offset: 3 });
    const next = reduceEditor(editor, { type: "SELECT_ALL" }, config);

    const { anchor, focus } = next.selection;
    expect(anchor.blockId).toBe(FTR_P1);
    expect(anchor.offset).toBe(0);
    expect(focus.blockId).toBe(FTR_P1);
    expect(focus.offset).toBe("footer text".length);
    expect(selectionContextOf(next.state, anchor.blockId)).toBe(FTR_ROOT);
    expect(selectionContextOf(next.state, focus.blockId)).toBe(FTR_ROOT);
    // Does NOT include the main body or the header.
    expect(anchor.blockId).not.toBe(BODY_P1);
    expect(focus.blockId).not.toBe(HDR_P2);
  });

  it("NO-REGRESSION: main-only doc spans the whole main tree", () => {
    const editor = buildEditor(buildMainOnlyState(), { blockId: BODY_P1, offset: 1 });
    const next = reduceEditor(editor, { type: "SELECT_ALL" }, config);

    const { anchor, focus } = next.selection;
    expect(anchor.blockId).toBe(BODY_P1);
    expect(anchor.offset).toBe(0);
    expect(focus.blockId).toBe(BODY_P2);
    expect(focus.offset).toBe("body two".length);
  });
});
