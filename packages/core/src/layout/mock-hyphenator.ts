import type { Hyphenator } from "./hyphenator";

/**
 * Deterministic mock hyphenator for tests. Breaks before every Nth code unit
 * (default `every` = 3) of the matching language (default: any language when
 * `opts.language` is undefined), but only when the word length is >= `floor`
 * (default 1). Returns sorted suffix-start indices (the FIRST index of each
 * breakable suffix); only INTERIOR points are returned (never index 0 or the
 * word end). Returns [] for a non-matching language or a too-short word. No real
 * patterns — see `Hyphenator` and the auto-hyphenation design §5.
 */
export function createMockHyphenator(opts: {
  every?: number;
  language?: string;
  floor?: number;
}): Hyphenator {
  const every = opts.every ?? 3;
  const floor = opts.floor ?? 1;
  const language = opts.language;
  return {
    hyphenate(word: string, lang: string): readonly number[] {
      if (language !== undefined && lang !== language) return [];
      if (word.length < floor) return [];
      const points: number[] = [];
      for (let i = every; i < word.length; i += every) {
        points.push(i);
      }
      return points;
    },
  };
}
