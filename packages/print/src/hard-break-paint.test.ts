/**
 * Paint smoke (#504 Task 6): a hard-break embed (`<br>`) must put the text
 * before it and the text after it on TWO visual lines.
 *
 * "A<br>B" is built the way render-core produces it — a block ElementBox whose
 * children are [ text "A", a zero-width, child-less inline-block ElementBox
 * carrying `metadata.embedType === HARD_BREAK_EMBED_TYPE`, text "B" ]. The IFC
 * turns that embed into a FORCED line break, so layout emits two LineBoxes. We
 * then run the SAME real paint path the other DOM paint tests use (`paintCanvas`
 * against a spy ctx) and assert both glyphs paint at DIFFERENT y coordinates —
 * proving the break reached the screen as two lines, not one.
 *
 * JSDOM does not implement CanvasRenderingContext2D — we use a spy-stub that
 * records fillText (text + x + y), mirroring inline-block-paint.test.ts.
 */

import { describe, it, expect } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import { cascadePass, createElementBox, createTextBox, createMockShaper, HARD_BREAK_EMBED_TYPE } from "@taleweaver/core";
import { layoutTree, type LayoutBox } from "./index";

// ── Canvas mock (records fillText text+x+y) ──────────────────────────────────
interface FillText { text: string; x: number; y: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fills: FillText[] } = {
    _fills: fills,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect() { /* no-op */ },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

/** A zero-width, child-less inline-block hard-break embed (the `<br>` shape). */
function hardBreak(key: string) {
  return createElementBox(
    key,
    { display: "inline-block", inlineSize: 0 },
    [],
    { embedType: HARD_BREAK_EMBED_TYPE },
  );
}

describe("hard-break paint (#504)", () => {
  it("paints 'A' and 'B' on two different lines (forced break reaches the screen)", () => {
    // Build "A<br>B" the way render-core produces it, then run the REAL core
    // layout path (cascade → block layout → IFC forced break).
    const tree = createElementBox("p", { display: "block" }, [
      createTextBox("ta", {}, "A"),
      hardBreak("br"),
      createTextBox("tb", {}, "B"),
    ]);
    const root = layoutTree(cascadePass(tree), 500, createMockShaper(8, 16));
    if ("type" in root && root.type === "virtual-root") {
      throw new Error("expected a positioned LayoutBox (non-paginated)");
    }

    const ctx = createSpyCtx();
    paintCanvas(
      ctx,
      root as LayoutBox,
      [], [], [], [],
      { x: 0, y: 0, height: 0 },
      "hidden",
      600, 800, 0, 800,
    );

    const fillA = ctx._fills.find((f) => f.text === "A");
    const fillB = ctx._fills.find((f) => f.text === "B");
    expect(fillA).toBeDefined();
    expect(fillB).toBeDefined();
    // The hard break put A on line 0 and B on the line below → different y.
    expect(fillA?.y).not.toBeCloseTo(fillB?.y ?? Number.NaN, 6);
    expect(fillB?.y ?? Number.NaN).toBeGreaterThan(fillA?.y ?? Number.NaN);
  });
});
