/**
 * Inert table marks (RT1) in a flow's segments: each becomes an INERT unit of a run
 * (storage that reads as nothing, as an inert embed does), merged with the runs around
 * it. Whether a mark is inert depends on the marks before it, so the context-free scan
 * cannot tell; after this, every position walker reads the segments as the records do.
 */
import type { BlockId } from "../../block";
import type { RunToken, Segment, Token } from "../../scan/tokens";

function merged(tokens: readonly Token[], inert: ReadonlySet<BlockId>): Token[] {
  const out: Token[] = [];
  let run: { len: number; items: RunToken["items"][number][]; footnotes: RunToken["footnotes"][number][]; inert: number[]; marks: boolean } | null = null;
  const flush = (): void => {
    if (run !== null) out.push({ k: "run", len: run.len, items: run.items, footnotes: run.footnotes, inert: run.inert, ...(run.marks ? { foldedMarks: true as const } : {}) });
    run = null;
  };
  for (const t of tokens) {
    const mark = t.k !== "run" && inert.has(t.id);
    if (t.k !== "run" && !mark) {
      flush();
      out.push(t);
      continue;
    }
    run ??= { len: 0, items: [], footnotes: [], inert: [], marks: false };
    if (t.k === "run") {
      if (t.foldedMarks === true) run.marks = true;
      for (const i of t.inert) run.inert.push(run.len + i);
      run.items.push(...t.items);
      run.footnotes.push(...t.footnotes);
    } else {
      run.marks = true;
      for (let i = 0; i < t.len; i++) run.inert.push(run.len + i);
    }
    run.len += t.len;
  }
  flush();
  return out;
}

/** `segments` with the marks `inert` read as inert run units (segments holding none are kept as they are). */
export function withInertMarks(segments: readonly Segment[], inert: ReadonlySet<BlockId>): Segment[] {
  if (inert.size === 0) return segments.slice();
  return segments.map((s) => (s.tokens.some((t) => t.k !== "run" && inert.has(t.id)) ? { ...s, tokens: merged(s.tokens, inert) } : s));
}
