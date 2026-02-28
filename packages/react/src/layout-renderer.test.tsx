import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  createBlockLayoutBox,
  createLineLayoutBox,
  createTextLayoutBox,
} from "@taleweaver/core";
import { renderLayoutTree } from "./layout-renderer";

function getFirstElement(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement))
    throw new Error("Expected HTMLElement as first child");
  return el;
}

describe("renderLayoutTree", () => {
  it("renders a text box as a span with white-space: pre", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe("hello");
    expect(span!.style.whiteSpace).toBe("pre");
  });

  it("renders block boxes as positioned divs", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "test");
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 10, 20, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const div = getFirstElement(container);
    expect(div.tagName).toBe("DIV");
    expect(div.style.position).toBe("absolute");
    expect(div.style.left).toBe("10px");
    expect(div.style.top).toBe("20px");
  });

  it("renders nested blocks", () => {
    const textBox1 = createTextLayoutBox("t1", 0, 0, 24, 16, "abc");
    const lineBox1 = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox1]);
    const innerBlock = createBlockLayoutBox("p1", 0, 0, 200, 16, [lineBox1]);

    const textBox2 = createTextLayoutBox("t2", 0, 0, 16, 16, "de");
    const lineBox2 = createLineLayoutBox("l2", 0, 0, 200, 16, [textBox2]);
    const innerBlock2 = createBlockLayoutBox("p2", 0, 16, 200, 16, [lineBox2]);

    const outerBlock = createBlockLayoutBox("doc", 0, 0, 200, 32, [
      innerBlock,
      innerBlock2,
    ]);

    const { container } = render(renderLayoutTree(outerBlock));
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe("abc");
    expect(spans[1].textContent).toBe("de");
  });

  it("renders line boxes as positioned divs", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "line1");
    const lineBox = createLineLayoutBox("l1", 5, 10, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const lineDivs = container.querySelectorAll("div > div");
    // There should be at least one line div
    expect(lineDivs.length).toBeGreaterThan(0);
  });

  // --- Style rendering ---

  it("renders bold text with fontWeight style", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "bold", {
      fontWeight: "bold",
    });
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const span = container.querySelector("span")!;
    expect(span.style.fontWeight).toBe("bold");
  });

  it("renders italic text with fontStyle style", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "italic", {
      fontStyle: "italic",
    });
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const span = container.querySelector("span")!;
    expect(span.style.fontStyle).toBe("italic");
  });

  it("renders underlined text with textDecoration style", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "underline", {
      textDecoration: "underline",
    });
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const span = container.querySelector("span")!;
    expect(span.style.textDecoration).toBe("underline");
  });

  it("renders text without styles when no styles provided", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "plain");
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const span = container.querySelector("span")!;
    expect(span.style.fontWeight).toBe("");
    expect(span.style.fontStyle).toBe("");
    expect(span.style.textDecoration).toBe("");
  });

  it("renders multiple styled text boxes correctly", () => {
    const boldBox = createTextLayoutBox("t1", 0, 0, 32, 16, "bold", {
      fontWeight: "bold",
    });
    const italicBox = createTextLayoutBox("t2", 32, 0, 48, 16, "italic", {
      fontStyle: "italic",
    });
    const lineBox = createLineLayoutBox("l1", 0, 0, 200, 16, [
      boldBox,
      italicBox,
    ]);
    const blockBox = createBlockLayoutBox("b1", 0, 0, 200, 16, [lineBox]);

    const { container } = render(renderLayoutTree(blockBox));
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[0].style.fontWeight).toBe("bold");
    expect(spans[0].style.fontStyle).toBe("");
    expect(spans[1].style.fontStyle).toBe("italic");
    expect(spans[1].style.fontWeight).toBe("");
  });
});
