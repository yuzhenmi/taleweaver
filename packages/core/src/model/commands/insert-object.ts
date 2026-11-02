import type { Plan } from "../plan";
import { type ObjectProps, newObject } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { replaceSelection } from "./helpers/replace-selection";
import { validObject } from "./helpers/validate";

// ---------------------------------------------------------------------------
// C11 / C12 inline objects
// ---------------------------------------------------------------------------

/** C11: insert an inline object (an image: kind "image", `props.src`) at the caret, over the selection; inline (no `wrap`), as GDocs Insert ▸ Image. */
export function insertObject(ctx: CommandContext, kind: string, o: Omit<ObjectProps, "wrap"> = {}): Plan | null {
  validObject(ctx, kind, o);
  return replaceSelection(ctx, (attrs) => [{ embed: newObject(kind, o), attrs }]);
}
