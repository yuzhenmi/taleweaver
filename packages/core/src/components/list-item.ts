import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * List-item: an inline-bearing leaf block. Data-model shape matches
 * paragraph (carries `inlineContent`, no children); rendered as an
 * `ElementBox` with `display: list-item` so the BFC's marker generator
 * emits a bullet or counter glyph next to it. The pre-expanded inline
 * RenderNodes are wrapped directly — no intermediate block.
 *
 * Sub-list nesting is achieved by a `list` container that wraps further
 * list-items, not by list-item owning children itself.
 */
export const listItemComponent: LeafComponentDefinition = {
  type: "list-item",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineRenderNodes) =>
    createElementBox(view.id, { display: "list-item" }, inlineRenderNodes),
};
