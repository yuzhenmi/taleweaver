import type { WhiteSpace } from "../styles";

/** Unicode LINE SEPARATOR — sentinel emitted by the tokenizer for forced line breaks (whiteSpace: pre/pre-wrap/pre-line). */
export const LINE_BREAK = " ";

/**
 * Split a string into tokens (words and inter-word spaces) according to white-space mode.
 * Plan 1 supports only "normal". Plans 2+ add nowrap, pre, pre-wrap, pre-line.
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
      const parts = trimmed.split(/\s+/);
      for (let i = 0; i < parts.length; i++) {
        out.push(parts[i]);
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
      for (let i = text.length - 1; i >= 0 && /\s/.test(text[i]); i--) {
        trailingCount++;
      }
      for (let i = 0; i < trailingCount; i++) out.push(" ");
      return out;
    }
    case "pre": {
      // Preserve all whitespace. Split on \n, emit LINE_BREAK between segments.
      const segments = text.split("\n");
      const out: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        out.push(segments[i]);
        if (i < segments.length - 1) out.push(LINE_BREAK);
      }
      return out;
    }
    case "pre-wrap": {
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
      const segments = text.split("\n");
      const out: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        let word = "";
        for (let c = 0; c < segment.length; c++) {
          const ch = segment[c];
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
      const lines = text.split("\n");
      const out: string[] = [];
      for (let li = 0; li < lines.length; li++) {
        const trimmed = lines[li].trim();
        if (trimmed !== "") {
          const parts = trimmed.split(/\s+/);
          for (let i = 0; i < parts.length; i++) {
            out.push(parts[i]);
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
