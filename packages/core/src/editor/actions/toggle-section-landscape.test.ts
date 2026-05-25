/**
 * `TOGGLE_SECTION_LANDSCAPE` editor action + `handleToggleSectionLandscape`.
 *
 * The action toggles the page-geometry override on the SECTION at the cursor
 * between doc-wide and LANDSCAPE (the doc-wide dimensions swapped — wider +
 * shorter pages). This is the browser-verification surface for the already-
 * committed C.2b-2 per-section page geometry: section `attrs.pageInlineSize` /
 * `attrs.pageBlockSize` flow → `section.ts` metadata → `buildSectionPlan` →
 * per-section layout geometry. This action only SETS those attrs (and clears
 * them on the second toggle, since `mergeBlockAttrs` removes a key whose
 * incoming value is `undefined`).
 *
 * These tests run at the editor-behavior level through `reduceEditor` and
 * assert REAL LAYOUT GEOMETRY (page `inlineSize` / `blockSize`), not just the
 * attrs — proving the render→layout reflow actually fires on a section-attrs
 * change. Harness mirrors `section-pagination.test.ts`.
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
import type { PageBox } from "../../layout/page-box";
import type { LayoutBox } from "../../layout/layout-box-v2";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/state-builders";
import { createHistory } from "../../state/history";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";

/**
 * Doc-wide page geometry: PORTRAIT-ish (inline 480, block 800), 0 margins ⇒ a
 * one-line paragraph (16px) leaves ample leftover room per page. Landscape =
 * inline/block swapped (inline 800, block 480) ⇒ WIDER + SHORTER pages.
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

/** A config with NO pageConfig (unpaginated harness). */
function makeUnpaginatedConfig(): EditorConfig {
  return {
    measurer: createMockShaper(8, 16),
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 480,
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

/**
 * The TOP-LEVEL block keys positioned on a materialized PageBox: the direct
 * `block`-typed children of the page's single root-BFC child. Sections are
 * `display: contents` so the BFC's direct block children are the flattened
 * top-level paragraphs. Used to attribute a page to its owning section.
 */
function topLevelKeysOnPage(page: PageBox): string[] {
  const rootBfc = page.children[0];
  if (rootBfc === undefined || !("children" in rootBfc)) return [];
  const keys: string[] = [];
  for (const c of rootBfc.children as readonly LayoutBox[]) {
    if (c.type === "block") keys.push(c.key);
  }
  return keys;
}

/** Make two sections (section A = [p0], section B = [p1..]) with cursor in B. */
function twoSectionEditor(config: EditorConfig, n = 4): {
  editor: EditorState;
  sectionA: BlockId;
  sectionB: BlockId;
} {
  let editor = buildPasted(config, n);
  const boundary = nthBlockId(editor, 1);
  editor = reduceEditor(
    editor,
    { type: "SET_SELECTION", selection: { anchor: createPosition(boundary, 0), focus: createPosition(boundary, 0) } },
    config,
  );
  editor = reduceEditor(editor, { type: "SECTION_BREAK" }, config);
  const sectionIds = rootChildIds(editor);
  if (sectionIds.length !== 2) throw new Error(`expected 2 sections, got ${sectionIds.length}`);
  const sectionA = sectionIds[0];
  const sectionB = sectionIds[1];
  // Place the cursor inside section B's first paragraph.
  const firstParaOfB = getBlock(editor.state, sectionB)?.firstChildId;
  if (firstParaOfB == null) throw new Error("section B has no first child");
  editor = reduceEditor(
    editor,
    { type: "SET_SELECTION", selection: { anchor: createPosition(firstParaOfB, 0), focus: createPosition(firstParaOfB, 0) } },
    config,
  );
  return { editor, sectionA, sectionB };
}

/**
 * For each section, return the (uniform) geometry of its pages: the inlineSize
 * and blockSize of every page whose top-level block keys belong to that
 * section's child set. Asserts the section's pages all share one geometry.
 */
function sectionPageGeometry(
  editor: EditorState,
  sectionId: BlockId,
): { inlineSize: number; blockSize: number } {
  const tree = editor.layoutTree;
  if (tree.type !== "virtual-root") throw new Error("expected a VirtualLayoutTree");
  const section = getBlock(editor.state, sectionId);
  if (section === null) throw new Error("section not found");
  // Collect the section's direct child paragraph ids.
  const childIds = new Set<string>();
  let c: BlockId | null = section.firstChildId;
  while (c !== null) {
    childIds.add(c);
    c = getBlock(editor.state, c)?.nextSiblingId ?? null;
  }
  let geom: { inlineSize: number; blockSize: number } | null = null;
  for (let i = 0; i < tree.plan.entries.length; i++) {
    const page = tree.getPage(i);
    const keys = topLevelKeysOnPage(page);
    const belongsToSection = keys.length > 0 && keys.every((k) => childIds.has(k));
    if (!belongsToSection) continue;
    const pageGeom = { inlineSize: page.inlineSize, blockSize: page.blockSize };
    if (geom === null) {
      geom = pageGeom;
    } else {
      expect(pageGeom).toEqual(geom);
    }
  }
  if (geom === null) throw new Error(`no pages found for section ${sectionId}`);
  return geom;
}

describe("handleToggleSectionLandscape — TOGGLE_SECTION_LANDSCAPE action", () => {
  it("toggles section 2 to landscape: attrs swapped + pages wider & shorter; section 1 unchanged", () => {
    const config = makeConfig();
    if (config.pageConfig === undefined) throw new Error("config.pageConfig required");
    const { editor: initial, sectionA, sectionB } = twoSectionEditor(config);

    // Baseline geometry: both sections are doc-wide (portrait).
    const docWide = { inlineSize: config.pageConfig.pageInlineSize, blockSize: config.pageConfig.pageBlockSize };
    expect(sectionPageGeometry(initial, sectionA)).toEqual(docWide);
    expect(sectionPageGeometry(initial, sectionB)).toEqual(docWide);

    const next = reduceEditor(initial, { type: "TOGGLE_SECTION_LANDSCAPE" }, config);

    // A real change produces a NEW state reference.
    expect(next.state).not.toBe(initial.state);

    // Section B's attrs: doc-wide dims SWAPPED.
    const secBBlock = getBlock(next.state, sectionB);
    expect(secBBlock?.attrs.pageInlineSize).toBe(config.pageConfig.pageBlockSize);
    expect(secBBlock?.attrs.pageBlockSize).toBe(config.pageConfig.pageInlineSize);

    // Section A's attrs untouched (no override).
    const secABlock = getBlock(next.state, sectionA);
    expect(secABlock?.attrs.pageInlineSize).toBeUndefined();
    expect(secABlock?.attrs.pageBlockSize).toBeUndefined();

    // GEOMETRY: section B's pages are WIDER (larger inlineSize) + SHORTER
    // (smaller blockSize) than section A's. This proves the render→layout
    // reflow fired on the section-attrs change.
    const geomA = sectionPageGeometry(next, sectionA);
    const geomB = sectionPageGeometry(next, sectionB);
    expect(geomA).toEqual(docWide);
    expect(geomB.inlineSize).toBeGreaterThan(geomA.inlineSize);
    expect(geomB.blockSize).toBeLessThan(geomA.blockSize);
    expect(geomB).toEqual({
      inlineSize: config.pageConfig.pageBlockSize,
      blockSize: config.pageConfig.pageInlineSize,
    });
  });

  it("toggles again: clears the override; section 2's pages return to doc-wide geometry", () => {
    const config = makeConfig();
    if (config.pageConfig === undefined) throw new Error("config.pageConfig required");
    const { editor: initial, sectionA, sectionB } = twoSectionEditor(config);
    const docWide = { inlineSize: config.pageConfig.pageInlineSize, blockSize: config.pageConfig.pageBlockSize };

    const landscape = reduceEditor(initial, { type: "TOGGLE_SECTION_LANDSCAPE" }, config);
    const restored = reduceEditor(landscape, { type: "TOGGLE_SECTION_LANDSCAPE" }, config);

    // Override cleared (keys removed).
    const secBBlock = getBlock(restored.state, sectionB);
    expect(secBBlock?.attrs.pageInlineSize).toBeUndefined();
    expect(secBBlock?.attrs.pageBlockSize).toBeUndefined();

    // Geometry back to doc-wide for both sections.
    expect(sectionPageGeometry(restored, sectionA)).toEqual(docWide);
    expect(sectionPageGeometry(restored, sectionB)).toEqual(docWide);
  });

  it("resolves the section when the cursor is in a block nested DEEPER than a direct child (section → list → list-item)", () => {
    // Build genuine multi-level nesting the flat-paste path can't produce: a
    // section whose child is a `list` CONTAINER holding a `list-item` leaf. The
    // cursor sits in the leaf, so resolving the active section requires walking
    // UP two parent hops (list-item → list → section) — exercising the
    // multi-step parent walk, not just the one-hop direct-child case.
    const config = makeConfig();
    if (config.pageConfig === undefined) throw new Error("config.pageConfig required");

    const initialState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "sec", lastChildId: "sec" }),
        buildBlock({ id: "sec", type: "section", parentId: "doc", firstChildId: "list", lastChildId: "list" }),
        buildBlock({ id: "list", type: "list", parentId: "sec", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          parentId: "list",
          attrs: { listType: "unordered" },
          inlineContent: inlineContent([text("nested item")]),
        }),
      ],
    });
    const rendered = render(initialState, config.componentRegistry, config.attrRegistry);
    const cascadedRoot = cascadePass(rendered.root);
    const layout = layoutTree(cascadedRoot, config.containerWidth, config.measurer, config.pageConfig);
    const cursor = createPosition("li" as BlockId, 0);
    const editor: EditorState = {
      state: initialState,
      selection: { anchor: cursor, focus: cursor },
      history: createHistory(initialState),
      renderTree: rendered.root,
      renderOutput: rendered,
      cascadedRoot,
      layoutTree: layout,
      containerWidth: config.containerWidth,
      targetX: null,
    };

    // Sanity: the cursor's block is NOT a direct child of the section.
    const focusBlock = getBlock(editor.state, editor.selection.focus.blockId);
    expect(focusBlock?.parentId).not.toBe("sec");

    const docWide = { inlineSize: config.pageConfig.pageInlineSize, blockSize: config.pageConfig.pageBlockSize };

    // Baseline: before the toggle the nested section is doc-wide (portrait).
    expect(sectionPageGeometry(editor, "sec" as BlockId)).toEqual(docWide);

    const next = reduceEditor(editor, { type: "TOGGLE_SECTION_LANDSCAPE" }, config);

    // The walk resolves the section ("sec", two hops up) and applies the override there.
    const secBlock = getBlock(next.state, "sec" as BlockId);
    expect(secBlock?.attrs.pageInlineSize).toBe(config.pageConfig.pageBlockSize);
    expect(secBlock?.attrs.pageBlockSize).toBe(config.pageConfig.pageInlineSize);

    // GEOMETRY (not just attrs): the nested section's pages became WIDER +
    // SHORTER (landscape) than doc-wide. This proves the multi-hop walk
    // produces a dirty set that actually flows through rebuildTrees→reflow —
    // the attrs write alone would not move the page box dims.
    const geom = sectionPageGeometry(next, "sec" as BlockId);
    expect(geom.inlineSize).toBeGreaterThan(docWide.inlineSize);
    expect(geom.blockSize).toBeLessThan(docWide.blockSize);
    expect(geom).toEqual({
      inlineSize: config.pageConfig.pageBlockSize,
      blockSize: config.pageConfig.pageInlineSize,
    });
  });

  it("undo after a toggle restores the prior (doc-wide) geometry", () => {
    const config = makeConfig();
    if (config.pageConfig === undefined) throw new Error("config.pageConfig required");
    const { editor: initial, sectionB } = twoSectionEditor(config);
    const docWide = { inlineSize: config.pageConfig.pageInlineSize, blockSize: config.pageConfig.pageBlockSize };

    const toggled = reduceEditor(initial, { type: "TOGGLE_SECTION_LANDSCAPE" }, config);
    expect(getBlock(toggled.state, sectionB)?.attrs.pageInlineSize).toBe(config.pageConfig.pageBlockSize);

    const undone = reduceEditor(toggled, { type: "UNDO" }, config);

    // Attrs cleared by undo.
    expect(getBlock(undone.state, sectionB)?.attrs.pageInlineSize).toBeUndefined();
    // Geometry restored to doc-wide.
    expect(sectionPageGeometry(undone, sectionB)).toEqual(docWide);
  });

  it("is a no-op in a section-less doc (no SECTION_BREAK made)", () => {
    const config = makeConfig();
    const editor = buildPasted(config, 3);

    const next = reduceEditor(editor, { type: "TOGGLE_SECTION_LANDSCAPE" }, config);

    // Same editor reference — no commit, no state change.
    expect(next).toBe(editor);
  });

  it("is a no-op when config.pageConfig is absent (unpaginated harness)", () => {
    const config = makeConfig();
    const paginatedConfig = config;
    if (paginatedConfig.pageConfig === undefined) throw new Error("config.pageConfig required");
    // Build a two-section doc with a paginated config so a section exists...
    const { editor } = twoSectionEditor(paginatedConfig);

    // ...then dispatch with an UNPAGINATED config (no pageConfig). Even though a
    // section exists, the handler can't determine landscape dims → no-op.
    const unpaginated = makeUnpaginatedConfig();
    const next = reduceEditor(editor, { type: "TOGGLE_SECTION_LANDSCAPE" }, unpaginated);

    expect(next).toBe(editor);
  });
});
