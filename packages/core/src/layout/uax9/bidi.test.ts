import { describe, it, expect } from "vitest";
import {
  computeParagraphLevel,
  classCode,
  CC,
  computeMatchingPDI,
  applyExplicit,
  computeIsolatingRunSequences,
} from "./bidi";

// Explicit-formatting code points used by the X-pass tests.
const RLE = "‫";
const PDF = "‬";
const LRO = "‭";
const RLO = "‮";
const LRI = "⁦";
const RLI = "⁧";
const FSI = "⁨";
const PDI = "⁩";

function codes(s: string): Uint8Array {
  const cps = [...s].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp === undefined) throw new Error("empty");
    return classCode(cp);
  });
  return Uint8Array.from(cps);
}

describe("computeParagraphLevel (P2/P3)", () => {
  it("LTR (0) when the first strong char is L", () => {
    const t = codes("abc");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(0);
  });
  it("RTL (1) when the first strong char is R", () => {
    const t = codes("אב"); // Hebrew alef bet
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("RTL (1) when the first strong char is AL (Arabic)", () => {
    const t = codes("اب"); // Arabic alef beh
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("ignores numbers/neutrals before the first strong char", () => {
    const t = codes("123 א"); // digits + space then Hebrew → 1
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("P3 default 0 when there is no strong char", () => {
    const t = codes("123 "); // only EN + WS
    expect(computeParagraphLevel(t, 0, t.length)).toBe(0);
  });
  it("skips an isolate-initiated run when finding the first strong char", () => {
    // LRI <Hebrew> PDI <Hebrew>: the Hebrew INSIDE the isolate is skipped;
    // the first strong char OUTSIDE the isolate is the trailing Hebrew → 1.
    const t = codes("⁦א⁩ב"); // LRI alef PDI bet
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("an LTR char inside an isolate does not set the level if a later outside char is strong", () => {
    // LRI <Latin 'a'> PDI <Hebrew>: 'a' (L) is inside the isolate → skipped;
    // first strong OUTSIDE is Hebrew → 1.
    const t = codes("⁦a⁩א");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("a strong char outside the range start/end is not considered", () => {
    // "aא" but scan only [1,2): first strong is Hebrew → 1.
    const t = codes("aא");
    expect(computeParagraphLevel(t, 1, t.length)).toBe(1);
  });
  it("handles nested isolates: inner+outer fully skipped", () => {
    // LRI LRI <Hebrew> PDI PDI <Hebrew>: both isolates skipped; trailing Hebrew → 1.
    const t = codes("⁦⁦א⁩⁩ב");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
  it("an unmatched isolate initiator swallows the rest of the range (P3 default 0)", () => {
    // LRI <Hebrew> with no PDI: the Hebrew stays inside the (unmatched) isolate,
    // so no strong char is seen at depth 0 → P3 default 0.
    const t = codes("⁦א");
    expect(computeParagraphLevel(t, 0, t.length)).toBe(0);
  });
  it("a stray PDI (no matching initiator) does not un-skip a following strong char", () => {
    // PDI <Hebrew>: the stray PDI must FLOOR depth at 0 (not go negative); the
    // Hebrew is then seen at depth 0 → 1. If the floor guard were removed, depth
    // would be -1 and the Hebrew would be wrongly skipped → 0. Guards the floor.
    const t = codes("⁩א"); // PDI alef
    expect(computeParagraphLevel(t, 0, t.length)).toBe(1);
  });
});

describe("computeMatchingPDI (BD9 pre-scan)", () => {
  it("matches a simple initiator/PDI pair", () => {
    const c = codes(`a${LRI}b${PDI}c`); // 0:a 1:LRI 2:b 3:PDI 4:c
    const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
    expect(matchingPDI[1]).toBe(3);
    expect(matchingIsolate[3]).toBe(1);
    // non-initiator / non-PDI slots stay sentinel -1
    expect(matchingPDI[0]).toBe(-1);
    expect(matchingPDI[2]).toBe(-1);
    expect(matchingPDI[4]).toBe(-1);
    expect(matchingIsolate[0]).toBe(-1);
  });

  it("matches nested LRI LRI PDI PDI inner-to-outer", () => {
    const c = codes(`${LRI}${LRI}${PDI}${PDI}`); // 0:LRI 1:LRI 2:PDI 3:PDI
    const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
    // inner LRI(1) pairs with first PDI(2); outer LRI(0) with second PDI(3).
    expect(matchingPDI[1]).toBe(2);
    expect(matchingIsolate[2]).toBe(1);
    expect(matchingPDI[0]).toBe(3);
    expect(matchingIsolate[3]).toBe(0);
  });

  it("an unmatched initiator points at end-of-paragraph (codes.length)", () => {
    const c = codes(`${LRI}a`); // 0:LRI 1:a, no PDI
    const { matchingPDI } = computeMatchingPDI(c);
    expect(matchingPDI[0]).toBe(c.length);
  });

  it("a stray PDI (empty stack) gets matchingIsolate -1", () => {
    const c = codes(`${PDI}a`); // 0:PDI 1:a
    const { matchingIsolate } = computeMatchingPDI(c);
    expect(matchingIsolate[0]).toBe(-1);
  });

  it("FSI is an isolate initiator for pairing purposes", () => {
    const c = codes(`${FSI}a${PDI}`); // 0:FSI 1:a 2:PDI
    const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
    expect(matchingPDI[0]).toBe(2);
    expect(matchingIsolate[2]).toBe(0);
  });
});

function runExplicit(s: string, paragraphLevel: number) {
  const c = codes(s);
  const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
  return {
    codes: c,
    ...applyExplicit(c, paragraphLevel, matchingPDI, matchingIsolate),
    matchingPDI,
    matchingIsolate,
  };
}

describe("applyExplicit (X1–X9)", () => {
  it("RLE … PDF raises the enclosed content to an odd level (base 0)", () => {
    // 0:a 1:RLE 2:b 3:PDF 4:c → content levels a=0, b=1, c=0.
    const { levels, workingTypes } = runExplicit(`a${RLE}b${PDF}c`, 0);
    expect(levels[0]).toBe(0);
    expect(levels[2]).toBe(1);
    expect(levels[4]).toBe(0);
    // X9: the RLE and PDF format chars become BN in workingTypes.
    expect(workingTypes[1]).toBe(CC.BN);
    expect(workingTypes[3]).toBe(CC.BN);
  });

  it("LRO override forces the enclosed content type to L at an even level", () => {
    // 0:a 1:LRO 2:b 3:PDF 4:c → b at level 2, b's working type forced to L.
    const { levels, workingTypes } = runExplicit(`a${LRO}b${PDF}c`, 0);
    expect(levels[2]).toBe(2);
    expect(workingTypes[2]).toBe(CC.L);
  });

  it("RLO override forces the enclosed content type to R", () => {
    // 0:a 1:RLO 2:b 3:PDF → b at level 1, working type forced to R.
    const { levels, workingTypes } = runExplicit(`a${RLO}b${PDF}`, 0);
    expect(levels[2]).toBe(1);
    expect(workingTypes[2]).toBe(CC.R);
  });

  it("caps the level under deep overflowing embeddings (≤125)", () => {
    // 130 RLE then a content char then 130 PDF. The level must cap at ≤125.
    const deep = RLE.repeat(130) + "a" + PDF.repeat(130);
    const { levels } = runExplicit(deep, 0);
    const contentIdx = 130; // the 'a'
    expect(levels[contentIdx]).toBeLessThanOrEqual(125);
    // least-odd-greater chain from 0: 1,3,5,...; cap is the largest odd ≤125 = 125.
    expect(levels[contentIdx]).toBe(125);
  });

  it("a RLI Heb PDI b → content levels 0,_,1,_,0", () => {
    // 0:a 1:RLI 2:Hebrew 3:PDI 4:b. Content (a, Heb, b) → 0, 1, 0.
    const { levels } = runExplicit(`a${RLI}א${PDI}b`, 0);
    expect(levels[0]).toBe(0);
    expect(levels[2]).toBe(1);
    expect(levels[4]).toBe(0);
  });

  it("FSI with RTL content behaves as RLI (raises to odd)", () => {
    // 0:FSI 1:Hebrew 2:PDI → FSI detects RTL → isolate at odd level 1.
    const { levels } = runExplicit(`${FSI}א${PDI}`, 0);
    expect(levels[1]).toBe(1);
  });

  it("FSI with LTR content behaves as LRI (raises to even)", () => {
    // 0:FSI 1:a 2:PDI → FSI detects LTR → isolate at even level 2.
    const { levels } = runExplicit(`${FSI}a${PDI}`, 0);
    expect(levels[1]).toBe(2);
  });

  it("X6a resets overflow-embedding when a valid isolate closes", () => {
    // Embeddings that overflow MAX_DEPTH *inside* an isolate must be discarded
    // when its matching PDI closes the isolate — otherwise a stale overflow
    // count blocks the next embedding push and the trailing content wrongly
    // stays at the base level. Regression for the missing X6a reset step.
    // 0:RLI 1..130:RLE×130 (62 valid to 125, 68 overflow) 131:PDI 132:RLE
    // 133:b 134:PDF. After the PDI pops the isolate back to base level 0, the
    // fresh RLE must raise 'b' to level 1.
    const s = `${RLI}${RLE.repeat(130)}${PDI}${RLE}b${PDF}`;
    const { levels } = runExplicit(s, 0);
    const bIdx = 133;
    expect(levels[bIdx]).toBe(1);
  });

  it("retains a 1:1 mapping over format chars (no removal)", () => {
    const s = `a${RLE}b${PDF}c`;
    const { codes: c, levels, workingTypes } = runExplicit(s, 0);
    const cpCount = [...s].length;
    expect(c.length).toBe(cpCount);
    expect(levels.length).toBe(cpCount);
    expect(workingTypes.length).toBe(cpCount);
  });
});

function runSeqs(s: string, paragraphLevel: number) {
  const c = codes(s);
  const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
  const { levels, workingTypes } = applyExplicit(
    c,
    paragraphLevel,
    matchingPDI,
    matchingIsolate,
  );
  return computeIsolatingRunSequences(
    c,
    levels,
    workingTypes,
    matchingPDI,
    matchingIsolate,
    paragraphLevel,
  );
}

describe("computeIsolatingRunSequences (X10 / BD13)", () => {
  it("a plain L R L line at base 0 is one level-0 sequence with sos=eos=L", () => {
    // After the X pass (no implicit I yet) every char is level 0.
    const seqs = runSeqs("aאb", 0);
    expect(seqs.length).toBe(1);
    expect(seqs[0].indices).toEqual([0, 1, 2]);
    expect(seqs[0].sos).toBe(0); // L
    expect(seqs[0].eos).toBe(0); // L
  });

  it("joins an isolate initiator run to its matching-PDI run (a RLI b PDI c)", () => {
    // 0:a 1:RLI 2:b 3:PDI 4:c. Levels 0,0,1,0,0.
    // Sequence 1 (level 0): [0,1] joins across RLI→PDI to [3,4] → [0,1,3,4].
    // Sequence 2 (level 1): [2].
    const seqs = runSeqs(`a${RLI}b${PDI}c`, 0);
    const byLen = [...seqs].sort((x, y) => y.indices.length - x.indices.length);
    expect(byLen[0].indices).toEqual([0, 1, 3, 4]);
    expect(byLen[0].sos).toBe(0); // level 0 vs para 0 → L
    expect(byLen[0].eos).toBe(0); // ends at c, after = para 0 → L
    expect(byLen[1].indices).toEqual([2]);
    expect(byLen[1].sos).toBe(1); // level 1 vs before(level 0) → max 1 → R
    expect(byLen[1].eos).toBe(1); // level 1 vs after PDI(level 0) → max 1 → R
  });

  it("eos for a sequence ending in an unmatched isolate initiator uses the paragraph level", () => {
    // base 1 (RTL paragraph): 0:a 1:RLI 2:b — RLI has NO matching PDI.
    // Para level 1. a's run is level 1; it ends with the unmatched RLI, so eos
    // uses the paragraph level (1 → R). The RLI raises b to level 3 (next odd > 1).
    const seqs = runSeqs(`a${RLI}b`, 1);
    const seqWithA = seqs.find((q) => q.indices.includes(0));
    expect(seqWithA).toBeDefined();
    if (seqWithA === undefined) throw new Error("missing seq");
    expect(seqWithA.eos).toBe(1); // paragraph level 1 → R
  });
});
