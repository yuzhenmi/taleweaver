import { describe, it, expect } from "vitest";
import {
  computeParagraphLevel,
  classCode,
  CC,
  computeMatchingPDI,
  applyExplicit,
  computeIsolatingRunSequences,
  applyWeak,
  applyNeutral,
  applyImplicit,
  resolveBidiLevels,
} from "./bidi";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
    expect(nth(seqs, 0, "sequence").indices).toEqual([0, 1, 2]);
    expect(nth(seqs, 0, "sequence").sos).toBe(0); // L
    expect(nth(seqs, 0, "sequence").eos).toBe(0); // L
  });

  it("joins an isolate initiator run to its matching-PDI run (a RLI b PDI c)", () => {
    // 0:a 1:RLI 2:b 3:PDI 4:c. Levels 0,0,1,0,0.
    // Sequence 1 (level 0): [0,1] joins across RLI→PDI to [3,4] → [0,1,3,4].
    // Sequence 2 (level 1): [2].
    const seqs = runSeqs(`a${RLI}b${PDI}c`, 0);
    const byLen = [...seqs].sort((x, y) => y.indices.length - x.indices.length);
    expect(nth(byLen, 0, "sequence").indices).toEqual([0, 1, 3, 4]);
    expect(nth(byLen, 0, "sequence").sos).toBe(0); // level 0 vs para 0 → L
    expect(nth(byLen, 0, "sequence").eos).toBe(0); // ends at c, after = para 0 → L
    expect(nth(byLen, 1, "sequence").indices).toEqual([2]);
    expect(nth(byLen, 1, "sequence").sos).toBe(1); // level 1 vs before(level 0) → max 1 → R
    expect(nth(byLen, 1, "sequence").eos).toBe(1); // level 1 vs after PDI(level 0) → max 1 → R
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

// Strong / weak / neutral code points used by the W-pass tests.
const HEB = "א"; // U+05D0  R
const ARB = "ا"; // U+0627  AL (Arabic letter)
const AND = "٠"; // U+0660  AN (Arabic-Indic digit zero)
const NSM = "́"; // combining acute accent — NSM
const ES = "+"; // U+002B  ES
const CS = ","; // U+002C  CS
const ET = "$"; // U+0024  ET

/**
 * Run the X passes for `s` at `paragraphLevel`, then apply W1–W7 to a FRESH
 * mutable `resolvedTypes` cloned from `workingTypes` for every isolating run
 * sequence. Returns the post-W resolved-types array so tests can assert on the
 * type at any absolute codepoint index.
 */
function runWeak(s: string, paragraphLevel: number): Uint8Array {
  const c = codes(s);
  const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
  const { levels, workingTypes } = applyExplicit(
    c,
    paragraphLevel,
    matchingPDI,
    matchingIsolate,
  );
  const seqs = computeIsolatingRunSequences(
    c,
    levels,
    workingTypes,
    matchingPDI,
    matchingIsolate,
    paragraphLevel,
  );
  const resolvedTypes = Uint8Array.from(workingTypes);
  for (const seq of seqs) applyWeak(seq, resolvedTypes);
  return resolvedTypes;
}

describe("applyWeak (W1–W7)", () => {
  it("W1: an NSM takes the type of the previous character (propagating along a run)", () => {
    // 0:a(L) 1:NSM 2:NSM → each NSM becomes L (type of the previous char). The
    // second NSM relies on W1 reading the ALREADY-UPDATED type of the first NSM
    // (L), not its original NSM — i.e. the resolution propagates along the run.
    const t = runWeak(`a${NSM}${NSM}`, 0);
    expect(t[1]).toBe(CC.L);
    expect(t[2]).toBe(CC.L);
  });

  it("W1: an NSM whose sequence-predecessor is an isolate initiator becomes ON", () => {
    // The isolate-initiator branch of W1 is only reachable when an initiator and
    // an NSM are adjacent WITHIN one isolating run sequence. (In raw text an
    // initiator's sequence-successor is always its matching PDI, so this is
    // exercised directly on a hand-built sequence — exactly the unit-test path
    // the task calls out.) Sequence [RLI, NSM] at sos=L: the NSM's previous type
    // is RLI (an isolate initiator) → ON, NOT the RLI's type.
    const types = Uint8Array.from([CC.RLI, CC.NSM]);
    applyWeak({ indices: [0, 1], sos: 0, eos: 0 }, types);
    expect(types[1]).toBe(CC.ON);
  });

  it("W1: an NSM after a PDI becomes ON", () => {
    // 0:a 1:RLI 2:b 3:PDI 4:NSM. Sequence (level 0) is [0,1,3,4]; within it the
    // NSM(4)'s previous char is the PDI(3) → ON.
    const t = runWeak(`a${RLI}b${PDI}${NSM}`, 0);
    expect(t[4]).toBe(CC.ON);
  });

  it("W1: an NSM first in the sequence takes sos", () => {
    // base 1 (RTL paragraph): 0:NSM 1:a. The sequence starts with the NSM; with
    // no previous char it takes sos. Para level 1 → sos = R, so the NSM → R.
    const t = runWeak(`${NSM}a`, 1);
    expect(t[0]).toBe(CC.R);
  });

  it("W2: an EN after AL becomes AN", () => {
    // 0:ARB(AL) 1:EN. Searching back from the EN the first strong is AL → AN.
    const t = runWeak(`${ARB}1`, 0);
    expect(t[1]).toBe(CC.AN);
  });

  it("W2: an EN after L stays EN (W2), then W7 makes it L", () => {
    // 0:a(L) 1:EN. W2 keeps EN (first strong is L, not AL). W7 then sees the
    // first strong before the EN is L → EN becomes L.
    const t = runWeak("a1", 0);
    expect(t[1]).toBe(CC.L);
  });

  it("W3: every AL becomes R", () => {
    // 0:ARB(AL) 1:b(L). The AL → R.
    const t = runWeak(`${ARB}b`, 0);
    expect(t[0]).toBe(CC.R);
  });

  it("W4: a single ES between two EN becomes EN", () => {
    // 0:HEB(R) 1:EN 2:ES 3:EN. (Hebrew keeps W7 from turning the ENs into L.)
    const t = runWeak(`${HEB}1+2`, 0);
    expect(t[1]).toBe(CC.EN);
    expect(t[2]).toBe(CC.EN); // ES bridged
    expect(t[3]).toBe(CC.EN);
  });

  it("W4: a single CS between two AN becomes AN", () => {
    // 0:AND 1:CS 2:AND. CS between two AN → AN.
    const t = runWeak(`${AND}${CS}${AND}`, 0);
    expect(t[0]).toBe(CC.AN);
    expect(t[1]).toBe(CC.AN); // CS bridged
    expect(t[2]).toBe(CC.AN);
  });

  it("W4: a CS between EN and AN does NOT bridge (W6 makes it ON)", () => {
    // 0:HEB(R) 1:EN 2:CS 3:AND. CS sits between an EN and an AN — mismatched
    // number types, so W4 leaves it; W6 then turns it into ON. The EN/AN keep.
    const t = runWeak(`${HEB}1${CS}${AND}`, 0);
    expect(t[1]).toBe(CC.EN);
    expect(t[2]).toBe(CC.ON); // not bridged → W6
    expect(t[3]).toBe(CC.AN);
  });

  it("W5: a run of ET before an EN becomes EN", () => {
    // 0:HEB(R) 1:ET 2:ET 3:EN. The ET run is adjacent (before) an EN → all EN.
    const t = runWeak(`${HEB}${ET}${ET}1`, 0);
    expect(t[1]).toBe(CC.EN);
    expect(t[2]).toBe(CC.EN);
    expect(t[3]).toBe(CC.EN);
  });

  it("W5: a run of ET after an EN becomes EN (incl. the far end of the run)", () => {
    // 0:HEB(R) 1:EN 2:ET 3:ET 4:ET. The whole maximal ET run flips — including
    // index 4, the ET FARTHEST from the EN that touches it. Guards that W5 walks
    // the entire run, not just the single ET immediately adjacent to the EN.
    const t = runWeak(`${HEB}1${ET}${ET}${ET}`, 0);
    expect(t[1]).toBe(CC.EN);
    expect(t[2]).toBe(CC.EN);
    expect(t[3]).toBe(CC.EN);
    expect(t[4]).toBe(CC.EN);
  });

  it("W6: a separator/terminator with no number neighbor becomes ON", () => {
    // 0:a(L) 1:ES 2:ET 3:CS 4:b(L). None is adjacent to a number → all ON.
    const t = runWeak(`a${ES}${ET}${CS}b`, 0);
    expect(t[1]).toBe(CC.ON);
    expect(t[2]).toBe(CC.ON);
    expect(t[3]).toBe(CC.ON);
  });

  it("W7: an EN after L becomes L", () => {
    // 0:a(L) 1:EN. First strong before the EN is L → EN becomes L.
    const t = runWeak("a1", 0);
    expect(t[1]).toBe(CC.L);
  });

  it("W7: an EN after R stays EN", () => {
    // 0:HEB(R) 1:EN. First strong before the EN is R → EN stays EN.
    const t = runWeak(`${HEB}1`, 0);
    expect(t[1]).toBe(CC.EN);
  });

  it("W2/W7: a leading EN uses sos as the strong boundary (sos=L → EN becomes L)", () => {
    // 0:EN 1:a(L) at base 0. The EN is FIRST in the sequence — there is no real
    // preceding char, so W2's and W7's backward strong-scan terminates at sos.
    // sos = L (level 0): W2 keeps the EN (sos is not AL), then W7 turns it into L.
    // Pins that sos — not a real index — is consulted as the strong boundary.
    const t = runWeak("1a", 0);
    expect(t[0]).toBe(CC.L);
  });

  it("W2/W7: a leading EN with sos=R stays EN (no spurious AN or L)", () => {
    // base 1 (RTL paragraph): 0:EN alone. The sequence level is the paragraph
    // level 1, so sos = R. W2 sees sos=R (not AL) → EN stays; W7 sees sos=R
    // (not L) → EN stays. Confirms the sos=R boundary neither bridges to AN nor L.
    const t = runWeak("1", 1);
    expect(t[0]).toBe(CC.EN);
  });
});

// Bracket / cross-form code points used by the N0 tests. Built by explicit code
// point (NOT glyph literals) — U+2329 ⟨ and U+3008 〈 are visually identical, so
// a pasted glyph silently picks the wrong one; only a U+2329 opener (paired =
// U+232A) with a U+3009 closer exercises the BD16 canonical-equivalence path.
const LANGLE = String.fromCodePoint(0x2329); // ⟨ paired = U+232A, canon ≡ U+3008
const RANGLE_CANON = String.fromCodePoint(0x3009); // 〉 RIGHT ANGLE BRACKET; canon ≡ U+232A
const EN_DIGIT = "1"; // U+0031 EN

/**
 * Run the X then W passes for `s` at `paragraphLevel`, then apply N0–N2 to the
 * post-W `resolvedTypes` for every isolating run sequence — mirroring `runWeak`
 * but threading the original CODE POINTS into `applyNeutral` (N0 needs them for
 * BD16 bracket lookup). Returns the post-N resolved-types array.
 */
function runNeutral(s: string, paragraphLevel: number): Uint8Array {
  const c = codes(s);
  const codePoints = Uint32Array.from(
    [...s].map((ch) => ch.codePointAt(0) ?? 0),
  );
  const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
  const { levels, workingTypes } = applyExplicit(
    c,
    paragraphLevel,
    matchingPDI,
    matchingIsolate,
  );
  const seqs = computeIsolatingRunSequences(
    c,
    levels,
    workingTypes,
    matchingPDI,
    matchingIsolate,
    paragraphLevel,
  );
  const resolvedTypes = Uint8Array.from(workingTypes);
  for (const seq of seqs) {
    applyWeak(seq, resolvedTypes);
    applyNeutral(seq, codePoints, levels, resolvedTypes);
  }
  return resolvedTypes;
}

describe("applyNeutral (N0–N2)", () => {
  it("N0(a): a bracket pair enclosing a strong char matching the embedding takes the embedding direction (RTL)", () => {
    // base 1 (RTL, e=R): 0:HEB(R) 1:'('(ON) 2:HEB(R) 3:')'(ON). The pair (1,3)
    // encloses index 2 = R, which MATCHES e=R → both brackets resolve to R.
    const t = runNeutral(`${HEB}(${HEB})`, 1);
    expect(t[1]).toBe(CC.R);
    expect(t[3]).toBe(CC.R);
  });

  it("N0(a): EN/AN count as R inside the bracket for the embedding-match test (RTL)", () => {
    // base 1 (RTL, e=R): 0:HEB(R) 1:'(' 2:EN 3:')'. After W, the EN stays EN
    // (preceded by R). N0 treats EN as R, which matches e=R → both → R.
    const t = runNeutral(`${HEB}(${EN_DIGIT})`, 1);
    expect(t[1]).toBe(CC.R);
    expect(t[3]).toBe(CC.R);
  });

  it("N0(b): opposite-direction enclosed + preceding opposite context → both brackets take the opposite direction", () => {
    // base 1 (RTL, e=R): 0:a(L) 1:'(' 2:a(L) 3:')'. Enclosed index 2 = L is
    // OPPOSITE to e=R. Scan back before the opening bracket: index 0 = L, which
    // is OPPOSITE to e → both brackets take that opposite direction (L).
    const t = runNeutral("a(a)", 1);
    expect(t[1]).toBe(CC.L);
    expect(t[3]).toBe(CC.L);
  });

  it("N0(b): opposite-direction enclosed but NON-opposite preceding context → both brackets fall back to the embedding direction", () => {
    // base 1 (RTL, e=R): 0:HEB(R) 1:'(' 2:a(L) 3:')'. Enclosed index 2 = L is
    // OPPOSITE to e=R. Scan back before the opening bracket: index 0 = HEB(R),
    // the SAME as e (not opposite) → fall back to e=R → both brackets → R.
    const t = runNeutral(`${HEB}(a)`, 1);
    expect(t[1]).toBe(CC.R);
    expect(t[3]).toBe(CC.R);
  });

  it("N0(b): opposite enclosed at the sequence start uses sos as the preceding context", () => {
    // base 0 (LTR, e=L): 0:'(' 1:HEB(R) 2:')'. Enclosed index 1 = R is OPPOSITE
    // to e=L. There is no preceding strong char → the backward scan terminates
    // at sos. sos = L (level 0) = SAME as e → fall back to e=L → both → L.
    const t = runNeutral(`(${HEB})`, 0);
    expect(t[0]).toBe(CC.L);
    expect(t[2]).toBe(CC.L);
  });

  it("N0 cross-form BD16: a U+2329 opener with a U+3009 closer is a pair via canonical equivalence", () => {
    // base 0 (LTR, e=L): 0:HEB(R) 1:⟨(U+2329, ON) 2:HEB(R) 3:〉(U+3009, ON). A
    // naive paired===closer check FAILS here (2329's paired is 232A, not 3009);
    // only canonicalBracketEquiv matches them, so this is the cross-form guard.
    //
    // The assertion is DISCRIMINATING: only if the pair is identified does N0(b)
    // fire — the enclosed HEB(R) is opposite e=L, the preceding context (HEB@0,
    // R) is also opposite, so both brackets → R. If canonical normalization were
    // removed, the pair is NOT found and the brackets resolve as bare neutrals:
    // the opener@1 sits between R(@0) and R(@2) → N1 → R (coincides), but the
    // CLOSER@3 sits between R(@2) and eos=L → N1 can't resolve it → N2 gives it
    // the embedding direction L. So t[3] flips R→L without the fix. Guards the
    // exact raw-comparison regression a same-form test cannot catch.
    const t = runNeutral(`${HEB}${LANGLE}${HEB}${RANGLE_CANON}`, 0);
    expect(t[1]).toBe(CC.R);
    expect(t[3]).toBe(CC.R); // ← the discriminating assertion (L if BD16 canon is dropped)
  });

  it("N0 NSM follow-on: an NSM immediately after a resolved bracket takes the bracket's direction", () => {
    // base 1 (RTL, e=R): 0:HEB(R) 1:'(' 2:HEB(R) 3:')' 4:NSM. The pair (1,3)
    // resolves to R (encloses R). The NSM at 4 has ORIGINAL type NSM and
    // immediately follows the closing bracket → it also becomes R (N0 NSM rule).
    const t = runNeutral(`${HEB}(${HEB})${NSM}`, 1);
    expect(t[3]).toBe(CC.R);
    expect(t[4]).toBe(CC.R);
  });

  it("N0(c): a bracket pair enclosing NO strong type is left for N1/N2", () => {
    // base 0 (LTR, e=L): 0:a(L) 1:'(' 2:'.'(ON, a CS→ON after W) 3:')' 4:a(L).
    // No strong type between the brackets → N0 leaves them; N1 then resolves the
    // whole neutral run '( . )' between two L's to L.
    const t = runNeutral("a(,)a", 0);
    expect(t[1]).toBe(CC.L);
    expect(t[2]).toBe(CC.L);
    expect(t[3]).toBe(CC.L);
  });

  it("N1: an ON run between two L's becomes L", () => {
    // 0:a(L) 1:ON 2:a(L). The neutral takes the common L direction.
    const t = runNeutral("a*a", 0);
    expect(t[1]).toBe(CC.L);
  });

  it("N1: an ON run between two R's becomes R", () => {
    // base 1: 0:HEB(R) 1:ON 2:HEB(R). The neutral takes the common R direction.
    const t = runNeutral(`${HEB}*${HEB}`, 1);
    expect(t[1]).toBe(CC.R);
  });

  it("N1: an ON between R and EN becomes R (EN counts as R on the boundary)", () => {
    // base 1: 0:HEB(R) 1:ON 2:EN. EN counts as R for N1 → R ON R → R.
    const t = runNeutral(`${HEB}*${EN_DIGIT}`, 1);
    expect(t[1]).toBe(CC.R);
  });

  it("N1: a leading ON with sos=R and a following R becomes R (sos boundary)", () => {
    // base 1 (RTL, e=R, sos=R): 0:ON 1:HEB(R). The neutral run starts the
    // sequence; sos=R on the left and R on the right → the ON becomes R.
    const t = runNeutral(`*${HEB}`, 1);
    expect(t[0]).toBe(CC.R);
  });

  it("N2: a lone ON between opposite strongs takes the embedding direction", () => {
    // base 0 (LTR, e=L): 0:a(L) 1:ON 2:HEB(R). N1 cannot resolve (L vs R differ),
    // so N2 applies the embedding direction of the ON (level 0 → L).
    const t = runNeutral("a*" + HEB, 0);
    expect(t[1]).toBe(CC.L);
  });
});

/**
 * Run the X→W→N passes for `s` at `paragraphLevel`, then apply I1/I2 per
 * isolating run sequence (mutating `levels` in place). Returns the post-I
 * `levels` array so tests can assert the implicit embedding levels. Mirrors
 * `runNeutral` but adds `applyImplicit` and surfaces `levels`.
 */
function runImplicit(s: string, paragraphLevel: number): Uint8Array {
  const c = codes(s);
  const codePoints = Uint32Array.from(
    [...s].map((ch) => ch.codePointAt(0) ?? 0),
  );
  const { matchingPDI, matchingIsolate } = computeMatchingPDI(c);
  const { levels, workingTypes } = applyExplicit(
    c,
    paragraphLevel,
    matchingPDI,
    matchingIsolate,
  );
  const seqs = computeIsolatingRunSequences(
    c,
    levels,
    workingTypes,
    matchingPDI,
    matchingIsolate,
    paragraphLevel,
  );
  const resolvedTypes = Uint8Array.from(workingTypes);
  for (const seq of seqs) {
    applyWeak(seq, resolvedTypes);
    applyNeutral(seq, codePoints, levels, resolvedTypes);
    applyImplicit(seq, levels, resolvedTypes);
  }
  return levels;
}

describe("applyImplicit (I1/I2)", () => {
  it("I1: at an even (LTR) level, an R bumps +1 (0→1)", () => {
    // base 0: 0:a(L) 1:HEB(R). a stays level 0 (L at even); the R → level 1.
    const levels = runImplicit(`a${HEB}`, 0);
    expect(levels[0]).toBe(0); // L at even level — unchanged
    expect(levels[1]).toBe(1); // R at even level → +1
  });

  it("I1: at an even (LTR) level, EN bumps +2 (0→2) and AN bumps +2 (0→2)", () => {
    // base 0: 0:HEB(R) 1:EN 2:AND(AN). HEB keeps the EN/AN as EN/AN through W
    // (preceded by R, so W7 does not turn the EN into L). At even level 0 both
    // the EN and the AN bump +2 → level 2. (HEB itself → 1 by I1.)
    const levels = runImplicit(`${HEB}${EN_DIGIT}${AND}`, 0);
    expect(levels[0]).toBe(1); // R → +1
    expect(levels[1]).toBe(2); // EN at even level → +2
    expect(levels[2]).toBe(2); // AN at even level → +2
  });

  it("I2: at an odd (RTL) level, an L bumps +1, and EN/AN bump +1", () => {
    // base 1 (odd embedding level 1): 0:a(L) 1:EN 2:AND(AN). At level 1 the L,
    // EN and AN each bump +1 → level 2. (W7 cannot turn the EN into L because the
    // sos at base 1 is R; the EN stays EN preceded by R-context.)
    const levels = runImplicit(`a${EN_DIGIT}${AND}`, 1);
    expect(levels[0]).toBe(2); // L at odd level → +1
    expect(levels[1]).toBe(2); // EN at odd level → +1
    expect(levels[2]).toBe(2); // AN at odd level → +1
  });

  it("I2: at an odd (RTL) level, an R keeps its level", () => {
    // base 1: 0:HEB(R). R at odd level 1 stays 1.
    const levels = runImplicit(`${HEB}`, 1);
    expect(levels[0]).toBe(1);
  });
});

describe("resolveBidiLevels (full pipeline)", () => {
  it("base ltr: Latin level 0, Hebrew level 1, digits resolve, paragraphLevel 0", () => {
    const text = "hello אבג 123";
    const { levels, types, paragraphLevel } = resolveBidiLevels(text, "ltr");
    expect(paragraphLevel).toBe(0);
    expect(levels.length).toBe([...text].length);
    // "hello" — Latin (L) at level 0.
    for (let i = 0; i < 5; i++) expect(levels[i]).toBe(0);
    expect(levels[5]).toBe(0); // the space between "hello" and Hebrew → L run, level 0
    // "אבג" — Hebrew (R) at level 1 (I1 even+R → +1).
    expect(levels[6]).toBe(1);
    expect(levels[7]).toBe(1);
    expect(levels[8]).toBe(1);
    // " 123" — the digits follow Hebrew context; EN preceded by R stays EN, and
    // at even level 0 I1 bumps EN +2 → level 2.
    expect(levels[10]).toBe(2); // '1'
    expect(levels[11]).toBe(2); // '2'
    expect(levels[12]).toBe(2); // '3'
    // `types` is the ORIGINAL class codes (NOT resolved): leading 'h' is L.
    expect(types[0]).toBe(CC.L);
    expect(types[6]).toBe(CC.R); // Hebrew alef original class is R
    // DISCRIMINATING: index 5 is the space, originally WS. The neutral passes
    // resolve its *type* to a strong direction, so this assertion FAILS if the
    // return ever regresses to `types: resolvedTypes` instead of the raw codes —
    // the exact slip that would silently break L1 in the reorder pass.
    expect(types[5]).toBe(CC.WS);
    expect(types.length).toBe([...text].length);
  });

  it("base rtl: a leading Latin run sits at an odd level above the RTL base", () => {
    // paragraphLevel 1 (RTL). "abc" is L at odd level 1 → I2 bumps each +1 → 2.
    const text = "abc";
    const { levels, paragraphLevel } = resolveBidiLevels(text, "rtl");
    expect(paragraphLevel).toBe(1);
    expect(levels[0]).toBe(2);
    expect(levels[1]).toBe(2);
    expect(levels[2]).toBe(2);
  });

  it("base auto: the first strong char picks the direction (Hebrew → paragraphLevel 1)", () => {
    const text = "אבג hello";
    const { levels, paragraphLevel } = resolveBidiLevels(text, "auto");
    expect(paragraphLevel).toBe(1);
    // Hebrew (R) at odd base level 1 stays 1.
    expect(levels[0]).toBe(1);
    expect(levels[1]).toBe(1);
    expect(levels[2]).toBe(1);
    // "hello" — Latin (L) at odd level 1 → I2 +1 → 2.
    expect(levels[4]).toBe(2);
  });

  it("base auto: a leading Latin char picks LTR (paragraphLevel 0)", () => {
    const { paragraphLevel } = resolveBidiLevels("hello אבג", "auto");
    expect(paragraphLevel).toBe(0);
  });
});

import * as coreBarrel from "../../index";

describe("uax9 public barrel", () => {
  it("re-exports the bidi surface from @taleweaver/core", () => {
    expect(typeof coreBarrel.resolveBidiLevels).toBe("function");
    expect(typeof coreBarrel.reorderVisual).toBe("function");
    expect(typeof coreBarrel.bidiMirror).toBe("function");
    expect(typeof coreBarrel.bidiClass).toBe("function");
    expect(coreBarrel.UAX9_UNICODE_VERSION).toBe("16.0.0");
    expect(coreBarrel.bidiMirror(0x28)).toBe(0x29); // ( -> )
    expect(coreBarrel.bidiClass(0x05d0)).toBe("R"); // Hebrew alef
    // End-to-end smoke through the barrel: an RTL run inside an LTR paragraph
    // reverses to visual order.
    const { levels, types, paragraphLevel } = coreBarrel.resolveBidiLevels(
      "abc אבג",
      "ltr",
    );
    expect(paragraphLevel).toBe(0);
    expect(coreBarrel.reorderVisual(levels, types, paragraphLevel, 0, 7)).toEqual([
      0, 1, 2, 3, 6, 5, 4,
    ]);
  });
});
