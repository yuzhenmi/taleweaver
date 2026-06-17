// packages/core/src/layout/resolve-goto-destination.test.ts
//
// #522 — internal /GoTo destination resolution for the PDF exporter. A
// cross-reference / TOC target block id resolves to its exact PDF destination
// `{ pageIndex, yTopPx, xLeftPx }` (wrapping the shipped `resolvePixelPosition`
// for exact-y + `pageOfFieldTarget` for the broken-ref / slot-target gate), or
// `null` for a broken / unindexed target. The factory partial-applies the
// document context into the `(targetId: string) => …` closure the page-emitter
// injects as `EmitPdfInput.resolveInternalDestination`.

import { describe, it, expect } from "vitest";
import {
  resolveGotoDestination,
  makeInternalDestinationResolver,
} from "./resolve-goto-destination";
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
 * Page config: 96px content area, no margins. At 16px line-height + the
 * paragraph component's default 0.5em (8px) bottom margin, each single-line
 * paragraph occupies 24px → 4 paragraphs/page. Each single-line paragraph i
 * therefore lands on page `Math.floor(i / 4)`.
 */
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 96,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

interface Built {
  state: State;
  virtual: VirtualLayoutTree;
  shaper: TextShaper;
}

/** Build a flat document of single-line paragraphs, laid out paginated. */
function buildDoc(paragraphTexts: readonly string[], cfg: PageConfig): Built {
  const blockIds = paragraphTexts.map((_, i) => `p${i}`);
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: blockIds[0],
        lastChildId: blockIds[blockIds.length - 1],
      }),
      ...paragraphTexts.map((t, i) =>
        buildBlock({
          id: nth(blockIds, i, "blockId"),
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: i > 0 ? blockIds[i - 1] : undefined,
          nextSiblingId: i < blockIds.length - 1 ? blockIds[i + 1] : undefined,
          inlineContent: inlineContent([text(t)]),
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

describe("resolveGotoDestination", () => {
  // 14 single-line paragraphs at 4 lines/page → paragraphs 0–3 on page 0,
  // 4–7 on page 1, 8–11 on page 2. "p8" is the FIRST paragraph on page 2.
  const texts = Array.from({ length: 14 }, (_, i) => `Heading ${i}`);
  const TARGET_PAGE = 2;

  it("resolves a target on a later page to its exact page-relative top-left", () => {
    const { state, virtual, shaper } = buildDoc(texts, pageConfig());
    const parentOf = makeBlockParentLookup(state);

    const dest = resolveGotoDestination(
      state,
      asBlockId("p8"),
      virtual,
      shaper,
      parentOf,
    );

    expect(dest).not.toBeNull();
    if (dest === null) throw new Error("unreachable");
    expect(dest.pageIndex).toBe(TARGET_PAGE);
    expect(dest.yTopPx).toBeGreaterThanOrEqual(0);
    expect(typeof dest.xLeftPx).toBe("number");
    // First paragraph on its page → top of the content area (page-relative
    // y = 0), no inline offset (x = 0).
    expect(dest.yTopPx).toBe(0);
    expect(dest.xLeftPx).toBe(0);
  });

  it("resolves a first-page target to page 0", () => {
    const { state, virtual, shaper } = buildDoc(texts, pageConfig());
    const parentOf = makeBlockParentLookup(state);

    const dest = resolveGotoDestination(
      state,
      asBlockId("p2"),
      virtual,
      shaper,
      parentOf,
    );

    expect(dest).not.toBeNull();
    if (dest === null) throw new Error("unreachable");
    expect(dest.pageIndex).toBe(0);
  });

  it("returns null for a missing (broken-ref) target id", () => {
    const { state, virtual, shaper } = buildDoc(texts, pageConfig());
    const parentOf = makeBlockParentLookup(state);

    const dest = resolveGotoDestination(
      state,
      asBlockId("no-such-block"),
      virtual,
      shaper,
      parentOf,
    );

    expect(dest).toBeNull();
  });
});

describe("makeInternalDestinationResolver", () => {
  const texts = Array.from({ length: 14 }, (_, i) => `Heading ${i}`);

  it("partial-applies the document context into a (targetId: string) => dest closure", () => {
    const { state, virtual, shaper } = buildDoc(texts, pageConfig());
    const parentOf = makeBlockParentLookup(state);

    const resolve = makeInternalDestinationResolver(
      state,
      virtual,
      shaper,
      parentOf,
    );

    expect(resolve("p8")?.pageIndex).toBe(2);
    expect(resolve("p2")?.pageIndex).toBe(0);
    expect(resolve("missing")).toBeNull();
  });
});
