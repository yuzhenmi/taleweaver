import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { typeId } from "../storage/item-id";
import { newFootnote, newParagraphMark } from "../storage/new-items";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { overSelection } from "./helpers/over-object";
import { canPlace } from "./helpers/placement";
import { replaceSelection } from "./helpers/replace-selection";

// ---------------------------------------------------------------------------
// S1 footnote, S2 header / footer
// ---------------------------------------------------------------------------

/** S1: insert a footnote anchor at the caret (over the selection); its body holds one ¶; the caret goes into the body. */
export function insertFootnote(ctx: CommandContext): Plan | null {
  return overSelection(ctx, (c) => {
    const r = rangeOf(c);
    if (r === null || !canPlace(c.version, "footnote", r.start)) return null;
    const mark = newParagraphMark();
    return replaceSelection(
      c,
      (attrs) => [{ embed: newFootnote(mark), attrs }],
      () => {
        const id = typeId(mark);
        return id === null ? null : caretAt(id, 0);
      },
    );
  });
}
