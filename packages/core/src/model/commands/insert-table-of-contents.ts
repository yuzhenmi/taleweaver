import type * as Y from "yjs";
import type { InsertUnit, Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { pointAfter } from "../position/storage-points";
import { newParagraphMark, newTableOfContents } from "../storage/new-items";
import type { Scalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { atOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { inMainTree } from "./helpers/in-main-tree";
import { splitWrites } from "./helpers/split-writes";
import { checkKeys } from "./helpers/validate";
import { insertAt } from "./helpers/writes";

/** Insert block object `obj` at the focus (C14's placement): k > 0 splits (C2 keys) and puts it before the tail; k = 0 puts it before the paragraph, after a ¶M when the item before is a block object. Caret: the tail's start. */
function insertBlockAt(ctx: CommandContext, obj: Y.Map<unknown>): Plan | null {
  // At the selection's focus, as today (no range delete).
  const at = atOf(ctx, ctx.selection.focus);
  if (at === null || !inMainTree(at)) return null;
  const point = { start: at, end: at, collapsed: true };
  if (at.offset > 0) {
    const s = splitWrites(ctx, point, [{ embed: obj, attrs: {} }]);
    if (s === null) return null;
    return plan(ctx.version, s.writes, () => caretAt(s.tail(), 0));
  }
  const head = pointAfter(at.L, 0);
  if (head === null) return null;
  const units: InsertUnit[] = at.L.before?.token.k === "toc" ? [{ embed: newParagraphMark(), attrs: {} }] : [];
  units.push({ embed: obj, attrs: {} });
  const id = at.L.block.id;
  return plan(ctx.version, [insertAt(head, units)], () => caretAt(id, 0));
}

/** C14: insert a table of contents (`options` → `a:*`) at the focus. */
export function insertTableOfContents(ctx: CommandContext, options: Readonly<Record<string, Scalar>> = {}): Plan | null {
  const keys: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(options)) keys[`a:${k}`] = v;
  return insertBlockAt(ctx, newTableOfContents(checkKeys(keys, ["a:"], "TOC")));
}
