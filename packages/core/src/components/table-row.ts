import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const tableRowComponent: ContainerComponentDefinition = {
  type: "table-row",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "table-row" }, childRenderNodes),
};
