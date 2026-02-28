/**
 * Integration: starting from an empty document.
 *
 * Every word processor session starts with an empty document. This tests
 * the full lifecycle: empty → insert → delete → split.
 */
import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "../state/initial-state";
import { createPosition, createSpan } from "../state/position";
import { insertText, deleteRange, splitNode } from "../state/transformations";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { registry, measurer, expectTextBox } from "./setup";

const containerWidth = 200;

describe("Integration: empty document lifecycle", () => {
  it("renders and lays out an empty document", () => {
    const doc = createEmptyDocument();
    const rendered = renderTree(doc, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    // 1 paragraph
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe("paragraph");

    // 1 text node with empty content
    expect(doc.children[0].children).toHaveLength(1);
    expect(doc.children[0].children[0].properties.content).toBe("");

    // Layout: 1 paragraph, no lines (empty text produces no word boxes)
    expect(layout.children).toHaveLength(1);
  });

  it("inserts text into the empty document", () => {
    const doc = createEmptyDocument();
    const pos = createPosition([0, 0], 0);
    const change = insertText(doc, pos, "Hello");
    const newState = change.newState;

    expect(newState.children[0].children[0].properties.content).toBe("Hello");

    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);

    const para = layout.children[0];
    expect(para.children).toHaveLength(1); // one line
    expect(expectTextBox(para.children[0].children[0]).text).toBe("Hello");
  });

  it("deletes all text to return to empty state", () => {
    const doc = createEmptyDocument();
    const change1 = insertText(doc, createPosition([0, 0], 0), "Hello");
    const withText = change1.newState;

    // Delete all text
    const range = createSpan(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    );
    const change2 = deleteRange(withText, range);
    const empty = change2.newState;

    expect(empty.children[0].children[0].properties.content).toBe("");

    // Render and layout the emptied document
    const rendered = renderTree(empty, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    expect(layout.children).toHaveLength(1);
  });

  it("splits an empty paragraph into two empty paragraphs", () => {
    const doc = createEmptyDocument();
    const pos = createPosition([0, 0], 0);
    const change = splitNode(doc, pos, "p2");
    const newState = change.newState;

    expect(newState.children).toHaveLength(2);
    expect(newState.children[0].children[0].properties.content).toBe("");
    expect(newState.children[1].children[0].properties.content).toBe("");

    // Both paragraphs render and layout
    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    expect(layout.children).toHaveLength(2);
  });

  it("deletes across two empty paragraphs to fuse them back into one", () => {
    const doc = createEmptyDocument();

    // Split to get two empty paragraphs
    const splitChange = splitNode(doc, createPosition([0, 0], 0), "p2");
    const twoEmpty = splitChange.newState;
    expect(twoEmpty.children).toHaveLength(2);

    // Delete from end of p1 (offset 0) to start of p2 (offset 0)
    // This is a cross-node delete that fuses two empty paragraphs
    const range = createSpan(
      createPosition([0, 0], 0),
      createPosition([1, 0], 0),
    );
    const deleteChange = deleteRange(twoEmpty, range);
    const fused = deleteChange.newState;

    expect(fused.children).toHaveLength(1);
    expect(fused.children[0].children[0].properties.content).toBe("");

    const rendered = renderTree(fused, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    expect(layout.children).toHaveLength(1);
  });
});
