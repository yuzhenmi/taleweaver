import { bidiClass, type BidiClass } from "./bidi-class";

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
        const dir = computeParagraphLevel(codes, i + 1, matchingPDI[i]);
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
    const runLevel = levels[positions[k]];
    let j = k + 1;
    while (j < positions.length && levels[positions[j]] === runLevel) j++;
    runs.push({ start: k, end: j });
    k = j;
  }

  // Map an absolute index → the run that contains it (only PDIs are looked up).
  const runStartingAt = new Map<number, number>(); // absolute first-index → run idx
  for (let r = 0; r < runs.length; r++) {
    runStartingAt.set(positions[runs[r].start], r);
  }

  const sequences: IsolatingRunSequence[] = [];

  for (let r = 0; r < runs.length; r++) {
    const firstAbs = positions[runs[r].start];
    // BD13: a sequence starts here unless this run begins with a PDI that
    // matches an isolate initiator (such a run is appended to another sequence).
    if (workingTypes[firstAbs] === CC.PDI && matchingIsolate[firstAbs] !== -1) {
      continue;
    }

    const indices: number[] = [];
    let curRun = r;
    for (;;) {
      const run = runs[curRun];
      for (let k = run.start; k < run.end; k++) indices.push(positions[k]);
      const lastAbs = positions[run.end - 1];
      const lt = workingTypes[lastAbs];
      // If the run ends in an isolate initiator WITH a matching PDI, continue
      // the sequence at the run that starts at that PDI.
      if (
        (lt === CC.LRI || lt === CC.RLI || lt === CC.FSI) &&
        matchingPDI[lastAbs] < n
      ) {
        const nextRun = runStartingAt.get(matchingPDI[lastAbs]);
        if (nextRun === undefined) break;
        curRun = nextRun;
        continue;
      }
      break;
    }

    // X10 sos/eos.
    const seqLevel = levels[indices[0]];
    const firstIdx = indices[0];
    const lastIdx = indices[indices.length - 1];

    // sos: nearest preceding non-BN level (else paragraph level).
    let prevLevel = paragraphLevel;
    for (let p = firstIdx - 1; p >= 0; p--) {
      if (workingTypes[p] !== CC.BN) {
        prevLevel = levels[p];
        break;
      }
    }
    const sos = levelToBoundary(Math.max(seqLevel, prevLevel));

    // eos: nearest following non-BN level (else paragraph level). If the
    // sequence ends in an isolate initiator with NO matching PDI, use the
    // paragraph level (X10).
    const lastType = workingTypes[lastIdx];
    const endsInUnmatchedIsolate =
      (lastType === CC.LRI || lastType === CC.RLI || lastType === CC.FSI) &&
      matchingPDI[lastIdx] >= n;
    let nextLevel = paragraphLevel;
    if (!endsInUnmatchedIsolate) {
      for (let p = lastIdx + 1; p < n; p++) {
        if (workingTypes[p] !== CC.BN) {
          nextLevel = levels[p];
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
    if (types[idx[k]] !== CC.NSM) continue;
    if (k === 0) {
      types[idx[k]] = sosType;
    } else {
      const prev = types[idx[k - 1]];
      if (prev === CC.LRI || prev === CC.RLI || prev === CC.FSI || prev === CC.PDI) {
        types[idx[k]] = CC.ON;
      } else {
        types[idx[k]] = prev;
      }
    }
  }

  // W2 — EN after AL becomes AN. Track the most recent strong type as we scan
  // forward (starting from sos): L, R, or AL. (One pass; no backward rescan.)
  {
    let lastStrong = sosType; // L or R from sos; updated to L/R/AL inline.
    for (let k = 0; k < n; k++) {
      const t = types[idx[k]];
      if (t === CC.L || t === CC.R || t === CC.AL) {
        lastStrong = t;
      } else if (t === CC.EN && lastStrong === CC.AL) {
        types[idx[k]] = CC.AN;
      }
    }
  }

  // W3 — AL becomes R.
  for (let k = 0; k < n; k++) {
    if (types[idx[k]] === CC.AL) types[idx[k]] = CC.R;
  }

  // W4 — a single separator between two numbers of the matching type. ES only
  // bridges EN; CS bridges EN…EN and AN…AN. "Single" = the neighbours are the
  // immediately-adjacent sequence positions (k-1, k+1).
  for (let k = 1; k < n - 1; k++) {
    const t = types[idx[k]];
    const prev = types[idx[k - 1]];
    const next = types[idx[k + 1]];
    if (t === CC.ES) {
      if (prev === CC.EN && next === CC.EN) types[idx[k]] = CC.EN;
    } else if (t === CC.CS) {
      if (prev === CC.EN && next === CC.EN) types[idx[k]] = CC.EN;
      else if (prev === CC.AN && next === CC.AN) types[idx[k]] = CC.AN;
    }
  }

  // W5 — a contiguous run of ET adjacent to an EN becomes EN. Scan for maximal
  // ET runs and convert the whole run if either neighbour (or, for an edge run,
  // not applicable — sos/eos are never EN) is EN.
  for (let k = 0; k < n; ) {
    if (types[idx[k]] !== CC.ET) {
      k++;
      continue;
    }
    let j = k;
    while (j < n && types[idx[j]] === CC.ET) j++;
    // [k, j) is a maximal ET run; check the chars immediately before/after.
    const beforeIsEN = k > 0 && types[idx[k - 1]] === CC.EN;
    const afterIsEN = j < n && types[idx[j]] === CC.EN;
    if (beforeIsEN || afterIsEN) {
      for (let m = k; m < j; m++) types[idx[m]] = CC.EN;
    }
    k = j;
  }

  // W6 — any remaining ES/ET/CS becomes ON.
  for (let k = 0; k < n; k++) {
    const t = types[idx[k]];
    if (t === CC.ES || t === CC.ET || t === CC.CS) types[idx[k]] = CC.ON;
  }

  // W7 — EN after L becomes L. Track the most recent strong type (L or R;
  // AL is gone after W3) scanning forward from sos.
  {
    let lastStrong = sosType;
    for (let k = 0; k < n; k++) {
      const t = types[idx[k]];
      if (t === CC.L || t === CC.R) {
        lastStrong = t;
      } else if (t === CC.EN && lastStrong === CC.L) {
        types[idx[k]] = CC.L;
      }
    }
  }
}
