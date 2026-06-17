import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { createMockHyphenator } from "@taleweaver/core";
import { layoutInlineContent } from "../ifc";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import { makeRootContext } from "../layout-context";
import type { LineBox, TextRunBox, BlockBox } from "../layout-box";

/**
 * HYPH.S4 — auto-hyphenation through the REAL IFC layout path.
 *
 * Under `hyphens: auto` + a resolved content language + an injected hyphenator,
 * a long word breaks at an algorithmic in-word break point: the prefix + a
 * synthetic "-" glyph end the line, the suffix flows to the next line. With no
 * hyphenator the `auto` path falls back to `manual` (no break) — byte-identical
 * to today's behavior. Mirrors the soft-hyphen layout assertions in
 * `ifc.test.ts` (HYPH.S3) but exercises the algorithmic (auto) producer.
 */

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const shaper = createMockShaper(8, 16); // 8px per char, 16px line height

function styledTree(
  text: string,
  style?: Partial<{
    hyphens: ComputedStyle["hyphens"];
    language: string;
    hyphenateLimitChars: readonly [number, number, number];
  }>,
) {
  const tree = cascadePass(
    createElementBox("p", { display: "block", ...(style ?? {}) }, [
      createTextBox("t", {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("expected element");
  return tree;
}

function linesOf(
  text: string,
  width: number,
  style?: Parameters<typeof styledTree>[1],
  hyphenator?: ReturnType<typeof createMockHyphenator>,
): { box: BlockBox; lines: LineBox[] } {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  const result = layoutInlineContent(styledTree(text, style), 0, 0, ctx, shaper, hyphenator, 0);
  if (result.box === null) throw new Error("layoutInlineContent returned null box");
  const lines = result.box.children.filter((c): c is LineBox => c.type === "line");
  return { box: result.box, lines };
}

function runsOf(line: LineBox): TextRunBox[] {
  return line.children.filter((c): c is TextRunBox => c.type === "text-run");
}

describe("auto-hyphenation — wrap geometry through the real IFC", () => {
  it("a long word wraps at an algorithmic break with a synthetic '-' at the line end", () => {
    // "hyphenation" = 11 letters × 8px = 88px. Mock (every=3) → raw points {3,6,9};
    // default limits [5,2,2] keep {3,6,9}. At a 40px column (fits 5 chars), the
    // first line takes the prefix that fits with a hyphen: break at 3 → "hyp" (24px)
    // + "-" (8px) = 32px ≤ 40. The line ends with the synthetic hyphen glyph; the
    // suffix flows on.
    const { lines } = linesOf(
      "hyphenation",
      40,
      { hyphens: "auto", language: "en" },
      createMockHyphenator({ every: 3 }),
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(nth(lines, 0, "line").endsWithHyphenContinuation).toBe(true);
    const hyphen = runsOf(nth(lines, 0, "line")).find((r) => r.text === "-");
    expect(hyphen).toBeDefined();
    // Prefix "hyp" = 3 chars × 8 = 24px; the hyphen sits at the inline-end (24).
    expect(hyphen?.inlineOffset).toBe(24);
    // The suffix line carries no hyphen continuation on its own start.
    const lastLine = nth(lines, lines.length - 1, "line");
    expect(lastLine.endsWithHyphenContinuation).not.toBe(true);
  });

  it("equivalence: hyphens:auto with NO hyphenator lays out identically to hyphens:manual", () => {
    // The auto fallback (no dictionary/hyphenator) must be the CSS UA `manual`
    // behavior — byte-identical to today's layout. Same doc, same width, structural
    // + geometric equality across the whole line set.
    const autoNoHyphenator = linesOf("hyphenation", 40, { hyphens: "auto", language: "en" }, undefined);
    const manual = linesOf("hyphenation", 40, { hyphens: "manual" }, undefined);

    expect(autoNoHyphenator.lines.length).toBe(manual.lines.length);
    // A word with no real break opportunity overflows on one line under both.
    expect(autoNoHyphenator.lines.length).toBe(1);
    expect(nth(autoNoHyphenator.lines, 0, "line").endsWithHyphenContinuation).not.toBe(true);
    expect(nth(manual.lines, 0, "line").endsWithHyphenContinuation).not.toBe(true);

    // Geometry equality: each line's block-offset + the run texts/offsets match.
    for (let i = 0; i < manual.lines.length; i++) {
      const a = nth(autoNoHyphenator.lines, i, "line");
      const m = nth(manual.lines, i, "line");
      expect(a.blockOffset).toBe(m.blockOffset);
      expect(a.blockSize).toBe(m.blockSize);
      expect(runsOf(a).map((r) => [r.text, r.inlineOffset])).toEqual(
        runsOf(m).map((r) => [r.text, r.inlineOffset]),
      );
    }
  });

  it("a page/column break cannot fall between the prefix and its auto-hyphenated suffix", () => {
    // The shipped hyphen-pair fragmentation constraint (a hyphenated prefix and its
    // suffix must stay together across a fragmentation boundary) is origin-agnostic
    // — it consumes `hyphenBreaks` regardless of producer. Verify the prefix line
    // carries the hyphen continuation and the suffix immediately follows it within
    // the SAME flow (consecutive block-offsets, no other content interleaved).
    const { lines } = linesOf(
      "hyphenation",
      40,
      { hyphens: "auto", language: "en" },
      createMockHyphenator({ every: 3 }),
    );
    const hyphenLineIdx = lines.findIndex((l) => l.endsWithHyphenContinuation === true);
    expect(hyphenLineIdx).toBeGreaterThanOrEqual(0);
    expect(hyphenLineIdx + 1).toBeLessThan(lines.length);
    const prefix = nth(lines, hyphenLineIdx, "prefix line");
    const suffix = nth(lines, hyphenLineIdx + 1, "suffix line");
    // Suffix sits directly below the prefix (one line height down, no gap).
    expect(suffix.blockOffset).toBe(prefix.blockOffset + prefix.blockSize);
  });
});
