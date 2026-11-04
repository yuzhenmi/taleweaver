import type { Plan } from "../plan";
import { isObjectSelection } from "../position/model-position";
import type { CommandContext } from "./command-context";
import { deleteBlockObject } from "./delete-block-object";
import { rangeOf } from "./helpers/at";
import { deleteSelectionOf } from "./helpers/delete-range";

/** C9: delete the selection (cut / type-over without text); an object selection's object (C10). */
export function deleteSelection(ctx: CommandContext): Plan | null {
  if (isObjectSelection(ctx.selection)) return deleteBlockObject(ctx, ctx.selection.object); // C10
  const r = rangeOf(ctx);
  if (r === null || r.collapsed) return null;
  return deleteSelectionOf(ctx, r);
}
