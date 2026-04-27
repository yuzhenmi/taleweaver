import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableComponent: ComponentDefinition = {
  type: "table",
  render: (node, children) =>
    createElementBox(node.id, {}, children),
};
