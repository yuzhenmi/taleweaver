/**
 * Comments slice-0 SPIKE — RESULT: a Yjs `RelativePosition` does NOT survive the
 * engine's STRUCTURAL block ops, so the comments feature uses paired MARKER-EMBED
 * anchors, NOT RelativePosition.
 *
 * Inline storage is one `Y.Text` per block, so every in-block op (insert, delete,
 * format) keeps every surviving character's identity. But a paragraph split moves
 * the tail into a NEW block's `Y.Text` and a merge moves the right block into the
 * left — Yjs cannot reparent items, so those characters are re-minted (the
 * structural-op limit). The measured survival matrix (asserted below, so it is a
 * durable record + a guard that flips if the ops ever change):
 *   - insert-before (same block):   SURVIVES
 *   - delete-elsewhere (same block): SURVIVES
 *   - split, anchor in LEFT half:   SURVIVES
 *   - split, anchor in RIGHT half:  ORPHANS   (moved into the new block)
 *   - merge, anchor in right block:  ORPHANS   (moved into the left block)
 *
 * A comment anchor MUST survive splits and merges, so it is a marker embed: markers
 * ARE inline content, so they move with surrounding text for free.
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

  it("split — anchor in the LEFT half SURVIVES, in the RIGHT half ORPHANS", () => {
    // Split "hello world" at offset 5 → left "hello" (same chars), right " world" (re-minted in the new block).
    const sL = oneBlock();
    const relLeft = relAt(sL, "p", 2); // "l", left half
    const splitL = splitBlockAtPosition(sL, createPosition("p" as BlockId, 5), createTestAllocator("p2")).state;
    expect(survives(relLeft, splitL, "l")).toBe(true);

    const sR = oneBlock();
    const relRight = relAt(sR, "p", 6); // "w", right half
    const splitR = splitBlockAtPosition(sR, createPosition("p" as BlockId, 5), createTestAllocator("p3")).state;
    expect(survives(relRight, splitR, "w")).toBe(false);
  });

  it("merge — anchor in the merged-in RIGHT block ORPHANS (its chars are re-minted in the left block)", () => {
    const s = twoBlocks();
    const rel = relAt(s, "p2", 0); // "w" of "world"
    const merged = mergeAdjacentBlocks(s, "p1" as BlockId, "p2" as BlockId).state;
    expect(survives(rel, merged, "w")).toBe(false);
  });
});
