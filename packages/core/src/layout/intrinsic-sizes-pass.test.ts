import { describe, it, expect } from "vitest";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";
import { createMockShaper } from "./mock-shaper";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";

describe("computeIntrinsicSizes", () => {
  const shaper = createMockShaper(10, 16);

  it("text node: minContent = widest cluster, maxContent = total run", () => {
    // "hello" = 5 chars; mock shaper: each char is width 10.
    // minClusterInlineSize = 10 (one cluster), unbreakableRunInlineSize = 50.
    const node = createTextBox("t", { display: "inline" }, "hello");
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("paragraph with inline text aggregates as inline (sum max-content)", () => {
    // t1 = "abc" (3 chars, max=30), t2 = "de" (2 chars, max=20).
    // Block with inline children: min = max(10, 10) = 10; max = 30 + 20 = 50.
    const t1 = createTextBox("t1", { display: "inline" }, "abc");
    const t2 = createTextBox("t2", { display: "inline" }, "de");
    const para = createElementBox("p", { display: "block" }, [t1, t2]);
    const cascaded = cascadePass(para);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("block with block children: max-over-children for both min and max", () => {
    // p1: "abc" (3 chars) -> min=10, max=30
    // p2: "abcde" (5 chars) -> min=10, max=50
    // doc block: min=max(10,10)=10, max=max(30,50)=50
    const p1 = createElementBox(
      "p1",
      { display: "block" },
      [createTextBox("t1", { display: "inline" }, "abc")],
    );
    const p2 = createElementBox(
      "p2",
      { display: "block" },
      [createTextBox("t2", { display: "inline" }, "abcde")],
    );
    const doc = createElementBox("doc", { display: "block" }, [p1, p2]);
    const cascaded = cascadePass(doc);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("empty text node returns { 0, 0 }", () => {
    const node = createTextBox("t", { display: "inline" }, "");
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result).toEqual({ minContent: 0, maxContent: 0 });
  });

  it("caches results — second call with same key uses cache", () => {
    const node = createTextBox("t", { display: "inline" }, "abcdef");
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const r1 = computeIntrinsicSizes(cascaded, shaper, cache);
    const r2 = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(r1).toBe(r2); // same reference — came from cache
  });

  it("inline element: min=max(child.min), max=sum(child.max)", () => {
    // An inline <span> wrapping two text nodes.
    // t1 = "ab" (max=20), t2 = "cde" (max=30).
    // inline span: min = max(10, 10) = 10; max = 20 + 30 = 50.
    const t1 = createTextBox("t1", { display: "inline" }, "ab");
    const t2 = createTextBox("t2", { display: "inline" }, "cde");
    const span = createElementBox("span", { display: "inline" }, [t1, t2]);
    const cascaded = cascadePass(span);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("inline-block: treated as block (max-over-children)", () => {
    // inline-block containing two block paragraphs.
    // p1: max=20, p2: max=40. Block aggregation: max=40.
    const p1 = createElementBox(
      "p1",
      { display: "block" },
      [createTextBox("t1", { display: "inline" }, "ab")],
    );
    const p2 = createElementBox(
      "p2",
      { display: "block" },
      [createTextBox("t2", { display: "inline" }, "abcd")],
    );
    const widget = createElementBox("w", { display: "inline-block" }, [p1, p2]);
    const cascaded = cascadePass(widget);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(40);
  });

  it("display:none returns { 0, 0 }", () => {
    const node = createElementBox(
      "hidden",
      { display: "none" },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result).toEqual({ minContent: 0, maxContent: 0 });
  });
});
