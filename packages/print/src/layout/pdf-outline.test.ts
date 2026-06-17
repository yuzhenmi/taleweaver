// packages/core/src/layout/pdf-outline.test.ts
//
// #523 — PDF outline (`/Outlines` bookmark tree) core helper. `buildPdfOutline`
// turns `getOutline`'s flat `{ blockId, level, text }[]` into a nested,
// destination-resolved `PdfOutlineNode[]`: stack nest-by-level (a level skip
// attaches to the nearest shallower ancestor) and each node's `dest` via the
// shipped `resolveGotoDestination`. Reuses #410 `getOutline` + #522
// `resolveGotoDestination`.

import { describe, it, expect } from "vitest";
import { buildPdfOutline, type PdfOutlineNode } from "./pdf-outline";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "./dispatch";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import type { VirtualLayoutTree } from "./virtual-layout-tree";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { makeBlockParentLookup } from "@taleweaver/core";
import { resolveGotoDestination } from "./resolve-goto-destination";
import { asBlockId } from "@taleweaver/core";
import type { State } from "@taleweaver/core";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Page config: 96px content area, no margins. The exact per-page heading count
 * depends on the heading component's own block margins (0.67em against each
 * heading's font size) — the dest test does NOT assume a specific count; it
 * asserts each node's `dest` equals an independent `resolveGotoDestination` call
 * and that the fixture genuinely paginates (some heading lands past page 0).
 */
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 96,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

interface HeadingSpec {
  readonly id: string;
  readonly level: number;
  readonly text: string;
}

interface Built {
  state: State;
  virtual: VirtualLayoutTree;
  shaper: TextShaper;
}

/** Build a flat document of single-line heading blocks, laid out paginated. */
function buildHeadingDoc(headings: readonly HeadingSpec[], cfg: PageConfig): Built {
  const ids = headings.map((h) => h.id);
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: ids[0],
        lastChildId: ids[ids.length - 1],
      }),
      ...headings.map((h, i) =>
        buildBlock({
          id: nth(ids, i, "headingId"),
          type: "heading",
          parentId: "doc",
          prevSiblingId: i > 0 ? ids[i - 1] : undefined,
          nextSiblingId: i < ids.length - 1 ? ids[i + 1] : undefined,
          attrs: { level: h.level },
          inlineContent: inlineContent([text(h.text)]),
        }),
      ),
    ],
  });
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const lt = layoutTree(root, cfg.pageInlineSize, shaper, cfg);
  if (lt.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated supported doc)");
  }
  return { state, virtual: lt, shaper };
}

function build(headings: readonly HeadingSpec[]): readonly PdfOutlineNode[] {
  const { state, virtual, shaper } = buildHeadingDoc(headings, pageConfig());
  const parentOf = makeBlockParentLookup(state);
  return buildPdfOutline(state, virtual, shaper, parentOf);
}

describe("buildPdfOutline", () => {
  it("nests headings by level (h1 parent, h2 children, next h1 a sibling root)", () => {
    const roots = build([
      { id: "h0", level: 1, text: "Intro" },
      { id: "h1", level: 2, text: "Background" },
      { id: "h2", level: 2, text: "Scope" },
      { id: "h3", level: 1, text: "Method" },
    ]);

    expect(roots.map((r) => r.title)).toEqual(["Intro", "Method"]);
    const intro = nth(roots, 0, "root");
    const method = nth(roots, 1, "root");
    expect(intro.children.map((c) => c.title)).toEqual(["Background", "Scope"]);
    expect(method.children).toEqual([]);
  });

  it("attaches a level skip to the nearest shallower ancestor (h1 → h3)", () => {
    const roots = build([
      { id: "h0", level: 1, text: "A" },
      { id: "h1", level: 3, text: "deep" },
    ]);

    expect(roots.map((r) => r.title)).toEqual(["A"]);
    const a = nth(roots, 0, "root");
    expect(a.children.map((c) => c.title)).toEqual(["deep"]);
  });

  it("threads each node's dest from resolveGotoDestination for its heading", () => {
    // 8 single-line headings; alternating levels so the second level-1 root
    // (h4) nests later headings as children. The roots are the two level-1
    // headings h0 and h4 (document order); h4's children are h5/h6/h7.
    const headings: HeadingSpec[] = Array.from({ length: 8 }, (_, i) => ({
      id: `h${i}`,
      level: i % 4 === 0 ? 1 : 2,
      text: `Heading ${i}`,
    }));
    const { state, virtual, shaper } = buildHeadingDoc(headings, pageConfig());
    const parentOf = makeBlockParentLookup(state);
    const roots = buildPdfOutline(state, virtual, shaper, parentOf);

    // buildPdfOutline threads each heading's resolved destination UNCHANGED —
    // assert node.dest deep-equals an independent resolveGotoDestination call
    // (robust to the exact pagination, which depends on heading margins).
    const expectDest = (node: PdfOutlineNode, id: string): void => {
      expect(node.dest).toEqual(
        resolveGotoDestination(state, asBlockId(id), virtual, shaper, parentOf),
      );
    };
    expect(roots.map((r) => r.title)).toEqual(["Heading 0", "Heading 4"]);
    const second = nth(roots, 1, "root");
    expectDest(nth(roots, 0, "root"), "h0");
    expectDest(second, "h4");
    expectDest(nth(second.children, 0, "child"), "h5");

    // The fixture genuinely paginates: at least one heading lands past page 0
    // (so the dest resolution actually exercises multiple pages).
    const allDestPages = [...roots, ...roots.flatMap((r) => r.children)].map(
      (n) => n.dest?.pageIndex,
    );
    expect(allDestPages.some((p) => p !== undefined && p > 0)).toBe(true);
  });

  it("returns [] for a heading-free document", () => {
    const { state, virtual, shaper } = buildHeadingDoc(
      [{ id: "h0", level: 1, text: "Only heading" }],
      pageConfig(),
    );
    // Replace with a paragraph-only doc: build directly.
    const paraState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p0" }),
        buildBlock({
          id: "p0",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("not a heading")]),
        }),
      ],
    });
    const root = render(
      paraState,
      createDefaultComponentRegistry(),
      createDefaultAttrRegistry(),
    ).root;
    const lt = layoutTree(root, pageConfig().pageInlineSize, shaper, pageConfig());
    if (lt.type !== "virtual-root") {
      throw new Error("expected a VirtualLayoutTree");
    }
    const parentOf = makeBlockParentLookup(paraState);
    expect(buildPdfOutline(paraState, lt, shaper, parentOf)).toEqual([]);
    // (state/virtual from the heading doc are unused here; assert the helper is callable.)
    void state;
    void virtual;
  });
});
