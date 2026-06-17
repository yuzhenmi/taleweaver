import { describe, it, expect } from "vitest";
import type { ComputedStyle } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { computeUsedStyle } from "./used-style";
import {
  createInlineBlockBox,
  createInlineBox,
  createTextRunBox,
  type InlineBlockBox,
  type InlineBox,
  type LayoutBox,
  type TextRunBox,
} from "./layout-box";
import { resolveParagraphBidi } from "./ifc-bidi";
import { applyL1, reorderRunsByLevel } from "@taleweaver/core";
import {
  flattenLineToLeaves,
  renestLeaves,
  reorderLineLeaves,
  segmentLine,
  splitTextRunBoxAtOffset,
  type FlatLeaf,
} from "./ifc-bidi-reorder";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
  link?: string;
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
    /* bidiLevel */ undefined,
    /* containingBlockSize */ undefined,
    args.link,
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

  // #521 PDF /Link: a linked run that crosses an LTR↔RTL embedding-level
  // boundary is SPLIT here by `reorderLineLeaves`. The run's `link` is per-run
  // IDENTITY metadata (opaque to geometry) and MUST ride onto BOTH fragments —
  // a dropped link → no PDF annotation for that link on the split fragment.
  it("carries link onto BOTH bidi-split fragments", () => {
    const box = makeBox({
      key: "lk",
      text: "abcdef",
      offsetLength: 6,
      inlineSize: 60,
      clusterWidths: [10, 10, 10, 10, 10, 10],
      sourceStart: 4,
      link: "https://x.com",
    });

    const [prefix, suffix] = splitTextRunBoxAtOffset(box, 3, 1000);

    expect(prefix.link).toBe("https://x.com");
    expect(suffix.link).toBe("https://x.com");
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

describe("segmentLine", () => {
  // Build levels from the real engine so they're authoritative.
  const source = "abc " + "אבג"; // Latin "abc " (level 0) + Hebrew "אבג" (level 1)
  const pb = resolveParagraphBidi(source, "ltr");
  const lineStartCp = 0;
  const lineEndCp = [...source].length;
  const postL1 = applyL1(pb.levels, pb.types, pb.paragraphLevel, lineStartCp, lineEndCp);

  // First codepoint index where the level becomes 1 (the Latin/Hebrew boundary).
  const boundaryCp = (() => {
    for (let i = 0; i < postL1.length; i++) {
      if (postL1[i] === 1) return i;
    }
    throw new Error("test setup: no level-1 codepoint found");
  })();

  it("splits a single box that straddles a level boundary into per-level segments", () => {
    // source has no astral chars, so display-U16 == codepoint index 1:1.
    const box = makeBox({
      key: "k",
      text: source,
      offsetLength: source.length,
      inlineSize: 100,
      clusterWidths: new Array(source.length).fill(10),
      sourceStart: 0,
    });

    const segments = segmentLine([box], pb, lineStartCp, postL1);

    expect(segments.length).toBeGreaterThanOrEqual(2);
    // Prefix: the Latin part at level 0; suffix: the Hebrew part at level 1.
    expect(nth(segments, 0, "segment").level).toBe(0);
    expect(nth(segments, 0, "segment").box.type).toBe("text-run");
    expect((nth(segments, 0, "segment").box as TextRunBox).text).toBe(source.slice(0, boundaryCp));

    const last = nth(segments, segments.length - 1, "segment");
    expect(last.level).toBe(1);
    expect((last.box as TextRunBox).text).toBe(source.slice(boundaryCp));

    // Concatenation of all segment texts reconstructs the source in logical order.
    const reconstructed = segments
      .map((s) => (s.box as TextRunBox).text)
      .join("");
    expect(reconstructed).toBe(source);
    // Every emitted text-run keeps its clusterWidths.length === text.length.
    for (const seg of segments) {
      const trb = seg.box as TextRunBox;
      expect(trb.clusterWidths?.length).toBe(trb.text.length);
    }
  });

  it("emits already-single-level boxes unchanged (no split)", () => {
    const latin = makeBox({
      key: "latin",
      text: "abc ",
      offsetLength: 4,
      inlineSize: 40,
      clusterWidths: [10, 10, 10, 10],
      sourceStart: 0,
    });
    const hebrew = makeBox({
      key: "hebrew",
      text: "אבג",
      offsetLength: 3,
      inlineSize: 30,
      clusterWidths: [10, 10, 10],
      sourceStart: 4, // codepoint 4 == UTF-16 offset 4 (all BMP)
    });

    const segments = segmentLine([latin, hebrew], pb, lineStartCp, postL1);

    expect(segments.length).toBe(2);
    expect(nth(segments, 0, "segment").box).toBe(latin); // unchanged identity (no split)
    expect(nth(segments, 0, "segment").level).toBe(0);
    expect(nth(segments, 1, "segment").box).toBe(hebrew);
    expect(nth(segments, 1, "segment").level).toBe(1);
  });

  it("treats an inline-block as one segment at its source char's level", () => {
    // Source: Latin "ab" + OBJECT_REPLACEMENT + Hebrew "אב".
    const OBJ = "￼";
    const ibSource = "ab" + OBJ + "אב";
    const ibPb = resolveParagraphBidi(ibSource, "ltr");
    const ibEndCp = [...ibSource].length;
    const ibPostL1 = applyL1(ibPb.levels, ibPb.types, ibPb.paragraphLevel, 0, ibEndCp);

    const inlineBlock = createInlineBlockBox(
      "ib",
      0, 0, 20, 16,
      "horizontal-tb", "ltr",
      computedStyle, usedStyle,
      [],
      1000,
      /* sourceStart */ 2, // the OBJECT_REPLACEMENT char
    );

    const segments = segmentLine([inlineBlock], ibPb, 0, ibPostL1);

    expect(segments.length).toBe(1);
    expect(nth(segments, 0, "segment").box).toBe(inlineBlock);
    // Level of the OBJECT_REPLACEMENT char (codepoint 2).
    expect(nth(segments, 0, "segment").level).toBe(ibPostL1[2]);
  });

  it("throws for an InlineBox (Task 5b not implemented here)", () => {
    const inlineBox = createInlineBox(
      "ix",
      0, 0, 20, 16,
      "horizontal-tb", "ltr",
      computedStyle, usedStyle,
      [],
      "only",
      "anc",
      1000,
    );
    expect(() => segmentLine([inlineBox], pb, lineStartCp, postL1)).toThrow(
      /Task 5b/,
    );
  });

  it("emits a pure-LTR line as level-0 segments with no split", () => {
    const ltrSource = "hello world";
    const ltrPb = resolveParagraphBidi(ltrSource, "ltr");
    const ltrEndCp = [...ltrSource].length;
    const ltrPostL1 = applyL1(ltrPb.levels, ltrPb.types, ltrPb.paragraphLevel, 0, ltrEndCp);

    const box = makeBox({
      key: "ltr",
      text: ltrSource,
      offsetLength: ltrSource.length,
      inlineSize: 110,
      clusterWidths: new Array(ltrSource.length).fill(10),
      sourceStart: 0,
    });

    const segments = segmentLine([box], ltrPb, 0, ltrPostL1);

    expect(segments.length).toBe(1);
    expect(nth(segments, 0, "segment").box).toBe(box);
    expect(nth(segments, 0, "segment").level).toBe(0);
  });

  it("throws when a line TextRunBox lacks sourceStart", () => {
    const box = makeBox({
      text: "abc",
      offsetLength: 3,
      inlineSize: 30,
      clusterWidths: [10, 10, 10],
      // no sourceStart
    });
    expect(() => segmentLine([box], pb, lineStartCp, postL1)).toThrow(/sourceStart/);
  });

  it("throws when a line TextRunBox lacks clusterWidths", () => {
    const box = makeBox({
      text: "abc",
      offsetLength: 3,
      inlineSize: 30,
      sourceStart: 0,
      // no clusterWidths
    });
    expect(() => segmentLine([box], pb, lineStartCp, postL1)).toThrow(/clusterWidths/);
  });

  it("reads POST-L1 levels, not PRE-L1 (TAB reset discriminates the two)", () => {
    // Discriminating source: Latin "ab\tcd" in an RTL paragraph.
    //   PRE-L1  levels (pb.levels):   [2,2,2,2,2]  — the TAB elevates to 2 with
    //                                   its Latin neighbours (one run, no split).
    //   POST-L1 levels (applyL1):     [2,2,1,2,2]  — UAX #9 L1 rule (i) resets the
    //                                   segment-separator TAB to the paragraph
    //                                   level (1), breaking the run into three.
    // segmentLine MUST observe POST-L1, so it emits THREE segments. A regression
    // that read pb.levels (PRE-L1) would emit ONE segment — this test fails then.
    const tabSource = "ab\tcd"; // L L S L L
    const tabPb = resolveParagraphBidi(tabSource, "rtl");
    const tabEndCp = [...tabSource].length;
    const tabPostL1 = applyL1(
      tabPb.levels,
      tabPb.types,
      tabPb.paragraphLevel,
      0,
      tabEndCp,
    );

    // Guard the fixture's discriminating property: pre-L1 ≠ post-L1 at the TAB,
    // and pre-L1 is a single uniform level (so PRE-L1 reading yields one segment).
    expect(Array.from(tabPb.levels)).toEqual([2, 2, 2, 2, 2]);
    expect(Array.from(tabPostL1)).toEqual([2, 2, 1, 2, 2]);

    // All-BMP source ⇒ display-U16 == codepoint index 1:1.
    const box = makeBox({
      key: "tab",
      text: tabSource,
      offsetLength: tabSource.length,
      inlineSize: 50,
      clusterWidths: new Array(tabSource.length).fill(10),
      sourceStart: 0,
    });

    const segments = segmentLine([box], tabPb, 0, tabPostL1);

    // POST-L1 grouping: "ab"@2, "\t"@1, "cd"@2. (PRE-L1 would be one "ab\tcd"@2.)
    expect(segments.map((s) => s.level)).toEqual([2, 1, 2]);
    expect(segments.map((s) => (s.box as TextRunBox).text)).toEqual([
      "ab",
      "\t",
      "cd",
    ]);
    // Logical-order concatenation reconstructs the source.
    expect(segments.map((s) => (s.box as TextRunBox).text).join("")).toBe(
      tabSource,
    );
    for (const seg of segments) {
      const trb = seg.box as TextRunBox;
      expect(trb.clusterWidths?.length).toBe(trb.text.length);
    }
  });

  it("splits a single box spanning THREE bidi levels into three segments", () => {
    // "abאב12" in an LTR paragraph: Latin "ab" (level 0), Hebrew "אב" (level 1),
    // EN digits "12" (level 2) — three distinct levels, exercising the suffix
    // loop across TWO splits (only a single 2-level split was previously tested).
    const triSource = "abאב12";
    const triPb = resolveParagraphBidi(triSource, "ltr");
    const triEndCp = [...triSource].length;
    const triPostL1 = applyL1(
      triPb.levels,
      triPb.types,
      triPb.paragraphLevel,
      0,
      triEndCp,
    );

    // Guard: this fixture genuinely has three distinct levels in the line.
    expect(Array.from(triPostL1)).toEqual([0, 0, 1, 1, 2, 2]);

    // All-BMP source ⇒ display-U16 == codepoint index 1:1.
    const box = makeBox({
      key: "tri",
      text: triSource,
      offsetLength: triSource.length,
      inlineSize: 60,
      clusterWidths: new Array(triSource.length).fill(10),
      sourceStart: 0,
    });

    const segments = segmentLine([box], triPb, 0, triPostL1);

    expect(segments.length).toBe(3);
    expect(segments.map((s) => s.level)).toEqual([0, 1, 2]);
    expect(segments.map((s) => (s.box as TextRunBox).text)).toEqual([
      "ab",
      "אב",
      "12",
    ]);
    // Logical-order concatenation reconstructs the source.
    expect(segments.map((s) => (s.box as TextRunBox).text).join("")).toBe(
      triSource,
    );
    for (const seg of segments) {
      const trb = seg.box as TextRunBox;
      expect(trb.clusterWidths?.length).toBe(trb.text.length);
    }
  });
});

describe("flattenLineToLeaves", () => {
  function makeInline(args: {
    ancestorKey: string;
    children: readonly LayoutBox[];
    key?: string;
  }): InlineBox {
    return createInlineBox(
      args.key ?? args.ancestorKey,
      /* inlineOffset */ 0,
      /* blockOffset */ 0,
      /* inlineSize */ 20,
      /* blockSize */ 16,
      /* writingMode */ "horizontal-tb",
      /* direction */ "ltr",
      computedStyle,
      usedStyle,
      args.children,
      /* fragmentEdge */ "only",
      args.ancestorKey,
      /* containingInlineSize */ 1000,
    );
  }

  function makeInlineBlock(key: string): InlineBlockBox {
    return createInlineBlockBox(
      key,
      0, 0, 20, 16,
      "horizontal-tb", "ltr",
      computedStyle, usedStyle,
      [],
      1000,
      /* sourceStart */ 0,
    );
  }

  it("flat line with no inline: every leaf has empty ancestors, order preserved", () => {
    const a = makeBox({ key: "a", text: "a", offsetLength: 1, inlineSize: 10 });
    const b = makeBox({ key: "b", text: "b", offsetLength: 1, inlineSize: 10 });

    const leaves = flattenLineToLeaves([a, b]);

    expect(leaves.length).toBe(2);
    expect(nth(leaves, 0, "leaf").leaf).toBe(a);
    expect(nth(leaves, 0, "leaf").ancestors).toEqual([]);
    expect(nth(leaves, 1, "leaf").leaf).toBe(b);
    expect(nth(leaves, 1, "leaf").ancestors).toEqual([]);
  });

  it("one inline: middle leaf carries the em ancestor, outer leaves are bare", () => {
    const before = makeBox({ key: "before", text: "a ", offsetLength: 2, inlineSize: 20 });
    const bc = makeBox({ key: "bc", text: "bc", offsetLength: 2, inlineSize: 20 });
    const em = makeInline({ ancestorKey: "em", children: [bc] });
    const after = makeBox({ key: "after", text: " d", offsetLength: 2, inlineSize: 20 });

    const leaves = flattenLineToLeaves([before, em, after]);

    expect(leaves.length).toBe(3);
    // logical (child) order preserved
    expect(nth(leaves, 0, "leaf").leaf).toBe(before);
    expect(nth(leaves, 0, "leaf").ancestors).toEqual([]);

    expect(nth(leaves, 1, "leaf").leaf).toBe(bc);
    expect(nth(leaves, 1, "leaf").ancestors.length).toBe(1);
    expect(nth(nth(leaves, 1, "leaf").ancestors, 0, "ancestor")).toBe(em);
    expect(nth(nth(leaves, 1, "leaf").ancestors, 0, "ancestor").ancestorKey).toBe("em");

    expect(nth(leaves, 2, "leaf").leaf).toBe(after);
    expect(nth(leaves, 2, "leaf").ancestors).toEqual([]);
  });

  it("nested inline (<em><strong>): ancestors are root-most first", () => {
    const x = makeBox({ key: "x", text: "x", offsetLength: 1, inlineSize: 10 });
    const strong = makeInline({ ancestorKey: "strong", children: [x] });
    const em = makeInline({ ancestorKey: "em", children: [strong] });

    const leaves = flattenLineToLeaves([em]);

    expect(leaves.length).toBe(1);
    expect(nth(leaves, 0, "leaf").leaf).toBe(x);
    expect(nth(leaves, 0, "leaf").ancestors.length).toBe(2);
    // root-most (em) first, then strong
    expect(nth(nth(leaves, 0, "leaf").ancestors, 0, "ancestor")).toBe(em);
    expect(nth(nth(leaves, 0, "leaf").ancestors, 0, "ancestor").ancestorKey).toBe("em");
    expect(nth(nth(leaves, 0, "leaf").ancestors, 1, "ancestor")).toBe(strong);
    expect(nth(nth(leaves, 0, "leaf").ancestors, 1, "ancestor").ancestorKey).toBe("strong");
  });

  it("inline-block inside an inline is emitted as a leaf with the inline's chain", () => {
    const ib = makeInlineBlock("ib");
    const link = makeInline({ ancestorKey: "a", children: [ib] });

    const leaves = flattenLineToLeaves([link]);

    expect(leaves.length).toBe(1);
    expect(nth(leaves, 0, "leaf").leaf).toBe(ib);
    expect(nth(leaves, 0, "leaf").leaf.type).toBe("inline-block");
    expect(nth(leaves, 0, "leaf").ancestors.length).toBe(1);
    expect(nth(nth(leaves, 0, "leaf").ancestors, 0, "ancestor")).toBe(link);
    expect(nth(nth(leaves, 0, "leaf").ancestors, 0, "ancestor").ancestorKey).toBe("a");
  });

  it("multiple leaves in one inline share the same single-element ancestor chain", () => {
    const t1 = makeBox({ key: "t1", text: "ab", offsetLength: 2, inlineSize: 20 });
    const t2 = makeBox({ key: "t2", text: "cd", offsetLength: 2, inlineSize: 20 });
    const em = makeInline({ ancestorKey: "em", children: [t1, t2] });

    const leaves = flattenLineToLeaves([em]);

    expect(leaves.length).toBe(2);
    expect(nth(leaves, 0, "leaf").leaf).toBe(t1);
    expect(nth(leaves, 1, "leaf").leaf).toBe(t2);
    expect(nth(leaves, 0, "leaf").ancestors.length).toBe(1);
    expect(nth(leaves, 1, "leaf").ancestors.length).toBe(1);
    expect(nth(nth(leaves, 0, "leaf").ancestors, 0, "ancestor")).toBe(em);
    expect(nth(nth(leaves, 1, "leaf").ancestors, 0, "ancestor")).toBe(em);
  });

  it("does not mutate the input boxes", () => {
    const x = makeBox({ key: "x", text: "x", offsetLength: 1, inlineSize: 10 });
    const em = makeInline({ ancestorKey: "em", children: [x] });
    const children: readonly LayoutBox[] = [em];

    flattenLineToLeaves(children);

    expect(children.length).toBe(1);
    expect(em.children.length).toBe(1);
    expect(em.children[0]).toBe(x);
  });
});

describe("renestLeaves", () => {
  const LINE_INLINE_SIZE = 1000;

  function inlineTemplate(args: {
    ancestorKey: string;
    key?: string;
  }): InlineBox {
    // The ancestor template only contributes style/key/geometry metadata; its
    // own children list is irrelevant to renest (which rebuilds children).
    return createInlineBox(
      args.key ?? args.ancestorKey,
      /* inlineOffset */ 0,
      /* blockOffset */ 0,
      /* inlineSize */ 0,
      /* blockSize */ 16,
      /* writingMode */ "horizontal-tb",
      /* direction */ "ltr",
      computedStyle,
      usedStyle,
      /* children */ [],
      /* fragmentEdge */ "only",
      args.ancestorKey,
      /* containingInlineSize */ LINE_INLINE_SIZE,
    );
  }

  function leaf(box: LayoutBox, ancestors: readonly InlineBox[]): FlatLeaf {
    return { leaf: box, ancestors };
  }

  function asInline(box: LayoutBox): InlineBox {
    if (box.type !== "inline") throw new Error(`expected inline, got ${box.type}`);
    return box;
  }
  function asTextRun(box: LayoutBox): TextRunBox {
    if (box.type !== "text-run") throw new Error(`expected text-run, got ${box.type}`);
    return box;
  }

  it("no inline: bare leaves returned as-is, repacked left-to-right", () => {
    const a = makeBox({ key: "a", text: "a", offsetLength: 1, inlineSize: 10, sourceStart: 0 });
    const b = makeBox({ key: "b", text: "b", offsetLength: 1, inlineSize: 20, sourceStart: 1 });
    const c = makeBox({ key: "c", text: "c", offsetLength: 1, inlineSize: 30, sourceStart: 2 });

    const out = renestLeaves([leaf(a, []), leaf(b, []), leaf(c, [])], LINE_INLINE_SIZE);

    expect(out.length).toBe(3);
    expect(out.map((x) => x.type)).toEqual(["text-run", "text-run", "text-run"]);
    expect(asTextRun(nth(out, 0, "box")).text).toBe("a");
    expect(asTextRun(nth(out, 1, "box")).text).toBe("b");
    expect(asTextRun(nth(out, 2, "box")).text).toBe("c");
    // Packed: 0, 10, 10+20.
    expect(nth(out, 0, "box").inlineOffset).toBe(0);
    expect(nth(out, 1, "box").inlineOffset).toBe(10);
    expect(nth(out, 2, "box").inlineOffset).toBe(30);
  });

  it("uniform inline (no split): one InlineBox fragment, fragmentEdge 'only'", () => {
    const em = inlineTemplate({ ancestorKey: "em" });
    const a = makeBox({ key: "a", text: "a", offsetLength: 1, inlineSize: 10, sourceStart: 0 });
    const bc = makeBox({ key: "bc", text: "bc", offsetLength: 2, inlineSize: 25, sourceStart: 1 });
    const d = makeBox({ key: "d", text: "d", offsetLength: 1, inlineSize: 10, sourceStart: 3 });

    const out = renestLeaves(
      [leaf(a, []), leaf(bc, [em]), leaf(d, [])],
      LINE_INLINE_SIZE,
    );

    expect(out.map((x) => x.type)).toEqual(["text-run", "inline", "text-run"]);
    const emBox = asInline(nth(out, 1, "box"));
    expect(emBox.ancestorKey).toBe("em");
    expect(emBox.fragmentEdge).toBe("only");
    // em inlineSize = bc width; packed after a (offset 10).
    expect(emBox.inlineSize).toBe(25);
    expect(emBox.inlineOffset).toBe(10);
    // bc inside the em at offset 0 (parent-relative).
    expect(emBox.children.length).toBe(1);
    expect(asTextRun(nth(emBox.children, 0, "child")).text).toBe("bc");
    expect(nth(emBox.children, 0, "child").inlineOffset).toBe(0);
    // d packed after the em (10 + 25).
    expect(nth(out, 2, "box").inlineOffset).toBe(35);
  });

  it("bidi-split inline: two non-adjacent pieces → two fragments, edges by logical order", () => {
    const em = inlineTemplate({ ancestorKey: "em" });
    // piece1 has the LOWER sourceStart (logically first); 'other' is between
    // them in VISUAL order; piece2 has the higher sourceStart.
    const piece1 = makeBox({ key: "p1", text: "x", offsetLength: 1, inlineSize: 12, sourceStart: 2 });
    const other = makeBox({ key: "o", text: "o", offsetLength: 1, inlineSize: 10, sourceStart: 5 });
    const piece2 = makeBox({ key: "p2", text: "y", offsetLength: 1, inlineSize: 14, sourceStart: 8 });

    const out = renestLeaves(
      [leaf(piece1, [em]), leaf(other, []), leaf(piece2, [em])],
      LINE_INLINE_SIZE,
    );

    // TWO separate InlineBox fragments (contiguous-only grouping), with the
    // bare leaf between them.
    expect(out.map((x) => x.type)).toEqual(["inline", "text-run", "inline"]);
    const frag1 = asInline(nth(out, 0, "box"));
    const frag2 = asInline(nth(out, 2, "box"));
    // Both carry the element's ancestorKey (for the cross-line post-pass).
    expect(frag1.ancestorKey).toBe("em");
    expect(frag2.ancestorKey).toBe("em");
    // Logically-first fragment (lower sourceStart = piece1) → "first";
    // logically-last (piece2) → "last".
    expect(frag1.fragmentEdge).toBe("first");
    expect(frag2.fragmentEdge).toBe("last");
    // Each wraps its own piece.
    expect(asTextRun(nth(frag1.children, 0, "child")).text).toBe("x");
    expect(asTextRun(nth(frag2.children, 0, "child")).text).toBe("y");
    // Geometry: frag1@0 (w12), other@12 (w10), frag2@22 (w14).
    expect(frag1.inlineOffset).toBe(0);
    expect(frag1.inlineSize).toBe(12);
    expect(nth(out, 1, "box").inlineOffset).toBe(12);
    expect(frag2.inlineOffset).toBe(22);
    expect(frag2.inlineSize).toBe(14);
  });

  it("bidi-split edges follow LOGICAL order even when visual order is reversed", () => {
    const em = inlineTemplate({ ancestorKey: "em" });
    // VISUAL order places the HIGHER-sourceStart piece first (RTL-style flip).
    const visFirst = makeBox({ key: "vf", text: "y", offsetLength: 1, inlineSize: 14, sourceStart: 8 });
    const other = makeBox({ key: "o", text: "o", offsetLength: 1, inlineSize: 10, sourceStart: 5 });
    const visLast = makeBox({ key: "vl", text: "x", offsetLength: 1, inlineSize: 12, sourceStart: 2 });

    const out = renestLeaves(
      [leaf(visFirst, [em]), leaf(other, []), leaf(visLast, [em])],
      LINE_INLINE_SIZE,
    );

    const fragVisFirst = asInline(nth(out, 0, "box"));
    const fragVisLast = asInline(nth(out, 2, "box"));
    // The visually-first fragment is logically LAST (sourceStart 8) → "last";
    // the visually-last fragment is logically FIRST (sourceStart 2) → "first".
    expect(fragVisFirst.fragmentEdge).toBe("last");
    expect(fragVisLast.fragmentEdge).toBe("first");
  });

  it("nested <em><strong>: renests bottom-up into 2 levels", () => {
    const em = inlineTemplate({ ancestorKey: "em" });
    const strong = inlineTemplate({ ancestorKey: "strong" });
    const z = makeBox({ key: "z", text: "z", offsetLength: 1, inlineSize: 18, sourceStart: 0 });

    const out = renestLeaves([leaf(z, [em, strong])], LINE_INLINE_SIZE);

    expect(out.length).toBe(1);
    const emBox = asInline(nth(out, 0, "box"));
    expect(emBox.ancestorKey).toBe("em");
    expect(emBox.fragmentEdge).toBe("only");
    expect(emBox.children.length).toBe(1);
    const strongBox = asInline(nth(emBox.children, 0, "child"));
    expect(strongBox.ancestorKey).toBe("strong");
    expect(strongBox.fragmentEdge).toBe("only");
    expect(asTextRun(nth(strongBox.children, 0, "child")).text).toBe("z");
    // Geometry rolls up: strong inlineSize = z width; em inlineSize = strong.
    expect(strongBox.inlineSize).toBe(18);
    expect(emBox.inlineSize).toBe(18);
    // Children are parent-relative at offset 0 at each level.
    expect(nth(emBox.children, 0, "child").inlineOffset).toBe(0);
    expect(nth(strongBox.children, 0, "child").inlineOffset).toBe(0);
  });

  it("geometry: InlineBox inlineSize = sum of children; offsets pack left-to-right", () => {
    const em = inlineTemplate({ ancestorKey: "em" });
    const a = makeBox({ key: "a", text: "a", offsetLength: 1, inlineSize: 10, sourceStart: 0 });
    const b = makeBox({ key: "b", text: "bb", offsetLength: 2, inlineSize: 20, sourceStart: 1 });
    const c = makeBox({ key: "c", text: "ccc", offsetLength: 3, inlineSize: 30, sourceStart: 3 });

    // <em>a bb ccc</em> — all three under em, contiguous (one fragment).
    const out = renestLeaves(
      [leaf(a, [em]), leaf(b, [em]), leaf(c, [em])],
      LINE_INLINE_SIZE,
    );

    expect(out.length).toBe(1);
    const emBox = asInline(nth(out, 0, "box"));
    expect(emBox.fragmentEdge).toBe("only");
    expect(emBox.inlineSize).toBe(60); // 10 + 20 + 30
    // Inner children packed 0, 10, 30.
    expect(emBox.children.map((x) => x.inlineOffset)).toEqual([0, 10, 30]);
    expect(emBox.children.map((x) => x.inlineSize)).toEqual([10, 20, 30]);
  });

  it("split fragments get distinct keys (2nd suffixed) but the same ancestorKey", () => {
    const em = inlineTemplate({ ancestorKey: "em", key: "em-key" });
    const p1 = makeBox({ key: "p1", text: "x", offsetLength: 1, inlineSize: 10, sourceStart: 1 });
    const mid = makeBox({ key: "m", text: "m", offsetLength: 1, inlineSize: 10, sourceStart: 4 });
    const p2 = makeBox({ key: "p2", text: "y", offsetLength: 1, inlineSize: 10, sourceStart: 7 });

    const out = renestLeaves(
      [leaf(p1, [em]), leaf(mid, []), leaf(p2, [em])],
      LINE_INLINE_SIZE,
    );

    const frag1 = asInline(nth(out, 0, "box"));
    const frag2 = asInline(nth(out, 2, "box"));
    expect(frag1.key).toBe("em-key");
    expect(frag2.key).toBe("em-key-frag1");
    expect(frag1.key).not.toBe(frag2.key);
    // ancestorKey stays the element key on BOTH (cross-line grouping).
    expect(frag1.ancestorKey).toBe("em");
    expect(frag2.ancestorKey).toBe("em");
  });
});

describe("reorderLineLeaves (end-to-end pure line reorder)", () => {
  const LINE_INLINE_SIZE = 1000;

  function asInline(box: LayoutBox): InlineBox {
    if (box.type !== "inline") throw new Error(`expected inline, got ${box.type}`);
    return box;
  }
  function asTextRun(box: LayoutBox): TextRunBox {
    if (box.type !== "text-run") throw new Error(`expected text-run, got ${box.type}`);
    return box;
  }

  function postL1Of(source: string, base: "ltr" | "rtl") {
    const pb = resolveParagraphBidi(source, base);
    const endCp = [...source].length;
    const postL1 = applyL1(pb.levels, pb.types, pb.paragraphLevel, 0, endCp);
    return { pb, postL1 };
  }

  it("pure-LTR line: identity order, levels all 0, packed left-to-right", () => {
    const source = "abc def";
    const { pb, postL1 } = postL1Of(source, "ltr");
    const box = makeBox({
      key: "k",
      text: source,
      offsetLength: source.length,
      inlineSize: source.length * 10,
      clusterWidths: new Array(source.length).fill(10),
      sourceStart: 0,
    });

    const out = reorderLineLeaves([box], pb, 0, postL1, LINE_INLINE_SIZE);

    // No bidi → one level-0 run, identity, full text preserved.
    expect(out.length).toBe(1);
    const run = asTextRun(nth(out, 0, "box"));
    expect(run.text).toBe(source);
    expect(run.bidiLevel).toBe(0);
    expect(run.inlineOffset).toBe(0);
  });

  it("mixed LTR-base with embedded RTL: Hebrew run reorders, per-leaf bidiLevel, packed LTR", () => {
    // "abc " (Latin, level 0) + "אבג" (Hebrew, level 1) in an LTR paragraph.
    const source = "abc אבג";
    const { pb, postL1 } = postL1Of(source, "ltr");

    // One TextRunBox covering the whole line, straddling the level boundary.
    const box = makeBox({
      key: "k",
      text: source,
      offsetLength: source.length,
      inlineSize: source.length * 10,
      clusterWidths: new Array(source.length).fill(10),
      sourceStart: 0,
    });

    // Compute the segment levels the orchestrator will see, then the expected
    // visual permutation, independently from reorderRunsByLevel.
    const segs = segmentLine([box], pb, 0, postL1);
    const segLevels = segs.map((s) => s.level);
    const expectedVisual = reorderRunsByLevel(segLevels);
    // Sanity: this fixture genuinely has two segments (Latin@0, Hebrew@1).
    expect(segLevels).toEqual([0, 1]);
    // For a single embedded level-1 run, L2 only reverses the run internally
    // (a single-segment reversal is a no-op at the SEGMENT level) — the
    // segment order stays [Latin, Hebrew], but the Hebrew run is stamped
    // level 1 so the painter renders it right-to-left.
    expect(expectedVisual).toEqual([0, 1]);

    const out = reorderLineLeaves([box], pb, 0, postL1, LINE_INLINE_SIZE);

    // Output is flat text-runs (no inline ancestors).
    expect(out.every((b) => b.type === "text-run")).toBe(true);
    const runs = out.map(asTextRun);

    // Per-leaf bidiLevel matches the visual-ordered segment levels.
    expect(runs.map((r) => r.bidiLevel)).toEqual(expectedVisual.map((i) => nth(segLevels, i, "segLevel")));

    // Latin leaf carries level 0, Hebrew leaf level 1.
    const latin = runs.find((r) => r.text === "abc ");
    const hebrew = runs.find((r) => r.text === "אבג");
    expect(latin?.bidiLevel).toBe(0);
    expect(hebrew?.bidiLevel).toBe(1);

    // VISUAL order: text concatenated in output order equals the visual-ordered
    // segment texts (the Hebrew run is repositioned relative to logical).
    expect(runs.map((r) => r.text)).toEqual(
      expectedVisual.map((i) => asTextRun(nth(segs, i, "seg").box).text),
    );

    // Geometry packs left-to-right from 0, contiguous, no gaps/overlaps.
    let cursor = 0;
    for (const r of runs) {
      expect(r.inlineOffset).toBe(cursor);
      cursor += r.inlineSize;
    }
  });

  it("RTL base with embedded LTR: the level-2 run genuinely MOVES relative to logical order", () => {
    // "abcאבג" in an RTL paragraph: Latin "abc" (level 2), Hebrew "אבג" (level 1).
    // segments = [Latin@2, Hebrew@1]; reorderRunsByLevel([2,1]) = [1,0] — the runs
    // SWAP. This is the proof that a non-trivial reorder reaches reorderLineLeaves.
    const source = "abcאבג";
    const { pb, postL1 } = postL1Of(source, "rtl");
    const box = makeBox({
      key: "k",
      text: source,
      offsetLength: source.length,
      inlineSize: source.length * 10,
      clusterWidths: new Array(source.length).fill(10),
      sourceStart: 0,
    });

    const segs = segmentLine([box], pb, 0, postL1);
    const segLevels = segs.map((s) => s.level);
    expect(segLevels).toEqual([2, 1]);
    const expectedVisual = reorderRunsByLevel(segLevels);
    // Non-identity: the runs swap.
    expect(expectedVisual).toEqual([1, 0]);

    const out = reorderLineLeaves([box], pb, 0, postL1, LINE_INLINE_SIZE);
    const runs = out.map(asTextRun);

    // VISUAL order: Hebrew run first (it had the lower level), Latin second.
    expect(runs.map((r) => r.text)).toEqual(["אבג", "abc"]);
    // Per-leaf bidiLevel: Hebrew@1 (visual-first), Latin@2 (visual-second).
    expect(runs.map((r) => r.bidiLevel)).toEqual([1, 2]);
    // Geometry packs left-to-right.
    let cursor = 0;
    for (const r of runs) {
      expect(r.inlineOffset).toBe(cursor);
      cursor += r.inlineSize;
    }
  });

  it("an <em> whose text is RTL: one fragment at level 1, ancestorKey preserved, edge 'only'", () => {
    // Line: [TextRun("abc "), <em>[TextRun("אבג")]</em>] in an LTR paragraph.
    const source = "abc אבג";
    const { pb, postL1 } = postL1Of(source, "ltr");

    const before = makeBox({
      key: "before",
      text: "abc ",
      offsetLength: 4,
      inlineSize: 40,
      clusterWidths: [10, 10, 10, 10],
      sourceStart: 0,
    });
    const emText = makeBox({
      key: "emtext",
      text: "אבג",
      offsetLength: 3,
      inlineSize: 30,
      clusterWidths: [10, 10, 10],
      sourceStart: 4, // codepoint 4 == UTF-16 offset 4 (all BMP)
    });
    const em = createInlineBox(
      "em-key",
      0, 0, 30, 16,
      "horizontal-tb", "ltr",
      computedStyle, usedStyle,
      [emText],
      "only",
      "em",
      LINE_INLINE_SIZE,
    );

    const out = reorderLineLeaves([before, em], pb, 0, postL1, LINE_INLINE_SIZE);

    // The em re-nests as a single InlineBox fragment (its single run, one level).
    const emFrags = out.filter((b) => b.type === "inline");
    expect(emFrags.length).toBe(1);
    const emBox = asInline(nth(emFrags, 0, "em-frag"));
    expect(emBox.ancestorKey).toBe("em");
    expect(emBox.fragmentEdge).toBe("only");
    // Its single child is the Hebrew run stamped at level 1.
    expect(emBox.children.length).toBe(1);
    const inner = asTextRun(nth(emBox.children, 0, "child"));
    expect(inner.text).toBe("אבג");
    expect(inner.bidiLevel).toBe(1);

    // The bare Latin leaf is level 0.
    const bareLatin = out.find((b) => b.type === "text-run" && asTextRun(b).text === "abc ");
    expect(bareLatin).toBeDefined();
    if (bareLatin === undefined || bareLatin.type !== "text-run") throw new Error("?");
    expect(bareLatin.bidiLevel).toBe(0);

    // Geometry packs left-to-right.
    let cursor = 0;
    for (const b of out) {
      expect(b.inlineOffset).toBe(cursor);
      cursor += b.inlineSize;
    }
  });

  it("RTL base uniform: the run reverses (level 1), bidiLevel 1", () => {
    const source = "אבג";
    const { pb, postL1 } = postL1Of(source, "rtl");
    // Guard: uniform level 1.
    expect(Array.from(postL1)).toEqual([1, 1, 1]);

    const box = makeBox({
      key: "k",
      text: source,
      offsetLength: source.length,
      inlineSize: 30,
      clusterWidths: [10, 10, 10],
      sourceStart: 0,
    });

    const out = reorderLineLeaves([box], pb, 0, postL1, LINE_INLINE_SIZE);

    // One uniform-level-1 segment → emitted as a single run; level stamped 1.
    expect(out.length).toBe(1);
    const run = asTextRun(nth(out, 0, "box"));
    expect(run.text).toBe(source);
    expect(run.bidiLevel).toBe(1);
    expect(run.inlineOffset).toBe(0);
  });

  // Build a TextRunBox positioned with an RTL `direction`, to prove the reorder
  // FORCES physical/identity positioning on its output regardless of the source
  // box's direction (the double-flip the contract eliminates).
  function makeRtlBox(args: {
    key?: string;
    text: string;
    offsetLength: number;
    inlineSize: number;
    clusterWidths?: readonly number[];
    sourceStart?: number;
  }): TextRunBox {
    return createTextRunBox(
      args.key ?? "run",
      /* inlineOffset */ 0,
      /* blockOffset */ 0,
      args.inlineSize,
      /* blockSize */ 16,
      "horizontal-tb",
      /* direction */ "rtl",
      computedStyle,
      usedStyle,
      args.text,
      args.offsetLength,
      LINE_INLINE_SIZE,
      undefined,
      args.clusterWidths,
      args.sourceStart,
    );
  }

  /**
   * Part-A invariant: EVERY box `reorderLineLeaves` emits is physical/identity-
   * positioned (`x === inlineOffset`), recursively for InlineBox children
   * (parent-relative). Asserting `x === inlineOffset` is the concrete check that
   * the box was built `direction:"ltr"` so `logicalToPhysical` is the identity.
   */
  function assertPhysicalIdentity(boxes: readonly LayoutBox[]): void {
    for (const b of boxes) {
      expect(b.x).toBe(b.inlineOffset);
      if (b.type === "inline") assertPhysicalIdentity(b.children);
    }
  }

  it("Part-A invariant: emitted boxes are physical/identity-positioned (x === inlineOffset) even from RTL-direction input", () => {
    // Mixed content under an RTL paragraph, with the input boxes carrying
    // direction:"rtl". The reorder output must be ltr-positioned so a downstream
    // logicalToPhysical never re-flips it.
    const source = "abcאבג";
    const { pb, postL1 } = postL1Of(source, "rtl");
    const box = makeRtlBox({
      key: "k",
      text: source,
      offsetLength: source.length,
      inlineSize: source.length * 10,
      clusterWidths: new Array(source.length).fill(10),
      sourceStart: 0,
    });

    const out = reorderLineLeaves([box], pb, 0, postL1, LINE_INLINE_SIZE);

    // Every emitted box is physical/identity-positioned.
    assertPhysicalIdentity(out);
    // The output boxes are positioned ltr (so the factory derived x === inlineOffset);
    // the CSS direction is still preserved on computedStyle (the page paragraph is rtl).
    for (const b of out) expect(b.direction).toBe("ltr");
    // Sanity: the reorder still happened (Hebrew visual-first).
    const runs = out.map(asTextRun);
    expect(runs.map((r) => r.text)).toEqual(["אבג", "abc"]);
  });

  it("Part-A invariant holds with nested InlineBox (RTL-direction <em>): recursive x === inlineOffset", () => {
    const source = "abc אבג";
    const { pb, postL1 } = postL1Of(source, "ltr");
    const before = makeRtlBox({
      key: "before",
      text: "abc ",
      offsetLength: 4,
      inlineSize: 40,
      clusterWidths: [10, 10, 10, 10],
      sourceStart: 0,
    });
    const emText = makeRtlBox({
      key: "emtext",
      text: "אבג",
      offsetLength: 3,
      inlineSize: 30,
      clusterWidths: [10, 10, 10],
      sourceStart: 4,
    });
    const em = createInlineBox(
      "em-key",
      0, 0, 30, 16,
      "horizontal-tb", "rtl",
      computedStyle, usedStyle,
      [emText],
      "only",
      "em",
      LINE_INLINE_SIZE,
    );

    const out = reorderLineLeaves([before, em], pb, 0, postL1, LINE_INLINE_SIZE);

    assertPhysicalIdentity(out);
    // The rebuilt InlineBox and its inner run are both ltr-positioned.
    const emFrags = out.filter((b) => b.type === "inline");
    expect(emFrags.length).toBe(1);
    const emBox = asInline(nth(emFrags, 0, "em-frag"));
    expect(emBox.direction).toBe("ltr");
    expect(emBox.children.every((c) => c.direction === "ltr")).toBe(true);
  });
});
