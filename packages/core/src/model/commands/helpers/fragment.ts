import type { ReadonlyAttrs } from "../../block";
import { type InsertUnit, chunked } from "../../plan";
import { type ObjectProps, newFootnoteOf, newHorizontalRule, newObject, newParagraphMark, newSectionBreak, newTableOfContents } from "../../storage/new-items";
import type { FlatKeys } from "../../storage/scalar";
import type { CommandContext } from "../command-context";
import { checkKeys, checkScalars, validObject } from "./validate";

// ---------------------------------------------------------------------------
// C17 paste
// ---------------------------------------------------------------------------

/** A model fragment item (what copy produces; a paste payload). */
export type FragmentItem =
  | { readonly k: "text"; readonly text: string; readonly attrs?: ReadonlyAttrs }
  /** A ¶ with its `p:*` / `m:*` keys. */
  | { readonly k: "para"; readonly keys?: FlatKeys }
  | { readonly k: "object"; readonly kind: string; readonly props?: ObjectProps; readonly attrs?: ReadonlyAttrs }
  | { readonly k: "hr"; readonly attrs?: ReadonlyAttrs }
  /** A footnote anchor and its body's content (text / ¶ / object / rule items), placed before the body's ¶. */
  | { readonly k: "footnote"; readonly body: readonly FragmentItem[]; readonly attrs?: ReadonlyAttrs }
  /** A TOC block object (`a:*` keys). */
  | { readonly k: "toc"; readonly keys?: FlatKeys }
  /** A section break (`s:*` keys; a pasted `[S]` never carries `h:*`). */
  | { readonly k: "S"; readonly keys?: FlatKeys };

export const isBlockItem = (i: FragmentItem): boolean => i.k === "toc" || i.k === "S";

export function units(ctx: CommandContext, items: readonly FragmentItem[], inBody: boolean): InsertUnit[] {
  const out: InsertUnit[] = [];
  let prev: FragmentItem | null = null;
  for (const i of items) {
    // W1 / W2 inside the payload: a block object or [S] follows a ¶ (or starts the payload); nothing abuts a TOC but a ¶.
    if (isBlockItem(i) && prev !== null && prev.k !== "para") throw new Error("model: a pasted block object or [S] must follow a ¶");
    if (prev !== null && prev.k === "toc" && i.k !== "para") throw new Error("model: a pasted TOC must be followed by a ¶");
    if (inBody && (isBlockItem(i) || i.k === "footnote")) throw new Error("model: a footnote body holds no TOC, [S] or footnote");
    const attrs = "attrs" in i && i.attrs !== undefined ? checkScalars(i.attrs, "pasted attr") : {};
    switch (i.k) {
      case "text":
        if (i.text !== "") out.push({ text: i.text, attrs });
        break;
      case "para":
        out.push({ embed: newParagraphMark(checkKeys(i.keys ?? {}, ["p:", "m:"], "paragraph")), attrs: {} });
        break;
      case "object":
        validObject(ctx, i.kind, i.props ?? {});
        out.push({ embed: newObject(i.kind, i.props ?? {}), attrs });
        break;
      case "hr":
        out.push({ embed: newHorizontalRule(), attrs });
        break;
      case "footnote": {
        // The body: its content then its final ¶ (G3), in pieces within the cap (X11); nested types created with their parent (G1).
        const body = [...units(ctx, i.body, true), { embed: newParagraphMark(), attrs: {} }];
        out.push({ embed: newFootnoteOf(...chunked(body)), attrs });
        break;
      }
      case "toc":
        out.push({ embed: newTableOfContents(checkKeys(i.keys ?? {}, ["a:"], "TOC")), attrs: {} });
        break;
      case "S": {
        const keys = Object.fromEntries(Object.entries(i.keys ?? {}).filter(([k]) => !k.startsWith("h:")));
        out.push({ embed: newSectionBreak(checkKeys(keys, ["s:"], "section")), attrs: {} });
        break;
      }
    }
    prev = i;
  }
  return out;
}
