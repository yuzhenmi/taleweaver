import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { isListItem, listExit } from "./helpers/list-exit";
import { overSelection } from "./helpers/over-object";
import { splitWrites } from "./helpers/split-writes";

/**
 * C2 Enter. A range is deleted first (an object selection's object: the split is at the start of the paragraph after it). On an empty list item it exits the list (today).
 * Caret: the start of the tail, which keeps the paragraph's ¶ and id.
 * E2 (Enter at the start of a leading table's first cell) is P2: tables are not in the model yet.
 */
export function splitParagraph(ctx: CommandContext): Plan | null {
  return overSelection(ctx, split);
}

function split(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null) return null;
  if (r.collapsed && isListItem(r.start.L.block) && r.start.L.length === 0) return listExit(ctx, r.start.L, ctx.selection);
  const s = splitWrites(ctx, r);
  if (s === null) return null;
  return plan(ctx.version, s.writes, () => caretAt(s.tail(), 0));
}
