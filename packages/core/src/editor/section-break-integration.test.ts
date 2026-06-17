/**
 * C.1b-T5: editor-level behavior + undo/redo integration test for
 * `SECTION_BREAK`.
 *
 * Validates Tasks 1–4 composed through the REAL editor + reducer + history
 * stack (per the project rule: caret/structure changes must be validated
 * end-to-end, not just at the unit level):
 *
 *   1. TRANSPARENCY — a `section` computes `display: contents`, so the four
 *      paragraphs lay out geometry-IDENTICALLY before and after the break.
 *      The created section ids appear in NO layout box.
 *   2. CURSOR — after the break the selection collapses to
 *      `{ firstLeafBlock(boundary), 0 }` (boundary = p3, a leaf → p3).
 *   3. UNDO — restores the original `[p1,p2,p3,p4]` doc-root structure (no
 *      sections) and the pre-break selection; geometry returns to original.
 *   4. REDO — re-applies the break (two sections, cursor at the new section
 *      start).
 */
import { describe, it, expect } from "vitest";
import { config, measurer, reduceEditor } from "./actions/test-helpers";
import type { EditorState } from "./editor-state";
import { getBlock, firstLeafBlock, createHistory } from "../state";
import type { State, BlockId } from "../state";
import { positionTreeForTest } from "@taleweaver/print";
import type { LayoutBox } from "@taleweaver/print";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import { render } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "@taleweaver/print";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Build a multi-paragraph editor `document → [p1, p2, p3, p4]` with the
 * cursor collapsed at the start of `cursorBlock`. Mirrors the up-front
 * render/cascade/layout the real `createInitialEditorState` performs.
 * (Copied verbatim from `actions/section-break.test.ts`.)
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
    caretPageHint: undefined,
    caretAffinity: undefined,
    anchorAffinity: undefined,
  };
}

/**
 * Materialize the editor's layout tree to a fully-positioned `LayoutBox`.
 * Phase 0b: core is geometry-free, so the test builds the layout tree itself
 * (render → cascade → layout, exactly what the backend driver does) from the
 * editor's `state` rather than reading a now-absent `editor.layoutTree`.
 */
function materialize(editor: EditorState): LayoutBox {
  const rendered = render(
    editor.state,
    config.componentRegistry,
    config.attrRegistry,
  );
  const cascadedRoot = cascadePass(rendered.root);
  const tree = layoutTree(
    cascadedRoot,
    config.containerWidth,
    measurer,
    config.pageConfig,
  );
  return positionTreeForTest(tree);
}

interface AbsBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Absolute box geometry for the box keyed `key`, summing parent-relative
 * `inlineOffset`/`blockOffset` up the tree to absolute logical coordinates.
 * Returns null if the key is not present anywhere in the tree.
 */
function absBox(root: LayoutBox, key: string): AbsBox | null {
  function walk(box: LayoutBox, accInline: number, accBlock: number): AbsBox | null {
    const inline = accInline + box.inlineOffset;
    const block = accBlock + box.blockOffset;
    if (box.key === key) {
      return { x: inline, y: block, w: box.inlineSize, h: box.blockSize };
    }
    if ("children" in box) {
      for (const c of box.children as readonly LayoutBox[]) {
        const found = walk(c, inline, block);
        if (found !== null) return found;
      }
    }
    return null;
  }
  return walk(root, 0, 0);
}

/** True iff any box in the tree has `key`. */
function anyBoxHasKey(box: LayoutBox, key: string): boolean {
  if (box.key === key) return true;
  if ("children" in box) {
    for (const c of box.children as readonly LayoutBox[]) {
      if (anyBoxHasKey(c, key)) return true;
    }
  }
  return false;
}

/** Ordered list of the document root's direct children. */
function rootChildIds(state: State): BlockId[] {
  const root = getBlock(state, state.rootId);
  if (root === null) return [];
  const ids: BlockId[] = [];
  let cur: BlockId | null = root.firstChildId;
  while (cur !== null) {
    ids.push(cur);
    const b = getBlock(state, cur);
    if (b === null) break;
    cur = b.nextSiblingId;
  }
  return ids;
}

const PARA_KEYS = ["p1", "p2", "p3", "p4"] as const;

/** Collect absolute geometry of every paragraph box, keyed by id. */
function paraGeometry(root: LayoutBox): Record<string, AbsBox | null> {
  const out: Record<string, AbsBox | null> = {};
  for (const k of PARA_KEYS) out[k] = absBox(root, k);
  return out;
}

describe("SECTION_BREAK — editor-level transparency + undo/redo integration", () => {
  it("lays out paragraphs geometry-identically before/after the break, collapses the cursor, and round-trips through undo/redo", () => {
    // ----- Setup: doc [p1,p2,p3,p4], cursor at start of p3 -----
    const before = makeEditor("p3" as BlockId);
    const beforeSelection = before.selection;

    // Boundary p3 is a leaf, so firstLeaf(p3) === p3.
    const boundary = "p3" as BlockId;
    expect(firstLeafBlock(before.state, boundary)).toBe("p3");

    const beforeLayout = materialize(before);
    const beforeGeom = paraGeometry(beforeLayout);
    // Sanity: all four paragraphs are present pre-break with real geometry.
    for (const k of PARA_KEYS) {
      expect(beforeGeom[k]).not.toBeNull();
    }
    // Non-degenerate guard: the paragraphs are genuinely STACKED (distinct
    // y-positions). Without this, a zeroed measurer that collapsed every box to
    // y:0 would let the transparency `toEqual` below pass vacuously. (Narrowing,
    // not `!`.)
    const p1Geom = beforeGeom["p1"];
    const p4Geom = beforeGeom["p4"];
    if (p1Geom == null || p4Geom == null) {
      throw new Error("section-break integration: degenerate pre-break geometry");
    }
    expect(p4Geom.y).toBeGreaterThan(p1Geom.y);

    // ----- 1. Dispatch SECTION_BREAK -----
    const after = reduceEditor(before, { type: "SECTION_BREAK" }, config);

    // A real break produced a new state reference.
    expect(after.state).not.toBe(before.state);

    // Root now has exactly two `section` children.
    const sectionIds = rootChildIds(after.state);
    expect(sectionIds).toHaveLength(2);
    for (const id of sectionIds) {
      expect(getBlock(after.state, id)?.type).toBe("section");
    }
    const secA = nth(sectionIds, 0, "section");
    const secB = nth(sectionIds, 1, "section");

    // ----- TRANSPARENCY: paragraph geometry identical before vs after -----
    const afterLayout = materialize(after);
    const afterGeom = paraGeometry(afterLayout);
    for (const k of PARA_KEYS) {
      expect(afterGeom[k]).not.toBeNull();
      expect(afterGeom[k]).toEqual(beforeGeom[k]);
    }

    // The created sections (display: contents) generate NO layout box.
    expect(anyBoxHasKey(afterLayout, secA)).toBe(false);
    expect(anyBoxHasKey(afterLayout, secB)).toBe(false);

    // ----- 2. CURSOR collapses to { firstLeaf(boundary)=p3, 0 } -----
    const expectedCursor = {
      blockId: firstLeafBlock(after.state, boundary) ?? boundary,
      offset: 0,
    };
    expect(expectedCursor).toEqual({ blockId: "p3" as BlockId, offset: 0 });
    expect(after.selection.focus).toEqual(expectedCursor);
    expect(after.selection.anchor).toEqual(expectedCursor);

    // ----- 3. UNDO: restore original structure + selection + geometry -----
    const undone = reduceEditor(after, { type: "UNDO" }, config);

    // Root children are the original paragraphs again — no sections remain.
    const undoneRootChildren = rootChildIds(undone.state);
    expect(undoneRootChildren).toEqual([
      "p1" as BlockId,
      "p2" as BlockId,
      "p3" as BlockId,
      "p4" as BlockId,
    ]);
    for (const id of undoneRootChildren) {
      expect(getBlock(undone.state, id)?.type).not.toBe("section");
      expect(getBlock(undone.state, id)?.type).toBe("paragraph");
    }
    // The section blocks are gone from the doc-root chain.
    expect(undoneRootChildren).not.toContain(secA);
    expect(undoneRootChildren).not.toContain(secB);

    // Pre-break selection restored (cursor in p3 at offset 0).
    expect(undone.selection).toEqual(beforeSelection);
    expect(undone.selection.focus).toEqual({ blockId: "p3" as BlockId, offset: 0 });

    // Geometry returns to the original.
    const undoneGeom = paraGeometry(materialize(undone));
    for (const k of PARA_KEYS) {
      expect(undoneGeom[k]).toEqual(beforeGeom[k]);
    }

    // ----- 4. REDO: sections back, cursor at the new section start -----
    const redone = reduceEditor(undone, { type: "REDO" }, config);

    const redoneRootChildren = rootChildIds(redone.state);
    expect(redoneRootChildren).toHaveLength(2);
    for (const id of redoneRootChildren) {
      expect(getBlock(redone.state, id)?.type).toBe("section");
    }
    // Cursor back at { firstLeaf(p3)=p3, 0 }.
    const redoneCursor = {
      blockId: firstLeafBlock(redone.state, boundary) ?? boundary,
      offset: 0,
    };
    expect(redoneCursor).toEqual({ blockId: "p3" as BlockId, offset: 0 });
    expect(redone.selection.focus).toEqual(redoneCursor);
    expect(redone.selection.anchor).toEqual(redoneCursor);

    // Transparency holds again after redo.
    const redoneGeom = paraGeometry(materialize(redone));
    for (const k of PARA_KEYS) {
      expect(redoneGeom[k]).toEqual(beforeGeom[k]);
    }
  });
});
