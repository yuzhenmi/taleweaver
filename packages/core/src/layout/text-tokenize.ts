import type { WhiteSpace } from "../styles";

/**
 * Split a string into tokens (words and inter-word spaces) according to white-space mode.
 * Plan 1 supports only "normal". Plans 2+ add nowrap, pre, pre-wrap, pre-line.
 */
export function tokenize(text: string, whiteSpace: WhiteSpace): string[] {
  switch (whiteSpace) {
    case "normal": {
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
    default:
      throw new Error(`whiteSpace mode "${whiteSpace}" not yet implemented`);
  }
}
