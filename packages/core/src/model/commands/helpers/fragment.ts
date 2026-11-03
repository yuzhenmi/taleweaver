import type { ReadonlyAttrs } from "../../block";
import { type InsertUnit, chunked } from "../../plan";
import { type Container, allowedIn, isBlockObject, isParagraphBreak, isStructural } from "../../scan/kinds";
import { type ObjectProps, newField, newFootnoteOf, newHorizontalRule, newLineBreak, newObject, newParagraphMark, newSectionBreak, newTableOfContents } from "../../storage/new-items";
import type { FlatKeys } from "../../storage/scalar";
import { newCellMark, newRowMark, newTableEnd, newTableStart } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { checkKeys, checkScalars, validField, validObject } from "./validate";

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
  | { readonly k: "lineBreak"; readonly attrs?: ReadonlyAttrs }
  /** A field: `field` page-number / page-count, `numberStyle` default decimal. */
  | { readonly k: "field"; readonly field: string; readonly numberStyle?: string; readonly attrs?: ReadonlyAttrs }
  /** A footnote anchor and its body's content (items placeable in a footnote body), placed before the body's ¶. */
  | { readonly k: "footnote"; readonly body: readonly FragmentItem[]; readonly attrs?: ReadonlyAttrs }
  /** A TOC block object (`a:*` keys). */
  | { readonly k: "toc"; readonly keys?: FlatKeys }
  /** A section break (`s:*` keys; a pasted `[S]` never carries `h:*`). */
  | { readonly k: "S"; readonly keys?: FlatKeys }
  /** A table of `rows` × `cols` empty cells, columns of equal weight (integers ≥ 1). */
  | { readonly k: "table"; readonly rows: number; readonly cols: number };

/** Read units of a fragment item that is neither a ¶ nor structural. */
export const fragmentUnits = (i: FragmentItem): number => ("text" in i ? i.text.length : 1);

/** Can every item go in `container` (a footnote's body items in a footnote body)? A paste of a payload that cannot is refused whole. */
export const placeable = (items: readonly FragmentItem[], container: Container): boolean =>
  items.every((i) => allowedIn(i.k, container) && (!("body" in i) || placeable(i.body, "footnote")));

/** Throws unless a table's row and column counts are integers ≥ 1. */
export function checkTableSize(rows: number, cols: number): void {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new Error("model: a table needs integer rows and columns ≥ 1");
}

/** `⟦ (⟨r⟩ (⟨c⟩ ¶)×C)×R ⟧` at depth `d`, `cols` holding C weights of 1. Throws unless both counts are integers ≥ 1. */
function tableUnits(rows: number, cols: number, d: number): InsertUnit[] {
  checkTableSize(rows, cols);
  const out: InsertUnit[] = [{ embed: newTableStart(d, Array.from({ length: cols }, () => 1)), attrs: {} }];
  for (let r = 0; r < rows; r++) {
    out.push({ embed: newRowMark(d), attrs: {} });
    for (let c = 0; c < cols; c++) out.push({ embed: newCellMark(d), attrs: {} }, { embed: newParagraphMark(), attrs: {} });
  }
  out.push({ embed: newTableEnd(d), attrs: {} });
  return out;
}

/**
 * The payload as insert units (its placement checked first, {@link placeable}); `depth`: the number of tables around
 * the insertion point (a pasted table's marks store it). Throws on a payload that breaks W1 / W2.
 */
export function units(ctx: CommandContext, items: readonly FragmentItem[], depth = 0): InsertUnit[] {
  const out: InsertUnit[] = [];
  let prev: FragmentItem | null = null;
  for (const i of items) {
    // W1 / W2 inside the payload: a block object or [S] follows a ¶ (or starts the payload); nothing abuts a block object but a ¶.
    if (isStructural(i.k) && prev !== null && !isParagraphBreak(prev.k)) throw new Error("model: a pasted block object or [S] must follow a ¶");
    if (prev !== null && isBlockObject(prev.k) && !isParagraphBreak(i.k)) throw new Error("model: a pasted block object must be followed by a ¶");
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
      case "lineBreak":
        out.push({ embed: newLineBreak(), attrs });
        break;
      case "field": {
        const style = i.numberStyle ?? "decimal";
        validField(i.field, style);
        out.push({ embed: newField(i.field, style), attrs });
        break;
      }
      case "footnote": {
        // The body: its content then its final ¶ (G3), in pieces within the cap (X11); nested types created with their parent (G1).
        const body = [...units(ctx, i.body), { embed: newParagraphMark(), attrs: {} }];
        out.push({ embed: newFootnoteOf(...chunked(body)), attrs });
        break;
      }
      case "toc":
        out.push({ embed: newTableOfContents(checkKeys(i.keys ?? {}, ["a:"], "TOC")), attrs: {} });
        break;
      case "table":
        out.push(...tableUnits(i.rows, i.cols, depth));
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
