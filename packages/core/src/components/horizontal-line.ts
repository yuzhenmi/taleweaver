import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const horizontalLineComponent: ComponentDefinition = {
  type: "horizontal-line",
  render: (node) =>
    createBlockNode(
      node.id,
      { paddingTop: 12, paddingBottom: 12, lineMarginTop: 0, lineMarginBottom: 0, blockMarginTop: 0.2, blockMarginBottom: 0.2 },
      [],
      undefined,
      { type: "horizontal-line" },
    ),
};
