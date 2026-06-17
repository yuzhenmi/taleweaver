/**
 * Comments slice-0 SPIKE — RESULT: a Yjs `RelativePosition` into a per-item
 * `Y.Text` does NOT reliably survive the engine's structural ops, so the comments
 * feature uses paired MARKER-EMBED anchors, NOT RelativePosition.
 *
 * A RelativePosition encodes a target Y-TYPE IDENTITY; it stays valid only while
 * that exact `Y.Text` is mutated in place. The engine's ops do NOT uniformly do
 * that. The measured survival matrix (asserted below, so it's a durable record +
 * a guard that flips if the ops ever change to preserve Y identity):
 *   - insert-before (same block):  SURVIVES  (insertText mutates the Y.Text in place)
 *   - delete-elsewhere (same block): SURVIVES  (surgical deleteRange trims the Y.Text in place;
 *                                              see surgical-inline-ops Phase 1 — was ORPHANS
 *                                              under the old full-rebuild deleteRange)
 *   - split, anchor in LEFT half:  SURVIVES  (left Y.Text kept)
 *   - split, anchor in RIGHT half: ORPHANS   (right half is a fresh Y.Text)
 *   - merge, anchor in right block: ORPHANS  (merge clones the right block's items)
 *
 * A comment anchor MUST survive deletes, splits, and merges. Same-block delete now
 * preserves identity (surgical Phase 1), but cross-block split/merge still orphan
 * (Class-3 structural limit: Yjs forbids reparenting a Y.Text, so moved content is
 * a fresh type) — so RelativePosition is still not viable as the SOLE anchor here.
 * The comments feature uses paired MARKER-EMBED anchors, which reuse the proven
 * footnote-anchor `EmbedItem` machinery: markers ARE inline content, so they
 * move/clone with surrounding text for free. See the comments design spec §1
 * "SPIKE PRECONDITION" and the surgical-inline-ops Phase 1 spec.
 *
 * Each case anchors at a known char, runs an op, then resolves the RelativePosition
 * and reports whether it still addresses the SAME surviving character.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { insertText } from "./ops/insert-text";
import { deleteRange } from "./ops/delete-range";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { getYBlock, getBlocksMap } from "./yjs-doc";
import { STATE_INTERNAL } from "./state-internal";
import type { State } from "./state";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
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

function docOf(state: State): Y.Doc {
  return state[STATE_INTERNAL].doc;
}

/** The first item's `Y.Text` for block `id` (used to MINT the anchor pre-op). */
function firstItemText(state: State, id: string): Y.Text {
  const yBlock = getYBlock(docOf(state), id as BlockId, "firstItemText");
  const yInline = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  return yInline.get(0).get("text") as Y.Text;
}

/** Every LIVE text-item `Y.Text` reachable from the blocks map (the set of "alive" texts). */
function liveItemTexts(state: State): Set<Y.Text> {
  const out = new Set<Y.Text>();
  for (const yBlock of getBlocksMap(docOf(state)).values()) {
    const yInline = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>> | null;
    if (yInline === null) continue;
    for (let i = 0; i < yInline.length; i++) {
      const yItem = yInline.get(i);
      if (yItem.get("kind") === "text") out.add(yItem.get("text") as Y.Text);
    }
  }
  return out;
}

/**
 * SOUND survival measure: the RelativePosition "survived" only if it resolves to a
 * `Y.Text` that is STILL LIVE in the document (reachable from the blocks map) AND
 * holds `expectChar` at the resolved index. The liveness check is load-bearing —
 * Yjs can still resolve a position into a REPLACED/CLONED-but-store-resident
 * `Y.Text` (whose own `_item` is not tombstoned when only its containing array slot
 * was replaced), which would be a false positive. A rebuilt/cloned `Y.Text` is NOT
 * in the live set → correctly reported as orphaned. Uniform across insert / delete /
 * split / merge — no per-op assumptions about WHERE the char lands.
 */
function survives(doc: Y.Doc, rel: Y.RelativePosition, state: State, expectChar: string): boolean {
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc); // (relPos, doc) — relPos FIRST
  if (abs === null || !(abs.type instanceof Y.Text)) return false;
  if (!liveItemTexts(state).has(abs.type)) return false; // resolved into a dead/replaced text
  return abs.type.toString().charAt(abs.index) === expectChar;
}

describe("comments slice-0 spike — RelativePosition survival across structural ops", () => {
  it("insert-before (same block) SURVIVES — insertText mutates the Y.Text in place", () => {
    const s0 = oneBlock();
    const rel = Y.createRelativePositionFromTypeIndex(firstItemText(s0, "p"), 6); // "w"
    const after = insertText(s0, createPosition("p" as BlockId, 0), "XYZ", {}).state;
    expect(survives(docOf(after), rel, after, "w")).toBe(true);
  });

  it("delete-elsewhere (same block) SURVIVES — surgical deleteRange trims the Y.Text in place", () => {
    // Post surgical-inline-ops Phase 1: a same-block delete mutates the existing Y.Text
    // in place (was a full rebuild that orphaned every anchor). A RelativePosition into
    // a surviving run now keeps resolving.
    const s = oneBlock();
    const rel = Y.createRelativePositionFromTypeIndex(firstItemText(s, "p"), 6); // "w"
    const after = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 10), createPosition("p" as BlockId, 11)),
    ).state;
    expect(survives(docOf(after), rel, after, "w")).toBe(true);
  });

  it("split — anchor in the LEFT half SURVIVES, in the RIGHT half ORPHANS", () => {
    // Split "hello world" at offset 5 → left "hello" (same Y.Text, shortened), right " world" (new Y.Text).
    const sL = oneBlock();
    const relLeft = Y.createRelativePositionFromTypeIndex(firstItemText(sL, "p"), 2); // "l", left half
    const splitL = splitBlockAtPosition(sL, createPosition("p" as BlockId, 5), createTestAllocator("p2")).state;
    expect(survives(docOf(splitL), relLeft, splitL, "l")).toBe(true);

    const sR = oneBlock();
    const relRight = Y.createRelativePositionFromTypeIndex(firstItemText(sR, "p"), 6); // "w", right half
    const splitR = splitBlockAtPosition(sR, createPosition("p" as BlockId, 5), createTestAllocator("p3")).state;
    expect(survives(docOf(splitR), relRight, splitR, "w")).toBe(false);
  });

  it("merge — anchor in the merged-in RIGHT block ORPHANS (merge clones the right items)", () => {
    const s = twoBlocks();
    const rel = Y.createRelativePositionFromTypeIndex(firstItemText(s, "p2"), 0); // "w" of "world"
    const merged = mergeAdjacentBlocks(s, "p1" as BlockId, "p2" as BlockId).state;
    expect(survives(docOf(merged), rel, merged, "w")).toBe(false);
  });
});
