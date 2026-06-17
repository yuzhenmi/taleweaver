// packages/core/src/cursor/block-line-collector.test.ts
//
// Slice 1 — the pure multi-page line collector `collectBlockLinesAcrossPages`.
// Concatenates a spanning block's per-page `byBlock` line fragments in page
// order, the OFFSET-domain list later used for spanning-block navigation.
//
// Task 1.1 — concatenation in page order (the spanning fixture genuinely spans).
// Task 1.2 — equivalence vs `paginateRoot` (no fragment lost across the seam).
// Task 1.3 — edge cases (single-page block; blockId absent from a page).

import { describe, it, expect } from "vitest";
import { collectBlockLinesAcrossPages } from "./block-line-collector";
import { getLineIndex } from "./line-flatten";
import { buildSpanningTree } from "../test-utils/paginated-harness";
import { paginateRoot } from "../layout/paginate";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { createMockShaper } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// ---------------------------------------------------------------------------
// An independent rebuild of the SAME spanning doc `buildSpanningTree` produces,
// run through `paginateRoot` (the positioned oracle). Mirrors the harness's
// geometry + content exactly so the collector and the oracle describe the same
// block. Kept here (not exported from the harness) so the oracle path stays
// `paginateRoot`-only, distinct from the tree's `makeVirtualLayoutTree` path.
// ---------------------------------------------------------------------------

const SPANNING_BLOCK_ID = "spanning-p" as BlockId;

function spanningDoc(pages: number): { root: ElementBox; pageConfig: PageConfig } {
  const linesPerPage = 5;
  const lineHeight = 16;
  const pageBlockSize = linesPerPage * lineHeight;
  const pageConfig: PageConfig = {
    pageInlineSize: 600,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };
  const numLines = pages * linesPerPage;
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${SPANNING_BLOCK_ID}-t`, { whiteSpace: "pre" }, text);
  const paragraph = createElementBox(
    SPANNING_BLOCK_ID,
    { display: "block", whiteSpace: "pre" } as Style,
    [textNode],
  );
  const rootSpec = createElementBox("root", { display: "block" } as Style, [paragraph]);
  const cascaded = cascadePass(rootSpec);
  if (cascaded.type !== "element") throw new Error("spanningDoc: cascadePass returned a non-element root");
  return { root: cascaded, pageConfig };
}

function paginateSpanning(pages: number) {
  const { root, pageConfig } = spanningDoc(pages);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  return paginateRoot(root, ctx, createMockShaper(8, 16), undefined, pageConfig);
}

describe("collectBlockLinesAcrossPages", () => {
  // Task 1.1 — concatenation in page order, genuine span.
  it("concatenates a spanning block's per-page fragments in page order", () => {
    const { tree, blockId } = buildSpanningTree({ pages: 2 });

    const span = tree.plan.pageSpanOfBlock(blockId);
    expect(span).not.toBeNull();
    if (span === null) throw new Error("unreachable: span asserted non-null");
    expect(span.first).toBe(0);
    expect(span.last).toBe(1);

    const page0Lines = getLineIndex(tree.getPage(0)).byBlock.get(blockId);
    const page1Lines = getLineIndex(tree.getPage(1)).byBlock.get(blockId);
    // Both per-page fragments must be non-empty — proves the block genuinely spans.
    expect(page0Lines).toBeDefined();
    expect(page1Lines).toBeDefined();
    expect(page0Lines?.length ?? 0).toBeGreaterThan(0);
    expect(page1Lines?.length ?? 0).toBeGreaterThan(0);

    const collected = collectBlockLinesAcrossPages(tree, blockId, span);
    expect(collected).toEqual([...(page0Lines ?? []), ...(page1Lines ?? [])]);

    // Page indices are non-decreasing across the result.
    for (let i = 1; i < collected.length; i++) {
      expect(nth(collected, i, "collected line").pageIndex).toBeGreaterThanOrEqual(
        nth(collected, i - 1, "collected line").pageIndex,
      );
    }
  });

  // Task 1.2 — equivalence vs `paginateRoot`: no fragment lost across the seam.
  it("yields the same line count + offset sequence as paginateRoot's positioned tree", () => {
    const { tree, blockId } = buildSpanningTree({ pages: 2 });
    const span = tree.plan.pageSpanOfBlock(blockId);
    if (span === null) throw new Error("span unexpectedly null");
    const collected = collectBlockLinesAcrossPages(tree, blockId, span);

    // Oracle: the SAME doc through `paginateRoot`. `getLineIndex` over the root
    // BlockBox walks every PageBox, so `byBlock` already concatenates the block's
    // fragments across pages in document (== page) order.
    const oracleRoot = paginateSpanning(2);
    const oracleLines = getLineIndex(oracleRoot).byBlock.get(blockId);
    expect(oracleLines).toBeDefined();

    expect(collected.length).toBe(oracleLines?.length ?? 0);
    // Compare the OFFSET sequence (page-local geometry differs between the two
    // coordinate spaces, so absoluteY is NOT compared).
    const offsetsOf = (lines: readonly { line: { inlineOffsetStart: number; inlineOffsetEnd: number } }[]) =>
      lines.map((l) => [l.line.inlineOffsetStart, l.line.inlineOffsetEnd] as const);
    expect(offsetsOf(collected)).toEqual(offsetsOf(oracleLines ?? []));
  });

  // Task 1.3 — edge cases.
  it("a non-spanning block returns exactly that page's byBlock lines", () => {
    const { tree, blockId } = buildSpanningTree({ pages: 1 });
    const span = tree.plan.pageSpanOfBlock(blockId);
    if (span === null) throw new Error("span unexpectedly null");
    expect(span.first).toBe(span.last);

    const collected = collectBlockLinesAcrossPages(tree, blockId, span);
    const page0Lines = getLineIndex(tree.getPage(span.first)).byBlock.get(blockId);
    expect(collected).toEqual([...(page0Lines ?? [])]);
    expect(collected.length).toBeGreaterThan(0);
  });

  it("a blockId absent from a page contributes nothing and does not throw", () => {
    const { tree } = buildSpanningTree({ pages: 2 });
    const absent = "no-such-block" as BlockId;
    // Span both pages; neither page's byBlock has the id.
    const collected = collectBlockLinesAcrossPages(tree, absent, { first: 0, last: 1 });
    expect(collected).toEqual([]);
  });
});
