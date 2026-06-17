import type { TextTransform } from "../styles/style";

// Re-export the canonical `TextTransform` (defined in `styles/style.ts`, the
// lower layer) so existing importers of `layout/text-transform`'s
// `TextTransform` keep working without a wrong-direction styles→layout import.
export type { TextTransform };

/**
 * Transform one run's text per `mode`. Returns the display string + per SOURCE
 * code unit (UTF-16 — index-aligned with state offsets / `sourceLength`) the
 * count of display code units it produced. `mode === "none"` is never called.
 */
export function transformRun(
  text: string,
  mode: Exclude<TextTransform, "none">,
): { display: string; sourceDisplayLengths: readonly number[] } {
  const lengths: number[] = [];
  let display = "";
  let atWordStart = true; // capitalize: run start is a word boundary
  for (let i = 0; i < text.length; i++) {
    // `i < text.length` guarantees `text[i]` is present; the `?? ""` is a
    // provably-unreachable default that preserves the prior (non-undefined)
    // single-code-unit read exactly. (Surrogate pairs were already iterated
    // per UTF-16 code unit before this migration — behavior unchanged.)
    const ch = text[i] ?? "";
    let out: string;
    if (mode === "uppercase") out = ch.toUpperCase();
    else if (mode === "lowercase") out = ch.toLowerCase();
    else {
      // capitalize: uppercase the first cased char after a boundary; else unchanged.
      const isSpace = /\s/.test(ch);
      const isCased = ch.toLowerCase() !== ch.toUpperCase();
      if (atWordStart && isCased) { out = ch.toUpperCase(); atWordStart = false; }
      else { out = ch; if (isSpace) atWordStart = true; }
    }
    display += out;
    lengths.push(out.length);
  }
  return { display, sourceDisplayLengths: lengths };
}
