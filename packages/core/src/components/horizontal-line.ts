import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

export const horizontalLineComponent: ComponentDefinition = {
  type: "horizontal-line",
  // TODO Plan 2 — real horizontal-line rendering
  render: (state, children) =>
    createElementBox(state.id, { display: "block" }, children),
};
