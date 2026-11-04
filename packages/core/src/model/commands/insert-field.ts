import type { Plan } from "../plan";
import { newField } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { overSelection } from "./helpers/over-object";
import { canPlace } from "./helpers/placement";
import { replaceSelection } from "./helpers/replace-selection";
import { validField } from "./helpers/validate";

/**
 * A page field (`page-number` / `page-count`, `numberStyle` default decimal) at the
 * caret, over the selection (today's `INSERT_PAGE_NUMBER` / `INSERT_PAGE_COUNT`).
 * Placement: headers / footers only, as today; elsewhere a no-op. Caret: after it.
 */
export function insertField(ctx: CommandContext, field: string, numberStyle = "decimal"): Plan | null {
  validField(field, numberStyle);
  return overSelection(ctx, (c) => {
    const r = rangeOf(c);
    if (r === null || !canPlace(c.version, "field", r.start)) return null;
    return replaceSelection(c, (attrs) => [{ embed: newField(field, numberStyle), attrs }]);
  });
}
