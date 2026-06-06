import type { LeafComponentDefinition } from "./component-definition";
import type { Style, ListStyleType } from "../styles";
import { createElementBox } from "../render/render-node";
import {
  textAlignFromAttrs,
  lineHeightFromAttrs,
  marginInlineStartFromAttrs,
  marginBlockStartFromAttrs,
  marginBlockEndFromAttrs,
  writingModeFromAttrs,
} from "./leaf-style-attrs";

/**
 * List-item: an inline-bearing leaf block. Data-model shape matches
 * paragraph (carries `inlineContent`, no children); rendered as an
 * `ElementBox` with `display: list-item` so the BFC's marker generator
 * emits a bullet or counter glyph next to it. The pre-expanded inline
 * RenderNodes are wrapped directly — no intermediate block.
 *
 * Sub-list nesting is achieved by a `list` container that wraps further
 * list-items, not by list-item owning children itself.
 *
 * An authored `textAlign` attr is forwarded onto the ElementBox `style` so
 * it reaches the layout cascade (see `leaf-style-attrs.ts`).
 *
 * List presentation lives on the list-item LEAF itself, not on a wrapping
 * `list` container: in the word-processor model (Word / Google Docs), list
 * membership is a per-paragraph property and the toggle-list path retypes the
 * cursor's leaf to a list-item without introducing a wrapper element. The BFC
 * reads BOTH list-presentation properties off the list-item's OWN computed
 * style (`resolveMarkerText(childCs, …)` + `childInlineStart =
 * paddingInlineStart + marginInlineStart`), so the component must synthesize:
 *   - `listStyleType` — `decimal` for ordered, `disc` for unordered (mirrors
 *     `list.ts`), so ordered lists render `1. 2. 3.` instead of bullets.
 *   - `paddingInlineStart` (LIST_INDENT) — the structural marker gutter /
 *     list indent, ALWAYS present on a list-item. It places the marker at a
 *     POSITIVE inline offset inside the content column
 *     (`paddingInlineStart - markerWidth - markerGap`) instead of in the page
 *     margin, and indents the content from the page edge.
 *
 * The user's `marginInlineStart` (INDENT/OUTDENT) is forwarded SEPARATELY and
 * composes ON TOP OF the structural padding — the BFC adds them
 * (`childInlineStart = paddingInlineStart + marginInlineStart`) — so indenting
 * a list item increases its indent past the base list indent, and outdenting
 * to margin 0 still keeps the base list indent.
 */

/**
 * Structural list indent (the marker gutter). Matches `list.ts`'s container
 * `paddingInlineStart` so the toggle-list (no-wrapper) path and any future
 * container-wrapped path render at the same indent.
 */
const LIST_INDENT = 30;

export const listItemComponent: LeafComponentDefinition = {
  type: "list-item",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineRenderNodes) => {
    const writingMode = writingModeFromAttrs(view.attrs.writingMode);
    const textAlign = textAlignFromAttrs(view.attrs.textAlign);
    const lineHeight = lineHeightFromAttrs(view.attrs.lineHeight);
    const marginInlineStart = marginInlineStartFromAttrs(view.attrs.marginInlineStart);
    const marginBlockStart = marginBlockStartFromAttrs(view.attrs.marginBlockStart);
    const marginBlockEnd = marginBlockEndFromAttrs(view.attrs.marginBlockEnd);
    const listStyleType: ListStyleType =
      view.attrs.listType === "ordered" ? "decimal" : "disc";
    const style: Style = {
      display: "list-item",
      listStyleType,
      // Structural marker gutter / list indent — always present so the marker
      // lands at a positive inline offset inside the content column.
      paddingInlineStart: LIST_INDENT,
      ...(writingMode !== undefined ? { writingMode } : {}),
      ...(textAlign !== undefined ? { textAlign } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      // User indent (INDENT/OUTDENT) composes ON TOP OF the structural padding.
      ...(marginInlineStart !== undefined ? { marginInlineStart } : {}),
      // Paragraph-spacing attrs (space-before/after control). Authored
      // marginBlockStart/End apply when set — only the DEFAULT differs from
      // paragraph.
      //
      // DESIGN RATIONALE (#418): a list-item intentionally has ZERO default
      // block margins — UNLIKE the paragraph component, which defaults
      // `marginBlockEnd: 0.5em` for inter-paragraph spacing. With no default
      // marginBlockEnd, consecutive list items in one list collapse to a zero
      // inter-item gap and pack tightly into a cohesive list, matching the
      // Google-Docs / word-processor convention where list items are NOT
      // separated by full inter-paragraph spacing. (WITHIN-item line spacing is
      // unchanged: list-item and paragraph both inherit the same default
      // lineHeight, so a list item's own lines are spaced exactly like a
      // paragraph's.) Locked by a regression test in list-item.test.ts.
      ...(marginBlockStart !== undefined ? { marginBlockStart } : {}),
      ...(marginBlockEnd !== undefined ? { marginBlockEnd } : {}),
    };
    return createElementBox(view.id, style, inlineRenderNodes);
  },
};
