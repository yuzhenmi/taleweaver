/**
 * Comments slice 1 — marker-embed anchor survival + orphan derivation.
 *
 * This is the load-bearing counterpart to the slice-0 spike
 * (`comment-anchor-survival.test.ts`): where the spike PROVED that a
 * `RelativePosition` orphans on delete / split-right / merge, this test proves
 * that paired zero-width MARKER-EMBEDS (the model the spike forced) SURVIVE the
 * same structural ops — because they are inline content, the existing ops move /
 * clone them with surrounding text for free. The whole point of the pivot is
 * that the survival matrix flips from 3-of-5-orphan (RelativePosition) to
 * all-survive (markers).
 */
import { describe, it, expect } from "vitest";
import {
  insertCommentMarkers,
} from "./ops/insert-comment-markers";
import {
  resolveCommentRange,
  buildCommentRangeIndex,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type CommentId,
} from "./comments";
import { insertText } from "./ops/insert-text";
import { deleteRange } from "./ops/delete-range";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { extractText, builtinEmbedSerializer } from "./extract-text";
import { clonePastedSubtree } from "./clone-pasted-subtree";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import type { State } from "./state";
import { getBlock } from "./state";

const CID = "c1" as CommentId;

/** doc > [ p("hello world") ] */
function oneBlock(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("hello world")]),
      }),
    ],
  });
}

/** doc > [ p1("hello"), p2("world") ] */
function twoBlocks(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("hello")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p1",
        inlineContent: inlineContent([text("world")]),
      }),
    ],
  });
}

/** Comment "world" in p ("hello world"): start at offset 6, end at offset 11. */
function commentWorld(state: State): State {
  return insertCommentMarkers(
    state,
    createSpan(createPosition("p" as BlockId, 6), createPosition("p" as BlockId, 11)),
    CID,
  ).state;
}

describe("insertCommentMarkers + scan — basic resolution", () => {
  it("inserts paired markers and resolveCommentRange returns the range", () => {
    const s = commentWorld(oneBlock());

    const range = resolveCommentRange(s, CID);
    expect(range).not.toBeNull();
    expect(range?.orphaned).toBe(false);
    // start marker sits at the original offset 6; end marker at original 11 +1
    // (the start marker shifted it right by one offset unit).
    expect(range?.start).toEqual(createPosition("p" as BlockId, 6));
    expect(range?.end).toEqual(createPosition("p" as BlockId, 12));

    // Both markers are zero-width bodyless embeds carrying the commentId.
    const items = getBlock(s, "p" as BlockId)?.inlineContent?.items ?? [];
    const embeds = items.filter((it) => it.kind === "embed");
    expect(embeds.length).toBe(2);
    expect(embeds.map((e) => e.kind === "embed" && e.embedType)).toEqual([
      COMMENT_START_EMBED_TYPE,
      COMMENT_END_EMBED_TYPE,
    ]);
    for (const e of embeds) {
      expect(e.kind === "embed" && e.properties).toEqual({ commentId: "c1" });
      expect(e.kind === "embed" && "contentBlockId" in e.properties).toBe(false);
    }
  });

  it("comments a cross-block range (start in p1, end in p2)", () => {
    const s = insertCommentMarkers(
      twoBlocks(),
      createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5)),
      CID,
    ).state;
    const range = resolveCommentRange(s, CID);
    expect(range?.orphaned).toBe(false);
    expect(range?.start.blockId).toBe("p1");
    expect(range?.end.blockId).toBe("p2");
  });

  it("buildCommentRangeIndex keys by commentId", () => {
    const s = commentWorld(oneBlock());
    const index = buildCommentRangeIndex(s);
    expect([...index.keys()]).toEqual(["c1"]);
    expect(index.get(CID)?.orphaned).toBe(false);
  });
});

describe("marker survival across structural ops (the spike's matrix — now ALL survive)", () => {
  it("insert-before SURVIVES — range stays live, shifted right", () => {
    const s = commentWorld(oneBlock());
    const after = insertText(s, createPosition("p" as BlockId, 0), "XYZ", {}).state;
    const range = resolveCommentRange(after, CID);
    expect(range?.orphaned).toBe(false);
    // "XYZ" (3 chars) before the start marker pushes both markers right by 3.
    expect(range?.start).toEqual(createPosition("p" as BlockId, 9));
    expect(range?.end).toEqual(createPosition("p" as BlockId, 15));
  });

  it("delete-elsewhere SURVIVES — markers untouched by an unrelated delete", () => {
    // Delete one char of "hello" (offset 0..1), far from the commented "world".
    const s = commentWorld(oneBlock());
    const after = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 1)),
    ).state;
    const range = resolveCommentRange(after, CID);
    expect(range?.orphaned).toBe(false);
    // One char removed before the markers → both shift left by one.
    expect(range?.start).toEqual(createPosition("p" as BlockId, 5));
    expect(range?.end).toEqual(createPosition("p" as BlockId, 11));
  });

  it("split SURVIVES — markers ride into the new right block", () => {
    // "hello world" with comment on "world" (markers at 6 and 12). Split at 6
    // (just before the start marker) → markers land in the new right block.
    const s = commentWorld(oneBlock());
    const after = splitBlockAtPosition(
      s,
      createPosition("p" as BlockId, 6),
      createTestAllocator("p2"),
    ).state;
    const range = resolveCommentRange(after, CID);
    expect(range?.orphaned).toBe(false);
    // Both markers moved to the new block; the range is still well-formed.
    expect(range?.start.blockId).toBe(range?.end.blockId);
  });

  it("merge SURVIVES — markers ride from the merged-in right block", () => {
    // Comment all of p2 ("world"): start at p2:0, end at p2:5.
    const base = insertCommentMarkers(
      twoBlocks(),
      createSpan(createPosition("p2" as BlockId, 0), createPosition("p2" as BlockId, 5)),
      CID,
    ).state;
    expect(resolveCommentRange(base, CID)?.orphaned).toBe(false);

    const merged = mergeAdjacentBlocks(base, "p1" as BlockId, "p2" as BlockId).state;
    const range = resolveCommentRange(merged, CID);
    expect(range?.orphaned).toBe(false);
    // After merge everything lives in p1.
    expect(range?.start.blockId).toBe("p1");
    expect(range?.end.blockId).toBe("p1");
  });
});

describe("orphan derivation", () => {
  it("whole-range delete (removes BOTH markers) → orphaned / resolve returns null", () => {
    // Markers at offsets 6 (start) and 12 (end) around "world" in "hello world"
    // (the start marker shifts the end to 12). Delete [6, 13) removes the start
    // marker, "world", and the end marker.
    const s = commentWorld(oneBlock());
    const after = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 6), createPosition("p" as BlockId, 13)),
    ).state;
    // No markers remain → no entry in the index → resolve returns null.
    expect(buildCommentRangeIndex(after).has(CID)).toBe(false);
    expect(resolveCommentRange(after, CID)).toBeNull();
  });

  it("delete crossing exactly ONE marker → orphaned", () => {
    // Delete [0, 7): removes "hello " + the start marker at 6, but NOT the end
    // marker. One-sided survivor → orphaned (a concrete position remains).
    const s = commentWorld(oneBlock());
    const after = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 7)),
    ).state;
    const range = resolveCommentRange(after, CID);
    expect(range).not.toBeNull();
    expect(range?.orphaned).toBe(true);
  });
});

describe("I-2 — markers excluded from text extraction", () => {
  it("extractText (builtin serializer) omits the comment markers", () => {
    const s = commentWorld(oneBlock());
    const whole = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 13), // 11 chars + 2 markers
    );
    // Markers serialize to "" — extracted text is exactly the original text,
    // with NO U+FFFC object-replacement chars.
    const out = extractText(s, whole, builtinEmbedSerializer);
    expect(out).toBe("hello world");
    expect(out).not.toContain("￼");
  });
});

describe("I-1 — paste strips comment markers", () => {
  it("clonePastedSubtree drops comment markers (no duplicate commentId)", () => {
    const s = commentWorld(oneBlock());
    const cloned = clonePastedSubtree(s, "p" as BlockId, createTestAllocator("clone"));
    const clonedRoot = cloned.blocks.get(cloned.rootId);
    expect(clonedRoot).toBeDefined();
    const items = clonedRoot?.inlineContent?.items ?? [];
    // No comment markers survive the clone → the pasted text carries no comment.
    const markers = items.filter(
      (it) =>
        it.kind === "embed" &&
        (it.embedType === COMMENT_START_EMBED_TYPE || it.embedType === COMMENT_END_EMBED_TYPE),
    );
    expect(markers.length).toBe(0);
    // The text content is preserved (markers were the only embeds).
    const textContent = items
      .map((it) => (it.kind === "text" ? it.text : ""))
      .join("");
    expect(textContent).toBe("hello world");
  });
});

describe("insertCommentMarkers — validation", () => {
  it("throws when an endpoint block does not resolve", () => {
    expect(() =>
      insertCommentMarkers(
        oneBlock(),
        createSpan(createPosition("nope" as BlockId, 0), createPosition("p" as BlockId, 5)),
        CID,
      ),
    ).toThrow();
  });

  it("throws when an endpoint offset is out of range", () => {
    expect(() =>
      insertCommentMarkers(
        oneBlock(),
        createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 99)),
        CID,
      ),
    ).toThrow();
  });

  it("dirties the host leaf block", () => {
    const result = insertCommentMarkers(
      oneBlock(),
      createSpan(createPosition("p" as BlockId, 6), createPosition("p" as BlockId, 11)),
      CID,
    );
    expect([...result.dirtyIds]).toContain("p");
  });
});
