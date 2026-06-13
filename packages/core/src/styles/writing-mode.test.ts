import { describe, it, expect } from "vitest";
import {
  logicalToPhysical,
  physicalToLogical,
  axisMapFor,
  assertNeverWritingMode,
  type LogicalRect,
  type PhysicalRect,
  type WritingMode,
} from "./writing-mode";

describe("logicalToPhysical", () => {
  it("identity for horizontal-tb LTR", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out: PhysicalRect = logicalToPhysical(
      logical, "horizontal-tb", "ltr", /* containingInlineSize */ 500,
    );
    expect(out).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("inverts inline axis for horizontal-tb RTL", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out: PhysicalRect = logicalToPhysical(
      logical, "horizontal-tb", "rtl", /* containingInlineSize */ 500,
    );
    expect(out).toEqual({ x: 500 - 10 - 100, y: 20, width: 100, height: 50 });
  });

  it("RTL with offset 0 places box at right edge", () => {
    const logical: LogicalRect = {
      inlineOffset: 0, blockOffset: 0, inlineSize: 80, blockSize: 30,
    };
    const out = logicalToPhysical(logical, "horizontal-tb", "rtl", 200);
    expect(out).toEqual({ x: 200 - 0 - 80, y: 0, width: 80, height: 30 });
  });

  // --- vertical-lr: block axis → physical x (left-to-right), inline axis → y.
  // width = blockSize, height = inlineSize. (1.0-styles.md table, vertical-lr)
  it("vertical-lr LTR: x=blockOffset, y=inlineOffset, swapped sizes", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-lr", "ltr", 500);
    expect(out).toEqual({ x: 20, y: 10, width: 50, height: 100 });
  });

  it("vertical-lr RTL: inline axis (y) mirrored against containingInlineSize", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-lr", "rtl", 500);
    expect(out).toEqual({ x: 20, y: 500 - 10 - 100, width: 50, height: 100 });
  });

  // --- vertical-rl: inline axis → y (same as v-lr), block axis → physical x
  // with the RIGHT-to-left MIRROR x = containingBlockSize − blockOffset − blockSize.
  // Without containingBlockSize (or "indefinite") → un-mirrored x = blockOffset
  // (the pending value the P3.1 physicalize pass corrects).
  it("vertical-rl LTR WITHOUT containingBlockSize: un-mirrored x=blockOffset", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-rl", "ltr", 500);
    expect(out).toEqual({ x: 20, y: 10, width: 50, height: 100 });
  });

  it("vertical-rl LTR with containingBlockSize='indefinite': un-mirrored x", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-rl", "ltr", 500, "indefinite");
    expect(out).toEqual({ x: 20, y: 10, width: 50, height: 100 });
  });

  it("vertical-rl LTR WITH containingBlockSize: mirrored x", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-rl", "ltr", 500, /* containingBlockSize */ 800);
    expect(out).toEqual({ x: 800 - 20 - 50, y: 10, width: 50, height: 100 });
  });

  it("vertical-rl RTL WITH containingBlockSize: mirrored x AND mirrored y", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-rl", "rtl", 500, /* containingBlockSize */ 800);
    expect(out).toEqual({ x: 800 - 20 - 50, y: 500 - 10 - 100, width: 50, height: 100 });
  });

  it("vertical-rl RTL WITHOUT containingBlockSize: un-mirrored x, mirrored y", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out = logicalToPhysical(logical, "vertical-rl", "rtl", 500);
    expect(out).toEqual({ x: 20, y: 500 - 10 - 100, width: 50, height: 100 });
  });
});

describe("physicalToLogical (inverse of logicalToPhysical)", () => {
  const sampleLogical: LogicalRect = {
    inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
  };
  const containingInlineSize = 500;
  const containingBlockSize = 800;

  const combos: ReadonlyArray<["horizontal-tb" | "vertical-rl" | "vertical-lr", "ltr" | "rtl"]> = [
    ["horizontal-tb", "ltr"],
    ["horizontal-tb", "rtl"],
    ["vertical-lr", "ltr"],
    ["vertical-lr", "rtl"],
    ["vertical-rl", "ltr"],
    ["vertical-rl", "rtl"],
  ];

  for (const [wm, dir] of combos) {
    it(`round-trips for ${wm} ${dir} (with containingBlockSize)`, () => {
      const phys = logicalToPhysical(sampleLogical, wm, dir, containingInlineSize, containingBlockSize);
      const back = physicalToLogical(phys, wm, dir, containingInlineSize, containingBlockSize);
      expect(back).toEqual(sampleLogical);
    });

    it(`round-trips for ${wm} ${dir} (without containingBlockSize)`, () => {
      const phys = logicalToPhysical(sampleLogical, wm, dir, containingInlineSize);
      const back = physicalToLogical(phys, wm, dir, containingInlineSize);
      expect(back).toEqual(sampleLogical);
    });
  }

  it("vertical-rl: with vs without containingBlockSize invert their respective forms", () => {
    // mirrored form
    const mirrored = logicalToPhysical(sampleLogical, "vertical-rl", "ltr", containingInlineSize, containingBlockSize);
    expect(physicalToLogical(mirrored, "vertical-rl", "ltr", containingInlineSize, containingBlockSize))
      .toEqual(sampleLogical);
    // un-mirrored form
    const unmirrored = logicalToPhysical(sampleLogical, "vertical-rl", "ltr", containingInlineSize);
    expect(physicalToLogical(unmirrored, "vertical-rl", "ltr", containingInlineSize))
      .toEqual(sampleLogical);
  });
});

describe("axisMapFor", () => {
  it("horizontal-tb LTR: inline=x, block=y, not reversed", () => {
    expect(axisMapFor("horizontal-tb", "ltr")).toEqual({
      inline: "x", block: "y", inlineReversed: false,
    });
  });

  it("horizontal-tb RTL: inline=x, block=y, reversed", () => {
    expect(axisMapFor("horizontal-tb", "rtl")).toEqual({
      inline: "x", block: "y", inlineReversed: true,
    });
  });

  it("vertical-rl LTR: inline=y, block=x, not reversed", () => {
    expect(axisMapFor("vertical-rl", "ltr")).toEqual({
      inline: "y", block: "x", inlineReversed: false,
    });
  });

  it("vertical-rl RTL: inline=y, block=x, reversed", () => {
    expect(axisMapFor("vertical-rl", "rtl")).toEqual({
      inline: "y", block: "x", inlineReversed: true,
    });
  });

  it("vertical-lr LTR: inline=y, block=x, not reversed", () => {
    expect(axisMapFor("vertical-lr", "ltr")).toEqual({
      inline: "y", block: "x", inlineReversed: false,
    });
  });

  it("vertical-lr RTL: inline=y, block=x, reversed", () => {
    expect(axisMapFor("vertical-lr", "rtl")).toEqual({
      inline: "y", block: "x", inlineReversed: true,
    });
  });
});

describe("writing-mode exhaustiveness guard", () => {
  // A bogus mode is only reachable via a cast. Before #437 the residual `else`
  // in logicalToPhysical silently treated it as vertical-rl; now the exhaustive
  // switch routes it through assertNeverWritingMode and throws — discriminating.
  const bogus = "sideways-rl" as unknown as WritingMode;

  it("logicalToPhysical throws on an out-of-union writing mode", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    expect(() => logicalToPhysical(logical, bogus, "ltr", 500)).toThrow(
      /Unhandled writing mode/,
    );
  });

  it("assertNeverWritingMode throws naming the offending value", () => {
    expect(() => assertNeverWritingMode(bogus as never)).toThrow(
      "Unhandled writing mode: sideways-rl",
    );
  });
});
