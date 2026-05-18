import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Paragraph: a leaf block whose `inlineContent` carries text runs and
 * inline embeds. The renderer expands those items into TextBox /
 * ElementBox children before calling `render`; the component just wraps
 * them in a block-level ElementBox.
 *
 * Default structural style: `display: block` + `marginBlockEnd: 0.5em`
 * for inter-paragraph spacing. Per-instance overrides flow through
 * `view.computedStyle` (attrs-derived) and the downstream layout
 * pipeline; the component declares only its baseline.
 */
export const paragraphComponent: LeafComponentDefinition = {
  type: "paragraph",
  kind: "leaf",
  render: (view, _ctx, inlineRenderNodes) =>
    createElementBox(view.id, {
      display: "block",
      marginBlockEnd: { unit: "em", value: 0.5 },
    }, inlineRenderNodes),
};
