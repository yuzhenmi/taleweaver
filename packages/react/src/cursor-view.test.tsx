import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CursorView } from "./cursor-view";

function getFirstElement(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement))
    throw new Error("Expected HTMLElement as first child");
  return el;
}

describe("CursorView", () => {
  it("renders a positioned div", () => {
    const { container } = render(
      <CursorView x={10} y={20} height={16} />,
    );
    const cursor = getFirstElement(container);
    expect(cursor.style.position).toBe("absolute");
    expect(cursor.style.left).toBe("10px");
    expect(cursor.style.top).toBe("20px");
    expect(cursor.style.height).toBe("16px");
    expect(cursor.style.width).toBe("2px");
  });

  it("has black background", () => {
    const { container } = render(
      <CursorView x={0} y={0} height={16} />,
    );
    const cursor = getFirstElement(container);
    expect(cursor.style.backgroundColor).toBe("black");
  });
});
