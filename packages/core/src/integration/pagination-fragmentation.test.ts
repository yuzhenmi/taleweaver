// packages/core/src/integration/pagination-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { paginatedHarness } from "../test-utils/paginated-harness";
import type { PageConfig } from "../layout/page-config";
import type { RenderNode } from "../render/render-node";
import type { LayoutBox, BlockBox } from "../layout/layout-box";
import type { PageBox } from "../layout/page-box";
import { layoutTreeIncremental } from "../layout/layout-incremental";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import { cascadePass } from "../cascade";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
} from "../editor/editor-state";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { getBlock, createPosition, createSpan } from "../state";

const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 200,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

// Mock shaper: createMockShaper(8, 16) → each char is 8px wide, 16px tall.
// PAGE.pageInlineSize = 600. So each line fits 600/8 = 75 characters.
// Each "word " is 5 chars → 75/5 = 15 words per line.
// PAGE.pageBlockSize = 200; 200/16 = 12.5 → 12 lines per page.

function buildParagraph(words: number): RenderNode {
  const text = "word ".repeat(words).trim();
  return {
    type: "element" as const,
    key: "p",
    style: { display: "block" },
    children: [{ type: "text" as const, key: "t", style: {}, text }],
  };
}

function buildDocumentRoot(children: readonly RenderNode[]): RenderNode {
  return {
    type: "element" as const,
    key: "doc",
    style: { display: "block" },
    children,
  };
}

function countLinesIn(page: PageBox): number {
  function walkBox(box: LayoutBox): number {
    if (box.type === "line") return 1;
    if (box.type === "text-run" || box.type === "marker") return 0;
    if ("children" in box) {
      let total = 0;
      for (const c of box.children as readonly LayoutBox[]) {
        total += walkBox(c);
      }
      return total;
    }
    return 0;
  }
  let total = 0;
  for (const child of page.children) {
    total += walkBox(child);
  }
  return total;
}

describe("pagination integration — within-block fragmentation", () => {
  it("fragments a tall paragraph across two pages", () => {
    // 20 lines * 15 words/line = 300 words.
    // page fits 12 lines → 20-line paragraph must span at least 2 pages.
    const para = buildParagraph(20 * 15);
    const root = buildDocumentRoot([para]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    const totalLines = result.pages.reduce((sum, p) => sum + countLinesIn(p), 0);
    expect(totalLines).toBe(20);
  });

  it("respects break-before: page on a body paragraph", () => {
    const para1 = buildParagraph(15); // 1 line
    const para2: RenderNode = {
      type: "element" as const,
      key: "p2",
      style: { display: "block", breakBefore: "page" },
      children: [
        {
          type: "text" as const,
          key: "t2",
          style: {},
          text: "word ".repeat(15).trim(),
        },
      ],
    };
    const root = buildDocumentRoot([para1, para2]);
    const result = paginatedHarness(root, PAGE);
    // break-before: page forces para2 onto a new page regardless of remaining space.
    expect(result.pages).toHaveLength(2);
  });

  it("empty document produces one blank page", () => {
    const root = buildDocumentRoot([]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages).toHaveLength(1);
    // PageBox holds a single wrapping content-area block (positioned at the
    // page's margin offset); the wrapping block has no flow children.
    expect(result.pages[0].children).toHaveLength(1);
    const contentArea = result.pages[0].children[0];
    expect(contentArea.type).toBe("block");
    if (contentArea.type !== "block") throw new Error("expected wrapping content-area block");
    expect(contentArea.children).toHaveLength(0);
  });

  it("honors widows constraint", () => {
    // 14-line paragraph. Page fits 12 lines.
    // With widows=5: second page must have at least 5 lines.
    const para: RenderNode = {
      type: "element" as const,
      key: "p",
      style: { display: "block", widows: 5 },
      children: [
        {
          type: "text" as const,
          key: "t",
          style: {},
          text: "word ".repeat(14 * 15).trim(),
        },
      ],
    };
    const root = buildDocumentRoot([para]);
    const result = paginatedHarness(root, PAGE);
    // Total lines must be 14 regardless of distribution.
    const totalLines = result.pages.reduce((sum, p) => sum + countLinesIn(p), 0);
    expect(totalLines).toBe(14);
    // Content must be split across pages.
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    if (result.pages.length >= 2) {
      // With widows=5, second page must have at least 5 lines.
      const p1Lines = countLinesIn(result.pages[1]);
      expect(p1Lines).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("pagination integration — edits to fragmented content", () => {
  it("re-paginates after the document grows: 1 page → 2 pages", () => {
    // 20 words → 1-2 lines (well within 1 page).
    const small = buildParagraph(20);
    // 300 words → 20 lines (spans multiple pages).
    const big = buildParagraph(20 * 15);

    const before = paginatedHarness(buildDocumentRoot([small]), PAGE);
    expect(before.pages).toHaveLength(1);

    const after = paginatedHarness(buildDocumentRoot([big]), PAGE);
    expect(after.pages.length).toBeGreaterThan(1);
  });

  it("re-paginates after the document shrinks: multi-page → 1 page", () => {
    const big = buildParagraph(20 * 15);
    const small = buildParagraph(20);

    const before = paginatedHarness(buildDocumentRoot([big]), PAGE);
    expect(before.pages.length).toBeGreaterThan(1);

    const after = paginatedHarness(buildDocumentRoot([small]), PAGE);
    expect(after.pages).toHaveLength(1);
  });
});

describe("pagination integration — layoutTreeIncremental + pageConfig", () => {
  // Regression test for the BFC reuse-cache bug: when fragmentation is active,
  // the cached full-document BlockBox must NOT short-circuit layoutBlock —
  // doing so would collapse a multi-page document into one page.
  it("preserves multi-page output when layoutTreeIncremental re-lays out an unchanged document", () => {
    const big = buildParagraph(20 * 15); // 20 lines → multi-page at PAGE
    const root = buildDocumentRoot([big]);
    const shaper = createMockShaper(8, 16);
    const cascaded = cascadePass(root);

    // First pass: cold incremental (no oldRoot/oldLayout). In paginated mode
    // this returns a VirtualLayoutTree; the test asserts over the materialized
    // page tree (Phase 3 Task 1 — `materializeAll() ≡ paginateRoot`).
    const r1 = layoutTreeIncremental(cascaded, null, null, PAGE.pageInlineSize, shaper, PAGE);
    expect(r1.type).toBe("virtual-root");
    const r1Positioned = resolvePositionedTree(r1);
    expect(r1Positioned.type).toBe("block");
    const r1Pages = (r1Positioned as BlockBox).children.filter((c): c is PageBox => c.type === "page");
    expect(r1Pages.length).toBeGreaterThan(1);

    // Second pass: same document, prior layout passed in. This is the path
    // that previously short-circuited via the BFC reuse cache when the root's
    // children were reference-equal to the cached version.
    const r2 = layoutTreeIncremental(cascaded, cascaded, r1, PAGE.pageInlineSize, shaper, PAGE);
    expect(r2.type).toBe("virtual-root");
    const r2Positioned = resolvePositionedTree(r2);
    expect(r2Positioned.type).toBe("block");
    const r2Pages = (r2Positioned as BlockBox).children.filter((c): c is PageBox => c.type === "page");
    // Same page count as r1 — fragmentation must not be short-circuited.
    expect(r2Pages.length).toBe(r1Pages.length);
  });
});

describe("virtualized layout — EditorState.layoutTree is virtual-root after a paginated edit", () => {
  // Phase 3 Task 1: the reducer's paginated layout path now produces a
  // VirtualLayoutTree (discriminated by `type: "virtual-root"`), not a
  // positioned BlockBox. Behavior is unchanged because every consumer
  // materializes via `resolvePositionedTree`'s `materializeAll()` bridge.
  function makePaginatedConfig(): EditorConfig {
    return {
      measurer: createMockShaper(8, 16),
      componentRegistry: createDefaultComponentRegistry(),
      attrRegistry: createDefaultAttrRegistry(),
      containerWidth: 600,
      pageConfig: {
        pageInlineSize: 816,
        pageBlockSize: 1056,
        pageMargins: { blockStart: 96, blockEnd: 96, inlineStart: 72, inlineEnd: 72 },
        pageGap: 24,
      },
    };
  }

  it("createInitialEditorState + a paginated INSERT_TEXT yield a virtual-root layoutTree", () => {
    const config = makePaginatedConfig();
    const editor0 = createInitialEditorState(config);
    // Initial paginated layout is already virtual.
    expect(editor0.layoutTree.type).toBe("virtual-root");

    const root = getBlock(editor0.state, editor0.state.rootId);
    if (root === null || root.firstChildId === null) throw new Error("no first child");
    const firstId = root.firstChildId;
    const editor1 = reduceEditor(
      editor0,
      { type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)) },
      config,
    );
    const editor2 = reduceEditor(editor1, { type: "INSERT_TEXT", text: "hello" }, config);
    // A paginated edit (incremental path) still yields a virtual-root tree.
    expect(editor2.layoutTree.type).toBe("virtual-root");
    // And it materializes to the same shape a positioned tree would (the bridge).
    const positioned = resolvePositionedTree(editor2.layoutTree);
    expect(positioned.type).toBe("block");
  });
});

// #425: cross-page interaction between the consecutive-run counter reset and the
// seed-on-resume that reconstructs the counter at a page break. These exercise
// the PAGINATED path (real page breaks), where listCounter is rebuilt per page
// from the seed loop. The seed and the main-loop reset MUST apply identical
// run-reset semantics or a list that straddles a page break renumbers wrong.
describe("pagination integration — ordered-list counter across page breaks (#425)", () => {
  function listItem(key: string, text: string): RenderNode {
    return {
      type: "element" as const,
      key,
      style: { display: "list-item" },
      children: [{ type: "text" as const, key: `${key}-t`, style: {}, text }],
    };
  }

  function paragraphBlock(key: string, text: string): RenderNode {
    return {
      type: "element" as const,
      key,
      style: { display: "block" },
      children: [{ type: "text" as const, key: `${key}-t`, style: {}, text }],
    };
  }

  function ol(key: string, children: readonly RenderNode[]): RenderNode {
    return {
      type: "element" as const,
      key,
      style: { display: "block", paddingInlineStart: 30, listStyleType: "decimal" },
      children,
    };
  }

  // Collect marker texts page-by-page (document order within each page).
  function markersByPage(result: ReturnType<typeof paginatedHarness>): string[][] {
    function collect(box: LayoutBox, out: string[]): void {
      if (box.type === "marker") {
        out.push(box.text);
        return;
      }
      if ("children" in box) {
        for (const c of box.children as readonly LayoutBox[]) collect(c, out);
      }
    }
    return result.pages.map((p) => {
      const out: string[] = [];
      collect(p, out);
      return out;
    });
  }

  // Flatten markers across all pages in document order. Pre-#431, a list-item
  // straddling a page break emitted its marker TWICE — on the origin-page tail
  // AND the resume-page head — and this helper de-duplicated that seam artifact
  // (orthogonal to #425's counter semantics). #431 fixed the double-emit at the
  // source (the resume fragment now creates no MarkerBox), so the dedup below no
  // longer fires in practice; it is retained as a harmless safety net.
  function flatMarkers(result: ReturnType<typeof paginatedHarness>): string[] {
    const flat: string[] = [];
    for (const page of markersByPage(result)) {
      for (const m of page) {
        if (flat.length > 0 && flat[flat.length - 1] === m) continue; // pre-#431 seam-dup safety net (now a no-op)
        flat.push(m);
      }
    }
    return flat;
  }

  it("a single list split across a page break CONTINUES numbering (seed)", () => {
    // 16 single-line list-items split across pages. The whole run must number
    // 1..16 continuously — the seed reconstructs the run on the resume page so
    // page-2 items continue (NOT restart at 1.).
    const items = Array.from({ length: 16 }, (_, i) => listItem(`li${i + 1}`, `item${i + 1}`));
    const root = buildDocumentRoot([ol("ol", items)]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    // Continuous numbering across the break (the subtle GREEN case).
    expect(flatMarkers(result)).toEqual(
      Array.from({ length: 16 }, (_, i) => `${i + 1}.`),
    );
    // The resume page's leading marker must NOT be "1." (would mean restarted).
    const byPage = markersByPage(result);
    expect(byPage[1][0]).not.toBe("1.");
  });

  function explicitMarkerItem(key: string, text: string, marker: string): RenderNode {
    return {
      type: "element" as const,
      key,
      style: { display: "list-item", markerText: marker },
      children: [{ type: "text" as const, key: `${key}-t`, style: {}, text }],
    };
  }

  it("an explicit-markerText list-item before a page break does NOT make the seed over-count the resumed auto item", () => {
    // #425 FIX 1 (seed↔loop asymmetry). The main loop increments listCounter
    // ONLY for `display:list-item` WITHOUT an explicit markerText (an explicit-
    // markerText item is a counter NO-OP — neither ++ nor reset). The seed-on-
    // resume loop MUST mirror that exactly. Before the fix the seed incremented
    // for EVERY display:list-item (including explicit-markerText ones), so a run
    // that places an explicit-markerText item on page 1 and resumes an auto-
    // counter item on page 2 over-counted → the resumed item read "13." not "12.".
    //
    // 12 single-line items fill page 1 (12 lines/page). One of them (index 5)
    // carries an explicit markerText "*" — a counter no-op. The remaining auto
    // items must number 1.,2.,3.,4.,5.,[*],6.,7.,8.,9.,10.,11. on page 1, then
    // CONTINUE 12.,13.,... on page 2.
    const items: RenderNode[] = [];
    let autoN = 0;
    for (let i = 0; i < 18; i++) {
      if (i === 5) {
        items.push(explicitMarkerItem("liStar", "starred", "*"));
      } else {
        autoN++;
        items.push(listItem(`li${i}`, `item${autoN}`));
      }
    }
    const root = buildDocumentRoot([ol("ol", items)]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);

    // The explicit-marker item is a counter no-op: auto items number 1..17
    // continuously across the page break, with "*" interleaved at its slot.
    const expected: string[] = [];
    let n = 0;
    for (let i = 0; i < 18; i++) {
      if (i === 5) {
        expected.push("*");
      } else {
        n++;
        expected.push(`${n}.`);
      }
    }
    expect(flatMarkers(result)).toEqual(expected);

    // The seam: the resumed auto item on page 2 must NOT be over-counted. Before
    // the fix the seed counted "*" → the first page-2 auto marker jumped by one.
    const byPage = markersByPage(result);
    // Page 2's leading auto marker continues the run (no "*" on page 2's head
    // unless the seam-dup carries it; flatMarkers already proves continuity, but
    // assert directly that "13." never appears where "12." should — i.e. the
    // markers are a strictly-incrementing auto sequence with no skipped number).
    const autoMarkers = flatMarkers(result).filter((m) => m !== "*");
    expect(autoMarkers).toEqual(Array.from({ length: 17 }, (_, i) => `${i + 1}.`));
    // And the page-2 head is not a phantom over-count.
    expect(byPage[1][0]).not.toBe("1."); // would mean a wrong restart
  });

  it("#431: a list-item whose CONTENT straddles a page break emits its marker only on the page it starts", () => {
    // Items 1 and 2 are single-line. Item 3 has ~20 lines of text (15 words/line):
    // it starts on page 1 (at line 3) and its content WRAPS across the page break,
    // so its tail flows onto page 2 mid-item (a true content straddle, not a clean
    // item-boundary break). Items 4, 5 are single-line and follow on page 2.
    //
    // Google-Docs parity: item 3's marker ("3.") must appear EXACTLY ONCE, on the
    // page where item 3 STARTS (page 1). The page-2 head fragment of item 3 (its
    // wrapped continuation) must produce NO MarkerBox. Subsequent items still
    // number correctly (4., 5.). Before the #431 fix the resume fragment
    // regenerated item 3's marker → "3." appeared on BOTH pages (raw count 2).
    const straddleText = "word ".repeat(20 * 15).trim(); // ~20 lines of content
    const items: RenderNode[] = [
      listItem("li1", "item one"),
      listItem("li2", "item two"),
      {
        type: "element" as const,
        key: "li3",
        style: { display: "list-item" },
        children: [{ type: "text" as const, key: "li3-t", style: {}, text: straddleText }],
      },
      listItem("li4", "item four"),
      listItem("li5", "item five"),
    ];
    const root = buildDocumentRoot([ol("olStraddle", items)]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);

    // Assert on the RAW (non-deduped) per-page marker boxes — NOT through
    // flatMarkers' seam-dedup, which would mask the double-marker.
    const byPage = markersByPage(result);
    const allRaw = byPage.flat();

    // Item 3's marker "3." must appear EXACTLY ONCE across all pages.
    expect(allRaw.filter((m) => m === "3.").length).toBe(1);

    // "3." appears on page 1 (where item 3 starts), and the page-2 head fragment
    // of item 3 (the first marker on page 2) is NOT "3." (no regenerated marker).
    expect(byPage[0]).toContain("3.");
    if (byPage[1].length > 0) {
      expect(byPage[1][0]).not.toBe("3.");
    }

    // Subsequent items number correctly: the full marker sequence (deduped or not,
    // since each appears once) is 1.,2.,3.,4.,5. in document order.
    expect(allRaw).toEqual(["1.", "2.", "3.", "4.", "5."]);
  });

  it("list A + paragraph + list B that straddles the break: B continues B's run", () => {
    // List A: 5 items. Paragraph separator breaks the run → list B restarts at 1.
    // List B: 16 items, long enough to straddle the page break.
    // The whole sequence must read A:1..5, then B:1..16 continuously — proving
    // (a) the separator reset (B starts at 1, not 6), AND (b) the seed
    // reconstructs B's run from AFTER the paragraph on the resume page (B's
    // page-2 items continue B's own count — NOT list A's, NOT restarted).
    const listA = Array.from({ length: 5 }, (_, i) => listItem(`a${i + 1}`, `a${i + 1}`));
    const listB = Array.from({ length: 16 }, (_, i) => listItem(`b${i + 1}`, `b${i + 1}`));
    const root = buildDocumentRoot([
      ol("olAll", [...listA, paragraphBlock("sep", "separator"), ...listB]),
    ]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    const expected = [
      ...Array.from({ length: 5 }, (_, i) => `${i + 1}.`), // list A: 1..5
      ...Array.from({ length: 16 }, (_, i) => `${i + 1}.`), // list B restarts: 1..16
    ];
    expect(flatMarkers(result)).toEqual(expected);
  });
});
