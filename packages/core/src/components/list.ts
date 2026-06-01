import type { ContainerComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listComponent: ContainerComponentDefinition = {
  type: "list",
  kind: "container",
  render: (view, _ctx, childRenderNodes) => {
    const listStyleType: "decimal" | "disc" =
      view.attrs.listType === "ordered" ? "decimal" : "disc";
    return createElementBox(view.id, {
      display: "block",
      paddingInlineStart: 30,
      listStyleType,
    }, childRenderNodes);
  },
};
