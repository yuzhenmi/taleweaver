import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass, cascadePassIncremental } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import { layoutBlock } from "./bfc";
import { createMockShaper } from "@taleweaver/core";
import {
  isLayoutBoxReusable,
  createLayoutBoxCache,
  buildLayoutBoxCacheFromTree,
  renderNodesLayoutEquivalent,
  type ReuseInputs,
} from "./layout-reuse";
import { createBlockBox } from "./layout-box";
import type { BlockBox } from "./layout-box";
import type { LayoutContext } from "./layout-context";
import { layoutTree } from "./dispatch";
import { layoutTreeIncremental } from "./layout-incremental";
import { positionTreeForTest } from "../test-utils/position-tree";
import type { LayoutBox } from "./layout-box";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const shaper = createMockShaper(8, 16);

// Helper: create a minimal BlockBox for predicate tests.
function makeBlockBox(overrides: Partial<{
  key: string;
  inlineOffset: number;
  blockOffset: number;
  inlineSize: number;
  blockSize: number;
}>): BlockBox {
  const defaults = {
    key: "test",
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: 500,
    blockSize: 100,
  };
  const args = { ...defaults, ...overrides };
  return createBlockBox(
    args.key,
    args.inlineOffset, args.blockOffset,
    args.inlineSize, args.blockSize,
    INITIAL_COMPUTED_STYLE.writingMode, INITIAL_COMPUTED_STYLE.direction,
    INITIAL_COMPUTED_STYLE, { ...INITIAL_COMPUTED_STYLE } as never,
    [],
    /* containingInlineSize */ 500,
  );
}

function makeInputs(overrides: Partial<ReuseInputs> = {}): ReuseInputs {
  return {
    computedStyle: INITIAL_COMPUTED_STYLE,
    availableInlineSize: 500,
    writingMode: INITIAL_COMPUTED_STYLE.writingMode,
    direction: INITIAL_COMPUTED_STYLE.direction,
    floatEnvDirtyBlockOffset: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

// ─── isLayoutBoxReusable ────────────────────────────────────────────────────

describe("isLayoutBoxReusable", () => {
  it("reuses when all inputs match", () => {
    const prev = makeBlockBox({});
    expect(isLayoutBoxReusable(prev, makeInputs())).toBe(true);
  });

  it("does not reuse when computed style differs (different display)", () => {
    const prev = makeBlockBox({});
    // Produce a genuinely different ComputedStyle by cascading a node with display:inline-block.
    const cascaded = cascadePass(createElementBox("x", { display: "inline-block" }, []));
    const cs = cascaded.computedStyle;
    if (!cs) throw new Error("cascade required");
    expect(isLayoutBoxReusable(prev, makeInputs({ computedStyle: cs }))).toBe(false);
  });

  it("does not reuse when availableInlineSize differs", () => {
    const prev = makeBlockBox({ inlineSize: 500 });
    expect(isLayoutBoxReusable(prev, makeInputs({ availableInlineSize: 400 }))).toBe(false);
  });

  it("does not reuse when writingMode differs", () => {
    const prev = makeBlockBox({});
    expect(isLayoutBoxReusable(prev, makeInputs({ writingMode: "vertical-rl" }))).toBe(false);
  });

  it("does not reuse when direction differs", () => {
    const prev = makeBlockBox({});
    expect(isLayoutBoxReusable(prev, makeInputs({ direction: "rtl" }))).toBe(false);
  });

  it("does not reuse when float dirty offset is at box block-end", () => {
    // prev box occupies [0, 100]; dirty offset = 100 = blockOffset + blockSize
    const prev = makeBlockBox({ blockOffset: 0, blockSize: 100 });
    expect(
      isLayoutBoxReusable(prev, makeInputs({ floatEnvDirtyBlockOffset: 100 })),
    ).toBe(false);
  });

  it("does not reuse when float dirty offset is above box", () => {
    // prev box occupies [50, 150]; dirty offset = 60 < 150
    const prev = makeBlockBox({ blockOffset: 50, blockSize: 100 });
    expect(
      isLayoutBoxReusable(prev, makeInputs({ floatEnvDirtyBlockOffset: 60 })),
    ).toBe(false);
  });

  it("reuses when float dirty offset is strictly below box block-end", () => {
    // prev box occupies [0, 100]; dirty offset = 101 > 100
    const prev = makeBlockBox({ blockOffset: 0, blockSize: 100 });
    expect(
      isLayoutBoxReusable(prev, makeInputs({ floatEnvDirtyBlockOffset: 101 })),
    ).toBe(true);
  });

  it("reuses when float dirty offset is POSITIVE_INFINITY (no float change)", () => {
    const prev = makeBlockBox({});
    expect(
      isLayoutBoxReusable(prev, makeInputs({ floatEnvDirtyBlockOffset: Number.POSITIVE_INFINITY })),
    ).toBe(true);
  });
});

// ─── createLayoutBoxCache / buildLayoutBoxCacheFromTree ─────────────────────

describe("createLayoutBoxCache", () => {
  it("stores and retrieves entries by key", () => {
    const cache = createLayoutBoxCache();
    const box = makeBlockBox({ key: "abc" });
    const rn = createElementBox("abc", { display: "block" }, []);
    cache.set("abc", { box, renderNode: rn, inFlowConsumed: box.blockSize });
    const entry = cache.get("abc");
    expect(entry).toBeDefined();
    expect(entry?.box).toBe(box);
    expect(entry?.renderNode).toBe(rn);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("clear() removes all entries", () => {
    const cache = createLayoutBoxCache();
    const rn = createElementBox("a", { display: "block" }, []);
    cache.set("a", { box: makeBlockBox({ key: "a" }), renderNode: rn, inFlowConsumed: 0 });
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("buildLayoutBoxCacheFromTree", () => {
  it("indexes root box with its render node", () => {
    const rn = createElementBox("root", { display: "block" }, []);
    const box = makeBlockBox({ key: "root" });
    const cache = buildLayoutBoxCacheFromTree(box, rn);
    const entry = cache.get("root");
    expect(entry?.box).toBe(box);
    expect(entry?.renderNode).toBe(rn);
  });

  it("indexes nested children", () => {
    // Build an actual layout tree.
    const child = createElementBox("child", { display: "block", blockSize: 20 }, []);
    const parent = createElementBox("parent", { display: "block" }, [child]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const rootResult = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (rootResult.box === null) throw new Error("layoutBlock returned null box");
    const rootBox = rootResult.box;
    const cache = buildLayoutBoxCacheFromTree(rootBox, cascaded);
    const rootEntry = cache.get("parent");
    expect(rootEntry?.box).toBe(rootBox);
    // The child box should also be indexed.
    const childEntry = cache.get("child");
    expect(childEntry).toBeDefined();
    expect(childEntry?.box.key).toBe("child");
  });

  it("accepts an existing cache and populates it", () => {
    const rn = createElementBox("root", { display: "block" }, []);
    const box = makeBlockBox({ key: "root" });
    const cache = createLayoutBoxCache();
    buildLayoutBoxCacheFromTree(box, rn, cache);
    expect(cache.get("root")?.box).toBe(box);
  });

  it("indexes children flattened through a display:contents wrapper (P1.C.1a)", () => {
    // `groupChildren` flattens the contents wrapper, so the layout boxes carry
    // the grandchildren keys ("a", "b") — NOT the wrapper's key ("sec"). The
    // cache must index by the FLATTENED render children so those layout boxes
    // reach their render nodes; otherwise L-PERF-A reuse silently breaks for
    // them on every keystroke.
    const a = createElementBox("a", { display: "block", blockSize: 20 }, []);
    const b = createElementBox("b", { display: "block", blockSize: 20 }, []);
    const sec = createElementBox("sec", { display: "contents" }, [a, b]);
    const parent = createElementBox("parent", { display: "block" }, [sec]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const rootResult = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (rootResult.box === null) throw new Error("layoutBlock returned null box");
    const cache = buildLayoutBoxCacheFromTree(rootResult.box, cascaded);
    // The flattened grandchildren are indexed (reachable for reuse).
    expect(cache.get("a")?.box.key).toBe("a");
    expect(cache.get("b")?.box.key).toBe("b");
    // The suppressed wrapper produced no box, so it is absent from the cache.
    expect(cache.get("sec")).toBeUndefined();
  });
});

// ─── Integration: subtree reuse end-to-end ─────────────────────────────────

describe("layoutBlock subtree reuse (incremental)", () => {
  it("reuses a block unchanged by the edit (p2 not affected by p1 edit)", () => {
    // Build first layout: [p1[t1], p2[t2]]
    const t1 = createTextBox("t1", { display: "inline" }, "first paragraph");
    const t2 = createTextBox("t2", { display: "inline" }, "second paragraph");
    const p1 = createElementBox("p1", { display: "block" }, [t1]);
    const p2 = createElementBox("p2", { display: "block" }, [t2]);
    const doc = createElementBox("doc", { display: "block" }, [p1, p2]);

    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");

    const ctx1 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r1 = layoutBlock(cascaded, 0, 0, ctx1, shaper, undefined);
    if (r1.box === null) throw new Error("layoutBlock returned null box");
    if (r1.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out1 = r1.box;

    // Find p2's box from the first layout.
    const p2Box1 = out1.children.find((c) => c.key === "p2");
    expect(p2Box1).toBeDefined();

    // Edit p1's text but leave p2 unchanged (same reference).
    const t1Edited = createTextBox("t1", { display: "inline" }, "FIRST paragraph");
    const p1Edited = createElementBox("p1", { display: "block" }, [t1Edited]);
    // IMPORTANT: p2 is the SAME reference — structural sharing.
    const docEdited = createElementBox("doc", { display: "block" }, [p1Edited, p2]);

    // Use incremental cascade so that the unchanged p2 subtree gets the
    // same cascaded node reference as before (structural sharing).
    const cascadedEdited = cascadePassIncremental(docEdited, doc, cascaded);
    if (cascadedEdited.type !== "element") throw new Error("?");

    // Build prevLayoutCache from first layout, using the first cascaded render tree.
    const prevCache = buildLayoutBoxCacheFromTree(out1, cascaded);

    // Inject prevLayoutCache into a new root context.
    const ctx2: LayoutContext = {
      ...makeRootContext(INITIAL_COMPUTED_STYLE, 500),
      prevLayoutCache: prevCache,
      prevFloatEnv: null,
    };
    const r2 = layoutBlock(cascadedEdited, 0, 0, ctx2, shaper, undefined);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    if (r2.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out2 = r2.box;

    // p2's box should be the SAME reference as before — reused.
    const p2Box2 = out2.children.find((c) => c.key === "p2");
    expect(p2Box2).toBeDefined();
    expect(p2Box2).toBe(p2Box1); // reference-equality!

    // Sanity check: p1 was edited so it must NOT be reused.
    const p1Box1 = out1.children.find((c) => c.key === "p1");
    const p1Box2 = out2.children.find((c) => c.key === "p1");
    expect(p1Box2).not.toBe(p1Box1);
  });

  it("reused box's inFlowConsumed excludes an enclosed taller float (not box.blockSize)", () => {
    // A BFC root that ENCLOSES a float TALLER than its in-flow content: a 60px
    // left float beside a single ~16px text line. `box.blockSize` is dragged up
    // to the float edge (~60) but the in-flow flow only consumed ~16. The
    // layout-box cache must report the TRUE in-flow size (~16) on REUSE — the
    // pre-fix code reconstructed it from `box.blockSize` (~60), over-reporting.
    const tree = cascadePass(
      createElementBox("root", { display: "block" }, [
        createElementBox("f", { display: "block", float: "inline-start", inlineSize: 50, blockSize: 60 }, []),
        createElementBox("p", { display: "block", whiteSpace: "pre" }, [
          createTextBox("p-t", { whiteSpace: "pre" }, "x"),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element root");

    // Fresh layout: blockSize is dragged up to the float (≥60); inFlowConsumed
    // is the short text line (<60).
    const ctx1 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r1 = layoutBlock(tree, 0, 0, ctx1, shaper, undefined);
    if (r1.box === null) throw new Error("layoutBlock returned null box");
    if (r1.box.type !== "block") throw new Error("expected block root");
    expect(r1.box.blockSize).toBeGreaterThanOrEqual(60);
    const trueInFlow = r1.inFlowConsumed;
    expect(trueInFlow).toBeLessThan(60);

    // Build the cache from the POSITIONED box tree (the production path: the
    // result's in-flow scalar is gone; the cache reads it back from the box).
    const prevCache = buildLayoutBoxCacheFromTree(r1.box, tree);

    // The cache entry itself reports the EXACT in-flow size — NOT box.blockSize.
    const entry = prevCache.get("root");
    expect(entry).toBeDefined();
    expect(entry?.inFlowConsumed).toBe(trueInFlow);
    expect(entry?.inFlowConsumed).toBeLessThan(60);

    // Re-layout at the SAME (0, 0) position with the cache injected → the root
    // box hits the cache-reuse path (same-position fast return). The reused
    // LayoutResult.inFlowConsumed must be the TRUE in-flow value, not ~60.
    const ctx2: LayoutContext = {
      ...makeRootContext(INITIAL_COMPUTED_STYLE, 500),
      prevLayoutCache: prevCache,
      prevFloatEnv: null,
    };
    const r2 = layoutBlock(tree, 0, 0, ctx2, shaper, undefined);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    if (r2.box.type !== "block") throw new Error("expected block root");
    // Cache reuse fired (same box reference returned for same-position hit).
    expect(r2.box).toBe(r1.box);
    expect(r2.inFlowConsumed).toBe(trueInFlow);
    expect(r2.inFlowConsumed).toBeLessThan(60);
  });

  it("does not reuse when container inline-size changes", () => {
    const child = createElementBox("child", { display: "block" }, []);
    const doc = createElementBox("doc", { display: "block" }, [child]);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");

    const ctx1 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r3 = layoutBlock(cascaded, 0, 0, ctx1, shaper, undefined);
    if (r3.box === null) throw new Error("layoutBlock returned null box");
    if (r3.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out1 = r3.box;
    const childBox1 = out1.children.find((c) => c.key === "child");
    expect(childBox1).toBeDefined();

    const prevCache = buildLayoutBoxCacheFromTree(out1, cascaded);
    // Different container width — reuse should be prevented.
    const ctx2: LayoutContext = {
      ...makeRootContext(INITIAL_COMPUTED_STYLE, 600),
      prevLayoutCache: prevCache,
      prevFloatEnv: null,
    };
    const r4 = layoutBlock(cascaded, 0, 0, ctx2, shaper, undefined);
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    if (r4.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out2 = r4.box;
    const childBox2 = out2.children.find((c) => c.key === "child");
    expect(childBox2).not.toBe(childBox1);
  });

  it("behaves identically when prevLayoutCache is null (cold start)", () => {
    const child = createElementBox("child", { display: "block", blockSize: 40 }, []);
    const doc = createElementBox("doc", { display: "block" }, [child]);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");

    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r5 = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out = r5.box;
    expect(out.type).toBe("block");
    expect(out.height).toBe(40);
  });

  // Plan 3.K.2 Task 3 — when the parent render-node was rebuilt but its
  // children are reference-equal to the cached version (a "structurally inert"
  // rebuild), the parent's layout output is provably identical and we should
  // reuse the cached LayoutBox without iterating children.
  it("reuses the parent box when its render-node was rebuilt but children are ref-equal", () => {
    // Cascade an element. Then synthesize a "rebuilt parent" with the SAME
    // children references but a different parent reference.
    const c1 = createElementBox("c1", { display: "block", blockSize: 30 }, []);
    const c2 = createElementBox("c2", { display: "block", blockSize: 40 }, []);
    const docA = createElementBox("doc", { display: "block" }, [c1, c2]);
    const cascadedA = cascadePass(docA);
    if (cascadedA.type !== "element") throw new Error("?");

    const ctx1 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r6 = layoutBlock(cascadedA, 0, 0, ctx1, shaper, undefined);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out1 = r6.box;
    const docBox1 = out1;

    // Simulate "parent rebuilt, children unchanged": cascade A again with
    // same children list but a fresh parent. Use cascadePassIncremental to
    // preserve children-reference equality.
    const docB = createElementBox("doc", { display: "block" }, [c1, c2]);
    expect(docB).not.toBe(docA); // fresh parent reference
    const cascadedB = cascadePassIncremental(docB, docA, cascadedA);
    if (cascadedB.type !== "element") throw new Error("?");
    // Sanity: parent's reference is fresh; children are unchanged via cascade reuse.
    expect(cascadedB).not.toBe(cascadedA);
    expect(cascadedB.children[0]).toBe(cascadedA.children[0]);
    expect(cascadedB.children[1]).toBe(cascadedA.children[1]);

    const prevCache = buildLayoutBoxCacheFromTree(out1, cascadedA);
    const ctx2: LayoutContext = {
      ...makeRootContext(INITIAL_COMPUTED_STYLE, 500),
      prevLayoutCache: prevCache,
      prevFloatEnv: null,
    };
    const r7 = layoutBlock(cascadedB, 0, 0, ctx2, shaper, undefined);
    if (r7.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r7.box;

    // The parent box itself is reused: same reference as before.
    expect(out2).toBe(docBox1);
  });
});

describe("buildLayoutBoxCacheFromTree (paginated, L-PERF-A)", () => {
  it("descends through PageBox wrappers to index per-page paragraph boxes", () => {
    // Build a multi-paragraph doc that paginates across two short pages.
    // Each paragraph is ~16px tall (one line) given the mock shaper's
    // 8x16 grid; a 40px page-block fits 2 paragraphs.
    const paragraphs = [];
    for (let i = 0; i < 4; i++) {
      const t = createTextBox(`t${i}`, { display: "inline" }, "x");
      paragraphs.push(createElementBox(`p${i}`, { display: "block" }, [t]));
    }
    const doc = createElementBox("doc", { display: "block" }, paragraphs);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");
    const pageConfig = {
      pageInlineSize: 500,
      pageBlockSize: 40,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const paginatedRoot = positionTreeForTest(layoutTree(cascaded, 500, shaper, pageConfig));

    const cache = buildLayoutBoxCacheFromTree(paginatedRoot, cascaded);
    // After the fix, every paragraph child of the doc has a cache entry —
    // even though it's nested under PageBox + per-page BlockBox wrappers.
    for (let i = 0; i < 4; i++) {
      const entry = cache.get(`p${i}`);
      expect(entry).toBeDefined();
      expect(entry?.box.key).toBe(`p${i}`);
    }
  });

  it("indexes a SINGLE PageBox passed as root (transparent-wrapper descent)", () => {
    // `buildLayoutBoxCacheFromTree` must descend through a PageBox + per-page
    // BlockBox wrapper to reach the per-page paragraph boxes when a SINGLE
    // PageBox is passed as the tree root (not the outer all-pages BlockBox).
    // NOTE: the virtual `getPage` no longer calls this with a PageBox root —
    // the per-page `prevLayoutCache` that did was removed (it reused shifted
    // blocks at stale offsets; see "paginated layout reuse across keystrokes"
    // below). This still guards the descent contract, which the legacy
    // non-virtual `layoutTreeIncremental` path and callers rely on.
    const paragraphs = [];
    for (let i = 0; i < 4; i++) {
      const t = createTextBox(`t${i}`, { display: "inline" }, "x");
      paragraphs.push(createElementBox(`p${i}`, { display: "block" }, [t]));
    }
    const doc = createElementBox("doc", { display: "block" }, paragraphs);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");
    const pageConfig = {
      pageInlineSize: 500,
      pageBlockSize: 40, // fits ~2 one-line paragraphs per page
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const paginatedRoot = positionTreeForTest(layoutTree(cascaded, 500, shaper, pageConfig));
    if (!("children" in paginatedRoot)) throw new Error("expected positioned tree");
    const firstPage = nth(paginatedRoot.children, 0, "page");
    expect(firstPage.type).toBe("page");

    // Pass the SINGLE PageBox as the root (the transparent-wrapper descent).
    const cache = buildLayoutBoxCacheFromTree(firstPage, cascaded);
    // The first page holds p0 and p1; both must be indexed despite being
    // nested under the PageBox + per-page BlockBox wrappers.
    expect(cache.get("p0")?.box.key).toBe("p0");
    expect(cache.get("p1")?.box.key).toBe("p1");
  });
});

describe("paginated layout reuse across keystrokes", () => {
  it("reuses unchanged PAGES by reference; re-materializes the edited page correctly", () => {
    // Build a 4-paragraph doc (2 paragraphs per page: 16px lines, 40px pages →
    // page 0 = p0,p1; page 1 = p2,p3), paginate, then edit p0 and re-paginate.
    //
    // The virtual layout reuses WHOLE unchanged pages by reference (the
    // page-level carry-forward memo). It does NOT reuse individual blocks
    // WITHIN a re-materialized page: an earlier per-page `prevLayoutCache`
    // attempted that but reused SHIFTED blocks at their stale offset (the
    // Enter-at-start paint bug), so it was removed. Editing p0 therefore
    // re-materializes the whole of page 0 (p0 AND p1 get fresh boxes, but
    // positioned correctly), while page 1 (p2,p3) is reused by reference.
    //
    // The load-bearing guarantee is CORRECTNESS: the incremental output must be
    // structurally identical to a fresh, non-incremental layout of the edit.
    const paragraphs = [];
    for (let i = 0; i < 4; i++) {
      const t = createTextBox(`t${i}`, { display: "inline" }, "x");
      paragraphs.push(createElementBox(`p${i}`, { display: "block" }, [t]));
    }
    const doc = createElementBox("doc", { display: "block" }, paragraphs);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");
    const pageConfig = {
      pageInlineSize: 500,
      pageBlockSize: 40,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const out1 = layoutTree(cascaded, 500, shaper, pageConfig);
    // Materialize the (virtual) paginated output once. This populates out1's
    // per-page memo BEFORE out2 is built, so out2's carry-forward memo can
    // reuse out1's unchanged PageBoxes by reference — the virtual-mode analog
    // of the L-PERF-A subtree reuse this test guards.
    const out1Positioned = positionTreeForTest(out1);

    // Find each paragraph's layout box from the paginated output.
    function findParagraphBox(root: BlockBox, key: string): BlockBox | undefined {
      if (root.key === key && root.type === "block") return root;
      if (!("children" in root)) return undefined;
      for (const child of root.children) {
        if (child.type === "block") {
          const hit = findParagraphBox(child as BlockBox, key);
          if (hit !== undefined) return hit;
        } else if ("children" in child) {
          // PageBox or other wrapper.
          for (const grandchild of (child as { children: readonly LayoutBox[] }).children) {
            if (grandchild.type === "block") {
              const hit = findParagraphBox(grandchild as BlockBox, key);
              if (hit !== undefined) return hit;
            }
          }
        }
      }
      return undefined;
    }
    if (out1Positioned.type !== "block") throw new Error("expected BlockBox root");
    const p1Box1 = findParagraphBox(out1Positioned, "p1");
    const p2Box1 = findParagraphBox(out1Positioned, "p2");
    const p3Box1 = findParagraphBox(out1Positioned, "p3");
    expect(p1Box1).toBeDefined();
    expect(p2Box1).toBeDefined();
    expect(p3Box1).toBeDefined();

    // Edit p0 only (text "x" → "X"; same width/height, so nothing shifts).
    const t0Edited = createTextBox("t0", { display: "inline" }, "X");
    const p0Edited = createElementBox("p0", { display: "block" }, [t0Edited]);
    const docEdited = createElementBox("doc", { display: "block" }, [
      p0Edited,
      nth(paragraphs, 1, "paragraph"), nth(paragraphs, 2, "paragraph"), nth(paragraphs, 3, "paragraph"),
    ]);
    const cascadedEdited = cascadePassIncremental(docEdited, doc, cascaded);
    if (cascadedEdited.type !== "element") throw new Error("?");

    // Re-paginate incrementally (the wiring the editor uses): out1 is the prev
    // tree, so its materialized pages seed the page-level carry-forward memo.
    const out2 = layoutTreeIncremental(
      cascadedEdited,
      cascaded,
      out1,
      500,
      shaper,
      pageConfig,
    );
    const out2Positioned = positionTreeForTest(out2);
    if (out2Positioned.type !== "block") throw new Error("expected BlockBox root");

    // CORRECTNESS: the incremental output is structurally identical to a fresh,
    // non-incremental layout of the edited doc. This is the guarantee the
    // removed intra-page cache violated (it left shifted blocks at stale y).
    const fresh = layoutTree(cascadedEdited, 500, shaper, pageConfig);
    const freshPositioned = positionTreeForTest(fresh);
    expect(out2Positioned).toEqual(freshPositioned);

    const p1Box2 = findParagraphBox(out2Positioned, "p1");
    const p2Box2 = findParagraphBox(out2Positioned, "p2");
    const p3Box2 = findParagraphBox(out2Positioned, "p3");

    // Page 0 (p0,p1) was re-materialized because p0's edit changed its
    // fingerprint: p1 gets a FRESH box, but positioned identically (the edit
    // did not shift it).
    expect(p1Box2).not.toBe(p1Box1);
    expect(p1Box2).toEqual(p1Box1);

    // Page 1 (p2,p3) is unchanged ⇒ reused by reference (page-level memo).
    expect(p2Box2).toBe(p2Box1);
    expect(p3Box2).toBe(p3Box1);
  });
});

describe("renderNodesLayoutEquivalent", () => {
  it("returns true when both nodes are the same reference", () => {
    const a = createElementBox("a", { display: "block" }, []);
    expect(renderNodesLayoutEquivalent(a, a)).toBe(true);
  });

  it("returns true when an ElementBox was rebuilt with the same children references", () => {
    const c1 = createElementBox("c1", { display: "block" }, []);
    const c2 = createElementBox("c2", { display: "block" }, []);
    const a = createElementBox("doc", { display: "block" }, [c1, c2]);
    // Build a "rebuilt" parent. Compose its computedStyle to match a's via
    // cascade reuse so the comparison's computedStyle ref-equality holds.
    const cascadedA = cascadePass(a);
    const b = createElementBox("doc", { display: "block" }, [c1, c2]);
    const cascadedB = cascadePassIncremental(b, a, cascadedA);
    expect(renderNodesLayoutEquivalent(cascadedA, cascadedB)).toBe(true);
  });

  it("returns false when keys differ", () => {
    const a = createElementBox("doc", { display: "block" }, []);
    const b = createElementBox("DIFFERENT", { display: "block" }, []);
    expect(renderNodesLayoutEquivalent(a, b)).toBe(false);
  });

  it("returns false when child references differ", () => {
    const c1 = createElementBox("c1", { display: "block" }, []);
    const c1b = createElementBox("c1", { display: "block" }, []); // different reference, same key
    const a = createElementBox("doc", { display: "block" }, [c1]);
    const b = createElementBox("doc", { display: "block" }, [c1b]);
    expect(renderNodesLayoutEquivalent(a, b)).toBe(false);
  });

  it("returns false when children-array length differs", () => {
    const c1 = createElementBox("c1", { display: "block" }, []);
    const a = createElementBox("doc", { display: "block" }, [c1]);
    const b = createElementBox("doc", { display: "block" }, []);
    expect(renderNodesLayoutEquivalent(a, b)).toBe(false);
  });

  it("returns false when types differ", () => {
    const a = createElementBox("a", { display: "block" }, []);
    const b = createTextBox("a", { display: "inline" }, "hello");
    expect(renderNodesLayoutEquivalent(a, b)).toBe(false);
  });

  it("compares text content for text nodes (different text → false)", () => {
    const a = createTextBox("t", { display: "inline" }, "hello");
    const b = createTextBox("t", { display: "inline" }, "world");
    expect(renderNodesLayoutEquivalent(a, b)).toBe(false);
  });
});
