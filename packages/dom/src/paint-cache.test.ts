import { describe, it, expect } from "vitest";
import { hashPaintInputs, createPaintCache } from "./paint-cache";
import type { LayoutBox } from "@taleweaver/core";

function makeBlockBox(overrides: Partial<LayoutBox> = {}): LayoutBox {
  return {
    type: "block",
    key: "k",
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: 100,
    blockSize: 50,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    writingMode: "horizontal-tb",
    direction: "ltr",
    computedStyle: {
      backgroundColor: "white",
      color: "black",
      fontFamily: "sans-serif",
      fontSize: 16,
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      borderBlockStartStyle: "none",
      borderBlockEndStyle: "none",
      borderInlineStartStyle: "none",
      borderInlineEndStyle: "none",
      borderBlockStartColor: "currentColor",
      borderBlockEndColor: "currentColor",
      borderInlineStartColor: "currentColor",
      borderInlineEndColor: "currentColor",
      direction: "ltr",
    } as any,
    usedStyle: {
      paddingBlockStart: 0,
      paddingBlockEnd: 0,
      paddingInlineStart: 0,
      paddingInlineEnd: 0,
      borderBlockStartWidth: 0,
      borderBlockEndWidth: 0,
      borderInlineStartWidth: 0,
      borderInlineEndWidth: 0,
    } as any,
    children: [],
    ...overrides,
  } as unknown as LayoutBox;
}

describe("hashPaintInputs", () => {
  it("same inputs → same hash", () => {
    const a = makeBlockBox();
    const b = makeBlockBox();
    expect(hashPaintInputs(a)).toBe(hashPaintInputs(b));
  });

  it("different position → different hash", () => {
    const a = makeBlockBox({ x: 0, y: 0 });
    const b = makeBlockBox({ x: 0, y: 10 });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
  });

  it("different size → different hash", () => {
    const a = makeBlockBox({ width: 100, height: 50 });
    const b = makeBlockBox({ width: 100, height: 60 });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
  });
});

describe("createPaintCache", () => {
  it("get returns undefined for missing box", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    expect(cache.get(b)).toBeUndefined();
  });

  it("set then get roundtrips", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    cache.set(b, "hash1");
    expect(cache.get(b)).toBe("hash1");
  });

  it("isUnchanged returns false for missing box", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    expect(cache.isUnchanged(b)).toBe(false);
  });

  it("isUnchanged returns true after first set", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    cache.set(b, hashPaintInputs(b));
    expect(cache.isUnchanged(b)).toBe(true);
  });
});

describe("PaintCache last-root tracking", () => {
  it("returns null for the last-walked root when never set", () => {
    const cache = createPaintCache();
    expect(cache.getLastRoot()).toBe(null);
  });

  it("remembers the last-walked root", () => {
    const cache = createPaintCache();
    // Use a minimal LayoutBox stub; the cache only stores the reference.
    const root = { type: "block" } as never;
    cache.setLastRoot(root);
    expect(cache.getLastRoot()).toBe(root);
  });

  it("setLastRoot(null) clears the reference", () => {
    const cache = createPaintCache();
    const root = { type: "block" } as never;
    cache.setLastRoot(root);
    cache.setLastRoot(null);
    expect(cache.getLastRoot()).toBe(null);
  });
});
