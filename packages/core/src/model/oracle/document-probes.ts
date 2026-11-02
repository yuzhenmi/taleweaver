import type { Document, FlowState, TreeKind } from "../document/types";

export function paragraphIds(d: Document): string[] {
  const out: string[] = [];
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    for (const [id, b] of d.trees[tree].entries()) if (b.inlineContent !== null) out.push(id);
  }
  return out.sort();
}

export function lengthOf(d: Document, id: string): number {
  let n = 0;
  for (const i of d.trees.block.get(id)?.inlineContent?.items ?? d.trees.embedContent.get(id)?.inlineContent?.items ?? d.trees.templateContent.get(id)?.inlineContent?.items ?? []) n += i.kind === "text" ? i.text.length : 1;
  return n;
}

/**
 * O5(a) subset / O7 on one flow's tokens, as the model reads them: not synthetic (R17),
 * no debris (R2), a ¶ before every `[S]` (A2), only a paragraph after a TOC (W2), the
 * flow ends in a ¶ (A1).
 */
export function wellFormed(fs: FlowState): boolean {
  const seq: string[] = [];
  for (const seg of fs.segments) for (const t of seg.tokens) if (t.k !== "run" || t.len > t.inert.length) seq.push(t.k);
  if (fs.synthetic || (seq.length > 0 && seq[seq.length - 1] !== "para")) return false;
  return seq.every((k, i) => {
    const prev = seq[i - 1];
    if ((k === "toc" || k === "S") && prev === "run") return false;
    if (k === "S" && prev !== "para") return false;
    return !(prev === "toc" && k !== "para" && k !== "run");
  });
}
