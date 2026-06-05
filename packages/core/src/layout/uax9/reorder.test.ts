import { describe, expect, it } from "vitest";
import { resolveBidiLevels } from "./bidi";
import { applyL1, reorderRunsByLevel, reorderVisual } from "./reorder";

describe("reorderVisual — UAX #9 L1 + L2", () => {
  it("reverses a single RTL run inside an LTR paragraph (L2 only)", () => {
    // "abc אבג" = a,b,c,space,alef,bet,gimel (7 codepoints), base ltr.
    //   levels: [0,0,0,0,1,1,1]  types: [L,L,L,WS,R,R,R]  paragraphLevel 0
    // L1: last char is R (level 1, not WS/S/B) → no trailing reset; interior
    //     WS at idx 3 is not before an S/B and not at end → unchanged. L1 no-op.
    // L2: maxLevel=1, minOdd=1. Reverse the maximal level>=1 run [4,5,6]:
    //     order [0,1,2,3,4,5,6] → [0,1,2,3,6,5,4].
    const { levels, types, paragraphLevel } = resolveBidiLevels("abc אבג", "ltr");
    expect([...levels]).toEqual([0, 0, 0, 0, 1, 1, 1]);
    expect(reorderVisual(levels, types, paragraphLevel, 0, 7)).toEqual([
      0, 1, 2, 3, 6, 5, 4,
    ]);
  });

  it("applies L1 to a segment separator (TAB) — discriminating case", () => {
    // "a אב\tגד" = a, space, alef, bet, TAB, gimel, dalet (7 cp), base ltr.
    //   levels: [0,0,1,1,1,1,1]  types: [L,WS,R,R,S,R,R]  paragraphLevel 0
    // The TAB (idx 4, class S) resolved to level 1 INSIDE the RTL run.
    // L1 rule i resets every S to the paragraph level (0):
    //   levels become [0,0,1,1,0,1,1].
    // L2: maxLevel=1, minOdd=1. Maximal level>=1 runs are [2,3] and [5,6]
    //   (split by the level-0 TAB at idx 4). Reverse each:
    //   [0,1,2,3,4,5,6] → [0,1,3,2,4,6,5].
    //
    // Discrimination: WITHOUT L1 the TAB stays level 1, so [2..6] is one run
    //   and the result would be [0,1,6,5,4,3,2] — a different permutation.
    //   (Verified by temporarily removing the L1 step: this test then fails.)
    const { levels, types, paragraphLevel } = resolveBidiLevels(
      "a אב\tגד",
      "ltr",
    );
    expect([...levels]).toEqual([0, 0, 1, 1, 1, 1, 1]);
    expect([...types]).toEqual([
      // L, WS, R, R, S, R, R (original classes)
      0, 12, 1, 1, 11, 1, 1,
    ]);
    expect(reorderVisual(levels, types, paragraphLevel, 0, 7)).toEqual([
      0, 1, 3, 2, 4, 6, 5,
    ]);
  });

  it("reverses nested runs across levels 0/1/2 (max→minOdd loop)", () => {
    // "a אב12" = a, space, alef, bet, EN '1', EN '2' (6 cp), base ltr.
    //   levels: [0,0,1,1,2,2]  types: [L,WS,R,R,EN,EN]  paragraphLevel 0
    // L1: ends in EN (level 2, not WS/S/B) → no-op.
    // L2: maxLevel=2, minOdd=1, order=[0,1,2,3,4,5].
    //   level 2: reverse level>=2 run [4,5] → [0,1,2,3,5,4].
    //   level 1: reverse level>=1 run [2,3,4,5] (current span [2,3,5,4])
    //            → [4,5,3,2] → order [0,1,4,5,3,2].
    const { levels, types, paragraphLevel } = resolveBidiLevels("a אב12", "ltr");
    expect([...levels]).toEqual([0, 0, 1, 1, 2, 2]);
    expect(reorderVisual(levels, types, paragraphLevel, 0, 6)).toEqual([
      0, 1, 4, 5, 3, 2,
    ]);
  });

  it("resets trailing whitespace run at end of line to the paragraph level", () => {
    // "אב  " = alef, bet, space, space (4 cp), base ltr.
    //   pre-L1 levels (from resolver): [1,1,0,0]; but to make L1 do real work
    //   here we feed an RTL paragraph framing via base ltr where the resolver
    //   already lowered the trailing WS. Instead assert the L1 END-OF-LINE rule
    //   directly with a hand-built input where the trailing WS is at level 1.
    // Hand-built: levels=[1,1,1,1], types=[R,R,WS,WS], paragraphLevel=0.
    //   L1 rule iv: trailing WS run [2,3] → reset to 0 → levels [1,1,0,0].
    //   L2: maxLevel=1,minOdd=1. Reverse level>=1 run [0,1] → order
    //   [1,0,2,3].
    const levels = Uint8Array.of(1, 1, 1, 1);
    const CC_R = 1;
    const CC_WS = 12;
    const types = Uint8Array.of(CC_R, CC_R, CC_WS, CC_WS);
    expect(reorderVisual(levels, types, 0, 0, 4)).toEqual([1, 0, 2, 3]);
  });

  it("returns [] for an empty line and [0] for a single char", () => {
    const { levels, types, paragraphLevel } = resolveBidiLevels("a", "ltr");
    expect(reorderVisual(levels, types, paragraphLevel, 0, 0)).toEqual([]);
    expect(reorderVisual(levels, types, paragraphLevel, 0, 1)).toEqual([0]);
  });

  it("returns indices relative to lineStart for a non-zero lineStart", () => {
    // "abc אבג" sliced to the RTL tail [4,7): a 3-char level-1 run.
    //   Relative result reverses [0,1,2] → [2,1,0].
    const { levels, types, paragraphLevel } = resolveBidiLevels("abc אבג", "ltr");
    expect(reorderVisual(levels, types, paragraphLevel, 4, 7)).toEqual([2, 1, 0]);
  });
});

describe("reorderRunsByLevel — L2 over per-run levels", () => {
  it("reverses a single embedded run", () => {
    // [0,1,1,0]: maxLevel=1, minOdd=1. Reverse the level>=1 run [1,2] →
    //   perm [0,1,2,3] → [0,2,1,3].
    expect(reorderRunsByLevel([0, 1, 1, 0])).toEqual([0, 2, 1, 3]);
  });

  it("reverses nested runs from max down to minOdd", () => {
    // [1,2,1]: maxLevel=2, minOdd=1, perm=[0,1,2].
    //   level 2: reverse level>=2 span [1] (singleton, no-op) → [0,1,2].
    //   level 1: reverse level>=1 span [0,1,2] (all) → [2,1,0].
    expect(reorderRunsByLevel([1, 2, 1])).toEqual([2, 1, 0]);
  });

  it("is identity when there is no odd level", () => {
    expect(reorderRunsByLevel([0, 0])).toEqual([0, 1]);
  });

  it("reverses the whole array when all levels are the same odd level", () => {
    expect(reorderRunsByLevel([1, 1, 1])).toEqual([2, 1, 0]);
  });

  it("returns the singleton for a single run", () => {
    expect(reorderRunsByLevel([0])).toEqual([0]);
  });

  it("returns [] for an empty array", () => {
    expect(reorderRunsByLevel([])).toEqual([]);
  });
});

describe("applyL1 — post-L1 line levels (lineStart-relative)", () => {
  it("resets a segment separator (TAB) to the paragraph level", () => {
    // "a אב\tגד": levels [0,0,1,1,1,1,1], types [L,WS,R,R,S,R,R].
    //   L1 resets the S (idx 4) to paragraphLevel 0 → [0,0,1,1,0,1,1].
    const { levels, types, paragraphLevel } = resolveBidiLevels(
      "a אב\tגד",
      "ltr",
    );
    expect([...applyL1(levels, types, paragraphLevel, 0, 7)]).toEqual([
      0, 0, 1, 1, 0, 1, 1,
    ]);
  });

  it("resets a trailing whitespace run at end of line", () => {
    // Hand-built: levels=[1,1,1,1], types=[R,R,WS,WS], paragraphLevel=0.
    //   L1 rule iv resets the trailing WS run [2,3] → [1,1,0,0].
    const levels = Uint8Array.of(1, 1, 1, 1);
    const CC_R = 1;
    const CC_WS = 12;
    const types = Uint8Array.of(CC_R, CC_R, CC_WS, CC_WS);
    expect([...applyL1(levels, types, 0, 0, 4)]).toEqual([1, 1, 0, 0]);
  });

  it("leaves levels unchanged when L1 has no effect", () => {
    // "abc אבג": levels [0,0,0,0,1,1,1], ends in R, interior WS not before S/B.
    //   L1 is a no-op → post-L1 levels equal the input slice.
    const { levels, types, paragraphLevel } = resolveBidiLevels("abc אבג", "ltr");
    expect([...applyL1(levels, types, paragraphLevel, 0, 7)]).toEqual([
      0, 0, 0, 0, 1, 1, 1,
    ]);
  });

  it("returns levels relative to a non-zero lineStart", () => {
    // "abc אבג" sliced to [4,7): the RTL tail at level 1, L1 no-op.
    const { levels, types, paragraphLevel } = resolveBidiLevels("abc אבג", "ltr");
    expect([...applyL1(levels, types, paragraphLevel, 4, 7)]).toEqual([1, 1, 1]);
  });

  it("returns an empty array for an empty line", () => {
    const { levels, types, paragraphLevel } = resolveBidiLevels("a", "ltr");
    expect([...applyL1(levels, types, paragraphLevel, 0, 0)]).toEqual([]);
  });
});
