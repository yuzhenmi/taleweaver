import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableCellComponent: ComponentDefinition = {
  type: "table-cell",
  render: (node, children) =>
    createElementBox(node.id, {
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 4,
      paddingRight: 4,
    }, children),
};
