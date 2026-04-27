import type { ComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node-v2";

const HEADING_FONT_SIZES = { 1: 32, 2: 24, 3: 18.72, 4: 16, 5: 13.28, 6: 10.72 } as const;

export const headingComponent: ComponentDefinition = {
  type: "heading",
  render: (state, children) => {
    const level = state.properties.level as 1 | 2 | 3 | 4 | 5 | 6;
    const fontSize = HEADING_FONT_SIZES[level] ?? HEADING_FONT_SIZES[1];
    return createElementBox(state.id, {
      display: "block",
      fontWeight: "bold",
      fontSize,
      marginTop:    { unit: "em", value: 0.67 },
      marginBottom: { unit: "em", value: 0.67 },
      ...state.style,
    }, children);
  },
};
