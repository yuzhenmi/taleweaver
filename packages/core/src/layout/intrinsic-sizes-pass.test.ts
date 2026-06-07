import { describe, it, expect } from "vitest";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";
import { createMockShaper, createVariableMockShaper } from "./mock-shaper";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";

describe("computeIntrinsicSizes", () => {
  const shaper = createMockShaper(10, 16);

  it("text node: minContent = widest cluster, maxContent = total run", () => {
    // "hello" = 5 chars; mock shaper: each char is width 10.
    // minClusterInlineSize = 10 (one cluster), unbreakableRunInlineSize = 50.
    const node = createTextBox("t", { display: "inline" }, "hello");
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("paragraph with inline text aggregates as inline (sum max-content)", () => {
    // t1 = "abc" (3 chars, max=30), t2 = "de" (2 chars, max=20).
    // Block with inline children: min = max(10, 10) = 10; max = 30 + 20 = 50.
    const t1 = createTextBox("t1", { display: "inline" }, "abc");
    const t2 = createTextBox("t2", { display: "inline" }, "de");
    const para = createElementBox("p", { display: "block" }, [t1, t2]);
    const cascaded = cascadePass(para);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("block with block children: max-over-children for both min and max", () => {
    // p1: "abc" (3 chars) -> min=10, max=30
    // p2: "abcde" (5 chars) -> min=10, max=50
    // doc block: min=max(10,10)=10, max=max(30,50)=50
    const p1 = createElementBox(
      "p1",
      { display: "block" },
      [createTextBox("t1", { display: "inline" }, "abc")],
    );
    const p2 = createElementBox(
      "p2",
      { display: "block" },
      [createTextBox("t2", { display: "inline" }, "abcde")],
    );
    const doc = createElementBox("doc", { display: "block" }, [p1, p2]);
    const cascaded = cascadePass(doc);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("empty text node returns { 0, 0 }", () => {
    const node = createTextBox("t", { display: "inline" }, "");
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result).toEqual({ minContent: 0, maxContent: 0 });
  });

  it("caches results — second call with same key uses cache", () => {
    const node = createTextBox("t", { display: "inline" }, "abcdef");
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const r1 = computeIntrinsicSizes(cascaded, shaper, cache);
    const r2 = computeIntrinsicSizes(cascaded, shaper, cache);
    // The cache now stores the extended IntrinsicContribution and the public
    // boundary derives a fresh {min,max} view per call, so reference identity is
    // no longer guaranteed; equal VALUES confirm both reads hit the same cached
    // contribution. The no-re-shape guarantee is pinned by the dedicated
    // shape-count test in the #392 block below.
    expect(r2).toEqual(r1);
    // The contribution is cached after the first call (subtree not recomputed).
    expect(cache.get(cascaded.key)).toBeDefined();
  });

  it("inline element: min=max(child.min), max=sum(child.max)", () => {
    // An inline <span> wrapping two text nodes.
    // t1 = "ab" (max=20), t2 = "cde" (max=30).
    // inline span: min = max(10, 10) = 10; max = 20 + 30 = 50.
    const t1 = createTextBox("t1", { display: "inline" }, "ab");
    const t2 = createTextBox("t2", { display: "inline" }, "cde");
    const span = createElementBox("span", { display: "inline" }, [t1, t2]);
    const cascaded = cascadePass(span);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  it("inline-block: treated as block (max-over-children)", () => {
    // inline-block containing two block paragraphs.
    // p1: max=20, p2: max=40. Block aggregation: max=40.
    const p1 = createElementBox(
      "p1",
      { display: "block" },
      [createTextBox("t1", { display: "inline" }, "ab")],
    );
    const p2 = createElementBox(
      "p2",
      { display: "block" },
      [createTextBox("t2", { display: "inline" }, "abcd")],
    );
    const widget = createElementBox("w", { display: "inline-block" }, [p1, p2]);
    const cascaded = cascadePass(widget);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(40);
  });

  it("display:none returns { 0, 0 }", () => {
    const node = createElementBox(
      "hidden",
      { display: "none" },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const cascaded = cascadePass(node);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result).toEqual({ minContent: 0, maxContent: 0 });
  });

  // L-F / C3 regression: mixed block + inline children are NOT all
  // summed inline-style. Anonymous-block wrapping groups consecutive
  // inline children into runs, and the container's max-content is the
  // MAX over (real block children) AND (anonymous-block runs), not the
  // sum across all of them.
  it("C3: mixed block + inline children uses anonymous-block runs (max, not sum)", () => {
    // Layout:
    //   block (doc) {
    //     inline "abc" (max=30)       ← inline run #1 (one item)
    //     block "abcdefghij" (max=100)
    //     inline "de" (max=20)        ← inline run #2 (one item)
    //   }
    // Pre-fix (some + sum-across-all): max = 30 + 100 + 20 = 150 (WRONG).
    // Post-fix (anonymous-block runs):
    //   - run #1 max = 30
    //   - real block max = 100
    //   - run #2 max = 20
    //   container max = max(30, 100, 20) = 100 (CORRECT).
    const inline1 = createTextBox("t1", { display: "inline" }, "abc");
    const blockChild = createElementBox(
      "b",
      { display: "block" },
      [createTextBox("tb", { display: "inline" }, "abcdefghij")],
    );
    const inline2 = createTextBox("t2", { display: "inline" }, "de");
    const doc = createElementBox(
      "doc",
      { display: "block" },
      [inline1, blockChild, inline2],
    );
    const cascaded = cascadePass(doc);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    expect(result.maxContent).toBe(100);
    expect(result.minContent).toBe(10);
  });

  it("C3: consecutive inline siblings within one anonymous-block run sum (no wrap at max-content)", () => {
    // Two inline children in a row form one anonymous-block run; their
    // max-content sums (no wrap at max-content).
    const t1 = createTextBox("t1", { display: "inline" }, "abc"); // max=30
    const t2 = createTextBox("t2", { display: "inline" }, "de");  // max=20
    const blockChild = createElementBox(
      "b",
      { display: "block" },
      [createTextBox("tb", { display: "inline" }, "x")],
    ); // max=10
    const doc = createElementBox(
      "doc",
      { display: "block" },
      [t1, t2, blockChild], // [run(t1+t2), block]
    );
    const cascaded = cascadePass(doc);
    const cache = createIntrinsicSizesCache();
    const result = computeIntrinsicSizes(cascaded, shaper, cache);
    // Run #1 max = 30 + 20 = 50; block max = 10. Container max = 50.
    expect(result.maxContent).toBe(50);
    expect(result.minContent).toBe(10);
  });
});

describe("computeIntrinsicSizes — display: contents (P1.C.1a)", () => {
  const shaper = createMockShaper(10, 16);

  it("a contents wrapper contributes its children's intrinsic sizes, not zero", () => {
    // doc > [ <contents sec>( p("abc") , p("de") ) ]
    const sec = createElementBox("sec", { display: "contents" }, [
      createElementBox("a", { display: "block" }, [createTextBox("at", { display: "inline" }, "abc")]),
      createElementBox("b", { display: "block" }, [createTextBox("bt", { display: "inline" }, "de")]),
    ]);
    const withWrapper = createElementBox("doc", { display: "block" }, [sec]);
    const hoisted = createElementBox("doc", { display: "block" }, [
      createElementBox("a", { display: "block" }, [createTextBox("at", { display: "inline" }, "abc")]),
      createElementBox("b", { display: "block" }, [createTextBox("bt", { display: "inline" }, "de")]),
    ]);
    const w = computeIntrinsicSizes(cascadePass(withWrapper), shaper, createIntrinsicSizesCache());
    const h = computeIntrinsicSizes(cascadePass(hoisted), shaper, createIntrinsicSizesCache());
    expect(w).toEqual(h);
    // "abc" max = 30 is the widest block child; a contents wrapper that returned
    // {0,0} (the pre-fix bug) would give maxContent 0 here.
    expect(w.maxContent).toBe(30);
  });

  it("a contents element queried as the root delegates to block-container sizing", () => {
    const sec = createElementBox("sec", { display: "contents" }, [
      createElementBox("a", { display: "block" }, [createTextBox("at", { display: "inline" }, "abcd")]),
    ]);
    const result = computeIntrinsicSizes(cascadePass(sec), shaper, createIntrinsicSizesCache());
    expect(result.maxContent).toBe(40); // "abcd" = 4 × 10
  });

  // #266: table intrinsic sizing must flatten `display: contents` wrappers
  // around rows / cells (e.g. a `section` wrapping table rows). The walk in
  // computeTableIntrinsicSizes filters by `display === "table-row"` /
  // "table-cell", which without a flatten step skips the contents wrapper
  // entirely (producing 0/0). The pre-fix bug yields min=max=0 for the
  // wrapped case; the post-fix result equals the un-wrapped equivalent.
  it("table flattens a `display: contents` wrapper around rows (#266)", () => {
    // cells: c1 = "abc" (max=30), c2 = "abcde" (max=50).
    // Un-wrapped table: row [c1, c2] → colMaxes = [30, 50] → tableMax = 80.
    const cellText = (id: string, s: string) =>
      createElementBox(id, { display: "table-cell" }, [
        createTextBox(`${id}t`, { display: "inline" }, s),
      ]);
    const unwrapped = createElementBox("t", { display: "table" }, [
      createElementBox("r", { display: "table-row" }, [
        cellText("c1", "abc"),
        cellText("c2", "abcde"),
      ]),
    ]);
    // Same table, but the row sits inside a `display: contents` wrapper
    // (mirrors a `section` containing table rows in P1.C).
    const wrapped = createElementBox("t", { display: "table" }, [
      createElementBox("sec", { display: "contents" }, [
        createElementBox("r", { display: "table-row" }, [
          cellText("c1", "abc"),
          cellText("c2", "abcde"),
        ]),
      ]),
    ]);

    const u = computeIntrinsicSizes(cascadePass(unwrapped), shaper, createIntrinsicSizesCache());
    const w = computeIntrinsicSizes(cascadePass(wrapped), shaper, createIntrinsicSizesCache());

    expect(u.minContent).toBe(20); // colMins = [10, 10]
    expect(u.maxContent).toBe(80); // colMaxes = [30, 50]
    // The pre-fix bug: w === { minContent: 0, maxContent: 0 } (the contents
    // wrapper is filtered out by the display !== "table-row" check). The fix
    // makes the wrapped case match the un-wrapped result exactly.
    expect(w).toEqual(u);
  });

  // §17.4 (P8.S2): a colSpan>1 cell contributes its intrinsic size across the
  // columns it spans, not entirely to its first column.
  it("a colSpan-2 cell's max distributes across its columns (§17.4)", () => {
    // charWidth 10. Banner "abcdef" colSpan-2: max 60. Row1 "abc" (max 30) +
    // "ab" (max 20) set span-1 bases [30, 20]. Banner max shortfall 60−50=10
    // distributes proportional to [30, 20] → [36, 24]; tableMax = 60.
    // The OLD sequential walk charged 60 to col0 → colMaxes [60, 20] → 80.
    const banner = createElementBox(
      "c0", { display: "table-cell" }, [createTextBox("t0", { display: "inline" }, "abcdef")],
      { colSpan: 2 },
    );
    const table = createElementBox("t", { display: "table" }, [
      createElementBox("r0", { display: "table-row" }, [banner]),
      createElementBox("r1", { display: "table-row" }, [
        createElementBox("c1a", { display: "table-cell" }, [createTextBox("t1", { display: "inline" }, "abc")]),
        createElementBox("c1b", { display: "table-cell" }, [createTextBox("t2", { display: "inline" }, "ab")]),
      ]),
    ]);
    const r = computeIntrinsicSizes(cascadePass(table), shaper, createIntrinsicSizesCache());
    expect(r.maxContent).toBe(60);
    expect(r.minContent).toBe(20); // colMins [10, 10]
  });
});

describe("computeIntrinsicSizes — text-indent (#392)", () => {
  const shaper = createMockShaper(10, 16);

  // Case 1: pure-inline block, positive indent.
  it("pure-inline block, positive indent: max += indent, min = max(widest, indent + firstCluster)", () => {
    // "hello" charWidth 10 → no-indent max = 50, widest cluster = 10.
    // indent 40 → max = 50 + 40 = 90; min = max(10, 40 + 10) = 50.
    const block = createElementBox(
      "p",
      { display: "block", textIndent: { value: 40, unit: "px" } },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const cascaded = cascadePass(block);
    const result = computeIntrinsicSizes(cascaded, shaper, createIntrinsicSizesCache());
    expect(result.maxContent).toBe(90);
    expect(result.minContent).toBe(50);
  });

  // Case 2: first cluster ≠ widest — guards the restMin form against
  // a naive `widestCluster + indent`. Requires variable cluster widths.
  it("first cluster narrower than widest: min uses restMin, NOT widest + indent", () => {
    // text "iW": i = 4, W = 14. no-indent min (widest cluster) = 14, max = 18.
    // indent 5 → min = max(5 + 4, restMin=14) = 14 (NOT widest+indent = 19).
    //            max = 18 + 5 = 23.
    const varShaper = createVariableMockShaper({ i: 4, W: 14 }, 16);
    const block = createElementBox(
      "p",
      { display: "block", textIndent: { value: 5, unit: "px" } },
      [createTextBox("t", { display: "inline" }, "iW")],
    );
    const cascaded = cascadePass(block);
    const result = computeIntrinsicSizes(cascaded, varShaper, createIntrinsicSizesCache());
    expect(result.minContent).toBe(14);
    expect(result.maxContent).toBe(23);
  });

  // Case 3: negative indent (hanging) — clamp ≥ 0, restMin form lets min
  // fall below the no-indent blockMin.
  it("negative indent (hanging): min and max clamp ≥ 0 via restMin form", () => {
    // single-char "a" charWidth 10 → firstCluster = 10, restMin = 0.
    // indent −16 → min = clamp(max(−16 + 10, 0)) = clamp(0) = 0
    //              (NOT the naive max(blockMin=10, …) = 10).
    //            max = max(0, 10 + (−16)) = 0.
    const block = createElementBox(
      "p",
      { display: "block", textIndent: { value: -16, unit: "px" } },
      [createTextBox("t", { display: "inline" }, "a")],
    );
    const cascaded = cascadePass(block);
    const result = computeIntrinsicSizes(cascaded, shaper, createIntrinsicSizesCache());
    expect(result.minContent).toBe(0);
    expect(result.maxContent).toBe(0);
  });

  // Case 4: percentage indent contributes 0 (indefinite basis → resolve basis 0).
  it("percentage indent contributes 0 to both min and max (indefinite basis)", () => {
    // "hello" no-indent: min = 10, max = 50. 50% indent → contributes 0.
    const block = createElementBox(
      "p",
      { display: "block", textIndent: { value: 50, unit: "percent" } },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const cascaded = cascadePass(block);
    const result = computeIntrinsicSizes(cascaded, shaper, createIntrinsicSizesCache());
    expect(result.minContent).toBe(10);
    expect(result.maxContent).toBe(50);
  });

  // Case 5a: mixed block + inline children — indent applies to the doc's FIRST
  // inline run only; a later inline run is unchanged at the doc level. The
  // intervening block child carries an explicit `textIndent: 0` to suppress
  // inheritance, isolating the doc-level first-run rule (text-indent is
  // `inherits: true`, so a child block with NO explicit indent legitimately
  // indents ITS own first line — exercised separately below).
  it("mixed children: indent applies only to the doc's first inline run", () => {
    // doc (indent 25) {
    //   inline "abc" (run #1: max=30, min=10)        ← doc's first run → indented
    //   block "abcdefghij" (textIndent:0 → max=100, min=10)
    //   inline "de" (run #2: max=20, min=10)          ← NOT the first run
    // }
    // run #1: max = 30 + 25 = 55; min = max(25 + 10, restMin=0) = 35.
    // block (indent suppressed): max=100, min=10. run #2: max=20, min=10.
    // container max = max(55, 100, 20) = 100; min = max(35, 10, 10) = 35.
    const inline1 = createTextBox("t1", { display: "inline" }, "abc");
    const blockChild = createElementBox(
      "b",
      { display: "block", textIndent: { value: 0, unit: "px" } },
      [createTextBox("tb", { display: "inline" }, "abcdefghij")],
    );
    const inline2 = createTextBox("t2", { display: "inline" }, "de");
    const doc = createElementBox(
      "doc",
      { display: "block", textIndent: { value: 25, unit: "px" } },
      [inline1, blockChild, inline2],
    );
    const cascaded = cascadePass(doc);
    const result = computeIntrinsicSizes(cascaded, shaper, createIntrinsicSizesCache());
    expect(result.maxContent).toBe(100);
    expect(result.minContent).toBe(35);
  });

  // Case 5a': text-indent inherits — a child block with NO explicit indent
  // indents its OWN first formatted line (matches the IFC, which reads the
  // resolved/inherited value off the block's computed style).
  it("text-indent inherits: a child block indents its own first line", () => {
    // doc (indent 25) {
    //   inline "abc" (run #1 max = 30 + 25 = 55; min = max(35, 0) = 35)
    //   block "abcdefghij" (INHERITS 25 → max = 100 + 25 = 125; min = max(35,0) = 35)
    // }
    // container max = max(55, 125) = 125; min = max(35, 35) = 35.
    const inline1 = createTextBox("t1", { display: "inline" }, "abc");
    const blockChild = createElementBox(
      "b",
      { display: "block" }, // no explicit indent → inherits doc's 25
      [createTextBox("tb", { display: "inline" }, "abcdefghij")],
    );
    const doc = createElementBox(
      "doc",
      { display: "block", textIndent: { value: 25, unit: "px" } },
      [inline1, blockChild],
    );
    const result = computeIntrinsicSizes(cascadePass(doc), shaper, createIntrinsicSizesCache());
    expect(result.maxContent).toBe(125);
    expect(result.minContent).toBe(35);
  });

  // Case 5b: a block whose FIRST child is a real block → the doc's own indent
  // produces no indented run (no "first formatted line" of inline content
  // before the block). Child block carries `textIndent: 0` to suppress
  // inheritance, so the ONLY thing the doc's indent could touch is a
  // (nonexistent) leading inline run — and it touches nothing.
  it("first child is a real block: the doc-level indent affects nothing", () => {
    // doc {
    //   block "abc" (textIndent:0 → max=30, min=10)  ← first child is a block
    //   inline "de" (max=20, min=10)                  ← run is NOT the first run
    // }
    // Doc indent of 100 finds no first inline run → container unchanged:
    // max = max(30, 20) = 30; min = 10. Equal to the no-indent doc.
    const makeBlockChild = () =>
      createElementBox(
        "b",
        { display: "block", textIndent: { value: 0, unit: "px" } },
        [createTextBox("tb", { display: "inline" }, "abc")],
      );
    const make = (indent: number | undefined) =>
      createElementBox(
        "doc",
        indent === undefined
          ? { display: "block" }
          : { display: "block", textIndent: { value: indent, unit: "px" } },
        [makeBlockChild(), createTextBox("t2", { display: "inline" }, "de")],
      );
    const indented = computeIntrinsicSizes(
      cascadePass(make(100)),
      shaper,
      createIntrinsicSizesCache(),
    );
    const plain = computeIntrinsicSizes(
      cascadePass(make(undefined)),
      shaper,
      createIntrinsicSizesCache(),
    );
    expect(indented).toEqual(plain);
    expect(indented.maxContent).toBe(30);
    expect(indented.minContent).toBe(10);
  });

  // Case 6: indent: 0 (default) is byte-identical to the no-indent fixture.
  it("indent 0 is byte-identical to the no-indent equivalent (regression guard)", () => {
    // Mirror the existing "paragraph with inline text" fixture: min=10, max=50.
    const make = (withIndent: boolean) => {
      const t1 = createTextBox("t1", { display: "inline" }, "abc");
      const t2 = createTextBox("t2", { display: "inline" }, "de");
      return createElementBox(
        "p",
        withIndent
          ? { display: "block", textIndent: { value: 0, unit: "px" } }
          : { display: "block" },
        [t1, t2],
      );
    };
    const zeroIndent = computeIntrinsicSizes(
      cascadePass(make(true)),
      shaper,
      createIntrinsicSizesCache(),
    );
    const noIndent = computeIntrinsicSizes(
      cascadePass(make(false)),
      shaper,
      createIntrinsicSizesCache(),
    );
    expect(zeroIndent).toEqual(noIndent);
    // Exact pre-existing expected values (byte-identical regression guard).
    expect(zeroIndent.minContent).toBe(10);
    expect(zeroIndent.maxContent).toBe(50);
  });

  // Consistency assertion from the spec: for a uniform text run,
  // max(firstCluster, restMin) === minClusterInlineSize.
  it("text-node consistency: max(firstCluster, restMin) === minClusterInlineSize", () => {
    // The pass-level guarantee is exercised indirectly: a pure-inline block
    // with indent 0 must produce minContent === the run's minClusterInlineSize.
    // "hello" → minClusterInlineSize = 10.
    const block = createElementBox(
      "p",
      { display: "block", textIndent: { value: 0, unit: "px" } },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const result = computeIntrinsicSizes(cascadePass(block), shaper, createIntrinsicSizesCache());
    expect(result.minContent).toBe(10); // === minClusterInlineSize
  });

  // FINDING 1: restMin is the widest cluster in the TAIL (clusters after the
  // first), NOT the whole-run widest. When the first cluster is itself the
  // widest, the old over-conservative restMin (= whole-run min) wrongly refused
  // to narrow the box under a negative indent.
  it("restMin is the tail's widest cluster, not the whole-run widest (negative indent)", () => {
    // text "Wa": W = 14 (widest, and FIRST), a = 4. tail = ["a"] → restMin = 4.
    // indent −5 → min = clamp(max(−5 + 14, restMin=4)) = max(9, 4) = 9 (NOT 14,
    //   which the old `restMin = whole-run min = 14` would have produced).
    //   max = max(0, (14 + 4) + (−5)) = 13.
    const varShaper = createVariableMockShaper({ W: 14, a: 4 }, 16);
    const block = createElementBox(
      "p",
      { display: "block", textIndent: { value: -5, unit: "px" } },
      [createTextBox("t", { display: "inline" }, "Wa")],
    );
    const result = computeIntrinsicSizes(
      cascadePass(block),
      varShaper,
      createIntrinsicSizesCache(),
    );
    expect(result.minContent).toBe(9);
    expect(result.maxContent).toBe(13);
  });

  // FINDING 3: an inline-block as the FIRST child of an indented run is an
  // ATOMIC inline-level box, so the indent pushes the WHOLE inline-block — its
  // first-unit contribution is its own min-content, not 0. With the old
  // `firstCluster: 0`, `indent + firstCluster = indent` undercounted min-content
  // by the inline-block's width and the inline-block overflowed.
  it("inline-block first child of an indented run contributes its own width past the indent", () => {
    // Build an inline-block whose OWN min-content is 30: a single wide cluster
    // "X" (width 30) via the variable shaper (break-at-any-cluster would split a
    // multi-char run to its widest cluster, so a single fat cluster is the clean
    // way to get a 30-wide atomic box). Its firstCluster as an atomic inline-
    // level box must be its own min-content (30), NOT 0.
    const varShaper = createVariableMockShaper({ X: 30, a: 4, b: 4 }, 16);
    // `textIndent: 0` suppresses inheritance of the outer block's indent into the
    // inline-block's OWN first line — isolating the rule under test (the indent
    // pushing the inline-block as the outer run's atomic first unit).
    const leadingInlineBlock = createElementBox(
      "lib",
      { display: "inline-block", textIndent: { value: 0, unit: "px" } },
      [createTextBox("libt", { display: "inline" }, "X")], // atomic, min-content = 30
    );
    const trailingText = createTextBox("tt", { display: "inline" }, "ab"); // min=4
    const make = (indent: number | undefined) =>
      createElementBox(
        "p",
        indent === undefined
          ? { display: "block" }
          : { display: "block", textIndent: { value: indent, unit: "px" } },
        [leadingInlineBlock, trailingText],
      );
    // Non-indented: leading-run min = max(firstCluster=30, restMin=max(0, "ab".min=4)) = 30.
    const plain = computeIntrinsicSizes(
      cascadePass(make(undefined)),
      varShaper,
      createIntrinsicSizesCache(),
    );
    expect(plain.minContent).toBe(30);
    // indent 10: leading-run min = max(0, max(10 + firstCluster=30, restMin=4)) = 40
    //   (NOT 30 — the inline-block's own width 30 is included PAST the indent;
    //   with the old `firstCluster: 0` it would have stayed 30).
    const indented = computeIntrinsicSizes(
      cascadePass(make(10)),
      varShaper,
      createIntrinsicSizesCache(),
    );
    expect(indented.minContent).toBe(40);
  });

  // FINDING 2: a warm cache short-circuits the whole subtree — a text node is
  // shaped only ONCE across two computeIntrinsicSizes calls with the same cache.
  // (The old per-call `new Map()` re-shaped the subtree on every top-level query.)
  it("warm cache short-circuits the subtree: a text node is shaped once across two calls", () => {
    const base = createMockShaper(10, 16);
    let shapeCalls = 0;
    const countingShaper = {
      shape(text: string, style: Parameters<typeof base.shape>[1], dir: Parameters<typeof base.shape>[2]) {
        shapeCalls++;
        return base.shape(text, style, dir);
      },
      measureFontMetrics: base.measureFontMetrics,
    };
    const block = createElementBox(
      "p",
      { display: "block" },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const cascaded = cascadePass(block);
    const cache = createIntrinsicSizesCache();
    computeIntrinsicSizes(cascaded, countingShaper, cache);
    expect(shapeCalls).toBe(1);
    // Second query with the SAME cache must NOT re-shape.
    computeIntrinsicSizes(cascaded, countingShaper, cache);
    expect(shapeCalls).toBe(1);
  });

  // Case 7 (consumer): drive an inline-block with text-indent through the pass
  // as a child of a block; its shrink-to-fit contribution (max-content) must be
  // ≥ indent + firstCluster.
  it("inline-block consumer: max-content contribution ≥ indent + firstCluster", () => {
    // inline-block "hi there" (8 chars, max=80) with indent 30.
    // Its block-level max = 80 + 30 = 110 ≥ indent(30) + firstCluster(10) = 40.
    const indent = 30;
    const firstCluster = 10;
    const widget = createElementBox(
      "w",
      { display: "inline-block", textIndent: { value: indent, unit: "px" } },
      [createTextBox("t", { display: "inline" }, "hi there")],
    );
    // Drive it as the inline child of a block (the shrink-to-fit consumer path:
    // a block container takes the inline-block's intrinsic max as a run member).
    const parent = createElementBox("p", { display: "block" }, [widget]);
    const result = computeIntrinsicSizes(cascadePass(parent), shaper, createIntrinsicSizesCache());
    expect(result.maxContent).toBe(110);
    expect(result.maxContent).toBeGreaterThanOrEqual(indent + firstCluster);
  });
});

// P5-LWS Task 5: letter-/word-spacing flows into intrinsic sizing FOR FREE
// (CSS Text 3 §8). The shapers (Tasks 1-4) bake letter-spacing into every
// cluster advance and word-spacing into space clusters, and aggregate the
// result into `minClusterInlineSize` (widest cluster → min-content) and
// `unbreakableRunInlineSize` (run sum → max-content). `computeTextContribution`
// reads those aggregates verbatim, so spacing requires NO code change in the
// intrinsic-sizes pass. These tests lock that flow-through in and guard against
// a future regression that recomputes intrinsic sizes off the unspaced advance.
describe("computeIntrinsicSizes — letter/word-spacing (P5-LWS Task 5)", () => {
  const shaper = createMockShaper(10, 16); // charWidth W = 10

  it("min/max-content include letter-spacing (flows from the shaper aggregates)", () => {
    // "ab" with letterSpacing N = 4. Each cluster advance = W + N = 14.
    //   max-content = 2 * (W + N) = 28  (= plain 20 + 2*N)
    //   min-content = widest spaced cluster = W + N = 14  (= plain 10 + N)
    const N = 4;
    const make = (spaced: boolean) =>
      createElementBox(
        "p",
        spaced
          ? { display: "block", letterSpacing: { value: N, unit: "px" } }
          : { display: "block" },
        [createTextBox("t", { display: "inline" }, "ab")],
      );
    const spaced = computeIntrinsicSizes(cascadePass(make(true)), shaper, createIntrinsicSizesCache());
    const plain = computeIntrinsicSizes(cascadePass(make(false)), shaper, createIntrinsicSizesCache());
    // Anchor the plain baseline (W = 10): max = 2*W = 20, min = W = 10.
    expect(plain.maxContent).toBe(20);
    expect(plain.minContent).toBe(10);
    // Spacing grows both: every cluster gains N (max), and the widest cluster
    // gains N (min).
    expect(spaced.maxContent).toBe(plain.maxContent + 2 * N); // 28
    expect(spaced.minContent).toBe(plain.minContent + N); // 14
  });

  it("max-content includes word-spacing (the one space grows)", () => {
    // "a b" with wordSpacing M = 6 (no letterSpacing). Only the separator
    // cluster gains M: advances = [10, 10 + M, 10].
    //   max-content = 3*W + M = 36  (= plain 30 + M)
    // min-content is left unasserted here: word-spacing on the separator can
    // make the SPACE the widest cluster (16 > 10), so min-content is not a
    // robust "+M" relation — the max-content assertion is the stable lock-in.
    const M = 6;
    const make = (spaced: boolean) =>
      createElementBox(
        "p",
        spaced
          ? { display: "block", wordSpacing: { value: M, unit: "px" } }
          : { display: "block" },
        [createTextBox("t", { display: "inline" }, "a b")],
      );
    const spaced = computeIntrinsicSizes(cascadePass(make(true)), shaper, createIntrinsicSizesCache());
    const plain = computeIntrinsicSizes(cascadePass(make(false)), shaper, createIntrinsicSizesCache());
    expect(plain.maxContent).toBe(30); // 3 * W
    expect(spaced.maxContent).toBe(plain.maxContent + M); // 36
  });
});

describe("computeIntrinsicSizes — text-transform (C1)", () => {
  const shaper = createMockShaper(10, 16); // charWidth W = 10

  it("intrinsic sizes reflect the DISPLAY length of a growing transform (ß→SS)", () => {
    // "aß" under uppercase renders "ASS" (3 display chars). The intrinsic pass
    // must shape the TRANSFORMED text so an inline-block / shrink-to-fit box
    // sizes to the rendered width, not the 2-source-char width (else it clips).
    const make = (transform: "none" | "uppercase") =>
      createElementBox(
        "p",
        { display: "block" },
        [createTextBox("t", { display: "inline", textTransform: transform }, "aß")],
      );
    const transformed = computeIntrinsicSizes(
      cascadePass(make("uppercase")),
      shaper,
      createIntrinsicSizesCache(),
    );
    const plain = computeIntrinsicSizes(
      cascadePass(make("none")),
      shaper,
      createIntrinsicSizesCache(),
    );
    // none: "aß" = 2 source chars → max-content = 2*W = 20.
    expect(plain.maxContent).toBe(20);
    // uppercase: "ASS" = 3 display chars → max-content = 3*W = 30, NOT 20.
    expect(transformed.maxContent).toBe(30);
  });

  it("textTransform: none is a no-op (byte-identical to untransformed text)", () => {
    const node = createTextBox("t", { display: "inline", textTransform: "none" }, "hello");
    const withNone = computeIntrinsicSizes(cascadePass(node), shaper, createIntrinsicSizesCache());
    const bare = computeIntrinsicSizes(
      cascadePass(createTextBox("t", { display: "inline" }, "hello")),
      shaper,
      createIntrinsicSizesCache(),
    );
    expect(withNone).toEqual(bare);
  });
});
