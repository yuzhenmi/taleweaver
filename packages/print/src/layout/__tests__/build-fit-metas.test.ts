// packages/core/src/layout/__tests__/build-fit-metas.test.ts
//
// Direct unit tests for `buildBlockFitMetas`: classification (ifc / table /
// container / empty-block) and the metadata each meta carries (margins, breaks,
// total height, line / row block-sizes, listItem). The end-to-end equivalence
// to real layout is proven by `measure-pass-equivalence.test.ts`.

import { describe, it, expect } from "vitest";
import {
  buildBlockFitMetas,
  __getMetaBuildCountForTest,
  __resetMetaBuildCountForTest,
} from "../build-fit-metas";
import { createMockShaper } from "@taleweaver/core";
import { createMockHyphenator } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";

function cascade(children: readonly ElementBox[], rootStyle: Style = { display: "block" }): ElementBox {
  const root = cascadePass(createElementBox("root", rootStyle, children));
  if (root.type !== "element") throw new Error("non-element");
  return root;
}

/**
 * Build a cascaded root whose top-level children are exactly `cascadedChildren`
 * (already-cascaded `ElementBox`es), WITHOUT re-cascading them. This lets a test
 * share child references across two roots — the lever the incremental cache
 * keys on. The root carries the same default-block computed style the helper
 * `cascade` produces, so the children's inherited styles (computed when they
 * were first cascaded under an identical root) stay consistent.
 */
function rootFromCascadedChildren(cascadedChildren: readonly RenderNode[]): ElementBox {
  const bareRoot = cascadePass(createElementBox("root", { display: "block" }, []));
  if (bareRoot.type !== "element") throw new Error("non-element");
  return Object.freeze({
    ...bareRoot,
    children: Object.freeze([...cascadedChildren]),
  });
}

const shaper = () => createMockShaper(8, 16);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

describe("buildBlockFitMetas", () => {
  it("classifies a paragraph (inline content) as an ifc leaf with line block-sizes", () => {
    const text = createTextBox("p-t", { whiteSpace: "pre" }, "x\nx\nx");
    const p = createElementBox("p", { display: "block", whiteSpace: "pre" } as Style, [text]);
    const metas = buildBlockFitMetas(cascade([p]), shaper(), undefined, 600);
    expect(metas).toHaveLength(1);
    const m0 = nth(metas, 0, "meta");
    expect(m0.kind).toBe("ifc");
    expect(m0.lineBlockSizes).toEqual([16, 16, 16]);
    expect(m0.totalBlockSize).toBe(48);
    expect(m0.orphans).toBe(2);
    expect(m0.widows).toBe(2);
    expect(m0.lineEndsWithHyphen).toEqual([false, false, false]);
  });

  it("classifies an explicit-height empty block as a container with no children", () => {
    const spacer = createElementBox("s", { display: "block", blockSize: 80 } as Style, []);
    const metas = buildBlockFitMetas(cascade([spacer]), shaper(), undefined, 600);
    const m0 = nth(metas, 0, "meta");
    expect(m0.kind).toBe("block");
    expect(m0.children).toEqual([]);
    expect(m0.totalBlockSize).toBe(80);
  });

  it("classifies display:table as a table leaf with row block-sizes", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      createElementBox(`r${i}`, { display: "table-row", blockSize: 30 } as Style, [
        createElementBox(`c${i}`, { display: "table-cell" } as Style, [createTextBox(`t${i}`, {}, "x")]),
      ]),
    );
    const table = createElementBox("tbl", { display: "table" } as Style, rows);
    const metas = buildBlockFitMetas(cascade([table]), shaper(), undefined, 600);
    const m0 = nth(metas, 0, "meta");
    expect(m0.kind).toBe("table");
    expect(m0.rowBlockSizes).toEqual([30, 30, 30]);
    expect(m0.totalBlockSize).toBe(90);
  });

  it("classifies a block with block children as a container and recurses", () => {
    const quote = createElementBox("q", { display: "block" } as Style, [
      createElementBox("q0", { display: "block", whiteSpace: "pre" } as Style, [createTextBox("q0t", { whiteSpace: "pre" }, "x\nx")]),
      createElementBox("q1", { display: "block", whiteSpace: "pre" } as Style, [createTextBox("q1t", { whiteSpace: "pre" }, "x")]),
    ]);
    const metas = buildBlockFitMetas(cascade([quote]), shaper(), undefined, 600);
    const m0 = nth(metas, 0, "meta");
    expect(m0.kind).toBe("block");
    expect(m0.children).toHaveLength(2);
    const children = m0.children ?? [];
    expect(nth(children, 0, "child meta").kind).toBe("ifc");
    expect(nth(children, 0, "child meta").lineBlockSizes).toEqual([16, 16]);
    expect(nth(children, 1, "child meta").lineBlockSizes).toEqual([16]);
    expect(m0.totalBlockSize).toBe(48); // 3 lines × 16
  });

  it("reads margins and break properties from computed style", () => {
    const b = createElementBox("b", {
      display: "block",
      blockSize: 40,
      marginBlockStart: 10,
      marginBlockEnd: 20,
      breakBefore: "page",
      breakAfter: "page",
      breakInside: "avoid",
    } as Style, []);
    const metas = buildBlockFitMetas(cascade([b]), shaper(), undefined, 600);
    const m0 = nth(metas, 0, "meta");
    expect(m0.marginBlockStart).toBe(10);
    expect(m0.marginBlockEnd).toBe(20);
    expect(m0.breakBefore).toBe("page");
    expect(m0.breakAfter).toBe("page");
    expect(m0.breakInsideAvoid).toBe(true);
  });

  it("flags display:list-item with listItem: true", () => {
    const li = createElementBox("li", { display: "list-item", whiteSpace: "pre" } as Style, [createTextBox("lit", { whiteSpace: "pre" }, "x")]);
    const metas = buildBlockFitMetas(cascade([li]), shaper(), undefined, 600);
    expect(nth(metas, 0, "meta").listItem).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Incremental cache (virtualized-layout Phase 3, Task 0). The cache keys per-
// block metas on the cascaded `ElementBox` reference + the available content
// inline-size. An unchanged block (same ref, same width) reuses its meta; a
// width change rebuilds (line wrapping is width-dependent). Bare inline-run
// groups synthesize a fresh anonymous box each call and stay UNCACHED.
// ---------------------------------------------------------------------------

/** N paragraphs, each `numLines` hard-wrapped lines (whiteSpace: pre). */
function paragraph(key: string, numLines: number): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  return createElementBox(key, { display: "block", whiteSpace: "pre" } as Style, [textNode]);
}

describe("buildBlockFitMetas — incremental cache", () => {
  // ---- (a) correctness: warm == cold ------------------------------------
  it("(a) building metas twice on the same cascaded root yields deep-equal results", () => {
    __resetMetaBuildCountForTest();
    const children = Array.from({ length: 10 }, (_, i) => paragraph(`p${i}`, (i % 3) + 1));
    const root = cascade(children);

    const cold = buildBlockFitMetas(root, shaper(), undefined, 600);
    const warm = buildBlockFitMetas(root, shaper(), undefined, 600);

    // Deep-equal: the cached (warm) metas must be identical to the fresh (cold)
    // ones — the cache must not perturb a single field.
    expect(warm).toEqual(cold);
  });

  it("(a) the warm pass builds zero new metas (every block ref-hits the cache)", () => {
    const children = Array.from({ length: 10 }, (_, i) => paragraph(`p${i}`, (i % 3) + 1));
    const root = cascade(children);

    // Hold the shaper instance constant across both passes (production uses one
    // shaper per session). A cache hit requires the same ref + width + shaper;
    // varying the shaper is exercised separately in test (d).
    const s = shaper();
    buildBlockFitMetas(root, s, undefined, 600); // warm the cache
    __resetMetaBuildCountForTest();
    buildBlockFitMetas(root, s, undefined, 600); // second pass on the SAME refs + shaper
    expect(__getMetaBuildCountForTest()).toBe(0);
  });

  // ---- (b) incrementality: single-block edit rebuilds ~1, not N ----------
  it("(b) a single dirty block in a 30-block doc rebuilds only that one meta", () => {
    const N = 30;
    // First root: 30 distinct paragraphs.
    const firstChildren = Array.from({ length: N }, (_, i) => paragraph(`p${i}`, 2));
    const firstRoot = cascade(firstChildren);
    if (firstRoot.type !== "element") throw new Error("non-element");

    // Hold the shaper instance constant across both passes (production uses one
    // shaper per session) so the unchanged blocks ref-hit the cache; varying the
    // shaper is exercised separately in test (d).
    const s = shaper();

    // Cold build: builds all 30 block metas.
    __resetMetaBuildCountForTest();
    buildBlockFitMetas(firstRoot, s, undefined, 600);
    expect(__getMetaBuildCountForTest()).toBe(N);

    // Simulate a single dirty block: reuse all of the FIRST root's cascaded
    // children BY REFERENCE except index 7, which becomes a freshly-cascaded
    // DIFFERENT block (a new ElementBox reference the cache has never seen). The
    // incremental cascade behaves exactly this way — an unchanged subtree keeps
    // its ElementBox reference, a dirty block gets a new one.
    const dirtyChild = nth(cascade([paragraph("p7", 5)]).children, 0, "dirty child");
    const secondChildren = firstRoot.children.map((c, i) => (i === 7 ? dirtyChild : c));
    const secondRoot = rootFromCascadedChildren(secondChildren);

    __resetMetaBuildCountForTest();
    buildBlockFitMetas(secondRoot, s, undefined, 600);
    // Only the one changed block rebuilds; the other 29 ref-hit the cache.
    expect(__getMetaBuildCountForTest()).toBe(1);
  });

  it("(b) rebuilt plan after a single-block edit is still correct (matches a full cold build)", () => {
    const N = 30;
    const firstChildren = Array.from({ length: N }, (_, i) => paragraph(`p${i}`, 2));
    const firstRoot = cascade(firstChildren);
    if (firstRoot.type !== "element") throw new Error("non-element");
    buildBlockFitMetas(firstRoot, shaper(), undefined, 600); // warm

    const dirtyChild = nth(cascade([paragraph("p7", 5)]).children, 0, "dirty child");
    const secondChildren = firstRoot.children.map((c, i) => (i === 7 ? dirtyChild : c));
    const secondRoot = rootFromCascadedChildren(secondChildren);

    const incremental = buildBlockFitMetas(secondRoot, shaper(), undefined, 600);
    // A reference cold build of the SAME final tree (built fresh, no cache reuse
    // of the dirty block) — the metas must be deep-equal to the incremental ones.
    const reference = buildBlockFitMetas(rootFromCascadedChildren(secondChildren), shaper(), undefined, 600);
    expect(incremental).toEqual(reference);
    expect(nth(incremental, 7, "meta").totalBlockSize).toBe(80); // 5 lines × 16
  });

  // ---- (c) width guard: a resize rebuilds all -----------------------------
  it("(c) rebuilding with a different pageContentInlineSize rebuilds every block (width changed)", () => {
    const N = 30;
    const children = Array.from({ length: N }, (_, i) => paragraph(`p${i}`, 2));
    const root = cascade(children);

    // Hold the shaper constant so ONLY the width changes between passes — this
    // isolates the width guard (the shaper guard is exercised in test (d)).
    const s = shaper();
    buildBlockFitMetas(root, s, undefined, 600); // warm at width 600

    __resetMetaBuildCountForTest();
    buildBlockFitMetas(root, s, undefined, 400); // resize → different width
    // Wrapping is width-dependent, so every block misses the width guard and
    // rebuilds — even though every ElementBox reference is unchanged.
    expect(__getMetaBuildCountForTest()).toBe(N);
  });

  // ---- (d) shaper guard: a different shaper rebuilds with new metrics ------
  it("(d) rebuilding with a different shaper instance rebuilds every block and uses the new metrics", () => {
    const N = 5;
    const children = Array.from({ length: N }, (_, i) => paragraph(`p${i}`, 2));
    const root = cascade(children);

    // Warm the cache with shaper A (line height 16). Two lines per paragraph
    // ⇒ each totalBlockSize is 2 × 16 = 32.
    const shaperA = createMockShaper(8, 16);
    const metasA = buildBlockFitMetas(root, shaperA, undefined, 600);
    expect(nth(metasA, 0, "meta").lineBlockSizes).toEqual([16, 16]);
    expect(nth(metasA, 0, "meta").totalBlockSize).toBe(32);

    // Same cascaded root + same width, but a DIFFERENT shaper instance with
    // DIFFERENT metrics (line height 24). The shaper guard must force a rebuild.
    __resetMetaBuildCountForTest();
    const shaperB = createMockShaper(10, 24);
    const metasB = buildBlockFitMetas(root, shaperB, undefined, 600);
    // Every block misses the shaper guard and rebuilds — though every
    // ElementBox reference and the width are unchanged.
    expect(__getMetaBuildCountForTest()).toBe(N);
    // The rebuilt metas reflect shaper B's metrics (24-px lines), NOT the stale
    // cached 16-px values from shaper A.
    expect(nth(metasB, 0, "meta").lineBlockSizes).toEqual([24, 24]);
    expect(nth(metasB, 0, "meta").totalBlockSize).toBe(48);
  });

  // ---- (e) hyphenator guard: a swapped Hyphenator rebuilds (HYPH.S4) -------
  it("(e) a different Hyphenator instance misses the cache; the same instance hits", () => {
    // The slice-4 auto producer makes line-wrapping depend on the hyphenator's
    // break points, so a swapped Hyphenator (different breaks ⇒ different line
    // counts ⇒ different pagination) must miss the cache and rebuild — even for
    // the same ElementBox ref + width + shaper.
    const N = 5;
    const children = Array.from({ length: N }, (_, i) => paragraph(`p${i}`, 2));
    const root = cascade(children);
    const s = shaper();
    const hyphA = createMockHyphenator({ every: 3 });
    const hyphB = createMockHyphenator({ every: 4 });

    buildBlockFitMetas(root, s, hyphA, 600); // warm with hyphenator A

    // Rebuild SAME tree + width + shaper, but a DIFFERENT hyphenator instance →
    // every block misses the hyphenator guard and rebuilds.
    __resetMetaBuildCountForTest();
    buildBlockFitMetas(root, s, hyphB, 600);
    expect(__getMetaBuildCountForTest()).toBe(N);

    // Rebuild with the SAME hyphenator B → all blocks ref-hit (count unchanged).
    __resetMetaBuildCountForTest();
    buildBlockFitMetas(root, s, hyphB, 600);
    expect(__getMetaBuildCountForTest()).toBe(0);
  });
});
