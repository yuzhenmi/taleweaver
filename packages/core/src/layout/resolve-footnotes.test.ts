import { describe, it, expect } from "vitest";
import type { ElementBox } from "../render/render-node";
import { createElementBox } from "../render/render-node";
import type { Style } from "../styles";
import type { BlockId } from "../state";
import type { FootnoteAnchorRef } from "../footnotes";
import type { PagePlan } from "./measure-pass";
import {
  buildBlockToTopLevelIndex,
  buildFootnotePageAssignment,
} from "./resolve-footnotes";

const EMPTY_STYLE: Style = {};

function elem(key: string): ElementBox {
  return createElementBox(key, EMPTY_STYLE, []);
}

function anchor(
  blockId: string,
  contentBlockId: string,
): FootnoteAnchorRef {
  return {
    blockId: blockId as BlockId,
    contentBlockId: contentBlockId as BlockId,
    sectionId: null,
  };
}

/**
 * A minimal typed PagePlan stub exposing only the two methods
 * `buildFootnotePageAssignment` consumes. `spans` maps a block key to its
 * inclusive page span; `pageIndexOfBlock` returns the LAST page of the span
 * (matching the real plan's whole-block-progress semantics), and
 * `pageSpanOfBlock` returns the full span. Keys absent from `spans` resolve to
 * `-1` / `null`, exactly like the real plan.
 */
function stubPlan(
  spans: Record<string, { first: number; last: number }>,
): PagePlan {
  const stub: Pick<PagePlan, "pageIndexOfBlock" | "pageSpanOfBlock"> = {
    pageIndexOfBlock(blockKey: string): number {
      const span = spans[blockKey];
      return span === undefined ? -1 : span.last;
    },
    pageSpanOfBlock(
      blockKey: string,
    ): { readonly first: number; readonly last: number } | null {
      const span = spans[blockKey];
      return span === undefined ? null : { first: span.first, last: span.last };
    },
  };
  return stub as PagePlan;
}

describe("buildBlockToTopLevelIndex", () => {
  it("maps each top-level child key to its index", () => {
    const children: ElementBox[] = [elem("a"), elem("b"), elem("c")];
    const map = buildBlockToTopLevelIndex(children);
    expect(map.get("a" as BlockId)).toBe(0);
    expect(map.get("b" as BlockId)).toBe(1);
    expect(map.get("c" as BlockId)).toBe(2);
    expect(map.size).toBe(3);
  });

  it("returns an empty map for empty input", () => {
    const map = buildBlockToTopLevelIndex([]);
    expect(map.size).toBe(0);
  });
});

describe("buildFootnotePageAssignment", () => {
  it("places two anchors on their respective pages", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 1, last: 1 },
    });
    const anchors = [anchor("b0", "fn0"), anchor("b1", "fn1")];

    const result = buildFootnotePageAssignment(anchors, plan, index);

    expect(result.get(0)).toEqual(["fn0" as BlockId]);
    expect(result.get(1)).toEqual(["fn1" as BlockId]);
  });

  it("groups two same-page anchors in document order", () => {
    const children: ElementBox[] = [elem("b0"), elem("b1")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      b1: { first: 0, last: 0 },
    });
    // Document order: fnA before fnB.
    const anchors = [anchor("b0", "fnA"), anchor("b1", "fnB")];

    const result = buildFootnotePageAssignment(anchors, plan, index);

    expect(result.get(0)).toEqual(["fnA" as BlockId, "fnB" as BlockId]);
    expect(result.size).toBe(1);
  });

  it("assigns a page-spanning anchor's block to the FIRST page of the span", () => {
    const children: ElementBox[] = [elem("bSpan")];
    const index = buildBlockToTopLevelIndex(children);
    // Block spans pages 2..4; pageIndexOfBlock would return 4 (last), but the
    // assignment must use the FIRST page (2) per plan decision D4.
    const plan = stubPlan({ bSpan: { first: 2, last: 4 } });
    const anchors = [anchor("bSpan", "fnSpan")];

    const result = buildFootnotePageAssignment(anchors, plan, index);

    expect(result.get(2)).toEqual(["fnSpan" as BlockId]);
    expect(result.has(4)).toBe(false);
  });

  it("returns an empty map for empty anchors", () => {
    const index = buildBlockToTopLevelIndex([elem("b0")]);
    const plan = stubPlan({ b0: { first: 0, last: 0 } });

    const result = buildFootnotePageAssignment([], plan, index);

    expect(result.size).toBe(0);
  });

  /**
   * Run `fn` with NODE_ENV forced to "production" (so `isDevMode()` is false),
   * restoring the prior value afterward. Used to exercise the graceful-skip
   * path: in dev the defensive cases throw (loud), in prod they skip (safe).
   */
  function inProduction<T>(fn: () => T): T {
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    const env = proc?.env;
    const prev = env?.NODE_ENV;
    if (env !== undefined) env.NODE_ENV = "production";
    try {
      return fn();
    } finally {
      if (env !== undefined) env.NODE_ENV = prev;
    }
  }

  it("throws in dev for an anchor whose blockId is absent from the top-level index", () => {
    const children: ElementBox[] = [elem("b0")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      nested: { first: 0, last: 0 },
    });
    // "nested" is not a top-level child key (anchor nested in a non-transparent
    // container, out of FN-4 scope) → dev-only throw so it can't silently vanish.
    const anchors = [anchor("b0", "fnKept"), anchor("nested", "fnSkipped")];

    expect(() => buildFootnotePageAssignment(anchors, plan, index)).toThrow(
      /not a top-level child/,
    );
  });

  it("skips (not throws) the nested anchor gracefully in production", () => {
    const children: ElementBox[] = [elem("b0")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({
      b0: { first: 0, last: 0 },
      nested: { first: 0, last: 0 },
    });
    const anchors = [anchor("b0", "fnKept"), anchor("nested", "fnSkipped")];

    const result = inProduction(() =>
      buildFootnotePageAssignment(anchors, plan, index),
    );

    expect(result.get(0)).toEqual(["fnKept" as BlockId]);
    expect([...result.values()].flat()).not.toContain("fnSkipped" as BlockId);
  });

  it("throws in dev for an anchor whose block has no resolvable page span", () => {
    const children: ElementBox[] = [elem("b0"), elem("bMissing")];
    const index = buildBlockToTopLevelIndex(children);
    // bMissing is a top-level child but absent from the plan's spans
    // (structural inconsistency: pageSpanOfBlock returns null).
    const plan = stubPlan({ b0: { first: 0, last: 0 } });
    const anchors = [anchor("b0", "fnKept"), anchor("bMissing", "fnNoPage")];

    expect(() => buildFootnotePageAssignment(anchors, plan, index)).toThrow(
      /no resolvable page span/,
    );
  });

  it("skips (not throws) the no-span anchor gracefully in production", () => {
    const children: ElementBox[] = [elem("b0"), elem("bMissing")];
    const index = buildBlockToTopLevelIndex(children);
    const plan = stubPlan({ b0: { first: 0, last: 0 } });
    const anchors = [anchor("b0", "fnKept"), anchor("bMissing", "fnNoPage")];

    const result = inProduction(() =>
      buildFootnotePageAssignment(anchors, plan, index),
    );

    expect(result.get(0)).toEqual(["fnKept" as BlockId]);
    expect([...result.values()].flat()).not.toContain("fnNoPage" as BlockId);
  });
});
