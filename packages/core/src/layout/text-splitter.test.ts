import { describe, it, expect } from "vitest";
import { splitTextIntoWords } from "./text-splitter";
import { createMockMeasurer } from "./text-measurer";

const measurer = createMockMeasurer(8, 16);
const styles = {};

describe("splitTextIntoWords", () => {
  it("returns a single empty box for empty text", () => {
    const boxes = splitTextIntoWords("", styles, measurer);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].text).toBe("");
    expect(boxes[0].width).toBe(0);
    expect(boxes[0].height).toBe(16);
    expect(boxes[0].trailingSpace).toBe(false);
  });

  it("returns a single box for a word with no spaces", () => {
    const boxes = splitTextIntoWords("hello", styles, measurer);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].text).toBe("hello");
    expect(boxes[0].width).toBe(40); // 5 * 8
    expect(boxes[0].trailingSpace).toBe(false);
  });

  it("splits two words and attaches trailing space to first", () => {
    const boxes = splitTextIntoWords("hello world", styles, measurer);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].text).toBe("hello ");
    expect(boxes[0].trailingSpace).toBe(true);
    expect(boxes[0].width).toBe(48); // 6 * 8
    expect(boxes[1].text).toBe("world");
    expect(boxes[1].trailingSpace).toBe(false);
  });

  it("handles leading space as standalone box", () => {
    const boxes = splitTextIntoWords(" hello", styles, measurer);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].text).toBe(" ");
    expect(boxes[0].trailingSpace).toBe(true);
    expect(boxes[1].text).toBe("hello");
    expect(boxes[1].trailingSpace).toBe(false);
  });

  it("handles trailing space on last word", () => {
    const boxes = splitTextIntoWords("hello ", styles, measurer);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].text).toBe("hello ");
    expect(boxes[0].trailingSpace).toBe(true);
  });

  it("handles multiple spaces between words", () => {
    const boxes = splitTextIntoWords("a  b", styles, measurer);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].text).toBe("a  ");
    expect(boxes[0].trailingSpace).toBe(true);
    expect(boxes[1].text).toBe("b");
  });

  it("handles three words", () => {
    const boxes = splitTextIntoWords("a b c", styles, measurer);
    expect(boxes).toHaveLength(3);
    expect(boxes[0].text).toBe("a ");
    expect(boxes[1].text).toBe("b ");
    expect(boxes[2].text).toBe("c");
  });

  it("measures height from measurer", () => {
    const tallMeasurer = createMockMeasurer(8, 24);
    const boxes = splitTextIntoWords("hello", styles, tallMeasurer);
    expect(boxes[0].height).toBe(24);
  });

  it("measures width using character width", () => {
    const wideMeasurer = createMockMeasurer(10, 16);
    const boxes = splitTextIntoWords("abc", styles, wideMeasurer);
    expect(boxes[0].width).toBe(30); // 3 * 10
  });
});
