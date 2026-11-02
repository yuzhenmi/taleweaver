/**
 * Main-tree only, as today (a no-op elsewhere): rules, TOCs, section breaks,
 * footnotes, headers / footers, and a paste that holds a TOC, `[S]` or footnote.
 */
import type { At } from "./at";

export const inMainTree = (a: At): boolean => a.L.tree === "block";
