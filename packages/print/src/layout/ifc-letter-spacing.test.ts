import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutBlock } from "./bfc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { LineBox, LayoutBox, TextRunBox, InlineBox } from "./layout-box";
import type { Style } from "@taleweaver/core";

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
  const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
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
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const leaves = leavesOf(line0);
    expect(leaves).toHaveLength(1);
    const firstLeaf = leaves[0];
    if (firstLeaf === undefined) throw new Error("expected at least one leaf");
    // First (only) child centered within the full-width line.
    expect(firstLeaf.x).toBe((W - 20) / 2); // 40, not 38
  });

  it("end-of-line caret sits at the trimmed content edge (last leaf width excludes trailing tracking)", () => {
    // Left-aligned "ab", letterSpacing 4. The "ab" run's stored inlineSize is
    // reduced by b's trailing 4: 24 → 20. The sum of leaf inlineSizes (which the
    // caret/selection layer accumulates) is 20, so the end-of-line caret lands
    // at x=20, not 28/24.
    const lines = layoutPara("ab", 500, { letterSpacing: 4 });
    expect(lines).toHaveLength(1);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const leaves = leavesOf(line0);
    const sum = leaves.reduce((s, l) => s + l.inlineSize, 0);
    expect(sum).toBe(20);
    // The last leaf carries the trim.
    const last = leaves[leaves.length - 1];
    if (last === undefined) throw new Error("expected at least one leaf");
    expect(last.inlineSize).toBe(20);
    // P4-C.1 T2/F1: trimTrailingLetterSpacing rebuilds this leaf via the factory;
    // it MUST forward clusterWidths + sourceStart (else the bidi reorder can't
    // split the line-end run). Without the forward they come back undefined —
    // this asserts they survive the trim rebuild, with the length===text.length
    // invariant intact.
    expect(last.type).toBe("text-run");
    if (last.type === "text-run") {
      expect(last.clusterWidths).toBeDefined();
      expect(last.clusterWidths?.length).toBe(last.text.length);
      expect(last.sourceStart).toBe(0);
    }
  });

  it("normal-identity: letterSpacing normal → no trim, widths unchanged", () => {
    // "ab" with no spacing: a=8, b=8 → run width 16. No trailing trim.
    const lines = layoutPara("ab", 500, {});
    expect(lines).toHaveLength(1);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const leaves = leavesOf(line0);
    const sum = leaves.reduce((s, l) => s + l.inlineSize, 0);
    expect(sum).toBe(16);
    const lastLeaf = leaves[leaves.length - 1];
    if (lastLeaf === undefined) throw new Error("expected at least one leaf");
    expect(lastLeaf.inlineSize).toBe(16);

    // Centered identity: contentWidth 16 → offset (W − 16)/2.
    const W = 100;
    const centered = layoutPara("ab", W, { textAlign: "center" });
    const centeredLine0 = centered[0];
    if (centeredLine0 === undefined) throw new Error("expected at least one line");
    const centeredFirstLeaf = leavesOf(centeredLine0)[0];
    if (centeredFirstLeaf === undefined) throw new Error("expected at least one leaf");
    expect(centeredFirstLeaf.x).toBe((W - 16) / 2); // 42
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
    const baseLine0 = baseLines[0];
    if (baseLine0 === undefined) throw new Error("expected at least one line");
    const baseLeaves = leavesOf(baseLine0);
    const baseRight = baseLeaves[baseLeaves.length - 1];
    if (baseRight === undefined) throw new Error("expected at least one leaf");
    expect(baseRight.x + baseRight.inlineSize).toBe(W);

    // With letter-spacing: the first justified line STILL fills W (not W − k·4).
    const lines = layoutPara(TEXT, W, { letterSpacing: 4, textAlign: "justify", whiteSpace: "normal" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const leaves = leavesOf(line0);
    const rightmost = leaves[leaves.length - 1];
    if (rightmost === undefined) throw new Error("expected at least one leaf");
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
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const leaves = leavesOf(line0);
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

describe("IFC — trailing letter-spacing trim inside an INLINE element (#434)", () => {
  // When the line's last glyph is nested inside a `display:inline` element
  // (e.g. `<em>word</em>` at the line end) WITH non-normal letter-spacing, the
  // trailing tracking lives on a text-run leaf INSIDE an InlineBox — not at the
  // top level. CSS Text 3 §8.1 still requires trimming that trailing tracking
  // from the visible content edge. The caret/selection layer sums leaf
  // `inlineSize`s (recursing into InlineBoxes), so both the inner text-run leaf
  // AND its enclosing InlineBox must shrink by `trim`, or the end-of-line caret
  // sits `trim` px too far right.

  /**
   * Lay out a paragraph whose inline content is `[text(lead), <inline em>emText</inline>]`.
   * `letterSpacing` is set on the block and inherits into both the lead text and
   * the em's text. Returns the line boxes + the line inline-size.
   */
  function inlineWrappedLetterSpacingLines(
    lead: string,
    emText: string,
    width: number,
    letterSpacing: number,
  ): { lines: readonly LineBox[]; lineInlineSize: number } {
    const tree = cascadePass(
      createElementBox("p", { display: "block", letterSpacing: { value: letterSpacing, unit: "px" } }, [
        createTextBox("t1", {}, lead),
        createElementBox("em", { display: "inline" }, [
          createTextBox("t2", {}, emText),
        ]),
      ]),
    );
    if (tree.type !== "element") throw new Error("expected element tree");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, width), shaper, undefined);
    if (r.box === null) throw new Error("layoutBlock returned null box");
    if (r.box.type !== "block") throw new Error("expected block box");
    const lines = r.box.children.filter((c): c is LineBox => c.type === "line");
    return { lines, lineInlineSize: width };
  }

  /** The first (top-level) InlineBox child of a line — the `<em>` box. */
  function inlineBoxOf(line: LineBox): InlineBox {
    const box = line.children.find((c): c is InlineBox => c.type === "inline");
    if (box === undefined) throw new Error("expected an InlineBox child");
    return box;
  }

  /** The innermost trailing text-run leaf reachable through InlineBoxes. */
  function innermostTrailingLeaf(box: LayoutBox): TextRunBox {
    if (box.type === "text-run") return box;
    if (box.type === "inline") {
      for (let i = box.children.length - 1; i >= 0; i--) {
        const child = box.children[i];
        if (child === undefined) continue;
        if (child.type === "text-run" && child.text.trim() === "") continue;
        return innermostTrailingLeaf(child);
      }
    }
    throw new Error("no trailing text-run leaf");
  }

  /**
   * Sum of every text-run leaf's `inlineSize`, recursing into InlineBoxes — this
   * is the accumulation the end-of-line caret/selection geometry performs, so it
   * is the load-bearing caret-edge quantity.
   */
  function sumLeafInlineSizes(line: LineBox): number {
    let sum = 0;
    const walk = (boxes: readonly LayoutBox[]) => {
      for (const b of boxes) {
        if (b.type === "text-run") sum += b.inlineSize;
        else if (b.type === "inline") walk(b.children);
      }
    };
    walk(line.children);
    return sum;
  }

  it("trims the trailing tracking from the nested text-run leaf AND its enclosing InlineBox", () => {
    // letterSpacing 4 → each char 8+4 = 12px. "aaaa" = 48, em "bb" = 24. The
    // line's last retained glyph is the em's "b" → trim = b's trailing 4.
    // Nested leaf "bb": 24 → 20. The enclosing <em> InlineBox: 24 → 20.
    const { lines } = inlineWrappedLetterSpacingLines("aaaa", "bb", 500, 4);
    expect(lines).toHaveLength(1);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");

    const em = inlineBoxOf(line0);
    // RED today: the InlineBox keeps its full 24 (untrimmed).
    expect(em.inlineSize).toBe(20);

    const leaf = innermostTrailingLeaf(em);
    expect(leaf.text).toBe("bb");
    // RED today: the nested leaf keeps its full 24 (untrimmed).
    expect(leaf.inlineSize).toBe(20);
  });

  it("end-of-line caret edge (sum of leaf inlineSizes) excludes the nested trailing tracking", () => {
    // "aaaa" (48) + em "bb" (20 after trim) = 68. The caret/selection layer sums
    // leaf inlineSizes recursing into the InlineBox, so the end-of-line caret
    // lands at 68 — not 72 (trim px too far right).
    const { lines } = inlineWrappedLetterSpacingLines("aaaa", "bb", 500, 4);
    expect(lines).toHaveLength(1);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    // RED today: sum is 72 (the nested 4px tracking is never trimmed).
    expect(sumLeafInlineSizes(line0)).toBe(68);
  });

  it("normal-identity: letterSpacing normal → nested InlineBox leaf widths unchanged", () => {
    // No spacing: "aaaa" = 32, em "bb" = 16. No trailing trim anywhere.
    const { lines } = inlineWrappedLetterSpacingLines("aaaa", "bb", 500, 0);
    expect(lines).toHaveLength(1);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const em = inlineBoxOf(line0);
    expect(em.inlineSize).toBe(16);
    expect(innermostTrailingLeaf(em).inlineSize).toBe(16);
    expect(sumLeafInlineSizes(line0)).toBe(48); // 32 + 16
  });

  it("skips a trailing ALL-WHITESPACE InlineBox and trims the preceding word", () => {
    // When the line's last top-level child is an all-whitespace InlineBox
    // (`<em> </em>` under a whitespace-preserving mode), the trailing trim must
    // SKIP it (no glyph to trim) and land on the preceding word "aaaa",
    // mirroring how `trailingLetterSpacingOf` skips the trailing space unit. The
    // skip is driven by `trimTrailingLetterSpacing` returning `undefined`. With
    // letterSpacing 4 → "aaaa" = 48; the last 'a' trailing tracking (4) is
    // trimmed → 44. Without the unified walk the loop stops at the em InlineBox,
    // the helper returns `undefined`, and the trim is silently dropped (→ 48).
    const tree = cascadePass(
      createElementBox(
        "p",
        { display: "block", letterSpacing: { value: 4, unit: "px" }, whiteSpace: "pre-wrap" },
        [
          createTextBox("t1", {}, "aaaa"),
          createElementBox("em", { display: "inline" }, [createTextBox("t2", {}, " ")]),
        ],
      ),
    );
    if (tree.type !== "element") throw new Error("expected element tree");
    const r = layoutBlock(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 500), shaper, undefined);
    if (r.box === null || r.box.type !== "block") throw new Error("expected block box");
    const lines = r.box.children.filter((c): c is LineBox => c.type === "line");
    expect(lines).toHaveLength(1);
    const line0 = lines[0];
    if (line0 === undefined) throw new Error("expected at least one line");
    const word = leavesOf(line0).find((l) => l.text === "aaaa");
    expect(word).toBeDefined();
    expect(word?.inlineSize).toBe(44);
  });
});
