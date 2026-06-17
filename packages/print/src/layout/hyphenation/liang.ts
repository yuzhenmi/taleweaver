/**
 * Pure Knuth-Liang hyphenation trie matcher.
 *
 * The classic algorithm (Frank Liang, "Word Hy-phen-a-tion by Com-put-er",
 * 1983; the engine behind TeX's `\hyphenation`): a word is lowercased and framed
 * with dots (`.word.`); every pattern is slid across the framed word; at each
 * inter-letter position the MAXIMUM digit contributed by any matching pattern
 * wins; an ODD value means a break is permitted there. An explicit exceptions
 * dictionary overrides the pattern result for irregular words.
 *
 * This module is transport- and language-agnostic: it takes a compiled pattern
 * set + an exceptions map + the algorithm's own left/right floors and returns
 * SUFFIX-START indices (each is the first code unit of a suffix — a break BEFORE
 * that index, the "-" glyph rendered on the prefix). The engine applies CSS
 * `hyphenate-limit-chars` on top, so the floors here stay small (2/2).
 *
 * U+00AD CONTRACT (mirrors the core `Hyphenator` interface): the input word MAY
 * contain U+00AD SOFT HYPHEN. It is stripped before pattern matching (treated as
 * a non-letter) but the returned indices map back into the ORIGINAL
 * (U+00AD-bearing) word so they stay aligned with the engine's cluster map.
 */

import type { PatternSet } from "@taleweaver/core";

const SOFT_HYPHEN = "­";

interface CompiledPatterns {
  /** pattern letters (without digits, dots preserved) → point array. */
  readonly map: ReadonlyMap<string, readonly number[]>;
  /** word (lowercased, no separators) → suffix-start indices from the exceptions list. */
  readonly exceptions: ReadonlyMap<string, readonly number[]>;
}

/**
 * Parse one TeX pattern (`"hy3ph"`, `"a1b2c"`, `".comp"`) into its letter key and
 * its point array. The point array has length `letters.length + 1`: point[i] is
 * the value sitting BEFORE letter i (point[letters.length] is after the last
 * letter). Digits in the pattern set the points; absent digits are 0.
 */
function parsePattern(pattern: string): { key: string; points: number[] } {
  let key = "";
  const points: number[] = [];
  // points[i] precedes letters[i]; start with the leading slot.
  let pendingPoint = 0;
  for (const ch of pattern) {
    if (ch >= "0" && ch <= "9") {
      pendingPoint = ch.charCodeAt(0) - 48;
    } else {
      points.push(pendingPoint);
      pendingPoint = 0;
      key += ch;
    }
  }
  points.push(pendingPoint); // trailing slot (after the last letter)
  return { key, points };
}

/** Convert an exception spelling (`"as-so-ciate"`) to suffix-start indices. */
function parseException(spelling: string): { word: string; breaks: number[] } {
  let word = "";
  const breaks: number[] = [];
  for (const ch of spelling) {
    if (ch === "-") {
      breaks.push(word.length);
    } else {
      word += ch;
    }
  }
  return { word, breaks };
}

/** Compile a raw pattern set once (callers should cache the result). */
export function compilePatterns(set: PatternSet): CompiledPatterns {
  const map = new Map<string, readonly number[]>();
  for (const pattern of set.patterns.split(/\s+/)) {
    if (pattern === "") continue;
    const { key, points } = parsePattern(pattern);
    map.set(key, points);
  }
  const exceptions = new Map<string, readonly number[]>();
  for (const spelling of Object.values(set.exceptions)) {
    const { word, breaks } = parseException(spelling);
    exceptions.set(word, breaks);
  }
  return { map, exceptions };
}

/**
 * Hyphenate a single word against a compiled pattern set.
 *
 * @param word     raw display token; MAY contain U+00AD soft hyphens.
 * @param compiled compiled Liang patterns + exceptions.
 * @param leftMin  the algorithm's own minimum prefix length (kept small; the
 *                 engine applies CSS `hyphenate-limit-chars` on top).
 * @param rightMin the algorithm's own minimum suffix length.
 * @returns sorted SUFFIX-START indices into the ORIGINAL `word`.
 */
export function hyphenateWord(
  word: string,
  compiled: CompiledPatterns,
  leftMin: number,
  rightMin: number,
): number[] {
  // Strip U+00AD for matching, remembering the original index of each kept
  // code unit so results map back into the original (U+00AD-bearing) word.
  let clean = "";
  const originalIndexOfClean: number[] = [];
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === SOFT_HYPHEN) continue;
    clean += ch;
    originalIndexOfClean.push(i);
  }

  const lower = clean.toLowerCase();
  if (lower.length < leftMin + rightMin) return [];

  // Exceptions win outright (their breaks are indices into the clean word).
  const exception = compiled.exceptions.get(lower);
  if (exception !== undefined) {
    return exception
      .filter((p) => p >= leftMin && lower.length - p >= rightMin)
      .map((p) => {
        const orig = originalIndexOfClean[p];
        // The filter bounds p to [leftMin, lower.length-rightMin); originalIndexOfClean
        // has one entry per clean letter (lower.length entries), so p is in range.
        if (orig === undefined) {
          throw new Error(`hyphenateWord: exception break index ${p} out of range`);
        }
        return orig;
      });
  }

  // Knuth-Liang: frame with dots, slide every pattern, take the max point value
  // at each inter-letter position.
  const framed = "." + lower + ".";
  // points[i] is the value between framed[i-1] and framed[i]. We need the values
  // at the inter-letter positions of the CLEAN word: between clean letter k and
  // k+1 corresponds to framed position k+1 (the leading "." shifts by one).
  const points: number[] = new Array(framed.length + 1).fill(0);
  for (let start = 0; start < framed.length; start++) {
    let sub = "";
    for (let end = start; end < framed.length; end++) {
      sub += framed[end];
      const patternPoints = compiled.map.get(sub);
      if (patternPoints === undefined) continue;
      for (let k = 0; k < patternPoints.length; k++) {
        const pos = start + k;
        const pk = patternPoints[k];
        const existing = points[pos];
        // k < patternPoints.length (dense), and pos = start+k lies within the
        // matched substring's framed span, so pos < points.length (= framed.length+1).
        if (pk === undefined || existing === undefined) {
          throw new Error(`hyphenateWord: point index out of range (k=${k}, pos=${pos})`);
        }
        if (pk > existing) points[pos] = pk;
      }
    }
  }

  const breaks: number[] = [];
  // A break may occur before clean letter `p` (1 <= p <= len-1). In framed
  // coordinates that inter-letter gap is `points[p + 1]` (leading "." offset).
  for (let p = 1; p < lower.length; p++) {
    if (p < leftMin || lower.length - p < rightMin) continue;
    const point = points[p + 1];
    const orig = originalIndexOfClean[p];
    // p in [1, lower.length): p+1 < points.length (= framed.length+1 = lower.length+3),
    // and p indexes the clean letters (originalIndexOfClean has lower.length entries).
    if (point === undefined || orig === undefined) {
      throw new Error(`hyphenateWord: break index ${p} out of range`);
    }
    if (point % 2 === 1) {
      breaks.push(orig);
    }
  }
  return breaks;
}
