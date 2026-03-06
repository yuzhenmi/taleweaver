import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBlockLayoutBox,
  createTableLayoutBox,
  createLineLayoutBox,
  createTextLayoutBox,
  createPageLayoutBox,
} from "@taleweaver/core";
import { paintCanvas, paintPage } from "./canvas-renderer";

function createMockCtx() {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    font: "",
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
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
    // Default: fontSize=16, lineHeight=19.2 (1.2*16), so half-leading = (19.2-16)/2 = 1.6
    const tree = createBlockLayoutBox("b", 0, 0, 200, 24, [
      createLineLayoutBox("l", 0, 0, 200, 24, [
        createTextLayoutBox("t", 0, 0, 40, 24, "hello"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    // y should be 0 + 1.6 (half-leading offset)
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 0, expect.closeTo(1.6));
  });

  it("accumulates parent offsets for nested boxes", () => {
    const tree = createBlockLayoutBox("b", 10, 20, 200, 50, [
      createLineLayoutBox("l", 5, 10, 190, 24, [
        createTextLayoutBox("t", 3, 0, 40, 24, "ok"),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    // block(10,20) + line(5,10) + text(3,0) = (18, 30), plus half-leading +1.6 = (18, 31.6)
    expect(ctx.fillText).toHaveBeenCalledWith("ok", 18, expect.closeTo(31.6));
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

    // halfLeading=1.6, underlineY = 0 + 1.6 (halfLeading) + 16 (fontSize) + 1 = 18.6
    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const underline = fillRectCalls.find(
      ([x, y, w, h]) => x === 0 && Math.abs(y - 18.6) < 0.01 && w === 40 && h === 1,
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

    // y=50 + 1.6 (half-leading) = 51.6
    expect(ctx.fillText).toHaveBeenCalledWith("visible", 0, expect.closeTo(51.6));
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

    // y=90 + 1.6 (half-leading) = 91.6
    expect(ctx.fillText).toHaveBeenCalledWith("boundary", 0, expect.closeTo(91.6));
  });

  it("uses custom lineHeight and fontSize for half-leading", () => {
    const tree = createBlockLayoutBox("b", 0, 0, 200, 32, [
      createLineLayoutBox("l", 0, 0, 200, 32, [
        createTextLayoutBox("t", 0, 0, 40, 32, "big", { fontSize: 20, lineHeight: 1.6 }),
      ]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 32 }, "hidden", 200, 100, 0, 100);

    // halfLeading = (32 - 20) / 2 = 6
    expect(ctx.fillText).toHaveBeenCalledWith("big", 0, 6);
  });
});

describe("list marker painting", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("paints bullet marker in the padding area of a block", () => {
    // List-item block at (24, 0) with marker, inside a list at (0,0)
    const listItemBox = Object.freeze({
      ...createBlockLayoutBox("li1", 0, 0, 176, 24, [
        createBlockLayoutBox("p1", 24, 0, 152, 24, [
          createLineLayoutBox("l1", 0, 0, 152, 24, [
            createTextLayoutBox("t1", 0, 0, 40, 24, "Item"),
          ]),
        ]),
      ]),
      marker: "\u2022",
    });
    const tree = createBlockLayoutBox("doc", 0, 0, 200, 24, [
      createBlockLayoutBox("list1", 0, 0, 200, 24, [listItemBox]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillTextCalls = vi.mocked(ctx.fillText).mock.calls;
    // Marker should be painted at (0 + small offset, 0 + halfLeading)
    const markerCall = fillTextCalls.find(([text]) => text === "\u2022");
    expect(markerCall).toBeDefined();
    // "Item" should also be painted
    const itemCall = fillTextCalls.find(([text]) => text === "Item");
    expect(itemCall).toBeDefined();
  });

  it("paints ordered marker in the padding area", () => {
    const listItemBox = Object.freeze({
      ...createBlockLayoutBox("li1", 0, 0, 176, 24, [
        createBlockLayoutBox("p1", 24, 0, 152, 24, [
          createLineLayoutBox("l1", 0, 0, 152, 24, [
            createTextLayoutBox("t1", 0, 0, 40, 24, "Item"),
          ]),
        ]),
      ]),
      marker: "1.",
    });
    const tree = createBlockLayoutBox("doc", 0, 0, 200, 24, [
      createBlockLayoutBox("list1", 0, 0, 200, 24, [listItemBox]),
    ]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillTextCalls = vi.mocked(ctx.fillText).mock.calls;
    const markerCall = fillTextCalls.find(([text]) => text === "1.");
    expect(markerCall).toBeDefined();
  });
});

describe("horizontal line painting", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("draws a horizontal line for block with horizontal-line metadata", () => {
    const hrBox = createBlockLayoutBox("hr1", 0, 0, 200, 32, [], undefined, { type: "horizontal-line" });
    const tree = createBlockLayoutBox("doc", 0, 0, 200, 32, [hrBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    // Should draw a 1px-high line centered vertically in the box
    const hrCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 8 && w === 184 && h === 1,
    );
    expect(hrCall).toBeDefined();
  });

  it("does not paint text inside HR block", () => {
    const hrBox = createBlockLayoutBox("hr1", 0, 0, 200, 32, [], undefined, { type: "horizontal-line" });
    const tree = createBlockLayoutBox("doc", 0, 0, 200, 32, [hrBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("applies HR color #dadce0", () => {
    const fillStyles: string[] = [];
    vi.mocked(ctx.fillRect).mockImplementation(() => {
      fillStyles.push(ctx.fillStyle as string);
    });

    const hrBox = createBlockLayoutBox("hr1", 0, 0, 200, 32, [], undefined, { type: "horizontal-line" });
    const tree = createBlockLayoutBox("doc", 0, 0, 200, 32, [hrBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const hrIdx = fillRectCalls.findIndex(([x, , w, h]) => x === 8 && w === 184 && h === 1);
    expect(hrIdx).toBeGreaterThanOrEqual(0);
    expect(fillStyles[hrIdx]).toBe("#dadce0");
  });
});

describe("paintPage", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("fills white background", () => {
    const pageBox = createPageLayoutBox("page-0", 0, 0, 816, 1056, [
      createBlockLayoutBox("p1", 72, 96, 672, 24, [
        createLineLayoutBox("l1", 0, 0, 672, 24, [
          createTextLayoutBox("t1", 0, 0, 40, 24, "hello"),
        ]),
      ]),
    ]);

    paintPage(ctx, pageBox, [], null, "hidden");

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 816, 1056);
  });

  it("paints text at correct canvas position (margin offset from layout)", () => {
    // Text at (72, 96) within page → canvas pixel (72, 96)
    const pageBox = createPageLayoutBox("page-0", 0, 0, 816, 1056, [
      createBlockLayoutBox("p1", 72, 96, 672, 24, [
        createLineLayoutBox("l1", 0, 0, 672, 24, [
          createTextLayoutBox("t1", 0, 0, 40, 24, "hello"),
        ]),
      ]),
    ]);

    paintPage(ctx, pageBox, [], null, "hidden");

    // (72, 96) + half-leading 1.6 = (72, 97.6)
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 72, expect.closeTo(97.6));
  });

  it("draws cursor when on this page", () => {
    const pageBox = createPageLayoutBox("page-0", 0, 0, 200, 100, [
      createBlockLayoutBox("p1", 0, 0, 200, 24, [
        createLineLayoutBox("l1", 0, 0, 200, 24, [
          createTextLayoutBox("t1", 0, 0, 40, 24, "hi"),
        ]),
      ]),
    ]);

    // Cursor at layout y=10, page starts at y=0, page height=100 → on page
    paintPage(ctx, pageBox, [], { x: 20, y: 10, height: 24 }, "active");

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    // Should have cursor (2px wide) at (20, 10) on canvas
    const cursorCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 20 && y === 10 && w === 2 && h === 24,
    );
    expect(cursorCall).toBeDefined();
  });

  it("skips cursor when not on this page", () => {
    const pageBox = createPageLayoutBox("page-0", 0, 0, 200, 100, [
      createBlockLayoutBox("p1", 0, 0, 200, 24, [
        createLineLayoutBox("l1", 0, 0, 200, 24, [
          createTextLayoutBox("t1", 0, 0, 40, 24, "hi"),
        ]),
      ]),
    ]);

    // Cursor is null when not on this page
    paintPage(ctx, pageBox, [], null, "active");

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    const cursorCall = fillRectCalls.find(([_x, _y, w]) => w === 2);
    expect(cursorCall).toBeUndefined();
  });

  it("draws page-relative selection rects directly", () => {
    // Page 1 with y=0 (per-page coordinate space)
    const pageBox = createPageLayoutBox("page-1", 0, 0, 200, 100, [
      createBlockLayoutBox("p1", 0, 0, 200, 24, [
        createLineLayoutBox("l1", 0, 0, 200, 24, [
          createTextLayoutBox("t1", 0, 0, 40, 24, "hi"),
        ]),
      ]),
    ]);

    // Selection rects are already page-relative and pre-filtered by pageIndex
    const selRects: { x: number; y: number; width: number; height: number; pageIndex: number }[] =
      [{ x: 5, y: 10, width: 30, height: 24, pageIndex: 1 }];

    paintPage(ctx, pageBox, selRects, null, "hidden");

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    // Should draw selection rect at (5, 10) directly (no translation)
    const selCall = fillRectCalls.find(
      ([x, y, w, h]) => x === 5 && y === 10 && w === 30 && h === 24,
    );
    expect(selCall).toBeDefined();
  });

  it("renders empty when no selection rects passed", () => {
    const pageBox = createPageLayoutBox("page-0", 0, 0, 200, 100, [
      createBlockLayoutBox("p1", 0, 0, 200, 24, [
        createLineLayoutBox("l1", 0, 0, 200, 24, [
          createTextLayoutBox("t1", 0, 0, 40, 24, "hi"),
        ]),
      ]),
    ]);

    // No selection rects passed (already filtered out by caller)
    paintPage(ctx, pageBox, [], null, "hidden");

    const fillRectCalls = vi.mocked(ctx.fillRect).mock.calls;
    // Only the white background rect, no selection or cursor rects
    const selCall = fillRectCalls.find(
      ([x, y, w, h]) => w === 30 && h === 24,
    );
    expect(selCall).toBeUndefined();
  });
});

describe("table border painting", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("draws outer border for grid box", () => {
    const cellBox = createBlockLayoutBox("c0", 0, 0, 100, 24, [
      createLineLayoutBox("l0", 0, 0, 100, 24, [
        createTextLayoutBox("t0", 0, 0, 40, 24, "hi"),
      ]),
    ]);
    const rowBox = createBlockLayoutBox("r0", 0, 0, 100, 24, [cellBox]);
    const gridBox = createTableLayoutBox("g1", 0, 0, 100, 24, [rowBox], [100], [24]);
    const tree = createBlockLayoutBox("doc", 0, 0, 100, 24, [gridBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    // Should call strokeRect for the outer border
    expect(ctx.strokeRect).toHaveBeenCalledWith(0.5, 0.5, 99, 23);
  });

  it("draws column separator lines", () => {
    const cell0 = createBlockLayoutBox("c0", 0, 0, 100, 24, []);
    const cell1 = createBlockLayoutBox("c1", 100, 0, 200, 24, []);
    const rowBox = createBlockLayoutBox("r0", 0, 0, 300, 24, [cell0, cell1]);
    const gridBox = createTableLayoutBox("g1", 0, 0, 300, 24, [rowBox], [100, 200], [24]);
    const tree = createBlockLayoutBox("doc", 0, 0, 300, 24, [gridBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 300, 100, 0, 100);

    // Should draw vertical line at x=100 (column separator)
    const moveToCall = vi.mocked(ctx.moveTo).mock.calls.find(
      ([x, y]) => x === 100.5 && y === 0.5,
    );
    expect(moveToCall).toBeDefined();
    const lineToCall = vi.mocked(ctx.lineTo).mock.calls.find(
      ([x, y]) => x === 100.5 && y === 23.5,
    );
    expect(lineToCall).toBeDefined();
  });

  it("draws row separator lines", () => {
    const row0 = createBlockLayoutBox("r0", 0, 0, 200, 24, []);
    const row1 = createBlockLayoutBox("r1", 0, 24, 200, 24, []);
    const gridBox = createTableLayoutBox("g1", 0, 0, 200, 48, [row0, row1], [200], [24, 24]);
    const tree = createBlockLayoutBox("doc", 0, 0, 200, 48, [gridBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 48 }, "hidden", 200, 100, 0, 100);

    // Should draw horizontal line at y=24 (row separator)
    const moveToCall = vi.mocked(ctx.moveTo).mock.calls.find(
      ([x, y]) => x === 0.5 && y === 24.5,
    );
    expect(moveToCall).toBeDefined();
    const lineToCall = vi.mocked(ctx.lineTo).mock.calls.find(
      ([x, y]) => x === 199.5 && y === 24.5,
    );
    expect(lineToCall).toBeDefined();
  });

  it("paints cell text inside grid", () => {
    const cellBox = createBlockLayoutBox("c0", 0, 0, 100, 24, [
      createLineLayoutBox("l0", 0, 0, 100, 24, [
        createTextLayoutBox("t0", 0, 0, 40, 24, "hello"),
      ]),
    ]);
    const rowBox = createBlockLayoutBox("r0", 0, 0, 100, 24, [cellBox]);
    const gridBox = createTableLayoutBox("g1", 0, 0, 100, 24, [rowBox], [100], [24]);
    const tree = createBlockLayoutBox("doc", 0, 0, 100, 24, [gridBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    expect(ctx.fillText).toHaveBeenCalledWith("hello", 0, expect.closeTo(1.6));
  });

  it("sets stroke style to #dadce0", () => {
    const strokeStyles: string[] = [];
    vi.mocked(ctx.strokeRect).mockImplementation(() => {
      strokeStyles.push(ctx.strokeStyle as string);
    });

    const gridBox = createTableLayoutBox("g1", 0, 0, 100, 24, [], [100], [24]);
    const tree = createBlockLayoutBox("doc", 0, 0, 100, 24, [gridBox]);

    paintCanvas(ctx, tree, [], { x: 0, y: 0, height: 24 }, "hidden", 200, 100, 0, 100);

    expect(strokeStyles[0]).toBe("#dadce0");
  });
});
