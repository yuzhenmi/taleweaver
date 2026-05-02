// packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext, IFCBreakToken } from "../fragmentation";
import { layoutInlineContent } from "../ifc";
import { makeRootContext, makeChildContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node-v2";
import type { ElementBox } from "../../render/render-node-v2";

/**
 * Build a paragraph (inline block container) whose text has exactly `numLines`
 * lines, enforced via explicit \n hard-break characters in the text content.
 * The mock shaper produces hard breaks at \n, so the IFC will produce exactly
 * numLines LineBoxes regardless of container width.
 *
 * `lineHeight` controls the lineHeight per line via the mock shaper.
 */
function buildParagraph(numLines: number): {
  paragraph: ElementBox;
  ctx: ReturnType<typeof makeChildContext>;
} {
  // Build text with (numLines - 1) \n characters → numLines lines.
  // Use a non-space char per line so each line is non-empty.
  const parts: string[] = [];
  for (let i = 0; i < numLines; i++) {
    parts.push("x");
  }
  const text = parts.join("\n");

  // whiteSpace: "pre" so that \n characters are emitted as LINE_BREAK tokens,
  // giving the IFC exactly numLines lines regardless of container width.
  const textNode = createTextBox("t", { whiteSpace: "pre" }, text);
  const rawParagraph = createElementBox("p", { display: "block", whiteSpace: "pre" }, [textNode]);
  const paragraph = cascadePass(rawParagraph);
  if (paragraph.type !== "element") throw new Error("cascadePass returned non-element");

  const rootCtx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
  const ctx = makeChildContext(rootCtx, INITIAL_COMPUTED_STYLE, 200, "indefinite");
  return { paragraph, ctx };
}

describe("IFC fragmentation — line-level split", () => {
  it("places all lines when paragraph fits", () => {
    const { paragraph, ctx } = buildParagraph(5);
    // lineHeight = 16 → 5 lines = 80px total; 1000 fits all
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toBeNull();
    // All 5 lines are present
    expect(box!.children.length).toBe(5);
  });

  it("stops at the line that overflows; returns IFCBreakToken", () => {
    const { paragraph, ctx } = buildParagraph(10);
    // lineHeight = 16 → 10 lines = 160px; availableBlockSize = 80 → fits 5 lines
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 80,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).not.toBeNull();
    const ifc = breakToken as IFCBreakToken;
    expect(ifc.type).toBe("ifc");
    // 5 lines fit (5 × 16 = 80), line index 5 is the resume point
    expect(ifc.resumeAtLine).toBe(5);
    // The box should contain exactly 5 lines
    expect(box!.children.length).toBe(5);
  });

  it("returns box: null + IFCBreakToken at line 0 when even the first line doesn't fit", () => {
    const { paragraph, ctx } = buildParagraph(3);
    // lineHeight = 100 → first line is 100px; availableBlockSize = 50 → doesn't fit
    const shaper = createMockShaper(8, 100);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 50,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0 });
  });
});
