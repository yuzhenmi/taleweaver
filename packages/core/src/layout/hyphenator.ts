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
   */
  hyphenate(word: string, language: string): readonly number[];
}
