/**
 * C.1b-T4: `SECTION_BREAK` editor action + `handleSectionBreak`.
 *
 * Wires the Layer-3 `applySectionBreak` op into the editor reducer. The
 * break splits the document root's children into FLAT `section` blocks at
 * the cursor's boundary block, collapses the cursor to the first leaf of
 * the boundary subtree, and rebuilds render/cascade/layout.
 *
 * No-op contract (Decision 5 / T7): breaking at the FIRST child of the
 * container would create an empty leading section, so `applySectionBreak`
 * returns the input `state` reference unchanged; the handler short-circuits
 * and returns the original editor.
 */
import { describe, it, expect } from "vitest";
import { config, measurer, reduceEditor } from "./test-helpers";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory } from "../../state";
import type { BlockId, State } from "../../state";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/state-builders";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "@taleweaver/print";

/**
 * Phase 0b: core's `EditorState` is geometry-free — the layout tree lives in the
 * backend driver. This runs core's `render → cascadePass → layoutTree` pipeline
 * directly (what the driver does) so a test can prove the post-break document
 * still lays out without error.
 */
function layoutOf(state: State): unknown {
  const rendered = render(state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  return layoutTree(cascaded, config.containerWidth, measurer, config.pageConfig);
}

/**
 * Build a multi-paragraph editor `document → [p1, p2, p3, p4]` with the
 * cursor collapsed at the start of `cursorBlock`. Phase 0b: the EditorState is
 * geometry-free (no render/cascade/layout fields).
 */
function makeEditor(cursorBlock: BlockId): EditorState {
  const initialState = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p1",
        lastChildId: "p4",
      }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p1",
        nextSiblingId: "p3",
        inlineContent: inlineContent([text("two")]),
      }),
      buildBlock({
        id: "p3",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p2",
        nextSiblingId: "p4",
        inlineContent: inlineContent([text("three")]),
      }),
      buildBlock({
        id: "p4",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p3",
        inlineContent: inlineContent([text("four")]),
      }),
    ],
  });
  const cursor = { blockId: cursorBlock, offset: 0 };
  return {
    state: initialState,
    selection: { anchor: cursor, focus: cursor },
    history: createHistory(initialState),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

/** Ordered list of the document root's direct children. */
function rootChildren(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(editor.state, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

describe("handleSectionBreak — SECTION_BREAK action", () => {
  it("breaks the doc into two flat sections at the cursor's boundary (cursor in p3)", () => {
    const initial = makeEditor("p3" as BlockId);

    const next = reduceEditor(initial, { type: "SECTION_BREAK" }, config);

    // T7 (positive direction): a real break produces a NEW state reference.
    expect(next.state).not.toBe(initial.state);

    // Root now has exactly two children, both `section` blocks.
    const children = rootChildren(next);
    expect(children).toHaveLength(2);
    for (const id of children) {
      expect(getBlock(next.state, id)?.type).toBe("section");
    }

    // Leading section holds [p1, p2]; trailing section holds [p3, p4].
    const [secA, secB] = children;
    expect(getBlock(next.state, "p1" as BlockId)?.parentId).toBe(secA);
    expect(getBlock(next.state, "p2" as BlockId)?.parentId).toBe(secA);
    expect(getBlock(next.state, "p3" as BlockId)?.parentId).toBe(secB);
    expect(getBlock(next.state, "p4" as BlockId)?.parentId).toBe(secB);

    // Cursor collapses to the first leaf of the boundary (p3 is a leaf → p3).
    expect(next.selection.focus).toEqual({ blockId: "p3" as BlockId, offset: 0 });
    expect(next.selection.anchor).toEqual({ blockId: "p3" as BlockId, offset: 0 });

    // The post-break document lays out without error (driver-equivalent pipeline).
    expect(layoutOf(next.state)).toBeDefined();
  });

  it("is a no-op when the cursor is in the first child (would create an empty leading section)", () => {
    const initial = makeEditor("p1" as BlockId);

    const next = reduceEditor(initial, { type: "SECTION_BREAK" }, config);

    // T7 identity: state reference unchanged, selection unchanged.
    expect(next.state).toBe(initial.state);
    expect(next.selection).toBe(initial.selection);
    // Root children are still the original paragraphs (no sections).
    expect(rootChildren(next)).toEqual([
      "p1" as BlockId,
      "p2" as BlockId,
      "p3" as BlockId,
      "p4" as BlockId,
    ]);
  });
});
