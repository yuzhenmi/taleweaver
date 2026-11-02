import type { BlockId } from "../block";
import type { InsertUnit, Plan, Write } from "../plan";
import { caretAt } from "../position/model-position";
import { pointAfter } from "../position/storage-points";
import { typeId } from "../storage/item-id";
import { newHorizontalRule, newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { atOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { inMainTree } from "./helpers/in-main-tree";
import { diffKeys, keysOf } from "./helpers/paragraph-keys";
import { insertAt, keysWrite, materialize } from "./helpers/writes";

// ---------------------------------------------------------------------------
// C13 horizontal rule (G1: Enter's shape), C14 TOC, C10 block-object delete
// ---------------------------------------------------------------------------

/**
 * C13 with review-r7 G1's shape: before the focus paragraph P's ¶ insert ¶N (a copy
 * of P's keys), `[hr]`, ¶M — `x¶N [hr]¶M ¶P` — and clear ¶P's keys, so the derived
 * result is today's: P's text, a rule paragraph, then an empty Normal paragraph with
 * the caret at its start. Every insert is at or before the flow's final ¶ (A1).
 * Debris P gets its ¶ (X2). Applied directly in suggest mode too (G2).
 */
export function insertHorizontalRule(ctx: CommandContext): Plan | null {
  // Today's shape: at the selection's focus paragraph (no split, no range delete).
  const focus = atOf(ctx, ctx.selection.focus);
  if (focus === null || !inMainTree(focus)) return null;
  const L = focus.L;
  const p = pointAfter(L, L.length);
  if (p === null) return null;
  const units: InsertUnit[] = [{ embed: newParagraphMark(keysOf(L)), attrs: {} }, { embed: newHorizontalRule(), attrs: {} }, { embed: newParagraphMark(), attrs: {} }];
  const writes: Write[] = [];
  let caretId: () => BlockId;
  if (L.mark !== null) {
    writes.push(insertAt(p, units), ...keysWrite(L.mark, diffKeys(keysOf(L), {})));
    const id = L.block.id;
    caretId = () => id;
  } else {
    const m = materialize(L, {}, units);
    if (m === null) return null;
    writes.push(...m.writes);
    const fallback = L.block.id;
    caretId = () => typeId(m.map) ?? fallback;
  }
  return plan(ctx.version, writes, () => caretAt(caretId(), 0));
}
