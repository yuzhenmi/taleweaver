/**
 * The concrete, INJECTED Knuth-Liang hyphenation capability for the Taleweaver
 * engine. Lives in `@taleweaver/print` because only the print layout engine does
 * justified-text hyphenation (the digital backend relies on the browser's native
 * CSS `hyphens`, and `@taleweaver/core` is headless/geometry-free).
 *
 * Core defines the `Hyphenator` interface (and a deterministic mock) but ships
 * NO real pattern data — heavy per-language resources stay out of core's hot
 * path (mirrors `TextShaper`/`TextMeasurer`). This module supplies the pure Liang
 * trie algorithm (`liang.ts`); the per-language pattern DATA lives in its own
 * leaf package (`@taleweaver/hyphenation-en-us`, `-de`, …).
 *
 * HOST-INJECTION (preserves the SYNCHRONOUS `Hyphenator.hyphenate` contract): the
 * host decides which language packages to bundle and passes their `PatternSet`s
 * in via `createLiangHyphenator({ en: EN_US_PATTERN_SET })`. There is no baked-in
 * default language — that would couple the engine to one language package. A host
 * wanting lazy loading may itself `await import("@taleweaver/hyphenation-de")` at
 * app-init and pass the (sync) `PatternSet` in; dynamic loading stays the host's
 * choice, OUT of the engine's sync hyphenate path.
 *
 * ADDING A LANGUAGE IS A NEW DATA PACKAGE: register another `PatternSet` keyed by
 * its language prefix — no algorithm or core change.
 */
import type { Hyphenator, PatternSet } from "@taleweaver/core";
import { compilePatterns, hyphenateWord } from "./liang";

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
 * Construct a Liang hyphenator over the host-supplied language pattern sets
 * (keyed by primary subtag or full BCP-47 tag, e.g. `{ en: EN_US_PATTERN_SET }`).
 * Returns `[]` for any unregistered language and for words below the algorithm's
 * floor; an empty/omitted map yields a hyphenator that returns `[]` for every
 * language (hyphenation simply off). Results are memoized per word (pure +
 * deterministic ⇒ safe to cache).
 */
export function createLiangHyphenator(
  languages: Readonly<Record<string, PatternSet>>,
): Hyphenator {
  // Map of normalized language prefix → compiled patterns + memo cache.
  const registry = new Map<string, LanguageEntry>();
  for (const [prefix, set] of Object.entries(languages)) {
    registry.set(prefix.toLowerCase(), {
      compiled: compilePatterns(set),
      memo: new Map(),
    });
  }

  /** Resolve a BCP-47 tag to a registered entry: exact, then primary-subtag. */
  const resolve = (language: string): LanguageEntry | undefined => {
    const lower = language.toLowerCase();
    const exact = registry.get(lower);
    if (exact !== undefined) return exact;
    // `split` always yields at least one element, so index 0 is present.
    const primary = lower.split("-", 1)[0] ?? lower;
    return registry.get(primary);
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
