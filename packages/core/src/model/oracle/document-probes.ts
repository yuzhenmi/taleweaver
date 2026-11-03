import { unitsOf } from "../position/items";
import { isParagraphBreak, isSectionBreak } from "../scan/kinds";
import { type Token, roleOf } from "../scan/tokens";
import type { MarkRole } from "../storage/table-marks";
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
 * flow ends in a ¶ (A1); tables by their faces: balanced brackets, `⟦ ⟨r⟩ ⟨c⟩` in order, a paragraph in every cell
 * and after a `⟧` (as after any block object; a cell end is a flow end). Agrees with `firingsOf`.
 */
export function wellFormed(fs: FlowState): boolean {
  if (fs.synthetic) return false;
  // What the last terminator left open: the flow / a cell start, a ¶, a block object (a TOC, or a table seen from
  // after its `⟧`), `[S]`, or a table / row start awaiting its `⟨r⟩` / `⟨c⟩` (design §1 faces).
  let left: "start" | "afterPara" | "afterObject" | "afterSection" | "inCell" | MarkRole = "start";
  let run = false;
  let open = 0;
  let last: Token["k"] | null = null;
  for (const seg of fs.segments) {
    for (const t of seg.tokens) {
      if (t.k === "run" && t.len === t.inert.length) continue;
      last = t.k;
      const awaiting = left === "newRow" || left === "newCell";
      if (t.k === "run") {
        if (awaiting) return false; // a table / row lead (F2)
        run = true;
        continue;
      }
      if (isParagraphBreak(t.k)) {
        if (awaiting) return false;
        left = "afterPara";
        run = false;
        continue;
      }
      // Debris before any other terminator; a block object followed by anything but a ¶ / text (W2).
      if (run || left === "afterObject") return false;
      const role = roleOf(t);
      if (role !== null) {
        // After `⟦` a `⟨r⟩`, after `⟨r⟩` a `⟨c⟩`; a cell holds a paragraph (or a table) before its container ends.
        if (awaiting ? role !== left : left === "inCell" && role !== "open") return false;
        open += role === "open" ? 1 : role === "close" ? -1 : 0;
        if (open < 0 || (open === 0 && role !== "open" && role !== "close")) return false;
        left = role === "close" ? "afterObject" : role === "newCell" ? "inCell" : role === "open" ? "newRow" : "newCell";
      } else if (isSectionBreak(t.k)) {
        if (left !== "afterPara") return false;
        left = "afterSection";
      } else {
        if (awaiting) return false;
        left = "afterObject";
      }
    }
  }
  return open === 0 && (last === null || isParagraphBreak(last));
}
