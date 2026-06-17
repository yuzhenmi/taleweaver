import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { RenderNode, ElementBox } from "@taleweaver/core";
import { cascadePass, cascadePassIncremental } from "@taleweaver/core";
import { layoutTreeIncremental } from "../layout/layout-incremental";
import { positionTreeForTest } from "../test-utils/position-tree";
import { layoutBlock } from "../layout/bfc";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { buildLayoutBoxCacheFromTree } from "../layout/layout-reuse";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-box";

const shaper = createMockShaper(10, 16);

function asElement(n: RenderNode): ElementBox {
  if (n.type !== "element") throw new Error("expected element");
  return n;
}

function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKey(c, key);
      if (r) return r;
    }
  }
  return null;
}

describe("Incremental layout — subtree reuse via prevLayoutCache", () => {
  it("paragraph not affected by edit reuses LayoutBox by reference", () => {
    const t1 = createTextBox("t1", { display: "inline" }, "first paragraph");
    const t2 = createTextBox("t2", { display: "inline" }, "second paragraph");
    const p1 = createElementBox("p1", { display: "block" }, [t1]);
    const p2 = createElementBox("p2", { display: "block" }, [t2]);
    const doc = createElementBox("doc", { display: "block" }, [p1, p2]);
    const cascaded = cascadePass(doc);
    const ctx1 = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r1 = layoutBlock(asElement(cascaded), 0, 0, ctx1, shaper, undefined);
    if (r1.box === null) throw new Error("layoutBlock returned null box");
    const out1 = r1.box;

    // Edit p1's text. p2 stays the same render node (use cascadePassIncremental).
    const t1Edited = createTextBox("t1", { display: "inline" }, "FIRST paragraph");
    const p1Edited = createElementBox("p1", { display: "block" }, [t1Edited]);
    const docEdited = createElementBox("doc", { display: "block" }, [p1Edited, p2]);
    const cascadedEdited = cascadePassIncremental(docEdited, doc, cascaded);

    const prevCache = buildLayoutBoxCacheFromTree(out1, cascaded);
    const ctx2 = {
      ...ctx1,
      prevLayoutCache: prevCache,
      prevFloatEnv: ctx1.floatEnv,
    };
    const r2 = layoutBlock(asElement(cascadedEdited), 0, 0, ctx2, shaper, undefined);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r2.box;

    if (out1.type !== "block" || out2.type !== "block") throw new Error();
    const p2_1 = findBoxByKey(out1, "p2");
    const p2_2 = findBoxByKey(out2, "p2");
    expect(p2_1).not.toBeNull();
    expect(p2_2).not.toBeNull();
    expect(p2_2).toBe(p2_1);  // SAME reference!
  });

  it("identical re-layout reuses entire root subtree", () => {
    const t = createTextBox("t", { display: "inline" }, "hello world");
    const para = createElementBox("p", { display: "block" }, [t]);
    const doc = createElementBox("doc", { display: "block" }, [para]);
    const cascaded = cascadePass(doc);
    const ctx1 = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r3 = layoutBlock(asElement(cascaded), 0, 0, ctx1, shaper, undefined);
    if (r3.box === null) throw new Error("layoutBlock returned null box");
    const out1 = r3.box;

    const prevCache = buildLayoutBoxCacheFromTree(out1, cascaded);
    const ctx2 = { ...ctx1, prevLayoutCache: prevCache, prevFloatEnv: ctx1.floatEnv };
    const r4 = layoutBlock(asElement(cascaded), 0, 0, ctx2, shaper, undefined);
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r4.box;

    // Whole tree should be reference-equal.
    expect(out2).toBe(out1);
  });

  it("width change does NOT reuse (inputs differ)", () => {
    const t = createTextBox("t", { display: "inline" }, "hello world");
    const para = createElementBox("p", { display: "block" }, [t]);
    const doc = createElementBox("doc", { display: "block" }, [para]);
    const cascaded = cascadePass(doc);
    const ctx1 = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r5 = layoutBlock(asElement(cascaded), 0, 0, ctx1, shaper, undefined);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out1 = r5.box;

    // Different containerInlineSize → different ctx → no reuse expected.
    const ctx2 = {
      ...makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 200),
      prevLayoutCache: buildLayoutBoxCacheFromTree(out1, cascaded),
      prevFloatEnv: ctx1.floatEnv,
    };
    const r6 = layoutBlock(asElement(cascaded), 0, 0, ctx2, shaper, undefined);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out2 = r6.box;

    expect(out2).not.toBe(out1);  // Different size → no reuse.
  });

  it("layoutTreeIncremental reuses unchanged subtree", () => {
    const t1 = createTextBox("t1", { display: "inline" }, "first");
    const t2 = createTextBox("t2", { display: "inline" }, "second");
    const p1 = createElementBox("p1", { display: "block" }, [t1]);
    const p2 = createElementBox("p2", { display: "block" }, [t2]);
    const doc = createElementBox("doc", { display: "block" }, [p1, p2]);
    const cascaded = cascadePass(doc);
    const out1 = layoutTreeIncremental(asElement(cascaded), null, null, 500, shaper);

    // Edit only p1 (use cascadePassIncremental to preserve p2's render node).
    const t1New = createTextBox("t1", { display: "inline" }, "FIRST");
    const p1New = createElementBox("p1", { display: "block" }, [t1New]);
    const docNew = createElementBox("doc", { display: "block" }, [p1New, p2]);
    const cascadedNew = cascadePassIncremental(docNew, doc, cascaded);

    const out2 = layoutTreeIncremental(asElement(cascadedNew), cascaded, out1, 500, shaper);

    const p2_1 = findBoxByKey(positionTreeForTest(out1), "p2");
    const p2_2 = findBoxByKey(positionTreeForTest(out2), "p2");
    expect(p2_2).toBe(p2_1);  // Reference-equal via layoutTreeIncremental's cache.
  });
});
