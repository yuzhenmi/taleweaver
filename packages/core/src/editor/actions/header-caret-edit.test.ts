// packages/core/src/editor/actions/header-caret-edit.test.ts
//
// C.2c T7d: a MID-header caret keystroke (backspace / forward-delete / Enter)
// must flow through the editor-action HANDLERS to the (map-agnostic, T7a-c) ops
// and mutate the templateContents header body.
//
// Before T7d the handlers read the cursor/anchor/focus/prev/next block with
// `getBlock(editor.state, id)` (MAIN map only) to make their merge/split
// decisions. For a header caret `getBlock` returned null, so the handler
// short-circuited to a no-op BEFORE reaching the Layer-3 op — for DELETE_FORWARD
// at any offset, for Enter/SPLIT, and for DELETE_BACKWARD at offset 0 (the
// cross-block branch). (The MID-block DELETE_BACKWARD path — offset > 0 — was
// already tree-agnostic pre-T7d: it routes straight through `moveByCharacter` +
// `deleteRange`, both migrated in T7a-c, and read no block via `getBlock`.) T7d
// migrates the handler reads to `resolveBlock(...)?.block ?? null`, so every
// header keystroke reaches the op and mutates templateContents.
//
// SCOPE (T7d only): a MID-header edit. The §6 boundary edge-cases
// (backspace-at-header-start no-op, cross-context-selection refusal) are T7e.
// These tests therefore keep the caret in the interior of the body and assert
// the content mutation via `getTemplateContent` (NOT `getBlock`).
//
// The NO-REGRESSION guard for the main tree is the existing
// delete-backward / delete-forward / split editor-behavior suites
// (editor-flows.test.ts + the section-* suites) — those must stay green.

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
import type { State, BlockId } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = {
  componentRegistry,
  attrRegistry,
  containerWidth: 600,
};

const HDR_ROOT = "hdr-root" as BlockId;
const HDR_P1 = "hdr-c1" as BlockId;
const HDR_P2 = "hdr-c2" as BlockId;
const BODY_P = "p" as BlockId;

/**
 * A document with a main body paragraph plus a header template body living in
 * templateContents: a container ROOT (parentId === null) with two child
 * paragraphs ("alpha", "beta"). Same fixture shape as
 * map-agnostic-structural-ops.test.ts so the structural ops have material for
 * split (Enter), merge (cross-block backspace), and mid-block edits. The root
 * uses `type: "document"` — a registered container component — because this
 * editor-behavior test renders through the full pipeline (the state-level
 * structural-ops test could use a bare `"header"` type since it never renders).
 */
function buildStateWithHeaderBody(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body text")]),
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
 * Build a geometry-free EditorState from a State with the caret at `caret`.
 * Phase 0b: the structural caret-edit handlers (split/merge inside a header
 * body) read only caret/selection/context state — no layout — so the synthetic
 * state needs only the geometry-free fields.
 */
function buildEditor(state: State, caret: { blockId: BlockId; offset: number }): EditorState {
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

describe("C.2c T7d — mid-header DELETE_BACKWARD reaches the op", () => {
  it("backspace after a char in a header paragraph deletes the preceding grapheme (in templateContents)", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 3 });
    // "alpha", caret after "alp" → backspace removes "p".
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // The header body block shrank — observable via getTemplateContent.
    expect(headerText(next.state, HDR_P1)).toBe("alha");
    // Caret moved back one grapheme, stayed in the header paragraph.
    expect(next.selection.focus.blockId).toBe(HDR_P1);
    expect(next.selection.focus.offset).toBe(2);
    // It actually mutated (not a no-op).
    expect(next.state).not.toBe(editor.state);
  });

  it("does NOT trigger the section-boundary merge for a header caret (routes to a content delete)", () => {
    // Caret at offset 0 of the SECOND header child. The cross-block-backspace
    // path runs (offset === 0), and it must MERGE the two header paragraphs via
    // the normal same-parent path — NOT fire the doc-root section-merge branch
    // (the header root is not a doc-root `section`). So the two header
    // paragraphs join in templateContents, and no main-tree section is touched.
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P2, offset: 0 });
    const next = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);

    // The two header paragraphs merged: "alpha" + "beta" = "alphabeta" in c1.
    expect(headerText(next.state, HDR_P1)).toBe("alphabeta");
    // c2 was consumed by the merge.
    expect(getTemplateContent(next.state, HDR_P2)).toBeNull();
    // Caret sits at the join point (end of original "alpha").
    expect(next.selection.focus.blockId).toBe(HDR_P1);
    expect(next.selection.focus.offset).toBe(5);
    // Main body paragraph is untouched (no spurious section op).
    expect(joinText(getBlock(next.state, BODY_P)?.inlineContent?.items)).toBe("body text");
  });
});

describe("C.2c T7d — mid-header DELETE_FORWARD reaches the op", () => {
  it("forward-delete before a char in a header paragraph removes that grapheme (in templateContents)", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 2 });
    // "alpha", caret after "al" → forward-delete removes "p".
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);

    expect(headerText(next.state, HDR_P1)).toBe("alha");
    // Caret stays put.
    expect(next.selection.focus.blockId).toBe(HDR_P1);
    expect(next.selection.focus.offset).toBe(2);
    expect(next.state).not.toBe(editor.state);
  });

  it("forward-delete at end of a header paragraph merges the next header paragraph in (not a section op)", () => {
    // Caret at end of the FIRST header child → forward-delete merges c2 into c1.
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 5 });
    const next = reduceEditor(editor, { type: "DELETE_FORWARD" }, config);

    expect(headerText(next.state, HDR_P1)).toBe("alphabeta");
    expect(getTemplateContent(next.state, HDR_P2)).toBeNull();
    expect(next.selection.focus.blockId).toBe(HDR_P1);
    expect(next.selection.focus.offset).toBe(5);
    // Main body untouched.
    expect(joinText(getBlock(next.state, BODY_P)?.inlineContent?.items)).toBe("body text");
  });
});

describe("C.2c T7d — mid-header SPLIT_NODE (Enter) reaches the op", () => {
  it("Enter mid-header-paragraph splits into two header paragraphs in templateContents; caret moves into the new one", () => {
    const editor = buildEditor(buildStateWithHeaderBody(), { blockId: HDR_P1, offset: 3 });
    // "alpha", caret after "alp" → split into "alp" | "ha".
    const next = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    // Original block keeps id + left half.
    expect(headerText(next.state, HDR_P1)).toBe("alp");
    // A NEW block was created in templateContents with the right half.
    const newId = getTemplateContent(next.state, HDR_P1)?.nextSiblingId;
    expect(newId).not.toBeNull();
    expect(newId).toBeDefined();
    if (newId === null || newId === undefined) return;
    // The new block lives in templateContents, NOT the main map.
    expect(getTemplateContent(next.state, newId)).not.toBeNull();
    expect(getBlock(next.state, newId)).toBeNull();
    expect(headerText(next.state, newId)).toBe("ha");
    // The new header paragraph's parent is the header root.
    expect(getTemplateContent(next.state, newId)?.parentId).toBe(HDR_ROOT);
    // Caret moved to the start of the new paragraph.
    expect(next.selection.focus.blockId).toBe(newId);
    expect(next.selection.focus.offset).toBe(0);
  });
});
