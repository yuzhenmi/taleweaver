import { describe, it, expect } from "vitest";
import { ComponentRegistry, createRegistry } from "./component-registry-legacy";

import { documentComponent } from "./document-legacy";
import { paragraphComponent } from "./paragraph-legacy";
import { textComponent } from "./text-legacy";
import { spanComponent } from "./span-legacy";
import { defaultComponents } from "./index";
import { headingComponent } from "./heading-legacy";
import { listComponent } from "./list-legacy";
import { listItemComponent } from "./list-item-legacy";
import { createNode, createTextNode } from "../state/create-node-legacy";

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
  it("renders an element box with key matching node id", () => {
    const node = createNode("doc", "document");
    const result = documentComponent.render(node, []);
    expect(result.type).toBe("element");
    expect(result.key).toBe("doc");
    if (result.type !== "element") throw new Error("expected element");
    expect(result.children).toHaveLength(0);
  });

  it("passes rendered children through", () => {
    const child = documentComponent.render(createNode("c1", "paragraph"), []);
    const node = createNode("doc", "document");
    const result = documentComponent.render(node, [child]);
    if (result.type !== "element") throw new Error("expected element");
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("paragraphComponent", () => {
  it("renders an element box with display block", () => {
    const node = createNode("p1", "paragraph");
    const result = paragraphComponent.render(node, []);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("expected element");
    expect(result.style.display).toBe("block");
  });
});

describe("textComponent", () => {
  it("renders a text box with content from properties", () => {
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

  it("propagates inline styles from state style", () => {
    const node = createNode("t1", "text", { content: "hi" }, [], { fontWeight: "bold", fontSize: { unit: "px", value: 20 } });
    const result = textComponent.render(node, []);
    if (result.type !== "text") throw new Error("expected text");
    expect(result.style.fontWeight).toBe("bold");
  });
});

describe("spanComponent", () => {
  it("renders an element box (stub: display inline)", () => {
    const node = createNode("s1", "span", {}, [], { fontWeight: "bold" });
    const result = spanComponent.render(node, []);
    expect(result.type).toBe("element");
    if (result.type !== "element") throw new Error("expected element");
    expect(result.style.display).toBe("inline");
  });
});

describe("headingComponent", () => {
  it("renders an element box for heading", () => {
    const node = createNode("h1", "heading", { level: 1 });
    const result = headingComponent.render(node, []);
    expect(result.type).toBe("element");
  });

  it("passes children through", () => {
    const child = textComponent.render(createTextNode("t1", "Title"), []);
    const node = createNode("h1", "heading", { level: 1 });
    const result = headingComponent.render(node, [child]);
    if (result.type !== "element") throw new Error("expected element");
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("listComponent", () => {
  it("renders an element box (stub)", () => {
    const node = createNode("ol1", "list", { listType: "unordered" });
    const result = listComponent.render(node, []);
    expect(result.type).toBe("element");
  });
});

describe("listItemComponent", () => {
  it("renders an element box (stub)", () => {
    const node = createNode("li1", "list-item", {});
    const result = listItemComponent.render(node, []);
    expect(result.type).toBe("element");
  });
});

describe("defaultComponents", () => {
  it("contains all default component types", () => {
    const types = defaultComponents.map((c) => c.type);
    expect(types).toContain("document");
    expect(types).toContain("paragraph");
    expect(types).toContain("text");
    expect(types).toContain("span");
    expect(types).toContain("heading");
    expect(types).toContain("list");
    expect(types).toContain("list-item");
    expect(types).toContain("image");
    expect(types).toContain("horizontal-line");
    expect(types).toContain("table");
    expect(types).toContain("table-row");
    expect(types).toContain("table-cell");
    expect(defaultComponents).toHaveLength(12);
  });
});
