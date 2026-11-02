import { unitsOf } from "../position/items";
import { isBlockObject, isParagraphBreak, isSectionBreak, isStructural } from "../scan/kinds";
import type { Token } from "../scan/tokens";
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
  for (const i of d.trees.block.get(id)?.inlineContent?.items ?? d.trees.embedContent.get(id)?.inlineContent?.items ?? d.trees.templateContent.get(id)?.inlineContent?.items ?? []) n += unitsOf(i);
  return n;
}

/**
 * O5(a) subset / O7 on one flow's tokens, as the model reads them: not synthetic (R17),
 * no debris (R2), a ¶ before every `[S]` (A2), only a paragraph after a block object (W2), the
 * flow ends in a ¶ (A1).
 */
export function wellFormed(fs: FlowState): boolean {
  const seq: (Token["k"])[] = [];
  for (const seg of fs.segments) for (const t of seg.tokens) if (t.k !== "run" || t.len > t.inert.length) seq.push(t.k);
  if (fs.synthetic || (seq.length > 0 && !isParagraphBreak(seq[seq.length - 1]))) return false;
  return seq.every((k, i) => {
    const prev = seq[i - 1];
    if (isStructural(k) && prev === "run") return false;
    if (isSectionBreak(k) && !isParagraphBreak(prev)) return false;
    return !(isBlockObject(prev) && !isParagraphBreak(k) && k !== "run");
  });
}
