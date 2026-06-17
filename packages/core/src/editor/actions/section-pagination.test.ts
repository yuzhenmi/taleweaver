/**
 * BUG 1 (C.2b-1 positioning regression): section page breaks were enforced on
 * the PLAN side (`measurePass`/`fitOnePage` via a `stopBeforeIndex` cap) but NOT
 * on the POSITIONING side. `materializePage` laid out each page with no section
 * cap, so when a section's last page had leftover vertical room, `bfc.layoutBlock`
 * filled it with the NEXT section's leading block(s) — blocks the plan correctly
 * assigned to the next page. Those blocks then rendered on BOTH pages
 * (duplication / leak).
 *
 * This test pins the invariant the fix restores: for every page, the set of
 * top-level block keys in the materialized `PageBox` equals that page's
 * `plan.entries[i].children` keys. No section-2 block key appears in section 1's
 * last page, and no key appears on two pages.
 *
 * Harness: the real editor (`createInitialEditorState`, `reduceEditor`), a small
 * page so a couple one-line paragraphs leave leftover room, and a mid-doc
 * `SECTION_BREAK` so section 2 lands on page 2 with section 1 NOT filling page 1.
 */
import { describe, it, expect } from "vitest";
import { createInitialEditorState, reduceEditor, createDefaultComponentRegistry, createDefaultAttrRegistry, createMockShaper, getBlock, createPosition, render, cascadePass, type EditorConfig, type PageConfig, type EditorState, type BlockId } from "../../index";
import { layoutTree } from "@taleweaver/print";
import type { PageBox } from "@taleweaver/print";
import type { LayoutBox } from "@taleweaver/print";
import type { VirtualLayoutTree } from "@taleweaver/print";

// Phase 0b: `measurer` left core's `EditorConfig` for the backend's layout
// driver. Tests build the layout tree directly via core's pipeline (what the
// driver does) to assert the resolved per-page pagination geometry.
const measurer = createMockShaper(8, 16);

/** Build the layout tree the backend driver would (render → cascade → layout). */
function layoutOf(editor: EditorState, config: EditorConfig): LayoutBox | VirtualLayoutTree {
  const rendered = render(editor.state, config.componentRegistry, config.attrRegistry);
  const cascaded = cascadePass(rendered.root);
  return layoutTree(cascaded, config.containerWidth, measurer, config.pageConfig);
}

// Mock shaper: line height 16, char width 8. Page block-size 64, 0 margins ⇒
// 4 one-line paragraphs fit per page. A 2-paragraph leading section thus leaves
// 32px (two lines) of leftover room on its last page — which, before the fix,
// `materializePage` greedily filled with the next section's first paragraphs.
function makeConfig(pageBlockSize = 64): EditorConfig {
  const pageConfig: PageConfig = {
    pageInlineSize: 800,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
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

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * The TOP-LEVEL block keys actually positioned on a materialized `PageBox`:
 * the direct `block`-typed children of the page's single root-BFC child. This
 * is the materialized-page analogue of `plan.entries[i].children` — sections are
 * `display: contents` (transparent in layout), so the BFC's direct block
 * children are the flattened top-level paragraphs, keyed by block id. A leaked
 * next-section block shows up here as an extra key the plan's slice does not
 * contain.
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

describe("section pagination — positioning honors the section page-break cap (BUG 1)", () => {
  it("no next-section block leaks onto a leading section's last page (materialized PageBox keys == plan children keys)", () => {
    const config = makeConfig();
    // 8 one-line paragraphs over 4-line pages.
    let editor = buildPasted(config, 8);

    // Break into two sections at block index 1: section A = [p0],
    // section B = [p1..p7]. Section A (1 line = 16px) is far from filling page 0
    // (64px), so before the fix page 0's positioning greedily pulls in section
    // B's leading block(s) — the leak.
    const boundary = nthBlockId(editor, 1);
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: createPosition(boundary, 0), focus: createPosition(boundary, 0) } },
      config,
    );
    editor = reduceEditor(editor, { type: "SECTION_BREAK" }, config);

    // Root now holds two sections.
    const sectionIds = rootChildIds(editor);
    expect(sectionIds).toHaveLength(2);
    for (const id of sectionIds) {
      expect(getBlock(editor.state, id)?.type).toBe("section");
    }

    // Press Enter (SPLIT_NODE) inside section 1 exactly as the bug report
    // describes — split section A's only paragraph mid-text. This re-runs the
    // whole pipeline; the leak (if present) survives the re-layout. Section A is
    // still only ~2 short lines afterward, so page 0 retains ample leftover room.
    const secA = nth(sectionIds, 0, "section");
    const firstParaOfA = getBlock(editor.state, secA)?.firstChildId;
    if (firstParaOfA == null) throw new Error("section A has no first child");
    editor = reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: { anchor: createPosition(firstParaOfA, 2), focus: createPosition(firstParaOfA, 2) } },
      config,
    );
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);

    // The layout must be virtual (paginated mode).
    const tree = layoutOf(editor, config);
    if (tree.type !== "virtual-root") throw new Error("expected a VirtualLayoutTree");

    // INVARIANT 1: each page's materialized top-level block keys == its plan
    // children keys. A leaked next-section block appears as an extra key here
    // that the plan's slice does not contain (the BUG-1 symptom).
    const keysByPage: string[][] = [];
    for (let i = 0; i < tree.plan.entries.length; i++) {
      const page = tree.getPage(i);
      const planKeys = nth(tree.plan.entries, i, "plan entry").children.map((c) => c.key);
      const materializedKeys = topLevelKeysOnPage(page);
      expect(materializedKeys).toEqual(planKeys);
      keysByPage.push(materializedKeys);
    }

    // INVARIANT 2: no top-level block key appears on more than one page (no leak /
    // duplication across the section boundary).
    const pageOfKey = new Map<string, number>();
    for (let i = 0; i < keysByPage.length; i++) {
      for (const k of nth(keysByPage, i, "page keys")) {
        const prior = pageOfKey.get(k);
        expect(prior).toBeUndefined();
        pageOfKey.set(k, i);
      }
    }

    // Sanity: there are at least two pages (the section break forced a second
    // page), so the invariant is non-vacuous.
    expect(tree.plan.entries.length).toBeGreaterThanOrEqual(2);
  });
});
