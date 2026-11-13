import type { ReadonlyAttrs } from "../block";
import type { Plan } from "../plan";
import type { CommandContext } from "./command-context";
import { clearCells } from "./table/clear-cells";
import { cellsRect } from "./table/cell-rect";
import { replaceSelection } from "./helpers/replace-selection";
import { checkScalars } from "./helpers/validate";

/** C1: type `text` (with `attrs`, default the typing attrs) over the selection. */
export function insertText(ctx: CommandContext, text: string, attrs?: ReadonlyAttrs): Plan | null {
  if (text === "") return null;
  const exact = attrs === undefined ? undefined : checkScalars(attrs, "text attr");
  const cells = cellsRect(ctx);
  if (cells !== null) return clearCells(ctx, cells, (c) => insertText(c, text, exact)); // N7 (GDocs): clear, type into the first
  return replaceSelection(ctx, (typing) => [{ text, attrs: exact ?? typing }]);
}
