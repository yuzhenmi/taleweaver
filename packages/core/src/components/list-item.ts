import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const listItemComponent: ComponentDefinition = {
  type: "list-item",
  render: (state, children) =>
    createElementBox(state.id, { display: "list-item", ...state.style }, children),
};
