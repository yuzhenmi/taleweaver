import type { ComponentDefinition } from "./component-definition-legacy";
import { createElementBox } from "../render/render-node";

export const tableComponent: ComponentDefinition = {
  type: "table",
  render: (state, children) => {
    const columnWidths = state.properties.columnWidths as readonly number[] | undefined;
    return createElementBox(
      state.id,
      { display: "table", ...state.style },
      children,
      columnWidths ? { columnWidths } : undefined,
    );
  },
};
