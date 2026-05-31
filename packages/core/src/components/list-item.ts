import type { LeafComponentDefinition } from "./component-definition";
import type { Style } from "../styles";
import { createElementBox } from "../render/render-node";
import {
  textAlignFromAttrs,
  lineHeightFromAttrs,
  marginInlineStartFromAttrs,
  marginBlockStartFromAttrs,
  marginBlockEndFromAttrs,
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
 */
export const listItemComponent: LeafComponentDefinition = {
  type: "list-item",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineRenderNodes) => {
    const textAlign = textAlignFromAttrs(view.attrs.textAlign);
    const lineHeight = lineHeightFromAttrs(view.attrs.lineHeight);
    const marginInlineStart = marginInlineStartFromAttrs(view.attrs.marginInlineStart);
    const marginBlockStart = marginBlockStartFromAttrs(view.attrs.marginBlockStart);
    const marginBlockEnd = marginBlockEndFromAttrs(view.attrs.marginBlockEnd);
    const style: Style = {
      display: "list-item",
      ...(textAlign !== undefined ? { textAlign } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      ...(marginInlineStart !== undefined ? { marginInlineStart } : {}),
      // Paragraph-spacing attrs (list-item has no default block margins of its
      // own, but supports the same space-before/after control). Absent → unset.
      ...(marginBlockStart !== undefined ? { marginBlockStart } : {}),
      ...(marginBlockEnd !== undefined ? { marginBlockEnd } : {}),
    };
    return createElementBox(view.id, style, inlineRenderNodes);
  },
};
