import { describe, it, expect } from "vitest";
import { renderTree, renderTreeIncremental } from "./render";
import { createRegistry } from "../components/component-registry";
import { documentComponent } from "../components/document";
import { paragraphComponent } from "../components/paragraph";
import { textComponent } from "../components/text";
import { createNode, createTextNode } from "../state/create-node";
import { updateAtPath } from "../state/operations";

describe("renderTree", () => {
  it("renders a document → paragraph → text tree", () => {
    const reg = createRegistry([documentComponent, paragraphComponent, textComponent]);
    const state = {
      id: "doc", type: "document", properties: {}, style: {},
      children: [{
        id: "p", type: "paragraph", properties: {}, style: {},
        children: [{
          id: "t", type: "text", properties: { content: "hello" }, style: {}, children: [],
        }],
      }],
    };
    const result = renderTree(state, reg);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("?");
    expect(result.children[0].type).toBe("element");
  });
});

describe("renderTreeIncremental", () => {
  const reg = createRegistry([documentComponent, paragraphComponent, textComponent]);

  function makeDoc(paragraphCount: number) {
    const paragraphs = [];
    for (let i = 0; i < paragraphCount; i++) {
      const text = createTextNode(`text-${i}`, `paragraph ${i}`);
      const para = createNode(`para-${i}`, "paragraph", {}, [text]);
      paragraphs.push(para);
    }
    return createNode("doc", "document", {}, paragraphs);
  }

  it("returns the same render tree when state is reference-equal", () => {
    const state = makeDoc(3);
    const renderA = renderTree(state, reg);
    const renderB = renderTreeIncremental(state, state, renderA, reg);
    expect(renderB).toBe(renderA);
  });

  it("returns the original render when there is no oldState/oldRender", () => {
    const state = makeDoc(2);
    const result = renderTreeIncremental(state, null, null, reg);
    // Equivalent shape to renderTree(state, reg).
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("expected element");
    expect(result.children).toHaveLength(2);
  });

  it("preserves reference equality on unchanged sibling subtrees after a single-paragraph edit", () => {
    const stateA = makeDoc(3);
    const renderA = renderTree(stateA, reg);

    // Edit only paragraph 1's text. updateAtPath rebuilds the path; siblings keep refs.
    const updatedText = createTextNode("text-1", "paragraph 1 — edited");
    const updatedPara = createNode("para-1", "paragraph", {}, [updatedText]);
    const stateB = updateAtPath(stateA, [1], updatedPara);

    // Sanity: state-tree mutation preserves sibling references.
    expect(stateB.children[0]).toBe(stateA.children[0]);
    expect(stateB.children[2]).toBe(stateA.children[2]);

    const renderB = renderTreeIncremental(stateB, stateA, renderA, reg);

    if (renderB.type !== "element") throw new Error("expected element");
    if (renderA.type !== "element") throw new Error("expected element");

    // The root itself is rebuilt (it sits on the change path).
    expect(renderB).not.toBe(renderA);
    // The changed paragraph is rebuilt.
    expect(renderB.children[1]).not.toBe(renderA.children[1]);
    // Unchanged paragraphs reuse the previous render references.
    expect(renderB.children[0]).toBe(renderA.children[0]);
    expect(renderB.children[2]).toBe(renderA.children[2]);
  });
});
