/**
 * Integration: starting from an empty document.
 */
import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "../state/initial-state-legacy";
import { createPosition, createSpan } from "../state/position";
import { insertText, deleteRange, splitNode } from "../state/transformations-legacy";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { registry, measurer, expectTextBox } from "./setup";

const containerWidth = 200;

describe("Integration: empty document lifecycle", () => {
  it("renders and lays out an empty document", () => {
    const doc = createEmptyDocument();
    const rendered = renderTree(doc, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe("paragraph");
    expect(doc.children[0].children[0].properties.content).toBe("");

    if (layout.type !== "block") throw new Error("expected block");
    expect(layout.children).toHaveLength(1);
  });

  it("inserts text into the empty document", () => {
    const doc = createEmptyDocument();
    const change = insertText(doc, createPosition([0, 0], 0), "Hello");
    const newState = change.newState;

    expect(newState.children[0].children[0].properties.content).toBe("Hello");

    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children).toHaveLength(1);
    const line = para.children[0];
    if (line.type !== "line") throw new Error("expected line");
    expect(expectTextBox(line.children[0]).text).toBe("Hello");
  });

  it("deletes all text to return to empty state", () => {
    const doc = createEmptyDocument();
    const change1 = insertText(doc, createPosition([0, 0], 0), "Hello");
    const withText = change1.newState;

    const range = createSpan(createPosition([0, 0], 0), createPosition([0, 0], 5));
    const change2 = deleteRange(withText, range);
    const empty = change2.newState;

    expect(empty.children[0].children[0].properties.content).toBe("");

    const rendered = renderTree(empty, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    if (layout.type !== "block") throw new Error("expected block");
    expect(layout.children).toHaveLength(1);
  });

  it("splits an empty paragraph into two empty paragraphs", () => {
    const doc = createEmptyDocument();
    const change = splitNode(doc, createPosition([0, 0], 0), "p2");
    const newState = change.newState;

    expect(newState.children).toHaveLength(2);
    expect(newState.children[0].children[0].properties.content).toBe("");
    expect(newState.children[1].children[0].properties.content).toBe("");

    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    if (layout.type !== "block") throw new Error("expected block");
    expect(layout.children).toHaveLength(2);
  });

  it("deletes across two empty paragraphs to fuse them back into one", () => {
    const doc = createEmptyDocument();
    const splitChange = splitNode(doc, createPosition([0, 0], 0), "p2");
    const twoEmpty = splitChange.newState;
    expect(twoEmpty.children).toHaveLength(2);

    const range = createSpan(createPosition([0, 0], 0), createPosition([1, 0], 0));
    const deleteChange = deleteRange(twoEmpty, range);
    const fused = deleteChange.newState;

    expect(fused.children).toHaveLength(1);
    expect(fused.children[0].children[0].properties.content).toBe("");

    const rendered = renderTree(fused, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    if (layout.type !== "block") throw new Error("expected block");
    expect(layout.children).toHaveLength(1);
  });
});
