/**
 * FN-6.4 slice 3 — `rebuildTrees` restart-per-page second pass.
 *
 * `restart-per-page` footnote numbers depend on which PAGE each anchor lands
 * on, known only after the layout pass. The first render→cascade→layout pass
 * renders the documented continuous fallback (`effectiveRenderPolicy`); FN-6.4's
 * second pass reads the layout's `footnoteAnchorPages`, recomputes the per-page
 * numbers via `footnoteNumbers(anchors, restart-per-page, pageAssignment)`, and
 * re-renders the changed markers with a `footnoteNumbersOverride`.
 *
 * These tests drive the real pipeline through `rebuildTrees` with a small
 * `pageConfig` that forces footnotes onto different pages, and assert the
 * rebuilt editor's numbering map / materialized markers reflect the per-page
 * restart (RED before FN-6.4: page-1 footnote shows its continuous number).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { rebuildTrees } from "./helpers";
import type { EditorState, EditorConfig } from "../editor-state";
import { createMockShaper } from "../../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { createHistory, createPosition, createSpan } from "../../state";
import type { State, BlockId } from "../../state";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";
import type { PageConfig } from "../../layout/page-config";
import type { ElementBox } from "../../render/render-node";
import type { LayoutBox, PageBox } from "../../layout/layout-box";
import type { VirtualLayoutTree } from "../../layout/virtual-layout-tree";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../../test-utils/state-builders";
import * as numberingModule from "../../footnotes/numbering";

const measurer = createMockShaper(8, 16); // 16px line-height, 8px/char.

// 80px content / page ⇒ 5 single-line (16px) paragraphs per page, no margins.
// Roomy enough that a one-line footnote body + separator fits in the slot while
// content still paginates; enough filler paragraphs push the next anchor onto
// the next page.
const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 80,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function makeConfig(pageConfig?: PageConfig): EditorConfig {
  return {
    measurer,
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 600,
    pageConfig,
  };
}

/** A footnote body (container root + paragraph leaf) for embedContents. */
function footnoteBody(rootId: string, leafId: string, leafText: string) {
  return [
    buildBlock({ id: rootId, type: "footnote-body", firstChildId: leafId, lastChildId: leafId }),
    buildBlock({
      id: leafId,
      type: "paragraph",
      parentId: rootId,
      inlineContent: inlineContent([text(leafText)]),
    }),
  ];
}

type ParaSpec = { id: string; anchor?: string };

/**
 * Build the main-tree block array: a `document` root carrying `rootAttrs`, with
 * one paragraph per `paras` entry. A paragraph with an `anchor` carries a
 * footnote-anchor embed referencing that body id; the rest are filler that pad
 * pages so consecutive anchors land on different pages.
 */
function buildDocBlocks(
  rootAttrs: Record<string, unknown>,
  paras: ReadonlyArray<ParaSpec>,
): ReturnType<typeof buildBlock>[] {
  const childIds = paras.map((p) => p.id);
  const blocks = [
    buildBlock({
      id: "doc",
      type: "document",
      attrs: rootAttrs,
      firstChildId: childIds[0],
      lastChildId: childIds[childIds.length - 1],
    }),
  ];
  paras.forEach((p, i) => {
    const items = p.anchor !== undefined
      ? [text("x"), embed("footnote-anchor", { contentBlockId: p.anchor })]
      : [text("x")];
    blocks.push(
      buildBlock({
        id: p.id,
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: i > 0 ? childIds[i - 1] : null,
        nextSiblingId: i < childIds.length - 1 ? childIds[i + 1] : null,
        inlineContent: inlineContent(items),
      }),
    );
  });
  return blocks;
}

/** Build a full EditorState from a State (full pipeline, paginated). */
function buildEditorFull(state: State, config: EditorConfig): EditorState {
  const rendered = render(state, config.componentRegistry, config.attrRegistry);
  const cascadedRoot = cascadePass(rendered.root);
  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of rendered.embedContents) {
    cascadedEmbedContents.set(id, cascadePass(body) as ElementBox);
  }
  const layout = layoutTree(
    cascadedRoot,
    config.containerWidth,
    measurer,
    config.pageConfig,
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
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

/**
 * Collect every glyph-bearing text in a layout subtree: `text-run` boxes AND
 * `marker` boxes (the footnote-body leading number is a generated, offset-
 * excluded `MarkerBox` carrying its number string in `.text`).
 */
function collectRunTexts(box: LayoutBox, out: string[]): void {
  if (box.type === "text-run") out.push(box.text);
  if (box.type === "marker") out.push(box.text);
  const anyBox = box as { children?: readonly LayoutBox[] };
  if (anyBox.children !== undefined) {
    for (const child of anyBox.children) collectRunTexts(child, out);
  }
}

/** The materialized PageBoxes of a virtual layout tree. */
function pagesOf(layout: LayoutBox | VirtualLayoutTree): PageBox[] {
  if (layout.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated path)");
  }
  return layout.getPages(0, 100);
}

const ANCHOR_PAGES = (
  layout: LayoutBox | VirtualLayoutTree,
): ReadonlyMap<BlockId, number> => {
  if (layout.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated path)");
  }
  return layout.footnoteAnchorPages;
};

describe("FN-6.4 — rebuildTrees restart-per-page second pass", () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * Two footnotes on two different pages. Paragraphs: p0(anchor fn0), p1 filler
   * → page 0 full; p2(anchor fn1), p3 filler → page 1. Under restart-per-page
   * both fn0 and fn1 display "1"; under continuous fn1 would display "2".
   */
  function twoFootnotesTwoPages(rootAttrs: Record<string, unknown>): State {
    // Page 0 holds p0(anchor fn0) + fillers; p5 lands on page 1 with anchor fn1.
    // With ~4 content lines fitting after the footnote slot reserves space, six
    // single-line paragraphs guarantee the two anchors land on distinct pages.
    return buildState({
      rootId: "doc",
      blocks: buildDocBlocks(rootAttrs, [
        { id: "p0", anchor: "fn0" },
        { id: "p1" },
        { id: "p2" },
        { id: "p3" },
        { id: "p4" },
        { id: "p5", anchor: "fn1" },
        { id: "p6" },
      ]),
      embedContents: [
        ...footnoteBody("fn0", "fn0-p", "first"),
        ...footnoteBody("fn1", "fn1-p", "second"),
      ],
    });
  }

  it("restart-per-page: the page-1 footnote restarts at 1 (NOT its continuous number 2)", () => {
    const config = makeConfig(PAGE_CONFIG);
    const state = twoFootnotesTwoPages({
      footnoteNumberingReset: "restart-per-page",
    });
    const editor = buildEditorFull(state, config);

    // Sanity: the two anchors really land on different pages.
    const out = rebuildTrees(editor, editor, config);
    const pages = ANCHOR_PAGES(out.layoutTree);
    expect(pages.get("fn0" as BlockId)).toBe(0);
    expect(pages.get("fn1" as BlockId)).toBe(1);

    // After the second pass, the numbering map restarts per page: both → 1.
    expect(out.renderOutput.footnoteNumbers.get("fn0" as BlockId)?.formatted).toBe("1");
    expect(out.renderOutput.footnoteNumbers.get("fn1" as BlockId)?.formatted).toBe("1");
  });

  it("restart-per-page: every materialized CALL marker reads the restarted 1 — the continuous 2 never appears", () => {
    const config = makeConfig(PAGE_CONFIG);
    const state = twoFootnotesTwoPages({
      footnoteNumberingReset: "restart-per-page",
    });
    const editor = buildEditorFull(state, config);
    const out = rebuildTrees(editor, editor, config);

    // The call markers (superscript numbers in the main content) across ALL
    // pages: under restart-per-page each footnote is "1" on its own page, so no
    // marker ever reads the continuous "2". Collect every digit glyph in page
    // content (the inline-block marker's inner text-run) and assert no "2".
    const pages = pagesOf(out.layoutTree);
    const digits: string[] = [];
    for (const page of pages) {
      const texts: string[] = [];
      for (const child of page.children) collectRunTexts(child, texts);
      for (const t of texts) if (/^\d+$/.test(t)) digits.push(t);
    }
    // Both call markers restarted to "1"; the continuous "2" is absent.
    expect(digits).toContain("1");
    expect(digits).not.toContain("2");
  });

  it("continuous policy: numbers are 1,2 and the second pass NEVER runs", () => {
    const config = makeConfig(PAGE_CONFIG);
    const state = twoFootnotesTwoPages({}); // no policy attr → continuous default
    const editor = buildEditorFull(state, config);

    const spy = vi.spyOn(numberingModule, "footnoteNumbers");
    const out = rebuildTrees(editor, editor, config);

    // Continuous: fn0 → 1, fn1 → 2.
    expect(out.renderOutput.footnoteNumbers.get("fn0" as BlockId)?.formatted).toBe("1");
    expect(out.renderOutput.footnoteNumbers.get("fn1" as BlockId)?.formatted).toBe("2");

    // The second-pass per-page recompute is NEVER invoked for continuous: no
    // call to footnoteNumbers passes a restart-per-page policy.
    const perPageCalls = spy.mock.calls.filter(
      (c) => (c[1] as { reset?: string } | undefined)?.reset === "restart-per-page",
    );
    expect(perPageCalls.length).toBe(0);
  });

  it("restart-per-page with both footnotes on ONE page: numbers equal continuous (converges immediately)", () => {
    const config = makeConfig(PAGE_CONFIG);
    // Two anchors on p0/p1, both on page 0 (2 lines fit in 32px).
    const state = buildState({
      rootId: "doc",
      blocks: buildDocBlocks({ footnoteNumberingReset: "restart-per-page" }, [
        { id: "p0", anchor: "fn0" },
        { id: "p1", anchor: "fn1" },
      ]),
      embedContents: [
        ...footnoteBody("fn0", "fn0-p", "first"),
        ...footnoteBody("fn1", "fn1-p", "second"),
      ],
    });
    const editor = buildEditorFull(state, config);
    const out = rebuildTrees(editor, editor, config);

    const pages = ANCHOR_PAGES(out.layoutTree);
    expect(pages.get("fn0" as BlockId)).toBe(0);
    expect(pages.get("fn1" as BlockId)).toBe(0);

    // Same page ⇒ per-page == continuous: 1, 2.
    expect(out.renderOutput.footnoteNumbers.get("fn0" as BlockId)?.formatted).toBe("1");
    expect(out.renderOutput.footnoteNumbers.get("fn1" as BlockId)?.formatted).toBe("2");
  });

  it("restart-per-page on a NON-virtual layout (no pageConfig) skips the second pass (continuous fallback)", () => {
    const config = makeConfig(undefined); // no pageConfig ⇒ plain LayoutBox
    const state = twoFootnotesTwoPages({
      footnoteNumberingReset: "restart-per-page",
    });
    const editor = buildEditorFull(state, config);
    const out = rebuildTrees(editor, editor, config);

    // Non-virtual layout: no footnoteAnchorPages ⇒ render keeps the continuous
    // fallback (1, 2) rather than crashing or restarting.
    expect(out.layoutTree.type).not.toBe("virtual-root");
    expect(out.renderOutput.footnoteNumbers.get("fn0" as BlockId)?.formatted).toBe("1");
    expect(out.renderOutput.footnoteNumbers.get("fn1" as BlockId)?.formatted).toBe("2");
  });
});
