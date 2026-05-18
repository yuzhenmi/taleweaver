/**
 * Integration: inline formatting (span with bold) through the full pipeline.
 * Plan 1: spans rendered as element boxes (stub).
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { moveByCharacter } from "../cursor/cursor-ops";

describe("Integration: inline formatting with span", () => {
  it("cursor moves through span boundary", () => {
    const t1 = createTextNode("t1", "Hi ");
    const spanText = createTextNode("bt", "Bold");
    const span = createNode("s1", "span", {}, [spanText], { fontWeight: "bold" });
    const para = createNode("p1", "paragraph", {}, [t1, span]);
    const doc = createNode("doc", "document", {}, [para]);

    const pos = createPosition([0, 0], 3);
    const sel = moveByCharacter(doc, pos, "forward");

    expect(sel.focus.path).toEqual([0, 1, 0]);
    expect(sel.focus.offset).toBe(0);

    const back = moveByCharacter(doc, sel.focus, "backward");
    expect(back.focus.path).toEqual([0, 0]);
    expect(back.focus.offset).toBe(3);
  });
});
