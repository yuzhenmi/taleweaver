import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node";

export const imageComponent: ComponentDefinition = {
  type: "image",
  render: (state, _children) => {
    const src = state.properties.src as string;
    const width = state.properties.width as number;
    const height = state.properties.height as number;
    return createElementBox(
      state.id,
      { display: "block", inlineSize: width, blockSize: height, ...state.style },
      [],
      { image: { src, width, height } },
    );
  },
};
