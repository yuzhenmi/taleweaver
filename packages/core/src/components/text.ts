import type { ComponentDefinition } from "./component-definition";
import { createTextBox } from "../render/render-node-v2";
import { getTextContent } from "../state/text-utils";

export const textComponent: ComponentDefinition = {
  type: "text",
  render: (state) =>
    createTextBox(state.id, { ...state.style }, getTextContent(state)),
};
