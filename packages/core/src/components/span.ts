import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node";

export const spanComponent: ComponentDefinition = {
  type: "span",
  // TODO Plan 2 — real inline span rendering (display: inline, pass-through styles)
  render: (state, children) =>
    createElementBox(state.id, { display: "inline", ...state.style }, children),
};
