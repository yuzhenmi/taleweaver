import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { createPosition, createSpan } from "./position";
import { extractText } from "./extract-text";

function makeDoc(texts: string[]) {
  const paragraphs = texts.map((t, i) =>
    createNode(`p${i}`, "paragraph", {}, [createTextNode(`t${i}`, t)]),
  );
  return createNode("doc", "document", {}, paragraphs);
}

describe("extractText", () => {
  it("extracts text from a single paragraph", () => {
    const doc = makeDoc(["Hello world"]);
    const span = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );
    expect(extractText(doc, span)).toBe("Hello");
  });

  it("extracts partial text from middle", () => {
    const doc = makeDoc(["Hello world"]);
    const span = createSpan(
      createPosition([0, 0], 3),
      createPosition([0, 0], 8),
    );
    expect(extractText(doc, span)).toBe("lo wo");
  });

  it("extracts text across paragraphs with newline", () => {
    const doc = makeDoc(["First", "Second", "Third"]);
    const span = createSpan(
      createPosition([0, 0], 2),
      createPosition([2, 0], 3),
    );
    expect(extractText(doc, span)).toBe("rst\nSecond\nThi");
  });

  it("returns empty string for collapsed span", () => {
    const doc = makeDoc(["Hello"]);
    const span = createSpan(
      createPosition([0, 0], 2),
      createPosition([0, 0], 2),
    );
    expect(extractText(doc, span)).toBe("");
  });

  it("handles reversed span (anchor after focus)", () => {
    const doc = makeDoc(["Hello"]);
    const span = createSpan(
      createPosition([0, 0], 5),
      createPosition([0, 0], 0),
    );
    expect(extractText(doc, span)).toBe("Hello");
  });
});
