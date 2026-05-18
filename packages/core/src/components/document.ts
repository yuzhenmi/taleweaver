import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node-v2";

export const documentComponent: ComponentDefinition = {
  type: "document",
  render: (state, children) =>
    createElementBox(state.id, { display: "block", ...state.style }, children),
};
