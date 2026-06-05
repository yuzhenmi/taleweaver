import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCanvasShaper } from "./canvas-shaper";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

// ── Canvas mock ────────────────────────────────────────────────────────────
// JSDOM does not implement canvas.getContext("2d"); patch the prototype with
// a minimal stub that satisfies createCanvasShaper and the shaping logic.

function createMockCtx(): CanvasRenderingContext2D {
  return {
    font: "",
    measureText: (text: string) =>
      ({
        width: text.length * 8,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
      }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: PropertyDescriptor | undefined;

beforeEach(() => {
  originalGetContext = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext",
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: function () {
      return createMockCtx();
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  if (originalGetContext) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      originalGetContext,
    );
  }
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("createCanvasShaper", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement("canvas");
  });

  const cs = INITIAL_COMPUTED_STYLE;

  it("produces one cluster per grapheme (single-code-unit chars unchanged)", () => {
    const shaper = createCanvasShaper(canvas);
    const run = shaper.shape("abc", cs, "ltr");
    expect(run.clusters).toHaveLength(3);
    // Mock measureText returns width = length * 8; each char → 8
    expect(run.unbreakableRunInlineSize).toBeGreaterThanOrEqual(0);
    expect(run.minClusterInlineSize).toBeGreaterThanOrEqual(0);
  });

  it("emits soft breaks at internal whitespace", () => {
    const shaper = createCanvasShaper(canvas);
    const run = shaper.shape("a b c", cs, "ltr");
    const softs = run.breakOpportunities.filter((b) => b.kind === "soft");
    expect(softs.map((b) => b.clusterIndex)).toEqual([1, 3]);
  });

  it("emits hard breaks at newlines", () => {
    const shaper = createCanvasShaper(canvas);
    const run = shaper.shape("a\nb\rc", cs, "ltr");
    const hards = run.breakOpportunities.filter((b) => b.kind === "hard");
    expect(hards.map((b) => b.clusterIndex)).toEqual([1, 3]);
  });

  it("RTL baseDirection sets bidiLevel to 1", () => {
    const shaper = createCanvasShaper(canvas);
    const run = shaper.shape("abc", cs, "rtl");
    expect(run.bidiLevel).toBe(1);
  });

  it("LTR baseDirection sets bidiLevel to 0", () => {
    const shaper = createCanvasShaper(canvas);
    const run = shaper.shape("abc", cs, "ltr");
    expect(run.bidiLevel).toBe(0);
  });

  it("returns FontMetrics with positive ascent/descent", () => {
    const shaper = createCanvasShaper(canvas);
    const fm = shaper.measureFontMetrics(cs);
    expect(fm.ascent).toBeGreaterThanOrEqual(0);
    expect(fm.descent).toBeGreaterThanOrEqual(0);
  });

  it("empty string produces zero clusters", () => {
    const shaper = createCanvasShaper(canvas);
    const run = shaper.shape("", cs, "ltr");
    expect(run.clusters).toHaveLength(0);
    expect(run.unbreakableRunInlineSize).toBe(0);
    expect(run.minClusterInlineSize).toBe(0);
  });

  it("adds letterSpacing to each cluster advance vs the normal baseline", () => {
    const shaper = createCanvasShaper(canvas);
    const base = shaper.shape("ab", { ...INITIAL_COMPUTED_STYLE }, "ltr");
    const spaced = shaper.shape(
      "ab",
      { ...INITIAL_COMPUTED_STYLE, letterSpacing: 5 },
      "ltr",
    );
    for (let i = 0; i < base.clusters.length; i++) {
      expect(spaced.clusters[i].inlineAdvance).toBeCloseTo(
        base.clusters[i].inlineAdvance + 5,
        5,
      );
    }
    expect(spaced.unbreakableRunInlineSize).toBeCloseTo(
      base.unbreakableRunInlineSize + 10,
      5,
    );
    // The intrinsic-sizing aggregate grows too: letterSpacing adds to EVERY
    // cluster, so the widest spaced cluster is the widest base cluster + 5.
    expect(spaced.minClusterInlineSize).toBeCloseTo(
      base.minClusterInlineSize + 5,
      5,
    );
  });

  it("wordSpacing adds only to the space cluster", () => {
    const shaper = createCanvasShaper(canvas);
    const base = shaper.shape("a b", { ...INITIAL_COMPUTED_STYLE }, "ltr");
    const spaced = shaper.shape(
      "a b",
      { ...INITIAL_COMPUTED_STYLE, wordSpacing: 7 },
      "ltr",
    );
    // only the middle cluster (the space) grows by 7; 'a' and 'b' unchanged
    expect(spaced.clusters[0].inlineAdvance).toBeCloseTo(
      base.clusters[0].inlineAdvance,
      5,
    );
    expect(spaced.clusters[1].inlineAdvance).toBeCloseTo(
      base.clusters[1].inlineAdvance + 7,
      5,
    );
    expect(spaced.clusters[2].inlineAdvance).toBeCloseTo(
      base.clusters[2].inlineAdvance,
      5,
    );
    // The run sum grows by exactly the one space's word-spacing (7) — robust
    // regardless of which cluster is widest, unlike minClusterInlineSize.
    expect(spaced.unbreakableRunInlineSize).toBeCloseTo(
      base.unbreakableRunInlineSize + 7,
      5,
    );
  });
});
