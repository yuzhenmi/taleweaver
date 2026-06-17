import type { WhiteSpace } from "../styles";

/** Unicode LINE SEPARATOR — sentinel emitted by the tokenizer for forced line breaks (whiteSpace: pre/pre-wrap/pre-line). */
export const LINE_BREAK = " ";

/**
 * UAX #14 MANDATORY line-break characters (LB4 + LB5). The set is a superset
 * of `\n` (LF): it also forces a break at VERTICAL TABULATION (U+000B), FORM
 * FEED (U+000C), CARRIAGE RETURN (U+000D), NEXT LINE (U+0085), LINE SEPARATOR
 * (U+2028), and PARAGRAPH SEPARATOR (U+2029). A CRLF pair (U+000D U+000A) is a
 * single break per LB5; the alternation matches `\r\n` first so it collapses
 * to one break rather than two. The `pre`/`pre-wrap`/`pre-line` branches split
 * on this set (each match becomes one LINE_BREAK sentinel) instead of bare
 * `\n`. Used only with `String.prototype.split` (which is stateless and
 * ignores any flags), so no `g` flag is needed — and omitting it avoids a
 * stateful-`lastIndex` footgun if this regex is ever reused with `.test()`.
 */
const MANDATORY_BREAK_RE = /\r\n|[\n\u000B\u000C\r\u0085\u2028\u2029]/;

/**
 * Split a string into tokens (words and inter-word spaces) according to white-space mode.
 * Plan 1 supports only "normal". Plans 2+ add nowrap, pre, pre-wrap, pre-line,
 * and break-spaces (which reuses the pre-wrap tokenization).
 */
export function tokenize(text: string, whiteSpace: WhiteSpace): string[] {
  if (text === "") return [];
  switch (whiteSpace) {
    case "normal":
    case "nowrap": {
      const trimmed = text.trim();
      if (trimmed === "") {
        // All-whitespace input: emit one space token per character so
        // the state-model offset (text.length) advances over the input.
        // Without this, cursor positions past the whitespace fall past
        // the line and get clamped to the line start.
        return text.length === 0 ? [] : Array(text.length).fill(" ");
      }
      const out: string[] = [];
      // Emit ONE space token per LEADING-whitespace character (#308).
      // Symmetric with the trailing-space handling below; without this, source
      // offsets in [0, matchStart-of-first-word) are owned by no token and the
      // IFC's per-line offset cursor (`cursorOffset` in ifc.ts) never advances
      // over them. User-perceived symptom: caret at offsets 0..N-1 of "   word"
      // falls past the line's `inlineOffsetEnd` and clamps; ArrowRight from
      // offset 0 hops directly to offset N (the first word char) instead of
      // walking the spaces one by one.
      //
      // Visual collapse of these tokens at line/segment start is handled by the
      // IFC unit grouper (the leading/orphan-space branch emits them as
      // ZERO-WIDTH wrap units under collapsing white-space, so they render
      // invisibly but advance the offset cursor). Preserving the tokens here
      // only fixes the OFFSET alignment.
      let leadingCount = 0;
      // `i < text.length` guards each `text[i]`; the loop stops at the first
      // non-present index, so the read is always defined (`?? ""` is an
      // unreachable, behavior-preserving default — `/\s/.test("")` is false,
      // matching a bounds exit).
      for (let i = 0; i < text.length && /\s/.test(text[i] ?? ""); i++) {
        leadingCount++;
      }
      for (let i = 0; i < leadingCount; i++) out.push(" ");

      const parts = trimmed.split(/\s+/);
      // `String.prototype.split` returns a dense array; every `i < parts.length`
      // index is present. Iterating values directly removes the index read.
      for (const [i, part] of parts.entries()) {
        out.push(part);
        if (i < parts.length - 1) out.push(" ");
      }
      // Preserve one trailing-whitespace token PER trailing-whitespace
      // character. Without this, text "abc " would tokenize to ["abc"]
      // only — the trailing space's character offset would never
      // advance the IFC's per-line offset cursor, and
      // `line.inlineOffsetEnd` would stop at 3 instead of 4. Cursor
      // at offset 4 (after the typed space) would then fall past the
      // line and render at x=24 (after "c") rather than x=32 (after
      // "abc " including the space). User-perceived symptom: cursor
      // "stuck" after pressing space.
      //
      // We emit ONE token per trailing-whitespace character (not a
      // single collapsed " " token) so that N consecutive trailing
      // spaces produce N offset units. Otherwise typing space twice
      // hits the same clamp at offset 5.
      //
      // Visual collapse of trailing whitespace at line-end is a
      // separate concern handled by the IFC wrap pass; preserving
      // these tokens here only fixes the OFFSET alignment.
      let trailingCount = 0;
      // `i >= 0 && i <= text.length-1` guards each `text[i]`; `?? ""` is an
      // unreachable, behavior-preserving default (`/\s/.test("")` is false).
      for (let i = text.length - 1; i >= 0 && /\s/.test(text[i] ?? ""); i--) {
        trailingCount++;
      }
      for (let i = 0; i < trailingCount; i++) out.push(" ");
      return out;
    }
    case "pre": {
      // Preserve all whitespace. Split on \n, emit LINE_BREAK between segments.
      const segments = text.split(MANDATORY_BREAK_RE);
      const out: string[] = [];
      // `split` yields a dense array; iterate values to drop the index read.
      for (const [i, segment] of segments.entries()) {
        out.push(segment);
        if (i < segments.length - 1) out.push(LINE_BREAK);
      }
      return out;
    }
    case "pre-wrap":
    // `break-spaces` shares the `pre-wrap` tokenization exactly: word tokens +
    // one normalized " " token per whitespace char, with LINE_BREAK between
    // `\n` segments. The two modes differ only in the IFC wrap-unit grouper —
    // `break-spaces` emits ONE wrap unit per space token (so a run of preserved
    // spaces can wrap across lines) rather than slurping spaces into the
    // preceding word's unit. The offset model (1 state char per space,
    // sourceLength 1) is identical, so no tokenizer divergence is needed.
    case "break-spaces": {
      // Preserve every space (leading, interior, trailing) while still
      // producing word/space tokens the IFC can wrap at word boundaries.
      // Split on \n into segments, emitting LINE_BREAK between them; within
      // each segment, accumulate maximal non-whitespace runs into word
      // tokens and emit ONE normalized " " token per whitespace char.
      // For INTERIOR single spaces with no leading/trailing whitespace
      // (e.g. "a b") this matches the `normal` branch's output exactly, so
      // such fixtures are unaffected; but unlike `normal`, this branch
      // PRESERVES leading/trailing whitespace that `normal` would trim and
      // does NOT collapse runs of interior whitespace (each char becomes its
      // own " " token, e.g. " a" → [" ","a"] vs normal ["a"]). (Tab/NBSP
      // width fidelity is out of scope for Phase 1.)
      const segments = text.split(MANDATORY_BREAK_RE);
      const out: string[] = [];
      // `split` yields a dense array; iterate values to drop the index read.
      for (const [i, segment] of segments.entries()) {
        let word = "";
        for (let c = 0; c < segment.length; c++) {
          // `c < segment.length` guards `segment[c]`; `?? ""` is an unreachable,
          // behavior-preserving default (`/\s/.test("")` is false).
          const ch = segment[c] ?? "";
          if (/\s/.test(ch)) {
            if (word !== "") {
              out.push(word);
              word = "";
            }
            out.push(" ");
          } else {
            word += ch;
          }
        }
        if (word !== "") out.push(word);
        if (i < segments.length - 1) out.push(LINE_BREAK);
      }
      return out;
    }
    case "pre-line": {
      // Per-line: collapse whitespace within each line, separate lines by LINE_BREAK.
      const lines = text.split(MANDATORY_BREAK_RE);
      const out: string[] = [];
      // `split` yields a dense array; iterate values to drop the index read.
      for (const [li, line] of lines.entries()) {
        const trimmed = line.trim();
        // First-line leading whitespace (#366 / #308-part-2): the IFC's
        // second-pass lookahead in `collectInlineTokens` absorbs the leading
        // whitespace of NON-first line segments into the preceding LINE_BREAK
        // token's `sourceLength` (LINE_BREAK.sourceLength = next.matchStart -
        // LINE_BREAK.matchStart absorbs `\n` + the following leading-ws chars).
        // Only the very FIRST line lacks a preceding LINE_BREAK and thus
        // strands those source offsets. Emit one orphan " " token per leading
        // whitespace char on the first line — symmetric with the
        // `normal`/`nowrap` γ fix at the top of this function. The IFC
        // grouper's collapsing-mode arm then renders each as a zero-width unit
        // (no visible glyph) while `cursorOffset` advances over the source.
        if (li === 0) {
          // `c < line.length` guards `line[c]`; `?? ""` is an unreachable,
          // behavior-preserving default (`/\s/.test("")` is false).
          for (let c = 0; c < line.length && /\s/.test(line[c] ?? ""); c++) {
            out.push(" ");
          }
        }
        if (trimmed !== "") {
          const parts = trimmed.split(/\s+/);
          // `split` yields a dense array; iterate values to drop the index read.
          for (const [i, part] of parts.entries()) {
            out.push(part);
            if (i < parts.length - 1) out.push(" ");
          }
        }
        if (li < lines.length - 1) out.push(LINE_BREAK);
      }
      return out;
    }
    default:
      throw new Error(`whiteSpace mode "${whiteSpace}" not yet implemented`);
  }
}
