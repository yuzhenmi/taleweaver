/**
 * Detect scripts that need contextual shaping (Arabic and related scripts).
 *
 * The canvas backend can delegate shaping to the browser by drawing/measuring
 * the WHOLE run once. That path is critical for scripts whose glyph forms
 * depend on neighbors (initial/medial/final forms, lam-alef ligatures, etc.).
 */
const COMPLEX_SCRIPT_RE: RegExp = (() => {
  try {
    // Prefer Unicode property escapes when available.
    return new RegExp(
      [
        "\\p{Script=Arabic}",
        "\\p{Script=Syriac}",
        "\\p{Script=Thaana}",
        "\\p{Script=Nko}",
        "\\p{Script=Mandaic}",
      ].join("|"),
      "u",
    );
  } catch {
    // Fallback ranges for older engines.
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  }
})();

/** True when text should be shaped as a single run to preserve contextual forms. */
export function needsNativeComplexShaping(text: string): boolean {
  return COMPLEX_SCRIPT_RE.test(text);
}
