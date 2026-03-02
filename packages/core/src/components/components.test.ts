import { describe, it, expect } from "vitest";
import { ComponentRegistry, createRegistry } from "./component-registry";

import { documentComponent } from "./document";
import { paragraphComponent } from "./paragraph";
import { textComponent } from "./text";
import { spanComponent } from "./span";
import { defaultComponents } from "./index";
import { headingComponent } from "./heading";
import { listComponent } from "./list";
import { listItemComponent } from "./list-item";
import { createNode, createTextNode } from "../state/create-node";
import { createTextRenderNode } from "../render/text-render-node";
import { createBlockNode } from "../render/block-render-node";

describe("ComponentRegistry", () => {
  it("register and get", () => {
    const reg = new ComponentRegistry();
    reg.register(documentComponent);
    expect(reg.get("document")).toBe(documentComponent);
  });

  it("has returns true for registered types", () => {
    const reg = new ComponentRegistry();
    reg.register(textComponent);
    expect(reg.has("text")).toBe(true);
    expect(reg.has("unknown")).toBe(false);
  });

  it("get returns undefined for unregistered types", () => {
    const reg = new ComponentRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("later registration overwrites earlier", () => {
    const reg = new ComponentRegistry();
    reg.register(documentComponent);
    const custom = { type: "document", render: documentComponent.render };
    reg.register(custom);
    expect(reg.get("document")).toBe(custom);
  });
});

describe("createRegistry", () => {
  it("creates registry from array of definitions", () => {
    const reg = createRegistry(defaultComponents);
    expect(reg.has("document")).toBe(true);
    expect(reg.has("paragraph")).toBe(true);
    expect(reg.has("text")).toBe(true);
    expect(reg.has("span")).toBe(true);
  });

  it("creates registry from empty array", () => {
    const reg = createRegistry([]);
    expect(reg.has("document")).toBe(false);
  });
});

describe("documentComponent", () => {
  it("has type 'document'", () => {
    expect(documentComponent.type).toBe("document");
  });

  it("renders a block node with empty styles", () => {
    const node = createNode("doc", "document");
    const result = documentComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.key).toBe("doc");
    expect(result.children).toHaveLength(0);
  });

  it("passes rendered children through", () => {
    const child = createTextRenderNode("t1", "hi", {});
    const node = createNode("doc", "document");
    const result = documentComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("paragraphComponent", () => {
  it("has type 'paragraph'", () => {
    expect(paragraphComponent.type).toBe("paragraph");
  });

  it("renders a block node with zero margins", () => {
    const node = createNode("p1", "paragraph");
    const result = paragraphComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.marginTop).toBe(0);
    expect(result.styles.marginBottom).toBe(0);
  });
});

describe("textComponent", () => {
  it("has type 'text'", () => {
    expect(textComponent.type).toBe("text");
  });

  it("renders a text node with content from properties", () => {
    const node = createTextNode("t1", "hello");
    const result = textComponent.render(node, []);
    expect(result.type).toBe("text");
    if (result.type !== "text") throw new Error("expected text");
    expect(result.text).toBe("hello");
    expect(result.key).toBe("t1");
  });

  it("renders empty string for node without content", () => {
    const node = createNode("t1", "text", {});
    const result = textComponent.render(node, []);
    if (result.type !== "text") throw new Error("expected text");
    expect(result.text).toBe("");
  });

  it("propagates inline styles from properties", () => {
    const node = createNode("t1", "text", {
      content: "hi",
    }, [], {
      fontWeight: "bold",
      fontSize: 20,
    });
    const result = textComponent.render(node, []);
    expect(result.styles.fontWeight).toBe("bold");
    expect(result.styles.fontSize).toBe(20);
  });
});

describe("spanComponent", () => {
  it("has type 'span'", () => {
    expect(spanComponent.type).toBe("span");
  });

  it("renders an inline node with inline styles", () => {
    const node = createNode("s1", "span", {}, [], { fontWeight: "bold" });
    const child = createTextRenderNode("t1", "text", {});
    const result = spanComponent.render(node, [child]);
    expect(result.type).toBe("inline");
    expect(result.styles.fontWeight).toBe("bold");
    expect(result.children).toHaveLength(1);
  });
});

describe("headingComponent", () => {
  it("has type 'heading'", () => {
    expect(headingComponent.type).toBe("heading");
  });

  it("renders a block node with bold fontWeight", () => {
    const node = createNode("h1", "heading", { level: 1 });
    const result = headingComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.fontWeight).toBe("bold");
  });

  it("uses font size 32 for level 1", () => {
    const node = createNode("h1", "heading", { level: 1 });
    const result = headingComponent.render(node, []);
    expect(result.styles.fontSize).toBe(32);
  });

  it("uses font size 24 for level 2", () => {
    const node = createNode("h2", "heading", { level: 2 });
    const result = headingComponent.render(node, []);
    expect(result.styles.fontSize).toBe(24);
  });

  it("uses font size 20 for level 3", () => {
    const node = createNode("h3", "heading", { level: 3 });
    const result = headingComponent.render(node, []);
    expect(result.styles.fontSize).toBe(20);
  });

  it("defaults to level 1 when level is not specified", () => {
    const node = createNode("h1", "heading", {});
    const result = headingComponent.render(node, []);
    expect(result.styles.fontSize).toBe(32);
  });

  it("sets lineHeight proportional to fontSize for level 1", () => {
    const node = createNode("h1", "heading", { level: 1 });
    const result = headingComponent.render(node, []);
    expect(result.styles.lineHeight).toBe(40);
  });

  it("sets lineHeight proportional to fontSize for level 2", () => {
    const node = createNode("h2", "heading", { level: 2 });
    const result = headingComponent.render(node, []);
    expect(result.styles.lineHeight).toBe(30);
  });

  it("sets lineHeight proportional to fontSize for level 3", () => {
    const node = createNode("h3", "heading", { level: 3 });
    const result = headingComponent.render(node, []);
    expect(result.styles.lineHeight).toBe(25);
  });

  it("passes children through", () => {
    const child = createTextRenderNode("t1", "Title", {});
    const node = createNode("h1", "heading", { level: 1 });
    const result = headingComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("listComponent", () => {
  it("has type 'list'", () => {
    expect(listComponent.type).toBe("list");
  });

  it("renders a block node without paddingLeft on itself", () => {
    const node = createNode("ol1", "list", { listType: "unordered" });
    const result = listComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.paddingLeft).toBeUndefined();
  });

  it("adds paddingLeft 24 and bullet marker to unordered list-item children", () => {
    const child = createBlockNode("li1", { marginTop: 0, marginBottom: 0 }, []);
    const node = createNode("ol1", "list", { listType: "unordered" });
    const result = listComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    const markedChild = result.children[0];
    expect(markedChild.type).toBe("block");
    if (markedChild.type === "block") {
      expect(markedChild.styles.paddingLeft).toBe(24);
      expect(markedChild.marker).toBe("\u2022");
    }
  });

  it("adds numbered markers to ordered list-item children", () => {
    const child1 = createBlockNode("li1", { marginTop: 0 }, []);
    const child2 = createBlockNode("li2", { marginTop: 0 }, []);
    const node = createNode("ol1", "list", { listType: "ordered" });
    const result = listComponent.render(node, [child1, child2]);
    expect(result.children).toHaveLength(2);
    if (result.children[0].type === "block") {
      expect(result.children[0].marker).toBe("1.");
    }
    if (result.children[1].type === "block") {
      expect(result.children[1].marker).toBe("2.");
    }
  });

  it("does not modify non-block children", () => {
    const child = createTextRenderNode("t1", "item", {});
    const node = createNode("ol1", "list", { listType: "unordered" });
    const result = listComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("listItemComponent", () => {
  it("has type 'list-item'", () => {
    expect(listItemComponent.type).toBe("list-item");
  });

  it("renders a block node with zero margins", () => {
    const node = createNode("li1", "list-item", {});
    const result = listItemComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.marginTop).toBe(0);
    expect(result.styles.marginBottom).toBe(0);
  });

  it("passes children through", () => {
    const child = createTextRenderNode("t1", "text", {});
    const node = createNode("li1", "list-item", {});
    const result = listItemComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("defaultComponents", () => {
  it("contains all seven default component types", () => {
    const types = defaultComponents.map((c) => c.type);
    expect(types).toContain("document");
    expect(types).toContain("paragraph");
    expect(types).toContain("text");
    expect(types).toContain("span");
    expect(types).toContain("heading");
    expect(types).toContain("list");
    expect(types).toContain("list-item");
  });
});
