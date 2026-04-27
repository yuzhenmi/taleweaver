import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableRowComponent: ComponentDefinition = {
  type: "table-row",
  render: (node, children) =>
    createElementBox(node.id, {}, children),
};
