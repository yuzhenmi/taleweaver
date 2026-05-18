import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass, cascadePassIncremental } from "../cascade";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { makeRootContext } from "./layout-context";
import { layoutBlock } from "./bfc";
import { createMockShaper } from "./mock-shaper";
import {
  isLayoutBoxReusable,
  createLayoutBoxCache,
  buildLayoutBoxCacheFromTree,
  renderNodesLayoutEquivalent,
  type ReuseInputs,
} from "./layout-reuse";
import { createBlockBox } from "./layout-box-v2";
import type { BlockBox } from "./layout-box-v2";
import type { LayoutContext } from "./layout-context";

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
    cache.set("abc", { box, renderNode: rn });
    const entry = cache.get("abc");
    expect(entry).toBeDefined();
    expect(entry?.box).toBe(box);
    expect(entry?.renderNode).toBe(rn);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("clear() removes all entries", () => {
    const cache = createLayoutBoxCache();
    const rn = createElementBox("a", { display: "block" }, []);
    cache.set("a", { box: makeBlockBox({ key: "a" }), renderNode: rn });
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
    const rootResult = layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const r1 = layoutBlock(cascaded, 0, 0, ctx1, shaper);
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
    const r2 = layoutBlock(cascadedEdited, 0, 0, ctx2, shaper);
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

  it("does not reuse when container inline-size changes", () => {
    const child = createElementBox("child", { display: "block" }, []);
    const doc = createElementBox("doc", { display: "block" }, [child]);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("?");

    const ctx1 = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r3 = layoutBlock(cascaded, 0, 0, ctx1, shaper);
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
    const r4 = layoutBlock(cascaded, 0, 0, ctx2, shaper);
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
    const r5 = layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const r6 = layoutBlock(cascadedA, 0, 0, ctx1, shaper);
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
    const r7 = layoutBlock(cascadedB, 0, 0, ctx2, shaper);
    if (r7.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r7.box;

    // The parent box itself is reused: same reference as before.
    expect(out2).toBe(docBox1);
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
