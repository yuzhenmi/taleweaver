import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node-v2";

export const paragraphComponent: ComponentDefinition = {
  type: "paragraph",
  render: (state, children) =>
    createElementBox(state.id, {
      display: "block",
      marginBottom: { unit: "em", value: 0.5 },
      ...state.style,
    }, children),
};
