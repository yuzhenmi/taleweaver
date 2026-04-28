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
      if (trimmed === "") return [];
      const out: string[] = [];
      const parts = trimmed.split(/\s+/);
      for (let i = 0; i < parts.length; i++) {
        out.push(parts[i]);
        if (i < parts.length - 1) out.push(" ");
      }
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
    default:
      throw new Error(`whiteSpace mode "${whiteSpace}" not yet implemented`);
  }
}
