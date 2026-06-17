import { describe, it, expect } from "vitest";
import {
  buildDocumentFromTree,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  productionAllocator,
  type ContainerBlockNode,
  type State,
} from "@taleweaver/core";
import { renderDocumentToDom } from "./render-to-dom";

const components = createDefaultComponentRegistry();
const attrs = createDefaultAttrRegistry();

// A document containing one paragraph whose text is "hello".
// Shape per packages/print/src/html-serializer.test.ts: the root is a
// ContainerBlockNode `{ type: "document", children: [...] }`; a paragraph leaf
// carries `{ type: "paragraph", inlineContent: { items: [TextItem] } }`.
// buildDocumentFromTree(root, listDefs, allocator) — note the 3-arg signature
// and that `productionAllocator` is a value, not a factory.
function helloDoc(): State {
  const tree: ContainerBlockNode = {
    type: "document",
    children: [
      {
        type: "paragraph",
        inlineContent: { items: [{ kind: "text", text: "hello", attrs: {} }] },
      },
    ],
  };
  return buildDocumentFromTree(tree, {}, productionAllocator);
}

describe("renderDocumentToDom (end-to-end)", () => {
  it("renders a paragraph through the full render+cascade+walk pipeline", () => {
    const root = renderDocumentToDom(helloDoc(), components, attrs, document);
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root.textContent).toContain("hello");
  });

  it("emits NO geometry — only CSS styles, never left/top coordinates", () => {
    const root = renderDocumentToDom(helloDoc(), components, attrs, document);
    for (const elem of Array.from(root.querySelectorAll("*"))) {
      const style = elem.getAttribute("style") ?? "";
      expect(style).not.toMatch(/(^|;)\s*(left|top)\s*:/);
    }
  });

  it("accepts a suggestionView option (final view renders cleanly)", () => {
    const root = renderDocumentToDom(helloDoc(), components, attrs, document, { suggestionView: "final" });
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root.textContent).toContain("hello");
  });
});
