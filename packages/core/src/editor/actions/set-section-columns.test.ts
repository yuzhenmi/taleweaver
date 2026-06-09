/**
 * `SET_SECTION_COLUMNS` editor action + `handleSetSectionColumns`.
 *
 * The action sets the multi-column override (Google Docs Format ▸ Columns) on
 * the SECTION at the cursor — or, when the cursor is in a section-less run, on
 * the DOC ROOT (whole-doc columns). It only SETS the target block's
 * `columnCount` / `columnGap` / `columnRule` attrs; the
 * render→cascade→measure→materialize pipeline (slices T1–T5) turns those attrs
 * into the per-page `columnConfig` and rendered columns. `columnCount: 1` is the
 * single-column state.
 *
 * These tests run at the editor-behavior level through `reduceEditor` and assert
 * the RESOLVED layout effect (`PagePlanEntry.columnConfig.columnCount`), not just
 * the attrs — proving the render→layout reflow actually fires on the change.
 * Harness mirrors `toggle-section-landscape.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createMockShaper,
  getBlock,
  createPosition,
  type EditorConfig,
  type PageConfig,
  type EditorState,
  type BlockId,
} from "../../index";
import type { VirtualLayoutTree } from "../../layout/virtual-layout-tree";

/**
 * Doc-wide page geometry: a short page so each one-line paragraph leaves ample
 * room; column count does not depend on these dims, but a real `pageConfig` is
 * needed to reach the virtualized (plan-bearing) layout path.
 */
function makeConfig(): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 480,
    pageBlockSize: 800,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 480,
    pageConfig,
  };
}

/** Build an N-paragraph doc in one O(N) PASTE (one paragraph per line). */
function buildPasted(config: EditorConfig, n: number): EditorState {
  const text = Array.from({ length: n }, (_, i) => `para ${i}`).join("\n");
  return reduceEditor(createInitialEditorState(config), { type: "PASTE", text }, config);
}

/** The document root's direct children, in order. */
function rootChildIds(editor: EditorState): BlockId[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = root.firstChildId;
  while (id !== null) {
    ids.push(id);
    id = getBlock(editor.state, id)?.nextSiblingId ?? null;
  }
  return ids;
}

/** The nth top-level block id (paragraphs, pre-section-break). */
function nthBlockId(editor: EditorState, n: number): BlockId {
  const ids = rootChildIds(editor);
  const id = ids[n];
  if (id === undefined) throw new Error(`no block ${n}`);
  return id;
}

/** Place the caret at offset 0 of `blockId`. */
function placeCaret(editor: EditorState, blockId: BlockId, config: EditorConfig): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: { anchor: createPosition(blockId, 0), focus: createPosition(blockId, 0) },
    },
    config,
  );
}

/** Make two sections (section A = [p0], section B = [p1..]) with cursor in B. */
function twoSectionEditor(config: EditorConfig, n = 4): {
  editor: EditorState;
  sectionA: BlockId;
  sectionB: BlockId;
} {
  let editor = buildPasted(config, n);
  const boundary = nthBlockId(editor, 1);
  editor = placeCaret(editor, boundary, config);
  editor = reduceEditor(editor, { type: "SECTION_BREAK" }, config);
  const sectionIds = rootChildIds(editor);
  if (sectionIds.length !== 2) throw new Error(`expected 2 sections, got ${sectionIds.length}`);
  const sectionA = sectionIds[0];
  const sectionB = sectionIds[1];
  // Place the cursor inside section B's first paragraph.
  const firstParaOfB = getBlock(editor.state, sectionB)?.firstChildId;
  if (firstParaOfB == null) throw new Error("section B has no first child");
  editor = placeCaret(editor, firstParaOfB, config);
  return { editor, sectionA, sectionB };
}

/** The (uniform) `columnConfig.columnCount` of the section's plan pages. */
function sectionPlanColumnCounts(
  editor: EditorState,
  sectionId: BlockId,
): number[] {
  const tree = editor.layoutTree;
  if (tree.type !== "virtual-root") throw new Error("expected a VirtualLayoutTree");
  const vtree: VirtualLayoutTree = tree;
  // Collect the section's direct child paragraph ids.
  const childIds = new Set<string>();
  const section = getBlock(editor.state, sectionId);
  if (section === null) throw new Error("section not found");
  let c: BlockId | null = section.firstChildId;
  while (c !== null) {
    childIds.add(c);
    c = getBlock(editor.state, c)?.nextSiblingId ?? null;
  }
  // A plan entry belongs to the section when its children all belong to it.
  const counts: number[] = [];
  for (const entry of vtree.plan.entries) {
    const keys = entry.children.map((ch) => ch.key);
    if (keys.length > 0 && keys.every((k) => childIds.has(k))) {
      counts.push(entry.columnConfig.columnCount);
    }
  }
  return counts;
}

/** Every plan entry's `columnConfig.columnCount` (whole-doc). */
function allPlanColumnCounts(editor: EditorState): number[] {
  const tree = editor.layoutTree;
  if (tree.type !== "virtual-root") throw new Error("expected a VirtualLayoutTree");
  return tree.plan.entries.map((e) => e.columnConfig.columnCount);
}

describe("handleSetSectionColumns — SET_SECTION_COLUMNS action", () => {
  it("sets the active section to 2 columns: attrs + resolved plan columnConfig", () => {
    const config = makeConfig();
    const { editor: initial, sectionA, sectionB } = twoSectionEditor(config);

    // Baseline: every page is single-column.
    expect(sectionPlanColumnCounts(initial, sectionB).every((n) => n === 1)).toBe(true);

    const next = reduceEditor(
      initial,
      { type: "SET_SECTION_COLUMNS", columnCount: 2, columnGap: 24 },
      config,
    );

    // A real change produces a NEW state reference.
    expect(next.state).not.toBe(initial.state);

    // Section B's attrs carry the override.
    const secB = getBlock(next.state, sectionB);
    expect(secB?.attrs.columnCount).toBe(2);
    expect(secB?.attrs.columnGap).toBe(24);

    // Section A untouched (no override).
    const secA = getBlock(next.state, sectionA);
    expect(secA?.attrs.columnCount).toBeUndefined();

    // RESOLVED PLAN: section B's pages are 2-column, section A's stay 1-column.
    const countsB = sectionPlanColumnCounts(next, sectionB);
    expect(countsB.length).toBeGreaterThan(0);
    expect(countsB.every((n) => n === 2)).toBe(true);
    expect(sectionPlanColumnCounts(next, sectionA).every((n) => n === 1)).toBe(true);
  });

  it("applies columns DOC-WIDE when there is no section break (writes the doc root)", () => {
    const config = makeConfig();
    const editor = buildPasted(config, 3);

    // Baseline: single-column doc-wide.
    expect(allPlanColumnCounts(editor).every((n) => n === 1)).toBe(true);

    const next = reduceEditor(
      editor,
      { type: "SET_SECTION_COLUMNS", columnCount: 2, columnGap: 24 },
      config,
    );

    // Doc root carries the override.
    const root = getBlock(next.state, next.state.rootId);
    expect(root?.attrs.columnCount).toBe(2);

    // RESOLVED: the whole doc's pages are 2-column (effectiveDefaultColumns).
    const counts = allPlanColumnCounts(next);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((n) => n === 2)).toBe(true);
  });

  it("back to single column (columnCount 1) restores 1-column pages on the section", () => {
    const config = makeConfig();
    const { editor: initial, sectionB } = twoSectionEditor(config);

    const twoCol = reduceEditor(
      initial,
      { type: "SET_SECTION_COLUMNS", columnCount: 2, columnGap: 24 },
      config,
    );
    expect(sectionPlanColumnCounts(twoCol, sectionB).every((n) => n === 2)).toBe(true);

    const oneCol = reduceEditor(twoCol, { type: "SET_SECTION_COLUMNS", columnCount: 1 }, config);

    // columnCount: 1 explicitly (single column), and the plan is 1-column again.
    expect(getBlock(oneCol.state, sectionB)?.attrs.columnCount).toBe(1);
    expect(sectionPlanColumnCounts(oneCol, sectionB).every((n) => n === 1)).toBe(true);
    // A bare count-only change does NOT clobber the existing columnGap (the
    // handler writes gap/rule only when the action provides them).
    expect(getBlock(oneCol.state, sectionB)?.attrs.columnGap).toBe(24);
  });

  it("is a no-op (same editor reference) when the columnCount is already set (T7 guard)", () => {
    const config = makeConfig();
    const { editor: initial } = twoSectionEditor(config);

    const twoCol = reduceEditor(
      initial,
      { type: "SET_SECTION_COLUMNS", columnCount: 2, columnGap: 24 },
      config,
    );
    // Re-dispatching the SAME count + gap is a no-op merge.
    const again = reduceEditor(
      twoCol,
      { type: "SET_SECTION_COLUMNS", columnCount: 2, columnGap: 24 },
      config,
    );
    expect(again).toBe(twoCol);
  });

  it("is ONE undo unit: undo restores the prior 1-column plan", () => {
    const config = makeConfig();
    const { editor: initial, sectionB } = twoSectionEditor(config);

    const twoCol = reduceEditor(
      initial,
      { type: "SET_SECTION_COLUMNS", columnCount: 2, columnGap: 24 },
      config,
    );
    expect(getBlock(twoCol.state, sectionB)?.attrs.columnCount).toBe(2);

    const undone = reduceEditor(twoCol, { type: "UNDO" }, config);

    // One undo step reverts the whole column change.
    expect(getBlock(undone.state, sectionB)?.attrs.columnCount).toBeUndefined();
    expect(sectionPlanColumnCounts(undone, sectionB).every((n) => n === 1)).toBe(true);

    // Redo re-applies it.
    const redone = reduceEditor(undone, { type: "REDO" }, config);
    expect(getBlock(redone.state, sectionB)?.attrs.columnCount).toBe(2);
    expect(sectionPlanColumnCounts(redone, sectionB).every((n) => n === 2)).toBe(true);
  });
});
