import type { Plan } from "../plan";
import { newHorizontalRule } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { insertItem } from "./helpers/insert-item";

/** C13: a horizontal rule over the selection, in a paragraph of its own (G1: Enter's shape; `insertItem`). */
export function insertHorizontalRule(ctx: CommandContext): Plan | null {
  return insertItem(ctx, "hr", newHorizontalRule);
}
