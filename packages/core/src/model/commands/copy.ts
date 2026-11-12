import { isCellSelection, isObjectSelection } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import type { FragmentItem } from "./helpers/fragment";
import { readSlice } from "./helpers/read-slice";

/**
 * Copy: the selection as a fragment, the inverse of paste (pasting `copy(sel)` over `sel` reads the same, modulo
 * anchors). Null for a caret or a range holding nothing that reads (an empty paragraph). Object and cell selections are
 * C2 / C3.
 */
export function copy(ctx: CommandContext): FragmentItem[] | null {
  if (isObjectSelection(ctx.selection) || isCellSelection(ctx.selection)) return null;
  const r = rangeOf(ctx);
  const items = r === null || r.collapsed ? null : readSlice(ctx.version, r);
  return items === null || items.length === 0 ? null : items;
}
