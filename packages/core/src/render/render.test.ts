import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations";
import { defaultComponents } from "../components";
import { ComponentRegistry, createRegistry } from "../components/component-registry";
import { createBlockNode, createTextRenderNode, type RenderNode } from "./render-node";
import type { TextRenderNode } from "./text-render-node";
import { renderTree, renderTreeIncremental } from "./render";

function expectTextRender(node: RenderNode): TextRenderNode {
  if (node.type !== "text")
    throw new Error(`Expected text render node, got "${node.type}"`);
  return node;
}

const registry = createRegistry(defaultComponents);

function makeDoc() {
  const t1 = createTextNode("t1", "Hello ");
  const t2 = createTextNode("t2", "world");
  const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
  return createNode("doc", "document", {}, [p1]);
}

describe("Component render functions", () => {
  it("renders a text component", () => {
    const textNode = createTextNode("t1", "hello");
    const rendered = registry.get("text")!.render(textNode, []);

    expect(rendered.type).toBe("text");
    expect(expectTextRender(rendered).text).toBe("hello");
    expect(rendered.key).toBe("t1");
  });

  it("renders a paragraph component", () => {
    const child = createTextRenderNode("t1", "hello", {});
    const paraNode = createNode("p1", "paragraph", {}, []);
    const rendered = registry.get("paragraph")!.render(paraNode, [child]);

    expect(rendered.type).toBe("block");
    expect(rendered.children).toHaveLength(1);
    expect(rendered.children[0]).toBe(child);
  });

  it("renders a document component", () => {
    const child = createBlockNode("p1", {}, []);
    const docNode = createNode("doc", "document", {}, []);
    const rendered = registry.get("document")!.render(docNode, [child]);

    expect(rendered.type).toBe("block");
    expect(rendered.children).toHaveLength(1);
  });

  it("custom component can be registered", () => {
    const customRegistry = new ComponentRegistry();
    customRegistry.register({
      type: "heading",
      render: (node, children) =>
        createBlockNode(node.id, { fontSize: 24, fontWeight: "bold" }, children),
    });

    expect(customRegistry.has("heading")).toBe(true);
    const headingNode = createNode("h1", "heading", {}, []);
    const rendered = customRegistry.get("heading")!.render(headingNode, []);
    expect(rendered.styles.fontSize).toBe(24);
  });

  it("renders span component as inline with data-driven styles", () => {
    const textNode = createTextNode("t1", "styled text");
    const spanNode = createNode("s1", "span", { fontWeight: "bold", fontStyle: "italic" }, [textNode]);

    const renderedText = registry.get("text")!.render(textNode, []);
    const rendered = registry.get("span")!.render(spanNode, [renderedText]);

    expect(rendered.type).toBe("inline");
    expect(rendered.styles.fontWeight).toBe("bold");
    expect(rendered.styles.fontStyle).toBe("italic");
    expect(rendered.children).toHaveLength(1);
    expect(expectTextRender(rendered.children[0]).text).toBe("styled text");
  });

  it("filters unknown properties from span rendering", () => {
    const textNode = createTextNode("t1", "text");
    const spanNode = createNode("s1", "span", {
      fontWeight: "bold",
      color: "red",
      customAttr: 42,
    }, [textNode]);

    const renderedText = registry.get("text")!.render(textNode, []);
    const rendered = registry.get("span")!.render(spanNode, [renderedText]);

    expect(rendered.styles.fontWeight).toBe("bold");
    expect(rendered.styles).not.toHaveProperty("color");
    expect(rendered.styles).not.toHaveProperty("customAttr");
  });

  it("passes lineHeight through on spans", () => {
    const textNode = createTextNode("t1", "text");
    const spanNode = createNode("s1", "span", { lineHeight: 1.5 }, [textNode]);

    const renderedText = registry.get("text")!.render(textNode, []);
    const rendered = registry.get("span")!.render(spanNode, [renderedText]);

    expect(rendered.styles.lineHeight).toBe(1.5);
  });

  it("passes lineHeight through on text nodes", () => {
    const textNode = createNode("t1", "text", { content: "hello", lineHeight: 2 });

    const rendered = registry.get("text")!.render(textNode, []);

    expect(rendered.styles.lineHeight).toBe(2);
  });
});

describe("Full render pass", () => {
  it("renders a complete document tree", () => {
    const doc = makeDoc();
    const rendered = renderTree(doc, registry);

    expect(rendered.type).toBe("block"); // document
    expect(rendered.key).toBe("doc");
    expect(rendered.children).toHaveLength(1);

    const para = rendered.children[0];
    expect(para.type).toBe("block"); // paragraph
    expect(para.key).toBe("p1");
    expect(para.children).toHaveLength(2);

    expect(expectTextRender(para.children[0]).text).toBe("Hello ");
    expect(expectTextRender(para.children[1]).text).toBe("world");
  });

  it("throws for unregistered component type", () => {
    const unknown = createNode("u1", "unknown-type", {}, []);
    expect(() => renderTree(unknown, registry)).toThrow(
      'No render function registered for type "unknown-type"',
    );
  });
});

describe("Incremental render", () => {
  it("reuses unchanged render subtrees", () => {
    const doc = makeDoc();
    const rendered = renderTree(doc, registry);

    // Modify only t1
    const change = insertText(doc, createPosition([0, 0], 6), "dear ");
    const newRendered = renderTreeIncremental(
      change.newState,
      doc,
      rendered,
      registry,
    );

    // t2 render node should be reused (same reference)
    expect(newRendered.children[0].children[1]).toBe(
      rendered.children[0].children[1],
    );

    // t1 render node should be new
    expect(newRendered.children[0].children[0]).not.toBe(
      rendered.children[0].children[0],
    );
    expect(expectTextRender(newRendered.children[0].children[0]).text).toBe("Hello dear ");
  });

  it("reuses entire unchanged subtrees when sibling paragraph changes", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const rendered = renderTree(doc, registry);

    // Modify only p2's text
    const change = insertText(doc, createPosition([1, 0], 6), "!");
    const newRendered = renderTreeIncremental(
      change.newState,
      doc,
      rendered,
      registry,
    );

    // p1's entire render subtree should be reused
    expect(newRendered.children[0]).toBe(rendered.children[0]);

    // p2 should be re-rendered
    expect(newRendered.children[1]).not.toBe(rendered.children[1]);
    expect(expectTextRender(newRendered.children[1].children[0]).text).toBe("Second!");
  });

  it("returns same render tree if state is identical", () => {
    const doc = makeDoc();
    const rendered = renderTree(doc, registry);
    const same = renderTreeIncremental(doc, doc, rendered, registry);

    expect(same).toBe(rendered);
  });

  it("handles children added to the state tree", () => {
    const t1 = createTextNode("t1", "First");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const doc1 = createNode("doc", "document", {}, [p1]);
    const rendered1 = renderTree(doc1, registry);

    // Add a second paragraph
    const t2 = createTextNode("t2", "Second");
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc2 = createNode("doc", "document", {}, [p1, p2]);

    const rendered2 = renderTreeIncremental(doc2, doc1, rendered1, registry);

    expect(rendered2.children).toHaveLength(2);
    // First paragraph should be reused
    expect(rendered2.children[0]).toBe(rendered1.children[0]);
    // Second paragraph is new
    expect(expectTextRender(rendered2.children[1].children[0]).text).toBe("Second");
  });

  it("reuses render nodes by key when a child is inserted at the beginning", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc1 = createNode("doc", "document", {}, [p1, p2]);
    const rendered1 = renderTree(doc1, registry);

    // Insert a new paragraph at the beginning — shifts p1 and p2 indices
    const t0 = createTextNode("t0", "Zeroth");
    const p0 = createNode("p0", "paragraph", {}, [t0]);
    const doc2 = createNode("doc", "document", {}, [p0, p1, p2]);

    const rendered2 = renderTreeIncremental(doc2, doc1, rendered1, registry);

    expect(rendered2.children).toHaveLength(3);
    // p1 and p2 should be reused by key matching, not re-rendered
    expect(rendered2.children[1]).toBe(rendered1.children[0]); // p1 reused
    expect(rendered2.children[2]).toBe(rendered1.children[1]); // p2 reused
  });

  it("handles children removed from the state tree", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc1 = createNode("doc", "document", {}, [p1, p2]);
    const rendered1 = renderTree(doc1, registry);

    // Remove second paragraph
    const doc2 = createNode("doc", "document", {}, [p1]);
    const rendered2 = renderTreeIncremental(doc2, doc1, rendered1, registry);

    expect(rendered2.children).toHaveLength(1);
    expect(rendered2.children[0]).toBe(rendered1.children[0]);
  });
});
