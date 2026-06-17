// packages/core/src/layout/__tests__/ifc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext, IFCBreakToken } from "../fragmentation";
import { layoutInlineContent } from "../ifc";
import { makeRootContext, makeChildContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";

import type { Style } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation);
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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation);
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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0, paraFlowStart: 0 });
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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0, paraFlowStart: 0 });
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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 5, paraFlowStart: 0 });
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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 4, paraFlowStart: 0 });
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
    const { box, breakToken } = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, fragmentation2);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 0, paraFlowStart: 0 });
  });
});

describe("IFC fragmentation — hyphen-pair constraint", () => {
  // `hyphens: manual` (the cascade default) now produces REAL hyphenated lines from
  // U+00AD SOFT HYPHENs (HYPH slices 1-3). So the D.4 hyphen-pair back-off — a page
  // break must not fall BETWEEN the two lines of a soft-hyphenated word — is now
  // reachable end-to-end and is asserted here (was skipped pending hyphenation).
  const SHY = "­";

  // Build a wrapping paragraph (white-space: normal) of `text` in a `width`-px
  // column. Unlike `buildParagraph` (white-space: pre + \n hard lines) this lets
  // a soft-hyphenated word actually wrap and emit `endsWithHyphenContinuation`.
  function buildWrapPara(text: string, width: number, overrides?: Partial<Style>): {
    paragraph: ElementBox;
    ctx: ReturnType<typeof makeChildContext>;
  } {
    const textNode = createTextBox("t", { whiteSpace: "normal" }, text);
    const baseStyle: Style = { display: "block", whiteSpace: "normal", ...overrides };
    const paragraph = cascadePass(createElementBox("p", baseStyle, [textNode]));
    if (paragraph.type !== "element") throw new Error("cascadePass returned non-element");
    const rootCtx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
    const ctx = makeChildContext(rootCtx, INITIAL_COMPUTED_STYLE, width, "indefinite");
    return { paragraph, ctx };
  }

  it("backs the page break off a soft-hyphenated line so the word's two fragments stay together", () => {
    const shaper = createMockShaper(8, 16); // 8px/char, 16px/line
    // "aaaa bbb<SHY>bbb" in a 40px column wraps to 3 lines:
    //   line 0 "aaaa", line 1 "bbb<SHY>" + the "-" glyph, line 2 "bbb".
    // Line 1 carries endsWithHyphenContinuation (it is the first half of the split
    // word). First confirm the setup via a non-fragmented full layout.
    const full = buildWrapPara("aaaa bbb" + SHY + "bbb", 40);
    const fullBox = layoutInlineContent(full.paragraph, 0, 0, full.ctx, shaper, undefined, 0).box;
    expect(fullBox).not.toBeNull();
    if (fullBox === null) return;
    expect(fullBox.children.length).toBe(3);
    const line1 = nth(fullBox.children, 1, "line");
    if (line1.type !== "line") throw new Error("expected line");
    expect(line1.endsWithHyphenContinuation).toBe(true);

    // Now fragment with room for exactly 2 lines (32px) and orphans/widows = 1
    // (so ONLY the D.4 hyphen-pair rule governs the back-off). The greedy fit
    // would place lines 0 + 1 and break before line 2 — but that break falls
    // between the two halves of the hyphenated word, so D.4 backs it off to break
    // before line 1 instead: only line 0 is placed; the whole "bbb<SHY>bbb" word
    // (lines 1-2) carries to the next fragment.
    const frag = buildWrapPara("aaaa bbb" + SHY + "bbb", 40, { orphans: 1, widows: 1 });
    const { box, breakToken } = layoutInlineContent(frag.paragraph, 0, 0, frag.ctx, shaper, undefined, 0, {
      availableBlockSize: 32,
      pageIndex: 0,
      resumeFrom: null,
    });
    expect(box).not.toBeNull();
    expect(box?.children.length).toBe(1); // only line 0 — NOT 2
    expect(breakToken).toEqual({ type: "ifc", resumeAtLine: 1, paraFlowStart: 0 }); // backed off from 2 to 1
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
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 64, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.breakToken).toEqual({ type: "ifc", resumeAtLine: 4, paraFlowStart: 0 });

    // Second fragment: resume from line 4, fits all 6 remaining (6×16=96 needed, 200 available).
    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
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
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 64, pageIndex: 0, resumeFrom: null,
    });
    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 80, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.box!.children.length).toBe(4);
    expect(r2.breakToken).toEqual({ type: "ifc", resumeAtLine: 8, paraFlowStart: 0 });
  });

  it("returns box: null when no suffix lines fit on the resumed fragment", () => {
    const { paragraph, ctx } = buildParagraph(10);
    const shaper = createMockShaper(8, 16);
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 64, pageIndex: 0, resumeFrom: null,
    });
    // Second fragment: availableBlockSize=10 (smaller than one line=16) → first suffix line doesn't fit.
    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 10, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).toBeNull();
    // resume from where we stopped (line 4), NOT from 0
    expect(r2.breakToken).toEqual({ type: "ifc", resumeAtLine: 4, paraFlowStart: 0 });
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
    const r1 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box).not.toBeNull();
    expect(r1.box!.children.length).toBe(5);
    // Page 1's first line is at y=0, second at y=16, etc.
    expect(nth(r1.box!.children, 0, "line").blockOffset).toBe(0);
    expect(nth(r1.box!.children, 4, "line").blockOffset).toBe(64);

    const r2 = layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.box!.children.length).toBe(5);
    // Page 2's first emitted line (originally line 5 in the wrap pass) must
    // be at y=0 within the new BlockBox — its blockOffset must be REBASED.
    expect(nth(r2.box!.children, 0, "line").blockOffset).toBe(0);
    expect(nth(r2.box!.children, 4, "line").blockOffset).toBe(64);
    // The wrapping BlockBox's blockSize equals 5 lines × 16 = 80.
    expect(r2.box!.blockSize).toBe(80);
  });

  it("throws when given a non-IFC resumeFrom token", () => {
    const { paragraph, ctx } = buildParagraph(3);
    const shaper = createMockShaper(8, 16);
    expect(() =>
      layoutInlineContent(paragraph, 0, 0, ctx, shaper, undefined, 0, {
        availableBlockSize: 100, pageIndex: 0,
        resumeFrom: { type: "block", resumeChildIndex: 0, resumeChildToken: null },
      }),
    ).toThrow(/expected.*IFCBreakToken|resume.*type/i);
  });
});
