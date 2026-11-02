import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { typeId } from "../storage/item-id";
import { newFootnote, newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { inMainTree } from "./helpers/in-main-tree";
import { replaceSelection } from "./helpers/replace-selection";

// ---------------------------------------------------------------------------
// S1 footnote, S2 header / footer
// ---------------------------------------------------------------------------

/** S1: insert a footnote anchor at the caret (over the selection); its body holds one ¶; the caret goes into the body. */
export function insertFootnote(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || !inMainTree(r.start)) return null;
  const mark = newParagraphMark();
  return replaceSelection(
    ctx,
    (attrs) => [{ embed: newFootnote(mark), attrs }],
    () => {
      const id = typeId(mark);
      return id === null ? null : caretAt(id, 0);
    },
  );
}
