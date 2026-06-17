import { bidiClass, type BidiClass } from "./bidi-class";
import { bracketPair, canonicalBracketEquiv } from "./mirror";

/**
 * UAX #9 Unicode Bidirectional Algorithm — rule engine.
 *
 * This file is the foundation for the resolution phases. It currently
 * implements P2/P3 (paragraph embedding-level detection); the X (explicit
 * levels), W (weak types), N (neutrals), and I (implicit levels) passes land in
 * later tasks. All passes operate on a compact per-codepoint `Uint8Array` of
 * CLASS CODES (small ints) rather than `BidiClass` strings, for hot-path speed.
 *
 * MODULE-INTERNAL: nothing here is re-exported from any barrel / package
 * `index.ts`. Consumers import from this file directly.
 */

export type BaseDirection = "ltr" | "rtl" | "auto";

export interface BidiResult {
  /** Per-input-CODEPOINT resolved embedding level (NOT per UTF-16 unit). */
  readonly levels: Uint8Array;
  /** Per-input-codepoint ORIGINAL bidi class (used by L1 in reorder). */
  readonly types: Uint8Array;
  readonly paragraphLevel: number;
}

/**
 * The 23 UAX #9 Bidi_Class values in a FIXED, stable order. The index of each
 * class in this array IS its class code (the value stored in the `types`
 * Uint8Array). DO NOT REORDER — later passes (X/W/N/I) and any persisted
 * artifacts depend on this exact ordering.
 *
 * Order (codes 0..22):
 *   0:L 1:R 2:AL 3:EN 4:ES 5:ET 6:AN 7:CS 8:NSM 9:BN 10:B 11:S 12:WS 13:ON
 *   14:LRE 15:RLE 16:LRO 17:RLO 18:PDF 19:LRI 20:RLI 21:FSI 22:PDI
 *
 * (This mirrors the union declaration order in bidi-class.ts: the strong/weak/
 * neutral classes first, then the explicit-formatting classes.)
 */
export const BIDI_CLASS_CODES: readonly BidiClass[] = [
  "L", "R", "AL", "EN", "ES", "ET", "AN", "CS", "NSM", "BN",
  "B", "S", "WS", "ON",
  "LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI",
] as const;

/** Reverse lookup: class name → its fixed class code. Built once at module load. */
const CODE_BY_NAME: ReadonlyMap<BidiClass, number> = new Map(
  BIDI_CLASS_CODES.map((name, i) => [name, i] as const),
);

/** Class name → class code. Throws on an unknown name (cannot happen for the
 *  fixed union, but keeps the function total without a non-null assertion). */
export function code(name: BidiClass): number {
  const c = CODE_BY_NAME.get(name);
  if (c === undefined) throw new Error(`unknown bidi class: ${name}`);
  return c;
}

/** Code point → its bidi class code (the hot-path representation). */
export function classCode(codePoint: number): number {
  return code(bidiClass(codePoint));
}

/**
 * Read element `i` of a typed/numeric array, throwing if it is out of range.
 * Used at the many UAX #9 sites where an algorithm-derived index (a level-run
 * slice bound, an isolate-pairing target, an `idx`/`positions` permutation) is
 * provably in range by construction but TS cannot see it. Fail-loud: a silent
 * default here would corrupt bidi ordering/levels. `label`/`i` name the site.
 */
function tat(
  arr: Uint8Array | Int32Array | Uint32Array | readonly number[],
  i: number,
  label: string,
): number {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`bidi: ${label}[${i}] out of range (unreachable)`);
  }
  return v;
}

/** Read element `i` of a level-run array, throwing if out of range. */
function tatRun<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`bidi: runs[${i}] out of range (unreachable)`);
  }
  return v;
}

/**
 * Named numeric constants for every bidi class, keyed by class code. The
 * algorithm passes branch on these instead of comparing strings.
 */
export const CC = {
  L: code("L"),
  R: code("R"),
  AL: code("AL"),
  EN: code("EN"),
  ES: code("ES"),
  ET: code("ET"),
  AN: code("AN"),
  CS: code("CS"),
  NSM: code("NSM"),
  BN: code("BN"),
  B: code("B"),
  S: code("S"),
  WS: code("WS"),
  ON: code("ON"),
  LRE: code("LRE"),
  RLE: code("RLE"),
  LRO: code("LRO"),
  RLO: code("RLO"),
  PDF: code("PDF"),
  LRI: code("LRI"),
  RLI: code("RLI"),
  FSI: code("FSI"),
  PDI: code("PDI"),
} as const;

/**
 * UAX #9 rules P2 and P3 — compute the paragraph (base) embedding level for the
 * class-code run `types[start, end)`.
 *
 * P2: find the first character of class L, AL, or R, **skipping any characters
 * between an isolate initiator (LRI/RLI/FSI) and its matching PDI** (or, for an
 * unmatched initiator, the end of the range). P3: if such a character is found
 * and it is AL or R, the level is 1; otherwise (L found, or no strong char
 * found) the level is 0.
 *
 * This is also reused by X5c (FSI direction detection, a later task) to derive
 * an isolate's direction from its enclosed text — hence it is exported for tests
 * + intra-module reuse, but is MODULE-INTERNAL (never barrel-exported).
 */
export function computeParagraphLevel(
  types: Uint8Array,
  start: number,
  end: number,
): number {
  let isolateDepth = 0;
  for (let i = start; i < end; i++) {
    const t = types[i];
    if (t === CC.LRI || t === CC.RLI || t === CC.FSI) {
      isolateDepth++;
    } else if (t === CC.PDI) {
      if (isolateDepth > 0) isolateDepth--;
    } else if (isolateDepth === 0) {
      if (t === CC.L) return 0;
      if (t === CC.R || t === CC.AL) return 1;
    }
  }
  // P3: no strong character at depth 0 → default LTR.
  return 0;
}

// ===========================================================================
// X1–X10 — explicit embeddings, overrides, isolates, and isolating run
// sequences. MODULE-INTERNAL (exported only for tests / later W/N/I passes).
// ===========================================================================

/** UAX #9 maximum explicit-embedding depth (max_depth). */
const MAX_DEPTH = 125;

/**
 * Directional-override status of a directional-status-stack entry.
 *   NEUTRAL — no override in effect (X6 leaves the type unchanged).
 *   OVR_L   — override to L (X6 sets the working type to L).
 *   OVR_R   — override to R (X6 sets the working type to R).
 */
const OVR = { NEUTRAL: 0, L: 1, R: 2 } as const;
type Override = (typeof OVR)[keyof typeof OVR];

/** A directional-status-stack entry (UAX #9 §X1). */
interface StatusEntry {
  readonly level: number;
  readonly override: Override;
  readonly isolate: boolean;
}

/**
 * BD9 — the isolate-pairing pre-scan. Walks the class-code array once and
 * matches each isolate initiator (LRI/RLI/FSI) to its PDI.
 *
 * Returns two parallel arrays (both length `codes.length`):
 *  - `matchingPDI[i]`: for an initiator at `i`, the index of its matching PDI,
 *    or `codes.length` if the initiator is unmatched (treated as end-of-
 *    paragraph by X5c/X10). Sentinel `-1` for every non-initiator slot.
 *  - `matchingIsolate[p]`: for a PDI at `p`, the index of the initiator it
 *    matches, or `-1` for a stray PDI (and for every non-PDI slot).
 *
 * Per BD9 the matching is a simple stack: push initiators, and on a PDI pop
 * the nearest still-open initiator (if any).
 */
export function computeMatchingPDI(codes: Uint8Array): {
  matchingPDI: Int32Array;
  matchingIsolate: Int32Array;
} {
  const n = codes.length;
  const matchingPDI = new Int32Array(n).fill(-1);
  const matchingIsolate = new Int32Array(n).fill(-1);
  // Stack of open isolate-initiator indices.
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = codes[i];
    if (t === CC.LRI || t === CC.RLI || t === CC.FSI) {
      stack.push(i);
    } else if (t === CC.PDI) {
      const opener = stack.pop();
      if (opener === undefined) {
        // Stray PDI: no matching initiator.
        matchingIsolate[i] = -1;
      } else {
        matchingPDI[opener] = i;
        matchingIsolate[i] = opener;
      }
    }
  }
  // Unmatched initiators left on the stack match end-of-paragraph.
  for (const opener of stack) {
    matchingPDI[opener] = n;
  }
  return { matchingPDI, matchingIsolate };
}

/** Least odd level strictly greater than `level`. */
function nextOddLevel(level: number): number {
  return level + (level % 2 === 0 ? 1 : 2);
}

/** Least even level strictly greater than `level`. */
function nextEvenLevel(level: number): number {
  return level + (level % 2 === 0 ? 2 : 1);
}

/**
 * UAX #9 rules X1–X8 (with the X9 "retaining" model): the explicit-formatting
 * pass. Consumes the BD9 pre-scan (`matchingPDI` is needed by X5c/FSI before
 * the main walk reaches each FSI).
 *
 * Produces, both 1:1 with the input (no character is removed — §5.2 retaining):
 *  - `levels`: per-codepoint embedding level.
 *  - `workingTypes`: a COPY of `codes` mutated by X6 (override application) and
 *    X9 (embedding/override/PDF format chars → BN). This is what the W/N/I
 *    passes consume; the ORIGINAL `codes` are kept for L1.
 *
 * AMBIGUOUS-POINT DECISION (format-char levels): the conformance test (BidiTest /
 * BidiCharacterTest) ignores the levels of removed format characters (`x` in the
 * expected-levels column), so their `levels[i]` value is cosmetic. We assign
 * each embedding/override/PDF/BN format char the level of the *current top entry*
 * at the moment it is processed (i.e. the level BEFORE an embedding push, and the
 * level AFTER a PDF/PDI pop). Isolate initiators (LRI/RLI/FSI) and PDIs are NOT
 * removed; per X5a/X5b/X6a they take the current/new top level and are subject to
 * the active override — that is content-visible and handled explicitly below.
 */
export function applyExplicit(
  codes: Uint8Array,
  paragraphLevel: number,
  matchingPDI: Int32Array,
  _matchingIsolate: Int32Array,
): { levels: Uint8Array; workingTypes: Uint8Array } {
  const n = codes.length;
  const levels = new Uint8Array(n);
  const workingTypes = Uint8Array.from(codes);

  // X1: initialise the directional-status stack with one entry.
  const stack: StatusEntry[] = [
    { level: paragraphLevel, override: OVR.NEUTRAL, isolate: false },
  ];
  let overflowIsolate = 0;
  let overflowEmbedding = 0;
  let validIsolate = 0;

  const top = (): StatusEntry => {
    const e = stack[stack.length - 1];
    if (e === undefined) throw new Error("bidi: empty status stack");
    return e;
  };

  /** Push an embedding/override (X2–X5): the char itself becomes BN (X9). */
  const pushEmbedding = (i: number, rtl: boolean, override: Override): void => {
    const cur = top();
    // Format char takes the current top level (cosmetic — ignored by L1/conformance).
    levels[i] = cur.level;
    workingTypes[i] = CC.BN;
    const newLevel = rtl ? nextOddLevel(cur.level) : nextEvenLevel(cur.level);
    if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
      stack.push({ level: newLevel, override, isolate: false });
    } else if (overflowIsolate === 0) {
      overflowEmbedding++;
    }
  };

  /** Push an isolate initiator (X5a/X5b, and X5c after direction resolution). */
  const pushIsolate = (i: number, rtl: boolean): void => {
    const cur = top();
    // X5a/X5b: the initiator itself takes the CURRENT top level + override.
    levels[i] = cur.level;
    if (cur.override === OVR.L) workingTypes[i] = CC.L;
    else if (cur.override === OVR.R) workingTypes[i] = CC.R;
    const newLevel = rtl ? nextOddLevel(cur.level) : nextEvenLevel(cur.level);
    if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
      validIsolate++;
      stack.push({ level: newLevel, override: OVR.NEUTRAL, isolate: true });
    } else {
      overflowIsolate++;
    }
  };

  for (let i = 0; i < n; i++) {
    const t = codes[i];
    switch (t) {
      case CC.RLE: // X2
        pushEmbedding(i, true, OVR.NEUTRAL);
        break;
      case CC.LRE: // X3
        pushEmbedding(i, false, OVR.NEUTRAL);
        break;
      case CC.RLO: // X4
        pushEmbedding(i, true, OVR.R);
        break;
      case CC.LRO: // X5
        pushEmbedding(i, false, OVR.L);
        break;
      case CC.RLI: // X5a
        pushIsolate(i, true);
        break;
      case CC.LRI: // X5b
        pushIsolate(i, false);
        break;
      case CC.FSI: {
        // X5c: resolve direction from the enclosed text (P2/P3 over the
        // isolate's contents), then behave as RLI (dir 1) or LRI (dir 0).
        const dir = computeParagraphLevel(codes, i + 1, tat(matchingPDI, i, "matchingPDI"));
        pushIsolate(i, dir === 1);
        break;
      }
      case CC.PDI: {
        // X6a.
        if (overflowIsolate > 0) {
          overflowIsolate--;
        } else if (validIsolate === 0) {
          // No matching isolate initiator — do nothing to the stack.
        } else {
          // X6a: reset the overflow embedding count to zero. Embeddings that
          // overflowed MAX_DEPTH *inside* this isolate are discarded when its
          // matching PDI closes the isolate; leaving the count set would wrongly
          // steal a later PDF's pop and block later embedding pushes.
          overflowEmbedding = 0;
          while (!top().isolate) stack.pop();
          stack.pop(); // pop the isolate entry itself.
          validIsolate--;
        }
        // The PDI takes the (new) top entry's level + override.
        const cur = top();
        levels[i] = cur.level;
        if (cur.override === OVR.L) workingTypes[i] = CC.L;
        else if (cur.override === OVR.R) workingTypes[i] = CC.R;
        break;
      }
      case CC.PDF: {
        // X7.
        if (overflowIsolate === 0) {
          if (overflowEmbedding > 0) {
            overflowEmbedding--;
          } else if (!top().isolate && stack.length >= 2) {
            stack.pop();
          }
        }
        levels[i] = top().level;
        workingTypes[i] = CC.BN;
        break;
      }
      case CC.B: // X8 — paragraph separator is terminal.
        levels[i] = paragraphLevel;
        break;
      case CC.BN: // X9 — already BN; just assign the level.
        levels[i] = top().level;
        break;
      default: {
        // X6 — all other characters take the top level and any active override.
        const cur = top();
        levels[i] = cur.level;
        if (cur.override === OVR.L) workingTypes[i] = CC.L;
        else if (cur.override === OVR.R) workingTypes[i] = CC.R;
        break;
      }
    }
  }

  return { levels, workingTypes };
}

/** One isolating run sequence (BD13) plus its X10 sos/eos boundary types. */
export interface IsolatingRunSequence {
  /** Absolute codepoint indices in this sequence, in logical order. */
  readonly indices: number[];
  /** Start-of-sequence boundary type: 0 = L, 1 = R (by level parity). */
  readonly sos: 0 | 1;
  /** End-of-sequence boundary type: 0 = L, 1 = R. */
  readonly eos: 0 | 1;
}

/** Reduce an embedding level to its boundary type by parity (even→L=0, odd→R=1). */
function levelToBoundary(level: number): 0 | 1 {
  return (level & 1) === 0 ? 0 : 1;
}

/**
 * X10 / BD13 — partition the paragraph into isolating run sequences and compute
 * each sequence's sos/eos.
 *
 * AMBIGUOUS-POINT DECISION (BN handling): under the §5.2 retaining model we
 * EXCLUDE BN positions from the run sequences entirely. BN slots remain present
 * in the `levels`/`workingTypes` arrays (1:1 with input) but never appear in any
 * sequence's `indices`, so the downstream W/N/I passes never see them. Level runs
 * (BD7) are therefore computed over NON-BN positions: a maximal run of equal-level
 * non-BN characters. (Embedding/override/PDF format chars are BN after X9, so they
 * drop out here; isolate initiators and PDIs are retained and participate.)
 *
 * BD13 sequence assembly: start a sequence at every level run whose first
 * character is NOT a PDI that matches some isolate initiator; then, while the run
 * just added ends in an isolate initiator (LRI/RLI/FSI) WITH a matching PDI,
 * append the level run that starts at that matching PDI.
 *
 * X10 sos/eos: for a sequence, `sos` = boundary-type of max(sequence level, level
 * of the nearest preceding non-BN char, or the paragraph level if none); `eos` =
 * boundary-type of max(sequence level, level of the nearest following non-BN char,
 * or the paragraph level). Per X10, when the sequence's LAST character is an
 * isolate initiator with NO matching PDI, eos uses the paragraph level (there is
 * no "following" char inside the paragraph for that boundary).
 */
export function computeIsolatingRunSequences(
  codes: Uint8Array,
  levels: Uint8Array,
  workingTypes: Uint8Array,
  matchingPDI: Int32Array,
  matchingIsolate: Int32Array,
  paragraphLevel: number,
): IsolatingRunSequence[] {
  const n = codes.length;

  // The non-BN positions, in logical order — the universe for run/sequence
  // computation (BN is excluded per the retaining model; see the doc above).
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    if (workingTypes[i] !== CC.BN) positions.push(i);
  }

  // Partition `positions` into level runs (BD7): maximal equal-level spans.
  // Each run is stored as a slice [start, end) into `positions`.
  const runs: { start: number; end: number }[] = [];
  for (let k = 0; k < positions.length; ) {
    const runLevel = tat(levels, tat(positions, k, "positions"), "levels");
    let j = k + 1;
    while (
      j < positions.length &&
      tat(levels, tat(positions, j, "positions"), "levels") === runLevel
    )
      j++;
    runs.push({ start: k, end: j });
    k = j;
  }

  // Map an absolute index → the run that contains it (only PDIs are looked up).
  const runStartingAt = new Map<number, number>(); // absolute first-index → run idx
  for (let r = 0; r < runs.length; r++) {
    const run = tatRun(runs, r);
    runStartingAt.set(tat(positions, run.start, "positions"), r);
  }

  const sequences: IsolatingRunSequence[] = [];

  for (let r = 0; r < runs.length; r++) {
    const firstAbs = tat(positions, tatRun(runs, r).start, "positions");
    // BD13: a sequence starts here unless this run begins with a PDI that
    // matches an isolate initiator (such a run is appended to another sequence).
    if (
      tat(workingTypes, firstAbs, "workingTypes") === CC.PDI &&
      tat(matchingIsolate, firstAbs, "matchingIsolate") !== -1
    ) {
      continue;
    }

    const indices: number[] = [];
    let curRun = r;
    for (;;) {
      const run = tatRun(runs, curRun);
      for (let k = run.start; k < run.end; k++) indices.push(tat(positions, k, "positions"));
      const lastAbs = tat(positions, run.end - 1, "positions");
      const lt = tat(workingTypes, lastAbs, "workingTypes");
      // If the run ends in an isolate initiator WITH a matching PDI, continue
      // the sequence at the run that starts at that PDI.
      if (
        (lt === CC.LRI || lt === CC.RLI || lt === CC.FSI) &&
        tat(matchingPDI, lastAbs, "matchingPDI") < n
      ) {
        const nextRun = runStartingAt.get(tat(matchingPDI, lastAbs, "matchingPDI"));
        if (nextRun === undefined) break;
        curRun = nextRun;
        continue;
      }
      break;
    }

    // X10 sos/eos.
    const firstIdx = tat(indices, 0, "indices");
    const lastIdx = tat(indices, indices.length - 1, "indices");
    const seqLevel = tat(levels, firstIdx, "levels");

    // sos: nearest preceding non-BN level (else paragraph level).
    let prevLevel = paragraphLevel;
    for (let p = firstIdx - 1; p >= 0; p--) {
      if (tat(workingTypes, p, "workingTypes") !== CC.BN) {
        prevLevel = tat(levels, p, "levels");
        break;
      }
    }
    const sos = levelToBoundary(Math.max(seqLevel, prevLevel));

    // eos: nearest following non-BN level (else paragraph level). If the
    // sequence ends in an isolate initiator with NO matching PDI, use the
    // paragraph level (X10).
    const lastType = tat(workingTypes, lastIdx, "workingTypes");
    const endsInUnmatchedIsolate =
      (lastType === CC.LRI || lastType === CC.RLI || lastType === CC.FSI) &&
      tat(matchingPDI, lastIdx, "matchingPDI") >= n;
    let nextLevel = paragraphLevel;
    if (!endsInUnmatchedIsolate) {
      for (let p = lastIdx + 1; p < n; p++) {
        if (tat(workingTypes, p, "workingTypes") !== CC.BN) {
          nextLevel = tat(levels, p, "levels");
          break;
        }
      }
    }
    const eos = levelToBoundary(Math.max(seqLevel, nextLevel));

    sequences.push({ indices, sos, eos });
  }

  return sequences;
}

// ===========================================================================
// W1–W7 — weak-type resolution. MODULE-INTERNAL (exported for tests + the
// later N/I passes that the Task-7 driver chains after this one).
// ===========================================================================

/** Map a sos/eos boundary (0=L, 1=R) to the corresponding strong class code. */
function boundaryToType(boundary: 0 | 1): number {
  return boundary === 0 ? CC.L : CC.R;
}

/**
 * UAX #9 rules W1–W7 — resolve the weak types of one isolating run sequence,
 * IN PLACE, in the array `types`. Only the positions in `seq.indices` are read
 * or written; the array is otherwise left untouched (it is 1:1 with the input
 * codepoints, with BN positions excluded from `seq.indices`). `seq.sos` is the
 * virtual strong/type at the start of the sequence (the §X10 boundary): a
 * before-the-first-character context of L (sos=0) or R (sos=1).
 *
 * The seven rules are applied in order, each over the SEQUENCE (not raw
 * codepoint order); "previous" means previous within `seq.indices`:
 *
 *  - W1: each NSM → ON if the previous char is an isolate initiator
 *        (LRI/RLI/FSI) or PDI; else the type of the previous char; at the
 *        sequence start, sos's type. (Earlier NSMs are already resolved, so
 *        "previous type" reads the updated array — a chain of NSMs all take
 *        the type that resolved the first.)
 *  - W2: each EN → AN if the first strong type (R/L/AL/sos) found scanning
 *        backward is AL.
 *  - W3: every AL → R.
 *  - W4: a single ES between two EN → EN; a single CS between two EN → EN; a
 *        single CS between two AN → AN.
 *  - W5: a contiguous run of ET adjacent (before or after) an EN → EN.
 *  - W6: any remaining ES/ET/CS → ON.
 *  - W7: each EN → L if the first strong type (R/L/sos — AL is gone after W3)
 *        found scanning backward is L.
 */
export function applyWeak(seq: IsolatingRunSequence, types: Uint8Array): void {
  const idx = seq.indices;
  const n = idx.length;
  const sosType = boundaryToType(seq.sos);

  // W1 — non-spacing marks.
  for (let k = 0; k < n; k++) {
    const a = tat(idx, k, "idx");
    if (types[a] !== CC.NSM) continue;
    if (k === 0) {
      types[a] = sosType;
    } else {
      const prev = tat(types, tat(idx, k - 1, "idx"), "types");
      if (prev === CC.LRI || prev === CC.RLI || prev === CC.FSI || prev === CC.PDI) {
        types[a] = CC.ON;
      } else {
        types[a] = prev;
      }
    }
  }

  // W2 — EN after AL becomes AN. Track the most recent strong type as we scan
  // forward (starting from sos): L, R, or AL. (One pass; no backward rescan.)
  {
    let lastStrong = sosType; // L or R from sos; updated to L/R/AL inline.
    for (let k = 0; k < n; k++) {
      const a = tat(idx, k, "idx");
      const t = types[a];
      if (t === CC.L || t === CC.R || t === CC.AL) {
        lastStrong = t;
      } else if (t === CC.EN && lastStrong === CC.AL) {
        types[a] = CC.AN;
      }
    }
  }

  // W3 — AL becomes R.
  for (let k = 0; k < n; k++) {
    const a = tat(idx, k, "idx");
    if (types[a] === CC.AL) types[a] = CC.R;
  }

  // W4 — a single separator between two numbers of the matching type. ES only
  // bridges EN; CS bridges EN…EN and AN…AN. "Single" = the neighbours are the
  // immediately-adjacent sequence positions (k-1, k+1).
  for (let k = 1; k < n - 1; k++) {
    const a = tat(idx, k, "idx");
    const t = types[a];
    const prev = tat(types, tat(idx, k - 1, "idx"), "types");
    const next = tat(types, tat(idx, k + 1, "idx"), "types");
    if (t === CC.ES) {
      if (prev === CC.EN && next === CC.EN) types[a] = CC.EN;
    } else if (t === CC.CS) {
      if (prev === CC.EN && next === CC.EN) types[a] = CC.EN;
      else if (prev === CC.AN && next === CC.AN) types[a] = CC.AN;
    }
  }

  // W5 — a contiguous run of ET adjacent to an EN becomes EN. Scan for maximal
  // ET runs and convert the whole run if either neighbour (or, for an edge run,
  // not applicable — sos/eos are never EN) is EN.
  for (let k = 0; k < n; ) {
    if (tat(types, tat(idx, k, "idx"), "types") !== CC.ET) {
      k++;
      continue;
    }
    let j = k;
    while (j < n && tat(types, tat(idx, j, "idx"), "types") === CC.ET) j++;
    // [k, j) is a maximal ET run; check the chars immediately before/after.
    const beforeIsEN = k > 0 && tat(types, tat(idx, k - 1, "idx"), "types") === CC.EN;
    const afterIsEN = j < n && tat(types, tat(idx, j, "idx"), "types") === CC.EN;
    if (beforeIsEN || afterIsEN) {
      for (let m = k; m < j; m++) types[tat(idx, m, "idx")] = CC.EN;
    }
    k = j;
  }

  // W6 — any remaining ES/ET/CS becomes ON.
  for (let k = 0; k < n; k++) {
    const a = tat(idx, k, "idx");
    const t = types[a];
    if (t === CC.ES || t === CC.ET || t === CC.CS) types[a] = CC.ON;
  }

  // W7 — EN after L becomes L. Track the most recent strong type (L or R;
  // AL is gone after W3) scanning forward from sos.
  {
    let lastStrong = sosType;
    for (let k = 0; k < n; k++) {
      const a = tat(idx, k, "idx");
      const t = types[a];
      if (t === CC.L || t === CC.R) {
        lastStrong = t;
      } else if (t === CC.EN && lastStrong === CC.L) {
        types[a] = CC.L;
      }
    }
  }
}

// ===========================================================================
// N0–N2 — neutral and isolate-formatting resolution. MODULE-INTERNAL
// (exported for tests + the later I pass that the Task-7 driver chains).
// ===========================================================================

/** UAX #9 BD16 bracket-pair stack capacity (63 entries). */
const BD16_STACK_CAPACITY = 63;

/** Direction code for N0/N1: 0 = L, 1 = R. */
type Dir = 0 | 1;

/**
 * Strong-direction classification used by N0 and N1, per UAX #9: L counts as L;
 * R, EN, and AN all count as R. Returns 0 (L) or 1 (R) for a strong/numeric
 * resolved type, or -1 for a non-strong (neutral/isolate) type.
 */
function strongDir(type: number): Dir | -1 {
  if (type === CC.L) return 0;
  if (type === CC.R || type === CC.EN || type === CC.AN) return 1;
  return -1;
}

/** Narrow a possibly-(-1) strong direction to a Dir, falling back to `fallback`. */
function boundOrFallback(d: Dir | -1, fallback: Dir): Dir {
  return d === -1 ? fallback : d;
}

/** True if `type` is an NI — a neutral or isolate-formatting type (N1/N2 scope). */
function isNI(type: number): boolean {
  return (
    type === CC.B ||
    type === CC.S ||
    type === CC.WS ||
    type === CC.ON ||
    type === CC.FSI ||
    type === CC.LRI ||
    type === CC.RLI ||
    type === CC.PDI
  );
}

/**
 * UAX #9 rules N0–N2 — resolve neutral and isolate-formatting types of one
 * isolating run sequence, IN PLACE in `types`. Only the positions in
 * `seq.indices` are read or written.
 *
 * Applied in order over the sequence:
 *
 *  - N0 (BD16 + N0): identify paired brackets among the positions still typed ON
 *    (matched via canonical equivalence — BD16), then resolve each pair's
 *    direction from the strong types it encloses (with EN/AN counting as R), with
 *    a backward-context fallback when only the opposite direction is enclosed. An
 *    NSM immediately following a bracket that N0 set takes the same direction
 *    ("characters that had original bidirectional character type NSM prior to W1").
 *  - N1: a maximal run of NIs takes the common direction when the strong text on
 *    BOTH sides is the same (sos/eos supply the boundary direction; EN/AN count
 *    as R).
 *  - N2: any NI still unresolved takes the embedding direction (by level parity).
 *
 * `codePoints` are the ORIGINAL per-codepoint code points (1:1 with the input),
 * needed by N0 for `bracketPair` lookup and the NSM-follow-on test. `levels` give
 * each character's embedding level (for the N0 pair direction and N2).
 */
export function applyNeutral(
  seq: IsolatingRunSequence,
  codePoints: ReadonlyArray<number> | Uint32Array,
  levels: Uint8Array,
  types: Uint8Array,
): void {
  const idx = seq.indices;
  const n = idx.length;

  // -----------------------------------------------------------------------
  // N0 — paired brackets (BD16 identification, then per-pair resolution).
  // -----------------------------------------------------------------------

  // BD16 stack: each entry is the expected (canonical) closing key + the
  // SEQUENCE position of the opener. Fixed capacity (63).
  const stackKey = new Int32Array(BD16_STACK_CAPACITY);
  const stackOpenPos = new Int32Array(BD16_STACK_CAPACITY);
  let stackSize = 0;

  // Recorded pairs as parallel (openSeqPos, closeSeqPos) arrays.
  const pairOpen: number[] = [];
  const pairClose: number[] = [];

  identify: for (let k = 0; k < n; k++) {
    const abs = tat(idx, k, "idx");
    if (types[abs] !== CC.ON) continue;
    const bp = bracketPair(tat(codePoints, abs, "codePoints"));
    if (bp === null) continue;
    if (bp.kind === "open") {
      if (stackSize >= BD16_STACK_CAPACITY) {
        // Stack full: stop the entire BD16 identification (per BD16) and
        // resolve the pairs found so far.
        break identify;
      }
      stackKey[stackSize] = canonicalBracketEquiv(bp.paired);
      stackOpenPos[stackSize] = k;
      stackSize++;
    } else {
      // Closing bracket: search from the TOP down for a matching opener.
      const closeKey = canonicalBracketEquiv(tat(codePoints, abs, "codePoints"));
      for (let s = stackSize - 1; s >= 0; s--) {
        if (tat(stackKey, s, "stackKey") === closeKey) {
          pairOpen.push(tat(stackOpenPos, s, "stackOpenPos"));
          pairClose.push(k);
          // Pop the matched entry AND everything above it.
          stackSize = s;
          break;
        }
      }
    }
  }

  // Sort pairs by opening position (ascending). Build an index permutation so
  // the two parallel arrays stay aligned.
  const order = pairOpen.map((_, i) => i);
  order.sort((a, b) => tat(pairOpen, a, "pairOpen") - tat(pairOpen, b, "pairOpen"));

  for (const oi of order) {
    const openPos = tat(pairOpen, oi, "pairOpen");
    const closePos = tat(pairClose, oi, "pairClose");
    const openAbs = tat(idx, openPos, "idx");
    const closeAbs = tat(idx, closePos, "idx");

    // Embedding direction of the pair (EN/AN treated as R within N0 already
    // folds into strongDir for the enclosed scan).
    const e: Dir = (tat(levels, openAbs, "levels") & 1) === 0 ? 0 : 1;

    // Inspect the strong types strictly BETWEEN the brackets (sequence order).
    let sawEmbedding = false;
    let sawOpposite = false;
    for (let k = openPos + 1; k < closePos; k++) {
      const d = strongDir(tat(types, tat(idx, k, "idx"), "types"));
      if (d === -1) continue;
      if (d === e) {
        sawEmbedding = true;
        break;
      }
      sawOpposite = true;
    }

    let resolved: Dir | -1 = -1;
    if (sawEmbedding) {
      // (a) a strong type matching the embedding appears → use e.
      resolved = e;
    } else if (sawOpposite) {
      // (b) only the opposite strong type appears → establish context by
      // scanning backward from just before the opener to the first strong type
      // (or sos). If that preceding strong type is opposite e → use it;
      // otherwise fall back to e.
      const opposite: Dir = e === 0 ? 1 : 0;
      let context: Dir = seq.sos;
      for (let k = openPos - 1; k >= 0; k--) {
        const d = strongDir(tat(types, tat(idx, k, "idx"), "types"));
        if (d !== -1) {
          context = d;
          break;
        }
      }
      resolved = context === opposite ? opposite : e;
    }
    // (c) no strong enclosed → leave the brackets for N1/N2.

    if (resolved !== -1) {
      types[openAbs] = resolved === 0 ? CC.L : CC.R;
      types[closeAbs] = resolved === 0 ? CC.L : CC.R;
      // NSM follow-on: positions immediately after each bracket whose ORIGINAL
      // type (prior to W1) was NSM take the same direction.
      applyNsmFollowOn(idx, openPos, codePoints, types, resolved);
      applyNsmFollowOn(idx, closePos, codePoints, types, resolved);
    }
  }

  // -----------------------------------------------------------------------
  // N1 — a maximal run of NIs takes the common direction of the strong text on
  // both sides (sos/eos at the sequence ends; EN/AN count as R).
  // -----------------------------------------------------------------------
  for (let k = 0; k < n; ) {
    if (!isNI(tat(types, tat(idx, k, "idx"), "types"))) {
      k++;
      continue;
    }
    // [k, j) is a maximal NI run.
    let j = k;
    while (j < n && isNI(tat(types, tat(idx, j, "idx"), "types"))) j++;
    // Boundary directions: the strong text on each side, or sos/eos at the ends.
    // The chars at k-1 / j are non-NI by construction, so strongDir is never -1
    // there; the `?? seq.s*s` fallbacks cover only the sequence-edge cases.
    const left: Dir =
      k > 0 ? boundOrFallback(strongDir(tat(types, tat(idx, k - 1, "idx"), "types")), seq.sos) : seq.sos;
    const right: Dir =
      j < n ? boundOrFallback(strongDir(tat(types, tat(idx, j, "idx"), "types")), seq.eos) : seq.eos;
    if (left === right) {
      const t = left === 0 ? CC.L : CC.R;
      for (let m = k; m < j; m++) types[tat(idx, m, "idx")] = t;
    }
    k = j;
  }

  // -----------------------------------------------------------------------
  // N2 — any NI still unresolved takes the embedding direction (level parity).
  // -----------------------------------------------------------------------
  for (let k = 0; k < n; k++) {
    const abs = tat(idx, k, "idx");
    if (isNI(tat(types, abs, "types"))) {
      types[abs] = (tat(levels, abs, "levels") & 1) === 0 ? CC.L : CC.R;
    }
  }
}

/**
 * N0 NSM follow-on: starting at the position immediately after a bracket at
 * sequence position `bracketPos`, set every consecutive position whose ORIGINAL
 * (pre-W1) bidi type was NSM to the resolved bracket direction `dir`.
 */
function applyNsmFollowOn(
  idx: readonly number[],
  bracketPos: number,
  codePoints: ReadonlyArray<number> | Uint32Array,
  types: Uint8Array,
  dir: Dir,
): void {
  const t = dir === 0 ? CC.L : CC.R;
  for (let k = bracketPos + 1; k < idx.length; k++) {
    const a = tat(idx, k, "idx");
    const cp = codePoints[a];
    if (cp === undefined || classCode(cp) !== CC.NSM) break;
    types[a] = t;
  }
}

// ===========================================================================
// I1–I2 — implicit (resolved) embedding levels. MODULE-INTERNAL (exported for
// tests + the resolveBidiLevels driver below).
// ===========================================================================

/**
 * UAX #9 rules I1 and I2 — raise the embedding levels of one isolating run
 * sequence, IN PLACE in `levels`, based on each character's RESOLVED type (the
 * post-W/post-N type in `types`) and its OWN current level parity. Only the
 * positions in `seq.indices` are read or written.
 *
 *  - I1 (character at an EVEN — LTR — embedding level): if its resolved type is
 *    R → level += 1; if EN or AN → level += 2.
 *  - I2 (character at an ODD — RTL — embedding level): if its resolved type is
 *    L, EN, or AN → level += 1.
 *
 * A character whose resolved type is L at an even level, or R at an odd level,
 * keeps its level. After the W and N passes every position in a sequence is
 * resolved to one of L, R, EN, or AN, so those are the only cases handled here.
 *
 * BN positions and the explicit-formatting positions are already excluded from
 * `seq.indices` (the §5.2 retaining model drops them from sequences), so they
 * are never touched here — they keep the X-pass levels they were assigned.
 */
export function applyImplicit(
  seq: IsolatingRunSequence,
  levels: Uint8Array,
  types: Uint8Array,
): void {
  const idx = seq.indices;
  for (let k = 0; k < idx.length; k++) {
    const abs = tat(idx, k, "idx");
    const t = types[abs];
    const lvl = tat(levels, abs, "levels");
    if ((lvl & 1) === 0) {
      // I1 — even (LTR) level.
      if (t === CC.R) levels[abs] = lvl + 1;
      else if (t === CC.EN || t === CC.AN) levels[abs] = lvl + 2;
    } else {
      // I2 — odd (RTL) level.
      if (t === CC.L || t === CC.EN || t === CC.AN) levels[abs] = lvl + 1;
    }
  }
}

// ===========================================================================
// resolveBidiLevels — the public single-paragraph driver wiring the whole UBA.
// MODULE-INTERNAL (the barrel export lands in a later task).
// ===========================================================================

/**
 * Resolve the per-codepoint embedding levels of a SINGLE paragraph via the full
 * Unicode Bidirectional Algorithm.
 *
 * Pipeline (UAX #9), per codepoint, 1:1 with the input throughout:
 *  1. Classify each code point (Bidi_Class → class code).
 *  2. Paragraph level (P2/P3): "ltr" → 0, "rtl" → 1, "auto" → computed from the
 *     first strong character.
 *  3. BD9 isolate pre-scan (computeMatchingPDI).
 *  4. X1–X10 explicit levels / isolating-run-sequence partition.
 *  5. Per isolating run sequence, in order: W1–W7 (applyWeak), then N0–N2
 *     (applyNeutral), then I1–I2 (applyImplicit, which mutates `levels`).
 *
 * Returns `levels` (resolved embedding level per input codepoint), `types` (the
 * ORIGINAL class codes — NOT the resolved types; L1 in the reorder pass needs
 * the original B/S/WS/isolate classes), and the `paragraphLevel`. All arrays are
 * 1:1 with the input codepoints (NOT UTF-16 units).
 */
export function resolveBidiLevels(
  text: string,
  base: BaseDirection,
): BidiResult {
  const codePoints = [...text].map((ch) => ch.codePointAt(0) ?? 0);
  const codes = Uint8Array.from(codePoints.map((cp) => classCode(cp)));

  const paragraphLevel =
    base === "ltr"
      ? 0
      : base === "rtl"
        ? 1
        : computeParagraphLevel(codes, 0, codes.length);

  const { matchingPDI, matchingIsolate } = computeMatchingPDI(codes);
  const { levels, workingTypes } = applyExplicit(
    codes,
    paragraphLevel,
    matchingPDI,
    matchingIsolate,
  );
  const sequences = computeIsolatingRunSequences(
    codes,
    levels,
    workingTypes,
    matchingPDI,
    matchingIsolate,
    paragraphLevel,
  );

  const resolvedTypes = Uint8Array.from(workingTypes);
  for (const seq of sequences) {
    applyWeak(seq, resolvedTypes);
    applyNeutral(seq, codePoints, levels, resolvedTypes);
    applyImplicit(seq, levels, resolvedTypes);
  }

  // `types` is the ORIGINAL class codes (NOT the resolved types) for L1.
  return { levels, types: codes, paragraphLevel };
}
