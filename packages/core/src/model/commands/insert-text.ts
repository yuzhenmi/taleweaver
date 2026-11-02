import type { ReadonlyAttrs } from "../block";
import type { Plan } from "../plan";
import type { CommandContext } from "./command-context";
import { replaceSelection } from "./helpers/replace-selection";
import { checkScalars } from "./helpers/validate";

/** C1: type `text` (with `attrs`, default the typing attrs) over the selection. */
export function insertText(ctx: CommandContext, text: string, attrs?: ReadonlyAttrs): Plan | null {
  if (text === "") return null;
  const exact = attrs === undefined ? undefined : checkScalars(attrs, "text attr");
  return replaceSelection(ctx, (typing) => [{ text, attrs: exact ?? typing }]);
}
