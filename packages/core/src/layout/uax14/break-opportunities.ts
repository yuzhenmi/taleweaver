import {
  lineBreakClass,
  isEastAsianWide,
  isExtendedPictographicCn,
  isPiQu,
  isPfQu,
  type LineBreakClass,
} from "./line-break-class";

export interface LineBreakPoint {
  /** UTF-16 code-unit offset; a line break is allowed BEFORE this offset. */
  readonly index: number;
  /** true = mandatory (LB4/LB5: BK/CR/LF/NL); false = optional (soft). */
  readonly mandatory: boolean;
}

export interface LineBreakOptions {
  /**
   * When true, resolve `CJ` (CJK small kana etc.) → `ID` (breakable) — the CSS
   * `line-break: normal/auto` tailoring. Default `false` = the UAX #14 LB1
   * default `CJ` → `NS` (no-break), which is what `LineBreakTest.txt` is
   * generated from, so the conformance suite runs with the default. The S2.4
   * integration layer passes `true` for CSS `line-break: normal/auto`.
   */
  readonly cjBreakable?: boolean;
}

// Working classes after LB1 resolution. SA is baked to CM/AL at codegen, so it
// never appears. AI/SG/XX→AL and CJ→NS|ID are resolved here. The Brahmic classes
// AP/AK/AS/VF/VI survive LB1 (LB28a handles them).
type WClass = Exclude<LineBreakClass, "AI" | "SG" | "XX" | "CJ">;

function resolveLB1(cls: LineBreakClass, cjBreakable: boolean): WClass {
  switch (cls) {
    case "AI": case "SG": case "XX": return "AL";
    case "CJ": return cjBreakable ? "ID" : "NS";
    // After the cases above, `cls` is narrowed to WClass — no cast needed.
    default: return cls;
  }
}

interface Eff {
  cls: WClass;
  index: number;
  /** East_Asian_Width ∈ {F,W,H} of the base code point (LB30, LB19a). */
  ea: boolean;
  /** True if the ORIGINAL code point was ZWJ (LB8a, distinct from LB9 collapse). */
  origZWJ: boolean;
  /** True if this element is a CM/ZWJ that attached to a base via LB9 — the
   *  boundary BEFORE it is forbidden (LB9: X (CM|ZWJ)* treated as X, no break
   *  between X and its combiners). */
  lb9Attached: boolean;
  /** General_Category = Pi (initial quote) — for LB15a. Only meaningful for QU. */
  pi: boolean;
  /** General_Category = Pf (final quote) — for LB15b. Only meaningful for QU. */
  pf: boolean;
  /** True if the code point is U+25CC DOTTED CIRCLE (the `◌` placeholder in the
   *  LB28a Brahmic rules — class AL, but ONLY this code point counts as ◌). */
  dottedCircle: boolean;
  /** True if the code point is U+2010 HYPHEN. LB20a names `( HY | [‐] )`,
   *  but U+2010's Line_Break class is BA (not HY), so the class alone can't
   *  identify it. */
  dash2010: boolean;
  /** True if the code point is Extended_Pictographic AND gc=Cn (LB30b 2nd
   *  clause: `[\p{Extended_Pictographic} & \p{gc=Cn}] × EM`). */
  extPictCn: boolean;
}

interface DecodedCp {
  index: number;
  cls: WClass;
  ea: boolean;
  pi: boolean;
  pf: boolean;
  dottedCircle: boolean;
  dash2010: boolean;
  extPictCn: boolean;
}

const DOTTED_CIRCLE = 0x25cc;
const HYPHEN_2010 = 0x2010;

/** Decode `text` to code points (UTF-16 start index + resolved class + metadata). */
function decode(text: string, cjBreakable: boolean): DecodedCp[] {
  const out: DecodedCp[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) ?? 0xfffd; // i < length, so never undefined; ?? satisfies the type
    const cls = resolveLB1(lineBreakClass(cp), cjBreakable);
    out.push({
      index: i,
      cls,
      ea: isEastAsianWide(cp),
      // pi/pf (GC=Pi/Pf ∩ QU) drive LB15a/LB15b; codegen-derived so the set
      // never silently goes stale on a Unicode upgrade (see isPiQu/isPfQu).
      pi: isPiQu(cp),
      pf: isPfQu(cp),
      dottedCircle: cp === DOTTED_CIRCLE,
      dash2010: cp === HYPHEN_2010,
      extPictCn: isExtendedPictographicCn(cp),
    });
    i += cp > 0xffff ? 2 : 1;
  }
  return out;
}

/**
 * UAX #14 line-break opportunities in `text`. Returns the code-unit offsets
 * where a break is allowed BEFORE the offset (index 0 and end-of-text are never
 * emitted — LB2/LB3). `mandatory` marks forced breaks (LB4/LB5).
 *
 * Implements rules LB1–LB31 (UAX #14, Unicode 16.0.0) with the §8.2 number
 * tailoring for LB25. Validated by conformance.test.ts against LineBreakTest.txt.
 */
export function lineBreakOpportunities(text: string, options: LineBreakOptions = {}): LineBreakPoint[] {
  const cjBreakable = options.cjBreakable ?? false;
  const cps = decode(text, cjBreakable);
  const out: LineBreakPoint[] = [];
  if (cps.length === 0) return out;

  // LB9/LB10 pre-pass: each CM/ZWJ (not after BK/CR/LF/NL/SP/ZW) inherits the
  // base's class (LB9); a standalone CM/ZWJ → AL (LB10). The ORIGINAL code-unit
  // index is preserved so emitted break offsets are correct.
  const eff: Eff[] = [];
  for (const c of cps) {
    const isCM = c.cls === "CM" || c.cls === "ZWJ";
    if (isCM && eff.length > 0) {
      const prev = eff[eff.length - 1];
      // eff.length > 0 guarantees this index is in-bounds; a miss is impossible.
      if (prev === undefined) throw new Error("uax14: eff back-element missing (unreachable)");
      const prevCls = prev.cls;
      if (prevCls !== "BK" && prevCls !== "CR" && prevCls !== "LF" && prevCls !== "NL" &&
          prevCls !== "SP" && prevCls !== "ZW") {
        // LB9: X (CM | ZWJ)* → treat as X. Inherit the base's class + metadata so
        // look-around rules (LB30, LB15a/b, LB30b) see the base, not the combiner.
        eff.push({
          cls: prevCls,
          index: c.index,
          ea: prev.ea,
          origZWJ: c.cls === "ZWJ",
          pi: prev.pi,
          pf: prev.pf,
          dottedCircle: prev.dottedCircle,
          dash2010: prev.dash2010,
          extPictCn: prev.extPictCn,
          lb9Attached: true,
        });
        continue;
      }
    }
    // LB10: standalone CM/ZWJ → AL.
    eff.push({
      cls: isCM ? "AL" : c.cls,
      index: c.index,
      ea: c.ea,
      origZWJ: c.cls === "ZWJ",
      pi: c.pi,
      pf: c.pf,
      dottedCircle: c.dottedCircle,
      dash2010: c.dash2010,
      extPictCn: c.extPictCn,
      lb9Attached: false,
    });
  }

  let riCount = 0;       // consecutive RI parity for LB30a
  // The last NON-SPACE class at or before the `before` element. Rules LB14/LB15/
  // LB16/LB17 "look through" runs of SP* — the governing class is the one BEFORE
  // the spaces, which `prevNonSpace` carries. (For a non-space `a`, it equals `a`.)
  // Initialized to eff[0].cls: when eff[0] is itself SP (text starts with a
  // space), this seeds prevNonSpace = "SP", which is safe — none of the rules
  // that CONSULT prevNonSpace (LB8 ZW, LB14 OP, LB15a QU, LB16 CL/CP, LB17 B2)
  // match prevNonSpace === "SP": they each require a specific non-SP opener
  // class. (LB18 fires on the direct predecessor `a === "SP"`, not prevNonSpace,
  // so it is unrelated to this seeding.) Keep this invariant when editing the
  // loop: prevNonSpace must only ever gate rules whose governing class is non-SP.
  // cps.length !== 0 and decode/pre-pass emit one eff entry per cp, so eff[0] exists.
  const eff0 = eff[0];
  if (eff0 === undefined) throw new Error("uax14: empty eff array (unreachable — cps non-empty)");
  let prevNonSpace: WClass = eff0.cls;
  let prevNonSpaceIdx = 0; // eff index of prevNonSpace (look-around for LB15a)

  for (let i = 1; i < eff.length; i++) {
    // i in [1, eff.length): both i and i-1 are in-bounds. A miss is impossible.
    const effPrev = eff[i - 1];
    const effCur = eff[i];
    if (effPrev === undefined || effCur === undefined) {
      throw new Error(`uax14: eff index ${i} out of range (unreachable)`);
    }
    const a = effPrev.cls;
    const b = effCur.cls;
    if (a !== "SP") { prevNonSpace = a; prevNonSpaceIdx = i - 1; } // update BEFORE deciding boundary i

    // LB30a counts consecutive REAL Regional_Indicator characters. An
    // LB9-attached combining mark inherits class RI but is part of its base's
    // grapheme — it must not advance the RI parity (nor reset it).
    if (effPrev.lb9Attached) {
      // carry: leave riCount unchanged
    } else if (a === "RI") riCount++;
    else riCount = 0;

    const decision = decide(a, b, prevNonSpace, prevNonSpaceIdx, riCount, eff, i);
    if (decision === "!") out.push({ index: effCur.index, mandatory: true });
    else if (decision === "÷") out.push({ index: effCur.index, mandatory: false });
    // "×" → no break, emit nothing.
  }
  return out;
}

type Decision = "!" | "÷" | "×";

/**
 * Bounded eff accessor for the rule engine. Every call site has already
 * established the index is in range (loop invariant `0 <= idx < eff.length`,
 * or a preceding `< eff.length` / `>= 0` guard), so a miss is an algorithm
 * invariant violation — throw loudly rather than silently mis-decide a break.
 */
function effAt(eff: Eff[], idx: number): Eff {
  const e = eff[idx];
  if (e === undefined) throw new Error(`uax14: eff[${idx}] out of range (unreachable, length ${eff.length})`);
  return e;
}

/**
 * LB25 — "do not break numbers" (UAX #14, Unicode 16.0.0). The rule is a set of
 * pair patterns with bounded look-around:
 *
 *   NU ( SY | IS )* ( CL | CP )? × ( PO | PR )
 *   ( PO | PR ) × ( OP ( IS )? )? NU
 *   HY × NU ;  IS × NU
 *   NU ( SY | IS )* × NU
 *
 * Evaluated at the boundary between `a` (eff[i-1]) and `b` (eff[i]). Look-behind
 * over `NU ( SY | IS )*` and the optional `( CL | CP )` is done by walking eff
 * leftward; the `( PO | PR ) × OP ( IS )? NU` form looks one/two elements ahead.
 */
function lb25NoBreak(a: WClass, b: WClass, eff: Eff[], i: number): boolean {
  // NU ( SY | IS )* ( CL | CP )? × ( PO | PR )
  // and NU ( SY | IS )* × NU  — both require: walking left from `a` over an
  // optional ( CL | CP ) then a ( SY | IS )* run lands on an NU.
  if (b === "PO" || b === "PR" || b === "NU") {
    let j = i - 1;
    // For × ( PO | PR ), `a` may be CL/CP (the optional tail) or part of the
    // ( SY | IS )* run or the NU itself. For × NU, `a` must be NU/SY/IS (no
    // CL/CP tail — LB13 already forbids breaks before CL/CP so they cannot lead
    // into an NU here, and the spec's NU-run form has no CL/CP before NU).
    // j = i-1 >= 0 here (i >= 1), so effAt is in-bounds.
    if (b !== "NU" && (effAt(eff, j).cls === "CL" || effAt(eff, j).cls === "CP")) j--;
    while (j >= 0 && (effAt(eff, j).cls === "SY" || effAt(eff, j).cls === "IS")) j--;
    if (j >= 0 && effAt(eff, j).cls === "NU") return true;
  }
  // ( PO | PR ) × NU and ( PO | PR ) × OP ( IS )? NU.
  if (a === "PO" || a === "PR") {
    if (b === "NU") return true;
    if (b === "OP") {
      // OP ( IS )? NU ahead.
      let k = i + 1;
      if (k < eff.length && effAt(eff, k).cls === "IS") k++;
      if (k < eff.length && effAt(eff, k).cls === "NU") return true;
    }
  }
  // HY × NU ;  IS × NU.
  if ((a === "HY" || a === "IS") && b === "NU") return true;
  return false;
}

/**
 * Decide break/no-break/mandatory between adjacent effective classes `a`,`b`,
 * applying UAX #14 rules in order. `prevNonSpace` = the last non-SP class at or
 * before `a` (SP* look-through for LB14-17). `prevNonSpaceIdx` = its eff index.
 * `riCount` = consecutive RI count up to `a` (LB30a). `eff`/`i` give look-around
 * (LB21a, LB25 number runs, LB28a, LB30 EA width via `eff[i].ea`).
 */
function decide(
  a: WClass, b: WClass, prevNonSpace: WClass, prevNonSpaceIdx: number,
  riCount: number, eff: Eff[], i: number,
): Decision {
  // i in [1, eff.length): eff[i] and eff[i-1] are always in-bounds.
  const prevZWJ = effAt(eff, i - 1).origZWJ;
  // LB4/LB5: mandatory breaks.
  if (a === "BK") return "!";
  if (a === "CR") return b === "LF" ? "×" : "!";
  if (a === "LF" || a === "NL") return "!";
  // LB6: × before a mandatory break.
  if (b === "BK" || b === "CR" || b === "LF" || b === "NL") return "×";
  // LB7: × before SP or ZW.
  if (b === "SP" || b === "ZW") return "×";
  // LB8: ÷ after ZW SP*.
  if (prevNonSpace === "ZW") return "÷";
  // LB8a: × after ZWJ.
  if (prevZWJ) return "×";
  // LB9: × between a base and its combining mark / ZWJ (the eff[i] entry attached
  // via the pre-pass). No break before an LB9-attached combiner.
  if (effAt(eff, i).lb9Attached) return "×";
  // LB11: × around WJ.
  if (a === "WJ" || b === "WJ") return "×";
  // LB12: × after GL.
  if (a === "GL") return "×";
  // LB12a: × before GL unless after SP/BA/HY.
  if (b === "GL" && a !== "SP" && a !== "BA" && a !== "HY") return "×";
  // LB13: × before CL/CP/EX/SY (Unicode 16 dropped the NU precondition AND moved
  // IS to LB15c/LB15d, so IS is NOT in LB13's set).
  if (b === "CL" || b === "CP" || b === "EX" || b === "SY") return "×";
  // LB14: × after OP SP* (look through spaces via prevNonSpace).
  if (prevNonSpace === "OP") return "×";
  // LB15a: × after an initial-quote QU (Pi) that is itself sentence/clause
  //   initial: ( sot | BK | CR | LF | NL | OP | QU | GL | SP | ZW ) [\p{Pi}&QU]
  //   SP* ×.  Look through SP* via prevNonSpace; the QU's own predecessor must
  //   be one of the initial contexts.
  if (prevNonSpace === "QU" && effAt(eff, prevNonSpaceIdx).pi) {
    const beforeQU = prevNonSpaceIdx > 0 ? effAt(eff, prevNonSpaceIdx - 1).cls : undefined;
    if (beforeQU === undefined || beforeQU === "BK" || beforeQU === "CR" ||
        beforeQU === "LF" || beforeQU === "NL" || beforeQU === "OP" ||
        beforeQU === "QU" || beforeQU === "GL" || beforeQU === "SP" ||
        beforeQU === "ZW") {
      return "×";
    }
  }
  // LB15b: × before a final-quote QU (Pf) that is itself sentence/clause final:
  //   × [\p{Pf}&QU] ( SP | GL | WJ | CL | QU | CP | EX | IS | SY | BK | CR | LF |
  //   NL | ZW | eot ).
  if (b === "QU" && effAt(eff, i).pf) {
    const after = i + 1 < eff.length ? effAt(eff, i + 1).cls : undefined;
    if (after === undefined || after === "SP" || after === "GL" || after === "WJ" ||
        after === "CL" || after === "QU" || after === "CP" || after === "EX" ||
        after === "IS" || after === "SY" || after === "BK" || after === "CR" ||
        after === "LF" || after === "NL" || after === "ZW") {
      return "×";
    }
  }
  // LB15c: SP ÷ IS NU — break before a decimal mark that follows a space and is
  // followed by a number (e.g. "subtract .5"). Must precede LB15d.
  if (a === "SP" && b === "IS" && i + 1 < eff.length && effAt(eff, i + 1).cls === "NU") return "÷";
  // LB15d: × IS — otherwise do not break before ';', ',', or '.', even after
  // spaces. (IS was removed from LB13 in Unicode 16 and handled here instead.)
  if (b === "IS") return "×";
  // LB16: × (CL|CP) SP* before NS.
  if ((prevNonSpace === "CL" || prevNonSpace === "CP") && b === "NS") return "×";
  // LB17: × B2 SP* before B2.
  if (prevNonSpace === "B2" && b === "B2") return "×";
  // LB18: ÷ after SP (only reached when LB14/LB15/LB16/LB17 did not fire).
  if (a === "SP") return "÷";
  // LB19 (Unicode 16): do not break before a non-initial unresolved QU, nor
  // after a non-final unresolved QU.
  //   × [ QU - \p{Pi} ]      (break-suppress before a QU that is NOT Pi)
  //   [ QU - \p{Pf} ] ×      (break-suppress after a QU that is NOT Pf)
  if (b === "QU" && !effAt(eff, i).pi) return "×";
  if (a === "QU" && !effAt(eff, i - 1).pf) return "×";
  // LB19a (Unicode 16): unless surrounded by East Asian characters, do not break
  // either side of any unresolved QU.
  //   [^EastAsian] × QU ; × QU ( [^EastAsian] | eot ) ;
  //   QU × [^EastAsian] ; ( sot | [^EastAsian] ) QU ×.
  if (b === "QU") {
    const aEA = effAt(eff, i - 1).ea;
    const afterEA = i + 1 < eff.length ? effAt(eff, i + 1).ea : false; // eot counts as non-EA
    if (!aEA || !afterEA) return "×";
  }
  if (a === "QU") {
    const bEA = effAt(eff, i).ea;
    const beforeEA = i - 2 >= 0 ? effAt(eff, i - 2).ea : false; // sot counts as non-EA
    if (!bEA || !beforeEA) return "×";
  }
  // LB20: ÷ before and after CB.
  if (a === "CB" || b === "CB") return "÷";
  // LB20a (Unicode 16): × ( sot | BK | CR | LF | NL | SP | ZW | CB | GL ) ( HY |
  //   [‐] ) AL — no break after a word-initial hyphen. The hyphen is class HY OR
  //   the specific code point U+2010 (whose Line_Break is BA, not HY), tracked
  //   via the `dash2010` flag.
  if ((a === "HY" || effAt(eff, i - 1).dash2010) && b === "AL") {
    // The hyphen may carry LB9-attached combining marks as extra eff entries; the
    // rule's predecessor context is the element BEFORE the hyphen base, so skip
    // back over those marks to the base, then look one further back.
    let baseIdx = i - 1;
    while (baseIdx > 0 && effAt(eff, baseIdx).lb9Attached) baseIdx--;
    const before = baseIdx - 1 >= 0 ? effAt(eff, baseIdx - 1).cls : undefined;
    if (before === undefined || before === "BK" || before === "CR" ||
        before === "LF" || before === "NL" || before === "SP" ||
        before === "ZW" || before === "CB" || before === "GL") {
      return "×";
    }
  }
  // LB21: × before BA/HY/NS; × after BB.
  if (b === "BA" || b === "HY" || b === "NS") return "×";
  if (a === "BB") return "×";
  // LB21a: HL (HY|BA) × — no break after a hyphen/break-after that follows HL.
  if (i >= 2 && effAt(eff, i - 2).cls === "HL" && (a === "HY" || a === "BA") && b !== "HL") return "×";
  // LB21b: × SY before HL.
  if (a === "SY" && b === "HL") return "×";
  // LB22: × before IN.
  if (b === "IN") return "×";
  // LB23: × (AL|HL) NU and × NU (AL|HL).
  if ((a === "AL" || a === "HL") && b === "NU") return "×";
  if (a === "NU" && (b === "AL" || b === "HL")) return "×";
  // LB23a: × PR (ID|EB|EM) and × (ID|EB|EM) PO.
  if (a === "PR" && (b === "ID" || b === "EB" || b === "EM")) return "×";
  if ((a === "ID" || a === "EB" || a === "EM") && b === "PO") return "×";
  // LB24: × (PR|PO)(AL|HL) and × (AL|HL)(PR|PO).
  if ((a === "PR" || a === "PO") && (b === "AL" || b === "HL")) return "×";
  if ((a === "AL" || a === "HL") && (b === "PR" || b === "PO")) return "×";
  // LB25: do not break numbers (pair patterns with bounded look-around).
  if (lb25NoBreak(a, b, eff, i)) return "×";
  // LB26: × within Korean syllable blocks.
  if (a === "JL" && (b === "JL" || b === "JV" || b === "H2" || b === "H3")) return "×";
  if ((a === "JV" || a === "H2") && (b === "JV" || b === "JT")) return "×";
  if ((a === "JT" || a === "H3") && b === "JT") return "×";
  // LB27: × Korean × PO ; × PR × Korean.
  if ((a === "JL" || a === "JV" || a === "JT" || a === "H2" || a === "H3") && b === "PO") return "×";
  if (a === "PR" && (b === "JL" || b === "JV" || b === "JT" || b === "H2" || b === "H3")) return "×";
  // LB28: × (AL|HL)(AL|HL).
  if ((a === "AL" || a === "HL") && (b === "AL" || b === "HL")) return "×";
  // LB28a (Unicode 16, Brahmic orthographic syllables).
  //   AP × (AK | ◌ | AS)
  //   (AK | ◌ | AS) × (VF | VI)
  //   (AK | ◌ | AS) VI × (AK | ◌)
  //   (AK | ◌ | AS) × (AK | ◌ | AS) VF   [look-ahead one]
  // `◌` is U+25CC DOTTED CIRCLE ONLY (its Line_Break is AL, but the rule matches
  // ONLY that one code point — NOT any AL character). We track it via the
  // per-element `dottedCircle` flag, not the AL class, so ordinary AL/CM-attached
  // bases (e.g. U+23E9) do NOT spuriously join a Brahmic cluster.
  const aDotted = effAt(eff, i - 1).dottedCircle;
  const bDotted = effAt(eff, i).dottedCircle;
  // AK | ◌ | AS  (left operand a / right operand b).
  const aAkAsDot = a === "AK" || a === "AS" || aDotted;
  const bAkAsDot = b === "AK" || b === "AS" || bDotted;
  if (a === "AP" && bAkAsDot) return "×";
  if (aAkAsDot && (b === "VF" || b === "VI")) return "×";
  // (AK | ◌ | AS) VI × (AK | ◌). `a` is the VI (or VI carrying LB9-attached
  // marks); the `(AK | ◌ | AS)` must be the element BEFORE the VI base, so skip
  // back over any attached marks on `a` to the VI base, then one more.
  if (a === "VI" && (b === "AK" || bDotted)) {
    let viBase = i - 1;
    while (viBase > 0 && effAt(eff, viBase).lb9Attached) viBase--;
    const beforeVi = viBase - 1;
    if (beforeVi >= 0 &&
        (effAt(eff, beforeVi).cls === "AK" || effAt(eff, beforeVi).cls === "AS" || effAt(eff, beforeVi).dottedCircle)) {
      return "×";
    }
  }
  if (aAkAsDot && bAkAsDot &&
      i + 1 < eff.length && effAt(eff, i + 1).cls === "VF") return "×";
  // LB29: × IS (AL|HL).
  if (a === "IS" && (b === "AL" || b === "HL")) return "×";
  // LB30: × (AL|HL|NU) OP and × CP (AL|HL|NU) — EXCLUDING East-Asian-wide OP/CP.
  if ((a === "AL" || a === "HL" || a === "NU") && b === "OP" && !effAt(eff, i).ea) return "×";
  if (a === "CP" && !effAt(eff, i - 1).ea && (b === "AL" || b === "HL" || b === "NU")) return "×";
  // LB30a: × RI RI only on an odd→even pair (break BETWEEN flag pairs).
  if (a === "RI" && b === "RI" && riCount % 2 === 1) return "×";
  // LB30b: × EB EM ; × [\p{Extended_Pictographic} & \p{gc=Cn}] EM.
  if (a === "EB" && b === "EM") return "×";
  if (b === "EM" && effAt(eff, i - 1).extPictCn) return "×";
  // LB31: ÷ everywhere else.
  return "÷";
}
