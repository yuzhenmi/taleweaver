import type { Plan } from "../plan";
import { newLineBreak } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { insertItem } from "./helpers/insert-item";

/** Shift+Enter: a line break (an inline atom; no ¶, no paragraph attrs) at the caret, over the selection (today's `INSERT_LINE_BREAK`). Caret: after it. */
export function insertLineBreak(ctx: CommandContext): Plan | null {
  return insertItem(ctx, "lineBreak", newLineBreak);
}
