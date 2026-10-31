// packages/core/src/state/map-agnostic-helpers.test.ts
//
// C.2c T7a: the shared Layer-2 traversal / compare / span helpers must be
// MAP-AGNOSTIC — they resolve blocks across all three top-level Y.Maps (main
// `blocks`, `embedContents`, `templateContents`) via `resolveBlock`, not just
// the main map via `getBlock`.
//
// After C.2c T1-T6 a caret can sit inside a header/footer body, which lives in
// the templateContents tree. These helpers must traverse, compare, and iterate
// WITHIN such a body — and crucially, `selectionContextOf` must return the body
// ROOT (the templateContents subtree's parentId===null block), NOT
// `state.rootId`, so cross-context span ops can refuse header→body selections.
//
// The main-tree behavior is byte-identical: `resolveBlock`'s FIRST arm is
// `getBlock`, so a main-tree id resolves exactly as before. The existing
// block-traversal / block-compare / span-iteration / cursor-ops suites are the
// no-regression guard for that; this file only adds the templateContents-body
// coverage.

import { describe, it, expect } from "vitest";
import {
  nextBlockInDocOrder,
  prevBlockInDocOrder,
  ancestorChain,
  firstLeafBlock,
  lastLeafBlock,
} from "./block-traversal";
import { compareBlocksInDocOrder, selectionContextOf } from "./block-compare";
import { iterateSpan, iterateBlocksInSpan } from "./span-iteration";
import { moveByCharacter } from "../cursor/cursor-ops";
import { createPosition, createSpan } from "./block-position";
import { buildBlock, buildDocument, inlineContent, text, finalSectionOf } from "../test-utils/document-builders";
import type { BlockId } from "./block-id";
import type { Document } from "./document";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// A header template body: a ROOT container (parentId === null, in
// templateContents) with two child paragraphs. The main document is a single
// body paragraph. This is the canonical multi-block templateContents body the
// task asks for.
const DOC = "doc" as BlockId;
const BODY_P = "p" as BlockId;
const HDR_ROOT = "hdr-root" as BlockId;
const HDR_C1 = "hdr-c1" as BlockId;
const HDR_C2 = "hdr-c2" as BlockId;

function buildWithHeaderBody(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body")]),
      }),
    ],
    templateContents: [
      // Header body ROOT (a container with two child paragraphs).
      buildBlock({
        id: "hdr-root",
        type: "header",
        parentId: null,
        firstChildId: "hdr-c1",
        lastChildId: "hdr-c2",
      }),
      buildBlock({
        id: "hdr-c1",
        type: "paragraph",
        parentId: "hdr-root",
        nextSiblingId: "hdr-c2",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "hdr-c2",
        type: "paragraph",
        parentId: "hdr-root",
        prevSiblingId: "hdr-c1",
        inlineContent: inlineContent([text("beta")]),
      }),
    ],
  });
}

describe("C.2c T7a — ancestorChain is map-agnostic", () => {
  it("walks WITHIN a templateContents header body (does not throw 'not found')", () => {
    const document = buildWithHeaderBody();
    // hdr-c1 → hdr-root (the body root), NOT reaching state.rootId.
    expect(ancestorChain(document, HDR_C1)).toEqual([HDR_C1, HDR_ROOT]);
    expect(ancestorChain(document, HDR_C2)).toEqual([HDR_C2, HDR_ROOT]);
    // The body root itself.
    expect(ancestorChain(document, HDR_ROOT)).toEqual([HDR_ROOT]);
  });

  it("main-tree ancestorChain: paragraph → its (final) section → the root", () => {
    const document = buildWithHeaderBody();
    expect(ancestorChain(document, BODY_P)).toEqual([BODY_P, finalSectionOf(document), DOC]);
  });
});

describe("C.2c T7a — compareBlocksInDocOrder is map-agnostic", () => {
  it("orders two header paragraphs within the body correctly (does not throw)", () => {
    const document = buildWithHeaderBody();
    expect(compareBlocksInDocOrder(document, HDR_C1, HDR_C2)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(document, HDR_C2, HDR_C1)).toBeGreaterThan(0);
    expect(compareBlocksInDocOrder(document, HDR_C1, HDR_C1)).toBe(0);
  });
});

describe("C.2c T7a — selectionContextOf returns the BODY root, not state.rootId", () => {
  it("a header-body block resolves to the header body ROOT", () => {
    const document = buildWithHeaderBody();
    expect(selectionContextOf(document, HDR_C1)).toBe(HDR_ROOT);
    expect(selectionContextOf(document, HDR_C2)).toBe(HDR_ROOT);
    expect(selectionContextOf(document, HDR_ROOT)).toBe(HDR_ROOT);
    // Critically NOT the main document root.
    expect(selectionContextOf(document, HDR_C1)).not.toBe(DOC);
  });

  it("a main-tree block still resolves to the main context root", () => {
    const document = buildWithHeaderBody();
    expect(selectionContextOf(document, BODY_P)).toBe(DOC);
  });
});

describe("C.2c T7a — next/prevBlockInDocOrder are map-agnostic", () => {
  it("walks forward between the two header paragraphs", () => {
    const document = buildWithHeaderBody();
    // hdr-root → first child hdr-c1 → next sibling hdr-c2.
    expect(nextBlockInDocOrder(document, HDR_ROOT)).toBe(HDR_C1);
    expect(nextBlockInDocOrder(document, HDR_C1)).toBe(HDR_C2);
    // End of the body subtree: no parent's next sibling (body root parentId null).
    expect(nextBlockInDocOrder(document, HDR_C2)).toBeNull();
  });

  it("walks backward between the two header paragraphs", () => {
    const document = buildWithHeaderBody();
    expect(prevBlockInDocOrder(document, HDR_C2)).toBe(HDR_C1);
    // hdr-c1 is hdr-root's first child → prev is the parent.
    expect(prevBlockInDocOrder(document, HDR_C1)).toBe(HDR_ROOT);
    expect(prevBlockInDocOrder(document, HDR_ROOT)).toBeNull();
  });
});

describe("C.2c T7a — first/lastLeafBlock are map-agnostic", () => {
  it("descends into the header body subtree", () => {
    const document = buildWithHeaderBody();
    expect(firstLeafBlock(document, HDR_ROOT)).toBe(HDR_C1);
    expect(lastLeafBlock(document, HDR_ROOT)).toBe(HDR_C2);
  });
});

describe("C.2c T7a — iterateSpan / iterateBlocksInSpan are map-agnostic", () => {
  it("iterateSpan over a span WITHIN the header body yields the header leaf range(s)", () => {
    const document = buildWithHeaderBody();
    // Span from hdr-c1 offset 1 to hdr-c2 offset 2.
    const span = createSpan(
      createPosition(HDR_C1, 1),
      createPosition(HDR_C2, 2),
    );
    const ranges = Array.from(iterateSpan(document, span));
    expect(ranges.map((r) => r.block.id)).toEqual([HDR_C1, HDR_C2]);
    // "alpha" → from offset 1 to end (5).
    expect(ranges[0]).toMatchObject({ rangeStart: 1, rangeEnd: 5 });
    // "beta" → from 0 to focus offset 2.
    expect(ranges[1]).toMatchObject({ rangeStart: 0, rangeEnd: 2 });
  });

  it("iterateSpan single-block span within the header body", () => {
    const document = buildWithHeaderBody();
    const span = createSpan(
      createPosition(HDR_C1, 1),
      createPosition(HDR_C1, 4),
    );
    const ranges = Array.from(iterateSpan(document, span));
    expect(ranges.length).toBe(1);
    expect(ranges[0]).toMatchObject({ rangeStart: 1, rangeEnd: 4 });
    expect(nth(ranges, 0, "range").block.id).toBe(HDR_C1);
  });

  it("iterateBlocksInSpan walks the header body leaves in order", () => {
    const document = buildWithHeaderBody();
    const span = createSpan(
      createPosition(HDR_C1, 0),
      createPosition(HDR_C2, 0),
    );
    const blocks = Array.from(iterateBlocksInSpan(document, span));
    expect(blocks.map((b) => b.id)).toEqual([HDR_C1, HDR_C2]);
  });
});

describe("C.2c T7a — moveByCharacter is map-agnostic (cursor-ops)", () => {
  it("advances forward within a header paragraph (returns a valid Position)", () => {
    const document = buildWithHeaderBody();
    const out = moveByCharacter(document, createPosition(HDR_C1, 0), "forward");
    expect(out).toEqual({ blockId: HDR_C1, offset: 1 });
  });

  it("retreats backward within a header paragraph", () => {
    const document = buildWithHeaderBody();
    const out = moveByCharacter(document, createPosition(HDR_C1, 3), "backward");
    expect(out).toEqual({ blockId: HDR_C1, offset: 2 });
  });

  it("advances across the block boundary to the next header paragraph", () => {
    const document = buildWithHeaderBody();
    // At end of "alpha" (offset 5) → next content block hdr-c2 offset 0.
    const out = moveByCharacter(document, createPosition(HDR_C1, 5), "forward");
    expect(out).toEqual({ blockId: HDR_C2, offset: 0 });
  });
});
