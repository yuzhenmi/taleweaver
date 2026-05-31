/**
 * @module footnotes/policy
 *
 * FN-6.3: the document-level footnote numbering policy, read from the document
 * ROOT block's RAW attrs. The policy is NOT a style property — it is a
 * document-wide setting (mirroring Google Docs' Footnote settings dialog), so
 * it is stored as raw `attrs` on the root block and read directly here, NOT
 * routed through the cascade / attr-registry.
 *
 * Two keys carry it:
 *   - `footnoteNumberingReset`  → `FootnoteNumberingPolicy.reset`
 *   - `footnoteNumberingFormat` → `FootnoteNumberingPolicy.format`
 *
 * Each is validated independently against its closed set of literals; an
 * absent or invalid value falls back to the Google Docs default for that field
 * (`continuous` / `decimal`). The toolbar UI that WRITES these keys is a later
 * task; until then a document simply uses the default.
 */
import { getBlock } from "../state";
import type { State } from "../state";
import type { CounterFormat } from "./format-counter";
import type { FootnoteNumberingPolicy } from "./types";

/** The document default — a single continuous decimal sequence (Google Docs). */
export const DEFAULT_FOOTNOTE_NUMBERING_POLICY: FootnoteNumberingPolicy = {
  reset: "continuous",
  format: "decimal",
};

/** Valid `reset` literals (mirrors `FootnoteNumberingPolicy.reset`). */
const VALID_RESETS: ReadonlySet<FootnoteNumberingPolicy["reset"]> = new Set([
  "continuous",
  "restart-per-section",
  "restart-per-page",
]);

/** Valid `format` literals (mirrors `CounterFormat`). */
const VALID_FORMATS: ReadonlySet<CounterFormat> = new Set<CounterFormat>([
  "decimal",
  "lower-roman",
  "upper-roman",
  "lower-alpha",
  "upper-alpha",
  "symbol",
]);

/**
 * Validate a `reset` value against the closed set of literals. Exported so the
 * `SET_FOOTNOTE_POLICY` editor action validates the same way render does — an
 * invalid value is ignored rather than written as an unrecognized attr.
 */
export function isValidFootnoteReset(
  value: unknown,
): value is FootnoteNumberingPolicy["reset"] {
  return (
    typeof value === "string" &&
    VALID_RESETS.has(value as FootnoteNumberingPolicy["reset"])
  );
}

/**
 * Validate a `format` value against the closed set of `CounterFormat` literals.
 * Exported for the `SET_FOOTNOTE_POLICY` editor action (see
 * `isValidFootnoteReset`).
 */
export function isValidFootnoteFormat(value: unknown): value is CounterFormat {
  return typeof value === "string" && VALID_FORMATS.has(value as CounterFormat);
}

/**
 * Read the document-wide footnote numbering policy from the root block's raw
 * attrs. Each field is validated independently; an absent/invalid value falls
 * back to the corresponding `DEFAULT_FOOTNOTE_NUMBERING_POLICY` field.
 */
export function documentFootnotePolicy(state: State): FootnoteNumberingPolicy {
  const root = getBlock(state, state.rootId);
  const attrs = root?.attrs;
  if (attrs === undefined) {
    return DEFAULT_FOOTNOTE_NUMBERING_POLICY;
  }
  const resetRaw = attrs["footnoteNumberingReset"];
  const formatRaw = attrs["footnoteNumberingFormat"];
  return {
    reset: isValidFootnoteReset(resetRaw)
      ? resetRaw
      : DEFAULT_FOOTNOTE_NUMBERING_POLICY.reset,
    format: isValidFootnoteFormat(formatRaw)
      ? formatRaw
      : DEFAULT_FOOTNOTE_NUMBERING_POLICY.format,
  };
}
