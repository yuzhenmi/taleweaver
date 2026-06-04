import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutBlock } from "./bfc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { LineBox, LayoutBox, TextRunBox } from "./layout-box";
import type { Style } from "../styles";

// The IFC test harness uses an 8px/char mock shaper.
const shaper = createMockShaper(8, 16);

/**
 * Lay out a single paragraph and return its LineBoxes. `style` is applied to
 * the block element; `letterSpacing` is inherited so it reaches the text run.
 */
function layoutPara(text: string, width: number, style: Style): readonly LineBox[] {
  const tree = cascadePass(
    createElementBox("p", { display: "block", ...style }, [
      createTextBox("t", {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("expected element tree");
  const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper);
  if (r.box === null) throw new Error("layoutBlock returned null box");
  if (r.box.type !== "block") throw new Error("expected block box");
  return r.box.children.filter((c): c is LineBox => c.type === "line");
}

/** Collect the line's text-run leaves (line-relative x), left-to-right. */
function leavesOf(line: LineBox): TextRunBox[] {
  const out: TextRunBox[] = [];
  const walk = (boxes: readonly LayoutBox[]) => {
    for (const b of boxes) {
      if (b.type === "text-run") out.push(b);
      else if (b.type === "inline") walk(b.children);
    }
  };
  walk(line.children);
  out.sort((a, b) => a.x - b.x);
  return out;
}

describe("IFC — trailing letter-spacing trim (CSS Text 3 §8.1)", () => {
  it("trailing letter-spacing is trimmed from contentWidth (center alignment)", () => {
    // "ab", letterSpacing 4 (8px mock): a=12, b=12 → raw line width 24. The
    // trailing trim removes b's hanging 4 → contentWidth 20. Centered offset is
    // (W − 20)/2, NOT (W − 24)/2.
    const W = 100;
    const lines = layoutPara("ab", W, { letterSpacing: 4, textAlign: "center" });
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(lines[0]);
    expect(leaves).toHaveLength(1);
    // First (only) child centered within the full-width line.
    expect(leaves[0].x).toBe((W - 20) / 2); // 40, not 38
  });

  it("end-of-line caret sits at the trimmed content edge (last leaf width excludes trailing tracking)", () => {
    // Left-aligned "ab", letterSpacing 4. The "ab" run's stored inlineSize is
    // reduced by b's trailing 4: 24 → 20. The sum of leaf inlineSizes (which the
    // caret/selection layer accumulates) is 20, so the end-of-line caret lands
    // at x=20, not 28/24.
    const lines = layoutPara("ab", 500, { letterSpacing: 4 });
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(lines[0]);
    const sum = leaves.reduce((s, l) => s + l.inlineSize, 0);
    expect(sum).toBe(20);
    // The last leaf carries the trim.
    expect(leaves[leaves.length - 1].inlineSize).toBe(20);
  });

  it("normal-identity: letterSpacing normal → no trim, widths unchanged", () => {
    // "ab" with no spacing: a=8, b=8 → run width 16. No trailing trim.
    const lines = layoutPara("ab", 500, {});
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(lines[0]);
    const sum = leaves.reduce((s, l) => s + l.inlineSize, 0);
    expect(sum).toBe(16);
    expect(leaves[leaves.length - 1].inlineSize).toBe(16);

    // Centered identity: contentWidth 16 → offset (W − 16)/2.
    const W = 100;
    const centered = layoutPara("ab", W, { textAlign: "center" });
    expect(leavesOf(centered[0])[0].x).toBe((W - 16) / 2); // 42
  });

  it("justify + letter-spacing: a non-last (justified) line still FILLS lineInlineSize (gap computed from the spaced contentWidth)", () => {
    // Multi-word paragraph forced to wrap to >= 2 lines, justified, with
    // non-zero letter-spacing. The justify gap is `lineInlineSize − contentWidth`
    // where contentWidth already INCLUDES letter-spacing (and excludes the
    // trailing hung space + trailing tracking). So the justified line must reach
    // the FULL `lineInlineSize` — letter-spacing does NOT pull the right edge in
    // to `lineInlineSize − letterSpacing*k`. A justified line fills both edges
    // REGARDLESS of letter-spacing, exactly as it would WITHOUT it.
    const W = 88;
    const TEXT = "aa bb cc dd ee ff gg hh";

    // Baseline (no letter-spacing): the first justified line fills W.
    const baseLines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    expect(baseLines.length).toBeGreaterThanOrEqual(2);
    const baseLeaves = leavesOf(baseLines[0]);
    const baseRight = baseLeaves[baseLeaves.length - 1];
    expect(baseRight.x + baseRight.inlineSize).toBe(W);

    // With letter-spacing: the first justified line STILL fills W (not W − k·4).
    const lines = layoutPara(TEXT, W, { letterSpacing: 4, textAlign: "justify", whiteSpace: "normal" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const leaves = leavesOf(lines[0]);
    const rightmost = leaves[leaves.length - 1];
    // The rightmost leaf's right edge reaches the full lineInlineSize — letter-
    // spacing did not break justify (the residual gap was computed from the
    // spaced contentWidth, so the line still flushes both edges).
    expect(rightmost.x + rightmost.inlineSize).toBe(W);
  });

  it("line ending in a trailing space: trim targets the last RETAINED unit (b), not double-counted with the hung space", () => {
    // "ab " under break-spaces, letterSpacing 4: word "ab"=24, space=8+4=12.
    // raw currentWidth = 36. trailingSpaceWidthOf removes the hung space (12) →
    // 24. trailingLetterSpacingOf skips the trailing space unit and trims b's
    // trailing 4 → contentWidth 20. It must NOT subtract 4 a second time for
    // the space (the space's tracking left with the space).
    const W = 100;
    const lines = layoutPara("ab ", W, { letterSpacing: 4, textAlign: "center", whiteSpace: "break-spaces" });
    expect(lines).toHaveLength(1);
    const leaves = leavesOf(lines[0]);
    // The "ab" word leaf is centered using contentWidth 20: offset (100−20)/2=40.
    const wordLeaf = leaves.find(l => l.text === "ab");
    expect(wordLeaf?.x).toBe((W - 20) / 2); // 40
    // Caret-edge (effect b): the WORD leaf — NOT the trailing space leaf — is the
    // one trimmed. Its inlineSize is reduced by b's trailing 4: 24 → 20. (This
    // assertion fails against the buggy code that trimmed the last child, the
    // space leaf, leaving the word leaf at 24.)
    expect(wordLeaf?.inlineSize).toBe(20);
  });
});
