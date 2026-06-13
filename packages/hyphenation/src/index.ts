/**
 * `@taleweaver/hyphenation` — the concrete, INJECTED Knuth-Liang hyphenation
 * capability for the Taleweaver engine.
 *
 * Core defines the `Hyphenator` interface (and a deterministic mock) but ships
 * NO real pattern data — heavy per-language resources stay out of core's hot
 * path (mirrors `TextShaper`/`TextMeasurer`; CLAUDE.md "concrete engine in-engine
 * OUT"). This package supplies the pure Liang trie algorithm (`liang.ts`) plus
 * the English (`en-us`) pattern data (`patterns-en-us.ts`). A host wires it into
 * the editor via `EditorConfig.hyphenator = createLiangHyphenator()`.
 *
 * ADDING A LANGUAGE IS DATA, NOT CODE: register another compiled `PatternSet`
 * keyed by its language prefix — no algorithm or core change. v1 ships `en-us`.
 */
import type { Hyphenator } from "@taleweaver/core";
import { compilePatterns, hyphenateWord, type PatternSet } from "./liang";
import { EN_US_PATTERN_SET } from "./patterns-en-us";

export { compilePatterns, hyphenateWord } from "./liang";
export type { PatternSet } from "./liang";
export { EN_US_PATTERN_SET } from "./patterns-en-us";

/**
 * The algorithm's own minimum prefix/suffix lengths. Kept small (2/2) — the
 * engine layers CSS `hyphenate-limit-chars` (default 5/2/2) on top of these
 * candidate points (design §3.1), so these floors only guard against degenerate
 * 1-letter fragments the patterns should never have produced anyway.
 */
const ALGO_LEFT_MIN = 2;
const ALGO_RIGHT_MIN = 2;

/** Bounded LRU so repeated words in natural text don't re-traverse the trie. */
const MEMO_LIMIT = 2000;

interface LanguageEntry {
  readonly compiled: ReturnType<typeof compilePatterns>;
  readonly memo: Map<string, readonly number[]>;
}

/**
 * Construct a Liang hyphenator covering English (`en` / `en-*`). Returns `[]`
 * for any other language and for words below the algorithm's floor. Results are
 * memoized per word (pure + deterministic ⇒ safe to cache).
 */
export function createLiangHyphenator(
  extraLanguages?: Readonly<Record<string, PatternSet>>,
): Hyphenator {
  // Map of normalized language prefix → compiled patterns + memo cache.
  const languages = new Map<string, LanguageEntry>();
  const register = (prefix: string, set: PatternSet): void => {
    languages.set(prefix, { compiled: compilePatterns(set), memo: new Map() });
  };
  register("en", EN_US_PATTERN_SET);
  if (extraLanguages !== undefined) {
    for (const [prefix, set] of Object.entries(extraLanguages)) {
      register(prefix.toLowerCase(), set);
    }
  }

  /** Resolve a BCP-47 tag to a registered entry: exact, then primary-subtag. */
  const resolve = (language: string): LanguageEntry | undefined => {
    const lower = language.toLowerCase();
    const exact = languages.get(lower);
    if (exact !== undefined) return exact;
    const primary = lower.split("-", 1)[0];
    return languages.get(primary);
  };

  return {
    hyphenate(word: string, language: string): readonly number[] {
      const entry = resolve(language);
      if (entry === undefined) return [];
      // Memo key includes nothing language-related: each entry has its own memo.
      const cached = entry.memo.get(word);
      if (cached !== undefined) return cached;
      const result = hyphenateWord(
        word,
        entry.compiled,
        ALGO_LEFT_MIN,
        ALGO_RIGHT_MIN,
      );
      if (entry.memo.size >= MEMO_LIMIT) {
        // Cheap eviction: drop the oldest insertion (Map preserves order).
        const oldest = entry.memo.keys().next().value;
        if (oldest !== undefined) entry.memo.delete(oldest);
      }
      entry.memo.set(word, result);
      return result;
    },
  };
}
