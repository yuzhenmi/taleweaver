import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/block-render-node";

export const tableRowComponent: ComponentDefinition = {
  type: "table-row",
  render: (node, children) =>
    createBlockNode(node.id, { marginTop: 0, marginBottom: 0 }, children),
};
