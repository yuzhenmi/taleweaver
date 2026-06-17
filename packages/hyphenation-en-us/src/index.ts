/**
 * `@taleweaver/hyphenation-en-us` — English (`en-us`) Knuth-Liang hyphenation
 * pattern DATA.
 *
 * Data-only leaf package: ships the curated public-domain TeX `hyphen.tex`
 * (en-US) `PatternSet` and imports only the `PatternSet` TYPE from
 * `@taleweaver/core` (no algorithm, no layout engine). A host bundles this (and
 * any other per-language data package) and injects the resolved patterns into
 * the Liang hyphenator via `createLiangHyphenator({ en: EN_US_PATTERN_SET })`
 * (from `@taleweaver/print`).
 *
 * ADDING A LANGUAGE IS A NEW DATA PACKAGE: `@taleweaver/hyphenation-de`, etc. —
 * each exports its own `PatternSet`, with no algorithm or core change.
 */
export { EN_US_PATTERN_SET } from "./patterns-en-us";
