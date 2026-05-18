import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

/**
 * Document: the root container block. Holds child blocks (paragraphs,
 * lists, tables, etc.). The renderer pre-renders all children; this
 * component wraps them in a single block-level ElementBox.
 */
export const documentComponent: ContainerComponentDefinition = {
  type: "document",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "block" }, childRenderNodes),
};
