import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const horizontalLineComponent: ComponentDefinition = {
  type: "horizontal-line",
  render: (node) =>
    createBlockNode(
      node.id,
      { paddingTop: 12, paddingBottom: 12, marginTop: 4, marginBottom: 4 },
      [],
      undefined,
      { type: "horizontal-line" },
    ),
};
