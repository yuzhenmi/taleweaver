/**
 * Injected hyphenation capability (mirrors TextShaper/TextMeasurer). The concrete
 * Liang implementation + per-language patterns live in a separate package; core
 * defines this interface + a mock. Treated as IMMUTABLE once configured on
 * EditorConfig — swapping it at runtime does NOT invalidate the wrap caches, so a
 * host that wants to swap hyphenators must trigger a full rebuild. See the
 * auto-hyphenation design §5.
 */
export interface Hyphenator {
  /**
   * Sorted, code-unit-relative interior positions of `word` where a hyphenation
   * break MAY occur. Each position is the FIRST index of the suffix (break BEFORE
   * it; the "-" glyph renders on the prefix). ALL candidate points — the engine
   * applies `hyphenate-limit-chars`. [] when unknown/unhyphenatable/unsupported
   * language. Pure, synchronous, deterministic.
   *
   * CONTRACT: `word` is the raw DISPLAY token and MAY contain U+00AD SOFT HYPHEN
   * (a zero-width author-supplied break that the engine handles separately). A
   * concrete implementation MUST treat U+00AD as a non-letter (ignore it for
   * pattern matching) and return positions as indices into the ORIGINAL
   * (U+00AD-containing) `word` so they stay aligned with the engine's cluster
   * map. (The mock ignores this since it counts code units uniformly; the real
   * Liang hyphenator in S5 must honor it.)
   */
  hyphenate(word: string, language: string): readonly number[];
}

/**
 * A compiled Liang pattern set: the raw whitespace-separated TeX pattern strings
 * (e.g. `"hy3ph"`, `".comp"`) plus an exceptions table whose values are the
 * hyphenated spelling using `-` (e.g. `"as-so-ciate"`).
 */
export interface PatternSet {
  /** Whitespace-separated Knuth-Liang patterns (digits embedded between letters). */
  readonly patterns: string;
  /** Irregular words → explicit hyphenation using `-` separators (TeX `\hyphenation`). */
  readonly exceptions: Readonly<Record<string, string>>;
}
