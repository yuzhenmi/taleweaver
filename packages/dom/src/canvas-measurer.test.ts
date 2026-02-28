import { describe, it, expect, vi } from "vitest";
import { createCanvasMeasurer } from "./canvas-measurer";

function createMockContext() {
  return {
    font: "",
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
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
    expect(ctx.font).toBe("16px monospace");
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
});
