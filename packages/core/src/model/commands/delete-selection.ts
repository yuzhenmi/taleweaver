import type { Plan } from "../plan";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { deleteSelectionOf } from "./helpers/delete-range";

/** C9: delete the selection (cut / type-over without text). */
export function deleteSelection(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || r.collapsed) return null;
  return deleteSelectionOf(ctx, r);
}
