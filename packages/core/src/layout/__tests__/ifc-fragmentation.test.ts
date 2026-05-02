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

import type { Style } from "../../styles/style";

/**
 * Build a paragraph (inline block container) whose text has exactly `numLines`
 * lines, enforced via explicit \n hard-break characters in the text content.
 * The mock shaper produces hard breaks at \n, so the IFC will produce exactly
 * numLines LineBoxes regardless of container width.
 *
 * `lineHeight` controls the lineHeight per line via the mock shaper.
 * `paragraphStyleOverrides` allows overriding paragraph-level Style fields
 * (e.g. `{ orphans: 3 }` or `{ widows: 3 }`).
 */
function buildParagraph(numLines: number, paragraphStyleOverrides?: Partial<Style>): {
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
  const baseStyle: Style = { display: "block", whiteSpace: "pre", ...paragraphStyleOverrides };
  const rawParagraph = createElementBox("p", baseStyle, [textNode]);
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

describe("IFC fragmentation — orphans", () => {
  it("pushes whole paragraph when fewer than `orphans` lines fit on current page", () => {
    // Paragraph wraps to 5 lines. orphans: 3. Available block size = 20px.
    // lineHeight = 16 → only 1 line fits (16 <= 20). 1 < 3 → orphans violated → push whole.
    const { paragraph, ctx } = buildParagraph(5, { orphans: 3 });
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 20,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0 });
  });

  it("places K lines when K >= orphans", () => {
    // 10 lines, orphans: 2 (default). Available fits 5 lines (5×16=80). 5 >= 2 → split at 5.
    const { paragraph, ctx } = buildParagraph(10);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 80,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 5 });
  });
});

describe("IFC fragmentation — widows", () => {
  it("backs off split point when fewer than `widows` lines would land on next page", () => {
    // 7 lines, widows: 3. Available fits 6 lines (6×16=96). k=6, but 7-6=1 < 3 → widows violated.
    // Back off: k=5 → 7-5=2 < 3 still violated; k=4 → 7-4=3 >= 3 ✓. orphans=2, 4>=2 ✓. Split at 4.
    const { paragraph, ctx } = buildParagraph(7, { widows: 3 });
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 96, // 6×16
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 4 });
  });

  it("pushes whole paragraph when no valid split exists due to widows + orphans", () => {
    // 5 lines, orphans: 3, widows: 3. Need k>=3 AND 5-k>=3 → k>=3 AND k<=2. Contradiction.
    // All lines fit (5×16=80 <= 80) so the fit-loop places all 5, but even if it didn't,
    // any partial split would violate one constraint. No partial split → push whole.
    const { paragraph, ctx } = buildParagraph(5, { orphans: 3, widows: 3 });
    const shaper = createMockShaper(8, 16);
    // To force a partial split attempt: reduce available to fit only 4 (4×16=64).
    const fragmentation2: FragmentationContext = {
      availableBlockSize: 64, // 4×16 → k=4, 5-4=1 < 3 widows violated; back off: k=3 → 5-3=2 < 3; k=2 → 2<3 orphans violated → push whole
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, fragmentation2);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0 });
  });
});

describe("IFC fragmentation — hyphen-pair constraint", () => {
  // Hyphenation dictionaries are not loaded; `hyphens: auto` falls back to no-hyphenation
  // regardless of language (per CLAUDE.md). The wrap pass therefore never sets
  // endsWithHyphenContinuation: true on any LineBox in practice.
  // The algorithmic guard is in place in the split-point search so that when
  // hyphenation infrastructure (P7 — hyphens) lands, it activates automatically.
  // TODO: un-skip when hyphenation dictionaries land and the wrap pass produces
  // real hyphenated lines with endsWithHyphenContinuation: true.
  it.skip("avoids splitting between two hyphenated lines (requires hyphenation infrastructure)", () => {
    // Expected behavior once real hyphenation lands:
    // A paragraph where line N ends with a hyphen continuation (word split across N and N+1).
    // If the page break would fall between lines N and N+1, the split must be backed off to N-1.
  });
});

describe("IFC fragmentation — resume from IFCBreakToken", () => {
  it("emits lines starting at resumeAtLine", () => {
    // 10-line paragraph. First fragment fits 4 lines (orphans=2, widows=2 default).
    // availableBlockSize=64 → 4×16=64 fits; 5th line would bring total to 80 > 64.
    // widows check: 10-4=6 >= 2 ✓. orphans check: 4 >= 2 ✓. Split at 4.
    const { paragraph, ctx } = buildParagraph(10);
    const shaper = createMockShaper(8, 16);

    // First fragment: availableBlockSize=64 (4×16). All constraints satisfied → split at 4.
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 64, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.breakToken).toEqual({ type: "ifc", resumeAtLine: 4 });

    // Second fragment: resume from line 4, fits all 6 remaining (6×16=96 needed, 200 available).
    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.box!.children.length).toBe(6); // 6 remaining lines
    expect(r2.breakToken).toBeNull();
  });

  it("applies widows/orphans to the resumed suffix", () => {
    // 10-line paragraph, default orphans/widows = 2.
    // First fragment splits at 4. Second fragment available = 80 (5×16), so 5 of 6 fit.
    // 5 placed; 1 remaining. widows=2 → 1 < 2 → back off to 4 placed; 2 remaining.
    const { paragraph, ctx } = buildParagraph(10);
    const shaper = createMockShaper(8, 16);
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 64, pageIndex: 0, resumeFrom: null,
    });
    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 80, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.box!.children.length).toBe(4);
    expect(r2.breakToken).toEqual({ type: "ifc", resumeAtLine: 8 });
  });

  it("returns box: null when no suffix lines fit on the resumed fragment", () => {
    const { paragraph, ctx } = buildParagraph(10);
    const shaper = createMockShaper(8, 16);
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 64, pageIndex: 0, resumeFrom: null,
    });
    // Second fragment: availableBlockSize=10 (smaller than one line=16) → first suffix line doesn't fit.
    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 10, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).toBeNull();
    // resume from where we stopped (line 4), NOT from 0
    expect(r2.breakToken).toEqual({ type: "ifc", resumeAtLine: 4 });
  });

  it("rebases line blockOffsets so the first emitted suffix line starts at the parent's blockOffset (not at the original wrap's absolute y)", () => {
    // 10-line paragraph laid out at outer blockOffset=0. Wrap pass produces
    // lines at y=0,16,32,...,144. First call: 5 lines fit (availableBlockSize=80).
    // Second call: resume from line 5 with the SAME outer blockOffset=0.
    // The emitted lines on page 2 must have y values starting at 0, NOT at
    // 80 (which is what they were in the original wrap pass). Otherwise paint
    // renders them past the BlockBox's bottom and they appear to be missing.
    const { paragraph, ctx } = buildParagraph(10);
    const shaper = createMockShaper(8, 16);
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box).not.toBeNull();
    expect(r1.box!.children.length).toBe(5);
    // Page 1's first line is at y=0, second at y=16, etc.
    expect(r1.box!.children[0].blockOffset).toBe(0);
    expect(r1.box!.children[4].blockOffset).toBe(64);

    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.box!.children.length).toBe(5);
    // Page 2's first emitted line (originally line 5 in the wrap pass) must
    // be at y=0 within the new BlockBox — its blockOffset must be REBASED.
    expect(r2.box!.children[0].blockOffset).toBe(0);
    expect(r2.box!.children[4].blockOffset).toBe(64);
    // The wrapping BlockBox's blockSize equals 5 lines × 16 = 80.
    expect(r2.box!.blockSize).toBe(80);
  });

  it("throws when given a non-IFC resumeFrom token", () => {
    const { paragraph, ctx } = buildParagraph(3);
    const shaper = createMockShaper(8, 16);
    expect(() =>
      layoutInlineContent(paragraph, 0, 0, ctx, shaper, {
        availableBlockSize: 100, pageIndex: 0,
        resumeFrom: { type: "block", resumeChildIndex: 0, resumeChildToken: null },
      }),
    ).toThrow(/expected.*IFCBreakToken|resume.*type/i);
  });
});
