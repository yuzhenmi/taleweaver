/**
 * Integration: multiple edits with the incremental render/layout pipeline.
 *
 * 1. Start with two paragraphs.
 * 2. Type a character into the first paragraph.
 * 3. Verify the second paragraph's render subtree is reused (same reference).
 * 4. Move cursor by word through edited text.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations";
import { renderTree, renderTreeIncremental } from "../render/render";
import { moveByWord } from "../cursor/cursor-ops";
import { registry, expectTextRender } from "./setup";

describe("Integration: multiple edits with incremental pipeline", () => {
  it("incremental render reuses unchanged paragraph", () => {
    const t1 = createTextNode("t1", "First");
    const t2 = createTextNode("t2", "Second");
    const p1 = createNode("p1", "paragraph", {}, [t1]);
    const p2 = createNode("p2", "paragraph", {}, [t2]);
    const doc = createNode("doc", "document", {}, [p1, p2]);

    const rendered1 = renderTree(doc, registry);

    // Edit only p1
    const change = insertText(doc, createPosition([0, 0], 5), "!");
    const rendered2 = renderTreeIncremental(
      change.newState,
      doc,
      rendered1,
      registry,
    );

    // p2's render node should be reused (same reference)
    expect(rendered2.children[1]).toBe(rendered1.children[1]);
    // p1's render node should be new
    expect(rendered2.children[0]).not.toBe(rendered1.children[0]);

    // Verify content
    expect(expectTextRender(rendered2.children[0].children[0]).text).toBe("First!");
    expect(expectTextRender(rendered2.children[1].children[0]).text).toBe("Second");
  });

  it("word-by-word cursor movement through edited text", () => {
    const text = createTextNode("t1", "one two three");
    const para = createNode("p1", "paragraph", {}, [text]);
    const doc = createNode("doc", "document", {}, [para]);

    // Start at beginning, move forward word by word
    let pos = createPosition([0, 0], 0);

    // Forward word movement always lands at word ends, skipping spaces:
    // "one" (0-3), " " (3-4), "two" (4-7), " " (7-8), "three" (8-13)
    const sel1 = moveByWord(doc, pos, "forward");
    expect(sel1.focus.offset).toBe(3); // end of "one"

    const sel2 = moveByWord(doc, sel1.focus, "forward");
    expect(sel2.focus.offset).toBe(7); // end of "two" (skips space)

    const sel3 = moveByWord(doc, sel2.focus, "forward");
    expect(sel3.focus.offset).toBe(13); // end of "three" (skips space)

    // Move backward
    const sel4 = moveByWord(doc, sel3.focus, "backward");
    expect(sel4.focus.offset).toBe(8); // start of "three"

    const sel5 = moveByWord(doc, sel4.focus, "backward");
    expect(sel5.focus.offset).toBe(4); // start of "two"

    const sel6 = moveByWord(doc, sel5.focus, "backward");
    expect(sel6.focus.offset).toBe(0); // start of "one"
  });
});
