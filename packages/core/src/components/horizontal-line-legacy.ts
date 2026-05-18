import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node";

export const horizontalLineComponent: ComponentDefinition = {
  type: "horizontal-line",
  render: (state, _children) =>
    createElementBox(
      state.id,
      { display: "block", blockSize: 16, ...state.style },
      [],
      { horizontalLine: true },
    ),
};
