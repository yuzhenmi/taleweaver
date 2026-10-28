/**
 * Comments slice-0 SPIKE (re-measured under structural identity): blocks are
 * ranges of ONE CRDT sequence delimited by mark items, so a split inserts a mark
 * and a merge deletes one — no character is ever re-minted. The survival matrix
 * (asserted below, a durable record + a guard that flips if the ops ever change):
 *   - insert-before (same block):   SURVIVES
 *   - delete-elsewhere (same block): SURVIVES
 *   - split, anchor in LEFT half:   SURVIVES
 *   - split, anchor in RIGHT half:  SURVIVES
 *   - merge, anchor in right block:  SURVIVES
 *
 * Comment anchors stay paired MARKER embeds (they are inline content and move with
 * the text by construction).
 */
import { describe, it, expect } from "vitest";
import { insertText } from "./ops/insert-text";
import { deleteRange } from "./ops/delete-range";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import type { State } from "./state";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import { relAt, survives } from "../test-utils/relpos-survival";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";

/** doc > [ p("hello world") ] */
function oneBlock(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
    ],
  });
}

/** doc > [ p1("hello"), p2("world") ] (two blocks; "world" lives in p2's own Y.Text). */
function twoBlocks(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
    ],
  });
}

describe("comments slice-0 spike — RelativePosition survival across structural ops", () => {
  it("insert-before (same block) SURVIVES — an offset insert keeps every other char", () => {
    const s0 = oneBlock();
    const rel = relAt(s0, "p", 6); // "w"
    const after = insertText(s0, createPosition("p" as BlockId, 0), "XYZ", {}).state;
    expect(survives(rel, after, "w")).toBe(true);
  });

  it("delete-elsewhere (same block) SURVIVES — an offset delete keeps every other char", () => {
    const s = oneBlock();
    const rel = relAt(s, "p", 6); // "w"
    const after = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 10), createPosition("p" as BlockId, 11)),
    ).state;
    expect(survives(rel, after, "w")).toBe(true);
  });

  it("split — anchors in BOTH halves SURVIVE (a split inserts a mark, no character is re-minted)", () => {
    // Split "hello world" at offset 5 → left "hello", right " world" — same chars on both sides.
    const sL = oneBlock();
    const relLeft = relAt(sL, "p", 2); // "l", left half
    const splitL = splitBlockAtPosition(sL, createPosition("p" as BlockId, 5), createTestAllocator("p2")).state;
    expect(survives(relLeft, splitL, "l")).toBe(true);

    const sR = oneBlock();
    const relRight = relAt(sR, "p", 6); // "w", right half
    const splitR = splitBlockAtPosition(sR, createPosition("p" as BlockId, 5), createTestAllocator("p3")).state;
    expect(survives(relRight, splitR, "w")).toBe(true);
  });

  it("merge — an anchor in the merged-in RIGHT block SURVIVES (a merge deletes the mark only)", () => {
    const s = twoBlocks();
    const rel = relAt(s, "p2", 0); // "w" of "world"
    const merged = mergeAdjacentBlocks(s, "p1" as BlockId, "p2" as BlockId).state;
    expect(survives(rel, merged, "w")).toBe(true);
  });
});
