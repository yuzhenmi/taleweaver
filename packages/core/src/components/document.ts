import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node";

export const documentComponent: ComponentDefinition = {
  type: "document",
  render: (state, children) =>
    createElementBox(state.id, { display: "block", ...state.style }, children),
};
