import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { computeUsedStyle } from "./used-style";
import { createTextRunBox, type TextRunBox } from "./layout-box";
import { splitTextRunBoxAtOffset } from "./ifc-bidi-reorder";

const computedStyle: ComputedStyle = INITIAL_COMPUTED_STYLE;
const usedStyle = computeUsedStyle(computedStyle, 1000, "indefinite");

function makeBox(args: {
  key?: string;
  text: string;
  offsetLength: number;
  inlineSize: number;
  clusterWidths?: readonly number[];
  sourceDisplayLengths?: readonly number[];
  sourceStart?: number;
}): TextRunBox {
  return createTextRunBox(
    args.key ?? "run",
    /* inlineOffset */ 0,
    /* blockOffset */ 0,
    /* inlineSize */ args.inlineSize,
    /* blockSize */ 16,
    /* writingMode */ "horizontal-tb",
    /* direction */ "ltr",
    computedStyle,
    usedStyle,
    args.text,
    args.offsetLength,
    /* containingInlineSize */ 1000,
    args.sourceDisplayLengths,
    args.clusterWidths,
    args.sourceStart,
  );
}

describe("splitTextRunBoxAtOffset", () => {
  it("splits a plain BMP run (no sourceDisplayLengths) at a display offset", () => {
    const box = makeBox({
      key: "k",
      text: "abcdef",
      offsetLength: 6,
      inlineSize: 60,
      clusterWidths: [10, 10, 10, 10, 10, 10],
      sourceStart: 4,
    });

    const [prefix, suffix] = splitTextRunBoxAtOffset(box, 3, 1000);

    expect(prefix.text).toBe("abc");
    expect(prefix.offsetLength).toBe(3);
    expect(prefix.inlineSize).toBe(30);
    expect(prefix.clusterWidths).toEqual([10, 10, 10]);
    expect(prefix.sourceStart).toBe(4);
    expect(prefix.sourceDisplayLengths).toBeUndefined();
    expect(prefix.key).toBe("k");

    expect(suffix.text).toBe("def");
    expect(suffix.offsetLength).toBe(3);
    expect(suffix.inlineSize).toBe(30);
    expect(suffix.clusterWidths).toEqual([10, 10, 10]);
    expect(suffix.sourceStart).toBe(7);
    expect(suffix.sourceDisplayLengths).toBeUndefined();
    expect(suffix.key).toBe("k-bidi3");

    // length === text.length invariant
    expect(prefix.clusterWidths?.length).toBe(prefix.text.length);
    expect(suffix.clusterWidths?.length).toBe(suffix.text.length);
  });

  it("splits a text-transform-grown run on a state-unit display boundary", () => {
    // state "aßb" (offsetLength 3) renders as "aSSb" under text-transform: uppercase.
    // sourceDisplayLengths: a→1, ß→2 ("SS"), b→1.
    const box = makeBox({
      key: "g",
      text: "aSSb",
      offsetLength: 3,
      inlineSize: 40,
      clusterWidths: [10, 10, 10, 10],
      sourceDisplayLengths: [1, 2, 1],
      sourceStart: 2,
    });

    // Split at display 3 = after "aSS" = boundary between state unit 2 (ß) and 3 (b).
    const [prefix, suffix] = splitTextRunBoxAtOffset(box, 3, 1000);

    expect(prefix.text).toBe("aSS");
    expect(prefix.offsetLength).toBe(2); // a + ß
    expect(prefix.inlineSize).toBe(30);
    expect(prefix.clusterWidths).toEqual([10, 10, 10]);
    expect(prefix.sourceDisplayLengths).toEqual([1, 2]);
    expect(prefix.sourceStart).toBe(2);

    expect(suffix.text).toBe("b");
    expect(suffix.offsetLength).toBe(1); // b
    expect(suffix.inlineSize).toBe(10);
    expect(suffix.clusterWidths).toEqual([10]);
    expect(suffix.sourceDisplayLengths).toEqual([1]);
    expect(suffix.sourceStart).toBe(2 + 3); // display-U16 advance

    expect(prefix.clusterWidths?.length).toBe(prefix.text.length);
    expect(suffix.clusterWidths?.length).toBe(suffix.text.length);
  });

  it("throws when the split falls inside a single state unit's multi-display expansion", () => {
    const box = makeBox({
      text: "aSSb",
      offsetLength: 3,
      inlineSize: 40,
      clusterWidths: [10, 10, 10, 10],
      sourceDisplayLengths: [1, 2, 1],
      sourceStart: 0,
    });

    // Split at display 2 = between the two S of ß → mid-state-unit → must throw.
    expect(() => splitTextRunBoxAtOffset(box, 2, 1000)).toThrow();
  });

  it("splits an astral-grapheme run at a grapheme boundary", () => {
    // "x" + "😀" (surrogate pair) + "y". text = "x" + high + low + "y" (4 code units).
    const emoji = "😀"; // 2 UTF-16 code units
    const text = "x" + emoji + "y";
    expect(text.length).toBe(4);
    const box = makeBox({
      text,
      offsetLength: 4,
      inlineSize: 30,
      // interior code unit of the emoji carries 0 advance
      clusterWidths: [10, 20, 0, 10],
      sourceStart: 5,
    });

    // Split at display 3 = after "x😀" (grapheme boundary, before "y").
    const [prefix, suffix] = splitTextRunBoxAtOffset(box, 3, 1000);

    expect(prefix.text).toBe("x" + emoji);
    expect(prefix.clusterWidths).toEqual([10, 20, 0]);
    expect(prefix.inlineSize).toBe(30);
    expect(prefix.offsetLength).toBe(3);

    expect(suffix.text).toBe("y");
    expect(suffix.clusterWidths).toEqual([10]);
    expect(suffix.inlineSize).toBe(10);
    expect(suffix.offsetLength).toBe(1);
    expect(suffix.sourceStart).toBe(8);

    // length === text.length invariant for both halves
    expect(prefix.clusterWidths?.length).toBe(prefix.text.length);
    expect(suffix.clusterWidths?.length).toBe(suffix.text.length);
  });

  it("throws when the box has no clusterWidths", () => {
    const box = makeBox({
      text: "abc",
      offsetLength: 3,
      inlineSize: 30,
      // no clusterWidths
    });
    expect(() => splitTextRunBoxAtOffset(box, 1, 1000)).toThrow();
  });
});
