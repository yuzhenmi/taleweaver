/**
 * Integration: multiple edits pipeline.
 * TODO Plan 2 — incremental render/layout reuse tests removed.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations-legacy";
import { renderTree } from "../render/render-legacy";
import { moveByWord } from "../cursor/cursor-ops-legacy";
import { registry } from "./setup";

describe("Integration: multiple edits with pipeline", () => {
  it("full render on edit produces correct output", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    // Edit only p1
    const change = insertText(doc, createPosition([0, 0], 5), "!");
    const rendered = renderTree(change.newState, registry);

    if (rendered.type !== "element") throw new Error("expected element");
    const p1Render = rendered.children[0];
    const p2Render = rendered.children[1];

    // Verify content
    if (p1Render.type !== "element") throw new Error("expected element");
    if (p2Render.type !== "element") throw new Error("expected element");
    const p1Text = p1Render.children[0];
    const p2Text = p2Render.children[0];
    if (p1Text.type !== "text") throw new Error("expected text");
    if (p2Text.type !== "text") throw new Error("expected text");
    expect(p1Text.text).toBe("First!");
    expect(p2Text.text).toBe("Second");
  });

  it("word-by-word cursor movement through edited text", () => {
    const text = createTextNode("t1", "one two three");
    const para = createNode("p1", "paragraph", {}, [text]);
    const doc = createNode("doc", "document", {}, [para]);

    let pos = createPosition([0, 0], 0);

    const sel1 = moveByWord(doc, pos, "forward");
    expect(sel1.focus.offset).toBe(3);

    const sel2 = moveByWord(doc, sel1.focus, "forward");
    expect(sel2.focus.offset).toBe(7);

    const sel3 = moveByWord(doc, sel2.focus, "forward");
    expect(sel3.focus.offset).toBe(13);

    const sel4 = moveByWord(doc, sel3.focus, "backward");
    expect(sel4.focus.offset).toBe(8);

    const sel5 = moveByWord(doc, sel4.focus, "backward");
    expect(sel5.focus.offset).toBe(4);

    const sel6 = moveByWord(doc, sel5.focus, "backward");
    expect(sel6.focus.offset).toBe(0);
  });
});
