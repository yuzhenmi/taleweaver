import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBlockLayoutBox,
  createLineLayoutBox,
  createTextLayoutBox,
} from "@taleweaver/core";
import { paintCanvas } from "./canvas-renderer";

function createMockCtx() {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    font: "",
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    textBaseline: "" as CanvasTextBaseline,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe("paintCanvas", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("clears canvas before painting", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
  });

  it("paints text with half-leading offset for line height centering", () => {
    // Default: fontSize=16, lineHeight=24, so half-leading = (24-16)/2 = 4
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hello"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    // y should be 0 + 4 (half-leading offset)
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 0, 4);
  });

  it("accumulates parent offsets for nested boxes", () => {
    const tree = createBlockLayoutBox("b", 10, 20, 200, 50, [
      createLineLayoutBox("l", 5, 10, 190, 24, [
        createTextLayoutBox("t", 3, 0, 40, 24, "ok"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    // block(10,20) + line(5,10) + text(3,0) = (18, 30), plus half-leading +4 = (18, 34)
    expect(ctx.fillText).toHaveBeenCalledWith("ok", 18, 34);
  });

  it("sets font from text box styles", () => {
    const fontAtFillText: string[] = [];
    vi.mocked(ctx.fillText).mockImplementation(() => {
      fontAtFillText.push(ctx.font);
    });

    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "bold", { fontWeight: "bold" }),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    expect(fontAtFillText[0]).toContain("bold");
  });

  it("sets correct font per text box with different styles", () => {
    const fontAtFillText: string[] = [];
    vi.mocked(ctx.fillText).mockImplementation(() => {
      fontAtFillText.push(ctx.font);
    });

    const tree = createBlockLayoutBox("b", 0, 0, 400, 24, [
      createLineLayoutBox("l", 0, 0, 400, 24, [
        createTextLayoutBox("t1", 0, 0, 40, 24, "bold", { fontWeight: "bold" }),
        createTextLayoutBox("t2", 40, 0, 40, 24, "italic", { fontStyle: "italic" }),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 400, 100, 0, 100);

    expect(fontAtFillText[0]).toContain("bold");
    expect(fontAtFillText[0]).not.toContain("italic");
    expect(fontAtFillText[1]).toContain("italic");
    expect(fontAtFillText[1]).not.toContain("bold");
  });

  it("draws underline via fillRect accounting for half-leading", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "link", { textDecoration: "underline" }),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    // halfLeading=4, underlineY = 0 + 4 (halfLeading) + 16 (fontSize) + 1 = 21
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const underline = fillRectCalls.find(
      ([x, y, w, h]) => x === 0 && y === 21 && w === 40 && h === 1,
    );
    expect(underline).toBeDefined();
  });

  it("draws selection rects", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);
    const selRects = [{ x: 0, y: 0, width: 30, height: 24 }];

    paintCanvas(ctx, tree, selRects, { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const selCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 0 && y === 0 && w === 30 && h === 24,
    );
    expect(selCall).toBeDefined();
  });

  it("does not draw selection rects when array is empty", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    // No fillRect calls at all (no selection, no cursor, no underline)
    expect(fillRectCalls).toHaveLength(0);
  });

  it("culls selection rects outside visible range", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 6000, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);
    const selRects = [{ x: 0, y: 5000, width: 100, height: 24 }];

    paintCanvas(ctx, tree, selRects, { x: 0, y: 0, height: 24 }, "hidden", 200, 6000, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const selCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 0 && y === 5000 && w === 100 && h === 24,
    );
    expect(selCall).toBeUndefined();
  });

  it("draws black cursor when active", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 10, y: 0, height: 24 }, "active", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const cursorCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 10 && y === 0 && w === 2 && h === 24,
    );
    expect(cursorCall).toBeDefined();
  });

  it("draws grey cursor when inactive (unfocused)", () => {
    const fillStyles: string[] = [];
    vi.mocked(ctx.fillRect).mockImplementation(() => {
      fillStyles.push(ctx.fillStyle as string);
    });

    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 10, y: 0, height: 24 }, "inactive", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const cursorCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 10 && y === 0 && w === 2 && h === 24,
    );
    expect(cursorCall).toBeDefined();
    // The fillStyle set before the cursor fillRect should be grey
    const cursorIdx = fillRectCalls.indexOf(cursorCall!);
    expect(fillStyles[cursorIdx]).toBe("rgba(0, 0, 0, 0.4)");
  });

  it("hides cursor when hidden (blink off-phase)", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hi"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 10, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const cursorCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 10 && y === 0 && w === 2 && h === 24,
    );
    expect(cursorCall).toBeUndefined();
  });

  it("skips boxes outside visible range", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 6000, [
      createLineLayoutBox("l", 0, 5000, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "far away"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 6000, 0, 100);

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("paints boxes inside visible range", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 6000, [
      createLineLayoutBox("l", 0, 50, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "visible"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 6000, 0, 100);

    // y=50 + 4 (half-leading) = 54
    expect(ctx.fillText).toHaveBeenCalledWith("visible", 0, 54);
  });

  it("paints partially-visible boxes at boundary", () => {
    // Box starts above visible range but extends into it
    const tree = createBlockLayoutBox("b", 0, 0, 200, 6000, [
      createLineLayoutBox("l", 0, 90, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "boundary"),
      ]),
    ]);

    // visibleTop=100, but line at y=90 with height=24 extends to y=114
    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 6000, 100, 200);

    // y=90 + 4 (half-leading) = 94
    expect(ctx.fillText).toHaveBeenCalledWith("boundary", 0, 94);
  });

  it("uses custom lineHeight and fontSize for half-leading", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 32, [
      createLineLayoutBox("l", 0, 0, 200, 32, [
        createTextLayoutBox("t", 0, 0, 40, 32, "big", { fontSize: 20, lineHeight: 32 }),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 32 }, "hidden", 200, 100, 0, 100);

    // halfLeading = (32 - 20) / 2 = 6
    expect(ctx.fillText).toHaveBeenCalledWith("big", 0, 6);
  });
});
