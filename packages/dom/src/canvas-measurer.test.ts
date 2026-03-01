import { describe, it, expect, vi } from "vitest";
import { createCanvasMeasurer } from "./canvas-measurer";

function createMockContext() {
  return {
    font: "",
    measureText: vi.fn((text: string) => ({
      width: text.length * 10,
      fontBoundingBoxAscent: 14,
      fontBoundingBoxDescent: 4,
    })),
  };
}

function createMockCanvas(ctx: ReturnType<typeof createMockContext>) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getContext", {
    value: vi.fn(() => ctx),
    configurable: true,
  });
  return canvas;
}

describe("createCanvasMeasurer", () => {
  it("measureWidth sets ctx.font and returns measured width", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    const width = measurer.measureWidth("hello", {});
    expect(ctx.font).toBe('16px "Inter", sans-serif');
    expect(ctx.measureText).toHaveBeenCalledWith("hello");
    expect(width).toBe(50); // 5 chars * 10px
  });

  it("measureWidth uses provided font styles", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    measurer.measureWidth("ab", {
      fontFamily: "serif",
      fontSize: 20,
      fontWeight: "bold",
      fontStyle: "italic",
    });
    expect(ctx.font).toBe("italic bold 20px serif");
  });

  it("measureHeight returns effective lineHeight", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    expect(measurer.measureHeight({})).toBe(24);
    expect(measurer.measureHeight({ lineHeight: 32 })).toBe(32);
  });

  it("measureCursorHeight returns font bounding box height", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    // fontBoundingBoxAscent(14) + fontBoundingBoxDescent(4) = 18
    expect(measurer.measureCursorHeight({})).toBe(18);
    expect(ctx.font).toBe('16px "Inter", sans-serif');
  });

  it("measureCursorHeight sets font from styles", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    measurer.measureCursorHeight({ fontSize: 20, fontFamily: "serif" });
    expect(ctx.font).toBe("20px serif");
  });

  it("measureWidth caches results for identical text and styles", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    const styles = { fontWeight: "bold" as const };
    const w1 = measurer.measureWidth("hello", styles);
    const w2 = measurer.measureWidth("hello", styles);

    expect(w1).toBe(w2);
    // ctx.measureText should only be called once for the same input
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
  });

  it("measureWidth cache distinguishes different text", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    measurer.measureWidth("hello", {});
    measurer.measureWidth("world", {});

    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });

  it("measureWidth cache distinguishes different styles", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    measurer.measureWidth("hello", {});
    measurer.measureWidth("hello", { fontWeight: "bold" });

    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });

  it("measureCursorHeight caches results for identical styles", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas);

    const h1 = measurer.measureCursorHeight({});
    const h2 = measurer.measureCursorHeight({});

    expect(h1).toBe(h2);
    // measureText called only once (cursor height uses zero-width space measurement)
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
  });

  it("measureWidth evicts cache when size exceeds cap", () => {
    const ctx = createMockContext();
    const canvas = createMockCanvas(ctx);
    const measurer = createCanvasMeasurer(canvas, { cacheSize: 3 });

    measurer.measureWidth("a", {});
    measurer.measureWidth("b", {});
    measurer.measureWidth("c", {});
    expect(ctx.measureText).toHaveBeenCalledTimes(3);

    // "a" is cached — no new call
    measurer.measureWidth("a", {});
    expect(ctx.measureText).toHaveBeenCalledTimes(3);

    // 4th unique entry exceeds cap of 3, cache clears, re-measures
    measurer.measureWidth("d", {});
    expect(ctx.measureText).toHaveBeenCalledTimes(4);

    // "a" was evicted — needs re-measurement
    measurer.measureWidth("a", {});
    expect(ctx.measureText).toHaveBeenCalledTimes(5);
  });
});
