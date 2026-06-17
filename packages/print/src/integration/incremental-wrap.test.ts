/**
 * Integration: incremental wrap reference-equality tests.
 * Verifies the simple-cache-only behavior shipped in Plan 3.G Task 4:
 * - Identical re-layout reuses lines (reference-equal).
 * - Width change forces re-wrap (lines NOT reference-equal).
 * - Edit to one paragraph invalidates only that paragraph's cached state.
 */
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import { cascadePass, cascadePassIncremental } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { LayoutBox, BlockBox } from "../layout/layout-box";

const shaper = createMockShaper(10, 16);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of (box as { children: readonly LayoutBox[] }).children) {
      const r = findBoxByKey(c, key);
      if (r) return r;
    }
  }
  return null;
}

describe("Incremental wrap — reference equality", () => {
  it("identical re-layout reuses lines (using shared cache)", () => {
    const para = createElementBox("p", { display: "block" }, [
      createTextBox("t", { display: "inline" }, "hello world"),
    ]);
    const cascaded = cascadePass(para) as ElementBox;

    // Use the SAME ctx.ifcStateCache for two layouts so the second sees the cache.
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);

    const r1 = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (r1.box === null) throw new Error("layoutBlock returned null box");
    if (r1.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out1 = r1.box;
    const r2 = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    if (r2.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out2 = r2.box;

    // Lines should be reference-equal between out1 and out2 (cache hit).
    expect(out1.children.length).toBe(out2.children.length);
    for (let i = 0; i < out1.children.length; i++) {
      const child1 = nth(out1.children, i, "line child");
      if (child1.type === "line") {
        expect(nth(out2.children, i, "line child")).toBe(child1);
      }
    }
  });

  it("width change forces re-wrap (lines NOT reference-equal)", () => {
    const para = createElementBox("p", { display: "block" }, [
      createTextBox("t", { display: "inline" }, "hello world"),
    ]);
    const cascaded = cascadePass(para) as ElementBox;

    const ctx1 = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const ctx2 = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 200);

    const r3 = layoutBlock(cascaded, 0, 0, ctx1, shaper, undefined);
    if (r3.box === null) throw new Error("layoutBlock returned null box");
    if (r3.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out1 = r3.box;
    const r4 = layoutBlock(cascaded, 0, 0, ctx2, shaper, undefined);
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    if (r4.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out2 = r4.box;

    // Different widths → wraps differ → not reference-equal.
    const child1 = nth(out1.children, 0, "first child");
    const child2 = nth(out2.children, 0, "first child");
    if (child1.type === "line" && child2.type === "line") {
      expect(child2).not.toBe(child1);
    }
  });

  it("edit to one paragraph invalidates only its cached state", () => {
    // p2 uses a stable object reference shared between both layouts.
    const t2 = createTextBox("t2", { display: "inline" }, "second paragraph");
    const p2 = createElementBox("p2", { display: "block" }, [t2]);
    const p1 = createElementBox("p1", { display: "block" }, [
      createTextBox("t1", { display: "inline" }, "first paragraph text"),
    ]);
    const doc = createElementBox("doc", { display: "block" }, [p1, p2]);
    const cascaded = cascadePass(doc) as ElementBox;
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);

    const r5 = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out1 = r5.box;

    // Simulate an insertion in p1: adding a word changes token count → different ids.
    // Token ids are "{sourceKey}:{charOffset}", so adding "extra " shifts offsets.
    const p1Edited = createElementBox("p1", { display: "block" }, [
      createTextBox("t1", { display: "inline" }, "extra first paragraph text"),
    ]);
    const docEdited = createElementBox("doc", { display: "block" }, [p1Edited, p2]);
    // Use cascadePassIncremental to preserve style object identity for p2's tokens.
    // This is needed for the cache to work correctly with stricter token equality.
    const cascadedEdited = cascadePassIncremental(docEdited, doc, cascaded) as ElementBox;

    const r6 = layoutBlock(cascadedEdited, 0, 0, ctx, shaper, undefined);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r6.box;

    // p2's lines should be reference-equal (same key + tokens + width → cache hit).
    const p2Box1 = findBoxByKey(out1, "p2") as BlockBox | null;
    const p2Box2 = findBoxByKey(out2, "p2") as BlockBox | null;
    expect(p2Box1).not.toBeNull();
    expect(p2Box2).not.toBeNull();
    if (!p2Box1 || !p2Box2) throw new Error("p2 boxes not found");
    // Lines inside p2 should be ref-equal.
    if (p2Box1.children[0]?.type === "line" && p2Box2.children[0]?.type === "line") {
      expect(p2Box2.children[0]).toBe(p2Box1.children[0]);
    }

    // p1's lines should NOT be ref-equal: the token at offset 0 is now "extra"
    // instead of "first", so findChangePoint returns a change at index 0 → cache miss.
    const p1Box1 = findBoxByKey(out1, "p1") as BlockBox | null;
    const p1Box2 = findBoxByKey(out2, "p1") as BlockBox | null;
    expect(p1Box1).not.toBeNull();
    expect(p1Box2).not.toBeNull();
    if (!p1Box1 || !p1Box2) throw new Error("p1 boxes not found");
    if (p1Box1.children[0]?.type === "line" && p1Box2.children[0]?.type === "line") {
      expect(p1Box2.children[0]).not.toBe(p1Box1.children[0]);
    }
  });
});
