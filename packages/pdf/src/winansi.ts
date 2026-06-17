/**
 * WinAnsiEncoding (= Windows-1252): one byte per character for the standard-14
 * simple fonts (Helvetica/Times/Courier). Three covered ranges, all rendered by
 * the standard-14 fonts with NO embedding:
 *  - 0x20–0x7E (ASCII) and 0xA0–0xFF (Latin-1 supplement): the WinAnsi byte
 *    equals the Unicode codepoint (these ranges match ISO-8859-1).
 *  - the printable 0x80–0x9F block: common typographic punctuation whose Unicode
 *    codepoints fall OUTSIDE 0xA0–0xFF — smart quotes, en/em dashes, ellipsis,
 *    bullet, Euro, trademark, etc. Word processors auto-substitute these on
 *    nearly every line, so they are mapped via {@link WIN1252_HIGH} rather than
 *    dropped.
 * Any codepoint outside all three ranges (CJK, Arabic, emoji, …) maps to '?'
 * (0x3F) and is counted in `dropped`. Full Unicode coverage for those scripts is
 * the embedded-font path (phase c).
 */
const QUESTION = 0x3f;

/**
 * Unicode codepoint → WinAnsi byte for the printable 0x80–0x9F block. The five
 * undefined Windows-1252 slots (0x81, 0x8D, 0x8F, 0x90, 0x9D) have no glyph and
 * are intentionally absent (a codepoint that would map to one falls through to
 * the '?' replacement).
 */
const WIN1252_HIGH: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // € euro
  [0x201a, 0x82], // ‚ single low quote
  [0x0192, 0x83], // ƒ florin
  [0x201e, 0x84], // „ double low quote
  [0x2026, 0x85], // … ellipsis
  [0x2020, 0x86], // † dagger
  [0x2021, 0x87], // ‡ double dagger
  [0x02c6, 0x88], // ˆ modifier circumflex
  [0x2030, 0x89], // ‰ per mille
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹ single left guillemet
  [0x0152, 0x8c], // Œ ligature
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ' left single quote
  [0x2019, 0x92], // ' right single quote (curly apostrophe)
  [0x201c, 0x93], // " left double quote
  [0x201d, 0x94], // " right double quote
  [0x2022, 0x95], // • bullet
  [0x2013, 0x96], // – en dash
  [0x2014, 0x97], // — em dash
  [0x02dc, 0x98], // ˜ small tilde
  [0x2122, 0x99], // ™ trademark
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // › single right guillemet
  [0x0153, 0x9c], // œ ligature
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

export interface WinAnsiResult {
  readonly bytes: Uint8Array;
  /** Count of codepoints that fell outside WinAnsi coverage (mapped to '?'). */
  readonly dropped: number;
}

export function encodeWinAnsi(text: string): WinAnsiResult {
  const out: number[] = [];
  let dropped = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? QUESTION;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) {
      out.push(cp);
      continue;
    }
    const high = WIN1252_HIGH.get(cp);
    if (high !== undefined) {
      out.push(high);
      continue;
    }
    out.push(QUESTION);
    dropped++;
  }
  return { bytes: Uint8Array.from(out), dropped };
}
