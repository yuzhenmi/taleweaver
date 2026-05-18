import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listItemComponent: ContainerComponentDefinition = {
  type: "list-item",
  kind: "container",
  render: (view, _ctx, childRenderNodes) =>
    createElementBox(view.id, { display: "list-item" }, childRenderNodes),
};
