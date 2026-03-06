import { describe, it, expect } from "vitest";
import {
  createNode,
  createTextNode,
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  renderTree,
  layoutTree,
  createPosition,
} from "@taleweaver/core";
import { moveToLine, moveToLineBoundary } from "./line-navigation";

const measurer = createMockMeasurer(8, 16);
const registry = createRegistry([...defaultComponents]);

function makeDoc(texts: string[]) {
  const paragraphs = texts.map((t, i) =>
    createNode(`p${i}`, "paragraph", {}, [createTextNode(`t${i}`, t)]),
  );
  return createNode("doc", "document", {}, paragraphs);
}

describe("moveToLine", () => {
  it("moves down from first to second paragraph", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 2); // "He|llo"
    const result = moveToLine(state, pos, layout, measurer, "down", null);

    expect(result).not.toBeNull();
    expect(result!.position.path).toEqual([1, 0]);
    // Should maintain approximate x position
    expect(result!.position.offset).toBe(2);
  });

  it("moves up from second to first paragraph", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([1, 0], 3); // "Wor|ld"
    const result = moveToLine(state, pos, layout, measurer, "up", null);

    expect(result).not.toBeNull();
    expect(result!.position.path).toEqual([0, 0]);
    expect(result!.position.offset).toBe(3);
  });

  it("moves to end of document when going down from last line", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 2);
    const result = moveToLine(state, pos, layout, measurer, "down", null);

    expect(result).not.toBeNull();
    expect(result!.position.path).toEqual([0, 0]);
    expect(result!.position.offset).toBe(5); // end of "Hello"
  });

  it("moves to start of document when going up from first line", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 3);
    const result = moveToLine(state, pos, layout, measurer, "up", null);

    expect(result).not.toBeNull();
    expect(result!.position.path).toEqual([0, 0]);
    expect(result!.position.offset).toBe(0);
  });

  it("preserves targetX across moves", () => {
    const state = makeDoc(["Hello world", "Hi", "Long text here"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Start at offset 8 in first paragraph (x = 64)
    const pos = createPosition([0, 0], 8);
    const result1 = moveToLine(state, pos, layout, measurer, "down", null);
    expect(result1).not.toBeNull();
    // "Hi" is only 2 chars, so offset clamped to 2
    expect(result1!.position.path).toEqual([1, 0]);

    // Now move down again using the preserved targetX
    const result2 = moveToLine(
      state,
      result1!.position,
      layout,
      measurer,
      "down",
      result1!.targetX,
    );
    expect(result2).not.toBeNull();
    expect(result2!.position.path).toEqual([2, 0]);
    // Should try to reach x=64 again, which is offset 8
    expect(result2!.position.offset).toBe(8);
  });
});

describe("moveToLineBoundary", () => {
  it("moves to start of line", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 3); // "Hel|lo"
    const result = moveToLineBoundary(state, pos, layout, measurer, "start");

    expect(result).not.toBeNull();
    expect(result!.path).toEqual([0, 0]);
    expect(result!.offset).toBe(0);
  });

  it("moves to end of line", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 2); // "He|llo"
    const result = moveToLineBoundary(state, pos, layout, measurer, "end");

    expect(result).not.toBeNull();
    expect(result!.path).toEqual([0, 0]);
    expect(result!.offset).toBe(5); // end of "Hello"
  });

  it("works on second paragraph", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([1, 0], 2); // "Wo|rld"
    const result = moveToLineBoundary(state, pos, layout, measurer, "start");

    expect(result).not.toBeNull();
    expect(result!.path).toEqual([1, 0]);
    expect(result!.offset).toBe(0);
  });

  it("is a no-op when already at start", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 0);
    const result = moveToLineBoundary(state, pos, layout, measurer, "start");

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(0);
  });

  it("is a no-op when already at end", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = createPosition([0, 0], 5);
    const result = moveToLineBoundary(state, pos, layout, measurer, "end");

    expect(result).not.toBeNull();
    expect(result!.offset).toBe(5);
  });

  it("End on wrapped line stays at visual end of current line", () => {
    // "hello world" in 80px wraps: "hello " (line 1) + "world" (line 2)
    const state = makeDoc(["hello world"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 80, measurer);

    // Cursor in middle of line 1
    const pos = createPosition([0, 0], 2);
    const result = moveToLineBoundary(state, pos, layout, measurer, "end");

    expect(result).not.toBeNull();
    expect(result!.path).toEqual([0, 0]);
    // Should be at offset 5 (before trailing space), not 6 (which renders on line 2)
    expect(result!.offset).toBe(5);
  });

  it("End on second wrapped line goes to end of paragraph", () => {
    // "hello world" in 80px wraps: "hello " (line 1) + "world" (line 2)
    const state = makeDoc(["hello world"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 80, measurer);

    // Cursor on line 2
    const pos = createPosition([0, 0], 8);
    const result = moveToLineBoundary(state, pos, layout, measurer, "end");

    expect(result).not.toBeNull();
    expect(result!.path).toEqual([0, 0]);
    expect(result!.offset).toBe(11); // end of "world" = end of text
  });

  it("Home on second wrapped line goes to start of that line", () => {
    // "hello world" in 80px wraps: "hello " (line 1) + "world" (line 2)
    const state = makeDoc(["hello world"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 80, measurer);

    // Cursor on line 2
    const pos = createPosition([0, 0], 8);
    const result = moveToLineBoundary(state, pos, layout, measurer, "start");

    expect(result).not.toBeNull();
    expect(result!.path).toEqual([0, 0]);
    expect(result!.offset).toBe(6); // start of "world"
  });
});
