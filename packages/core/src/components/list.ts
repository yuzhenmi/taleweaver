import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listComponent: ComponentDefinition = {
  type: "list",
  render: (state, children) => {
    const listType = state.properties.listType as string | undefined;
    const listStyleType = listType === "ordered" ? "decimal" : "disc";
    return createElementBox(state.id, {
      display: "block",
      paddingLeft: 30,
      listStyleType,
      ...state.style,
    }, children);
  },
};
