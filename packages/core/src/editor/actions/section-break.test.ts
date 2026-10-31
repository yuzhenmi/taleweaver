/**
 * C.1b-T4: `SECTION_BREAK` editor action + `handleSectionBreak`.
 *
 * Wires the Layer-3 `applySectionBreak` op into the editor reducer. (Word)
 * The break is a split of the caret's paragraph whose head ends a
 * new section; the caret stays at the start of the tail.
 */
import { describe, it, expect } from "vitest";
import { config, measurer, reduceEditor } from "./test-helpers";
import { createEditorStateFromState, type EditorState } from "../editor-state";
import { getBlock } from "../../state";
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
  return createEditorStateFromState(initialState, { anchor: cursor, focus: cursor }, config);
}

/** Ordered list of a block's direct children (the root's: its sections). */
function childrenOf(editor: EditorState, id: BlockId = editor.document.rootId): BlockId[] {
  const root = getBlock(editor.document, id);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(editor.document, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

describe("handleSectionBreak — SECTION_BREAK action", () => {
  it("breaks the doc into two flat sections at the cursor's boundary (cursor in p3)", () => {
    const initial = makeEditor("p3" as BlockId);

    const next = reduceEditor(initial, { type: "SECTION_BREAK" });

    // Positive direction: a real break produces a NEW state reference.
    expect(next.document).not.toBe(initial.document);

    // Root now has exactly two children, both `section` blocks.
    const children = childrenOf(next);
    expect(children).toHaveLength(2);
    for (const id of children) {
      expect(getBlock(next.document, id)?.type).toBe("section");
    }

    // (Word) the break is a SPLIT of p3 at 0 whose head H (a new,
    // empty paragraph) carries the section end. Leading section = [p1, p2, H];
    // the final section keeps [p3, p4].
    const [secA, secB] = children;
    const leading = childrenOf(next, secA as BlockId);
    expect(leading.slice(0, 2)).toEqual(["p1", "p2"]);
    expect(leading).toHaveLength(3);
    const head = leading[2] as BlockId;
    expect(getBlock(next.document, head)?.inlineContent?.items).toEqual([]);
    expect(childrenOf(next, secB as BlockId)).toEqual(["p3", "p4"]);

    // Cursor stays at the start of the tail (p3).
    expect(next.selection.focus).toEqual({ blockId: "p3" as BlockId, offset: 0 });
    expect(next.selection.anchor).toEqual({ blockId: "p3" as BlockId, offset: 0 });

    // The post-break document lays out without error (driver-equivalent pipeline).
    expect(layoutOf(next.document)).toBeDefined();
  });

  it("a break at the start of the first paragraph leaves an empty paragraph carrying it (Word)", () => {
    // a section always holds ≥ 1 paragraph — the one its section end
    // terminates — so a break at (p1, 0) no longer has to be refused: the split's
    // empty head is the leading section's paragraph.
    const initial = makeEditor("p1" as BlockId);

    const next = reduceEditor(initial, { type: "SECTION_BREAK" });

    const [secA, secB] = childrenOf(next);
    const leading = childrenOf(next, secA as BlockId);
    expect(leading).toHaveLength(1);
    expect(getBlock(next.document, leading[0] as BlockId)?.inlineContent?.items).toEqual([]);
    expect(childrenOf(next, secB as BlockId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(next.selection.focus).toEqual({ blockId: "p1" as BlockId, offset: 0 });
  });
});
