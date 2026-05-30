// packages/core/src/state/map-agnostic-structural-ops.test.ts
//
// C.2c T7c: the STRUCTURAL Layer-3 edit ops (split / merge / delete-range /
// replace-range) — the ones that CREATE or DELETE blocks and rewire
// sibling/parent pointers — must operate inside the OWNING Y.Map of the
// reference block. After C.2c T1-T7b a caret can sit inside a header/footer
// body, which lives in the templateContents tree; pressing Enter, joining two
// header paragraphs, or selecting-and-deleting across them must mutate the
// templateContents map — including any NEWLY CREATED block, which must inherit
// the reference block's map (a split inside a header body lands the new header
// paragraph in templateContents, NOT the main `blocks` map).
//
// Mechanism: each op resolves ONCE via `resolveBlock(state, <refId>)` to get
// `{ block, kind }`, reads from `block`, threads `kind` to every
// `getYBlock(doc, id, opName, kind)` write site, and routes raw map reads
// through `getTreeMap(doc, kind)` (so new-block `set` / sibling `delete` hit
// the owning map). The main-tree path is byte-identical because `resolveBlock`
// resolves a main-tree id to `kind: "block"`, the `getYBlock` / `getTreeMap`
// default.
//
// This file proves each structural op MUTATES a templateContents header body
// (and, for split, lands the new block in templateContents — observable via
// `getTemplateContent` and NOT via `getBlock`). The existing per-op suites are
// the no-regression guard for the main tree.

import { describe, it, expect } from "vitest";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { deleteRange } from "./ops/delete-range";
import { replaceRange } from "./ops/replace-range";
import { getBlock, getTemplateContent } from "./state";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator } from "./block-id";
import type { BlockId } from "./block-id";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import type { State } from "./state";

const HDR_ROOT = "hdr-root" as BlockId;
const HDR_P1 = "hdr-c1" as BlockId;
const HDR_P2 = "hdr-c2" as BlockId;
const BODY_P = "p" as BlockId;

// A header template body: a ROOT container (parentId === null, in
// templateContents) with two child paragraphs ("alpha", "beta") — enough
// material for split (Enter), merge (join), and cross-block delete inside the
// body. Main document is a single body paragraph. Same fixture shape as
// map-agnostic-ops.test.ts / map-agnostic-helpers.test.ts.
function buildWithHeaderBody(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body text")]),
      }),
    ],
    templateContents: [
      buildBlock({
        id: "hdr-root",
        type: "header",
        parentId: null,
        firstChildId: "hdr-c1",
        lastChildId: "hdr-c2",
      }),
      buildBlock({
        id: "hdr-c1",
        type: "paragraph",
        parentId: "hdr-root",
        nextSiblingId: "hdr-c2",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "hdr-c2",
        type: "paragraph",
        parentId: "hdr-root",
        prevSiblingId: "hdr-c1",
        inlineContent: inlineContent([text("beta")]),
      }),
    ],
  });
}

function joinText(items: ReadonlyArray<{ kind: string; text?: string }> | undefined): string {
  return (items ?? [])
    .map((i) => (i.kind === "text" ? (i as { text: string }).text : ""))
    .join("");
}

describe("C.2c T7c — splitBlockAtPosition inside a templateContents header body", () => {
  it("creates the NEW header paragraph IN templateContents (NOT the main map) with correct rewiring", () => {
    const state = buildWithHeaderBody();
    const allocator = createTestAllocator("hp");
    // Split "alpha" at offset 3 → left "alp", new block "ha".
    const result = splitBlockAtPosition(state, createPosition(HDR_P1, 3), allocator);
    const newId = "hp-0" as BlockId;

    // The new block lives in templateContents, NOT the main blocks map.
    const newBlock = getTemplateContent(result.state, newId);
    expect(newBlock).not.toBeNull();
    expect(getBlock(result.state, newId)).toBeNull();

    // New block content + identity.
    expect(joinText(newBlock?.inlineContent?.items)).toBe("ha");
    expect(newBlock?.type).toBe("paragraph");
    // Parent is the header root (inherited from the original block's parent).
    expect(newBlock?.parentId).toBe(HDR_ROOT);
    expect(newBlock?.prevSiblingId).toBe(HDR_P1);
    // Original hdr-c1's old next sibling becomes the new block's next.
    expect(newBlock?.nextSiblingId).toBe(HDR_P2);

    // Original block: keeps id, content "alp", next rewired to the new block.
    const left = getTemplateContent(result.state, HDR_P1);
    expect(joinText(left?.inlineContent?.items)).toBe("alp");
    expect(left?.nextSiblingId).toBe(newId);

    // hdr-c2's prevSibling rewired to the new block (it sits between).
    const c2 = getTemplateContent(result.state, HDR_P2);
    expect(c2?.prevSiblingId).toBe(newId);

    // dirtyIds reports the touched template ids.
    expect(result.dirtyIds.has(HDR_P1)).toBe(true);
    expect(result.dirtyIds.has(newId)).toBe(true);
    expect(result.dirtyIds.has(HDR_P2)).toBe(true);
  });

  it("splitting the LAST header child rewires the header root's lastChildId in templateContents", () => {
    const state = buildWithHeaderBody();
    const allocator = createTestAllocator("hp");
    // Split the last child "beta" at offset 2 → "be" | "ta".
    const result = splitBlockAtPosition(state, createPosition(HDR_P2, 2), allocator);
    const newId = "hp-0" as BlockId;

    const newBlock = getTemplateContent(result.state, newId);
    expect(newBlock).not.toBeNull();
    expect(getBlock(result.state, newId)).toBeNull();
    expect(joinText(newBlock?.inlineContent?.items)).toBe("ta");
    expect(newBlock?.nextSiblingId).toBeNull();

    // Header root's lastChildId rewired to the new block.
    const root = getTemplateContent(result.state, HDR_ROOT);
    expect(root?.lastChildId).toBe(newId);
    expect(root?.firstChildId).toBe(HDR_P1);
    expect(result.dirtyIds.has(HDR_ROOT)).toBe(true);
  });
});

describe("C.2c T7c — mergeAdjacentBlocks inside a templateContents header body", () => {
  it("merges hdr-c2 into hdr-c1 in templateContents, removing hdr-c2 from the template map", () => {
    const state = buildWithHeaderBody();
    const result = mergeAdjacentBlocks(state, HDR_P1, HDR_P2);

    // hdr-c1 absorbs hdr-c2's content.
    const left = getTemplateContent(result.state, HDR_P1);
    expect(joinText(left?.inlineContent?.items)).toBe("alphabeta");
    // hdr-c1 was the first child; merging the last sibling makes it the last too.
    expect(left?.nextSiblingId).toBeNull();

    // hdr-c2 removed from the templateContents map (and never present in main).
    expect(getTemplateContent(result.state, HDR_P2)).toBeNull();
    expect(getBlock(result.state, HDR_P2)).toBeNull();

    // Header root's lastChildId rewired to hdr-c1 (hdr-c2 was last child).
    const root = getTemplateContent(result.state, HDR_ROOT);
    expect(root?.lastChildId).toBe(HDR_P1);

    expect(result.dirtyIds.has(HDR_P1)).toBe(true);
    expect(result.dirtyIds.has(HDR_P2)).toBe(true);
    expect(result.dirtyIds.has(HDR_ROOT)).toBe(true);
  });
});

describe("C.2c T7c — deleteRange inside a templateContents header body", () => {
  it("cross-block delete (mid-c1 to mid-c2) merges in-tree, all writes in templateContents", () => {
    const state = buildWithHeaderBody();
    // Span from hdr-c1 offset 3 ("alp|ha") to hdr-c2 offset 2 ("be|ta").
    const span = createSpan(createPosition(HDR_P1, 3), createPosition(HDR_P2, 2));
    const result = deleteRange(state, span);

    // hdr-c1 keeps "alp" + hdr-c2 suffix "ta" → "alpta".
    const anchor = getTemplateContent(result.state, HDR_P1);
    expect(joinText(anchor?.inlineContent?.items)).toBe("alpta");
    expect(anchor?.nextSiblingId).toBeNull();

    // hdr-c2 removed from templateContents (not main).
    expect(getTemplateContent(result.state, HDR_P2)).toBeNull();
    expect(getBlock(result.state, HDR_P2)).toBeNull();

    // Header root's lastChildId rewired to the anchor.
    const root = getTemplateContent(result.state, HDR_ROOT);
    expect(root?.lastChildId).toBe(HDR_P1);

    expect(result.dirtyIds.has(HDR_P1)).toBe(true);
    expect(result.dirtyIds.has(HDR_P2)).toBe(true);
  });

  it("same-block delete inside one header paragraph deletes the range in templateContents", () => {
    const state = buildWithHeaderBody();
    // Delete "lph" from "alpha" → "aa": span hdr-c1 [1,4).
    const span = createSpan(createPosition(HDR_P1, 1), createPosition(HDR_P1, 4));
    const result = deleteRange(state, span);

    const block = getTemplateContent(result.state, HDR_P1);
    expect(joinText(block?.inlineContent?.items)).toBe("aa");
    expect(getBlock(result.state, HDR_P1)).toBeNull();
    expect(result.dirtyIds.has(HDR_P1)).toBe(true);

    // hdr-c2 untouched.
    expect(joinText(getTemplateContent(result.state, HDR_P2)?.inlineContent?.items)).toBe("beta");
  });
});

describe("C.2c T7c — replaceRange inside a templateContents header body", () => {
  it("replaces a same-block range in a header paragraph with text (reflected in templateContents)", () => {
    const state = buildWithHeaderBody();
    // Replace "lph" in "alpha" with "XYZ" → "aXYZa": span hdr-c1 [1,4).
    const span = createSpan(createPosition(HDR_P1, 1), createPosition(HDR_P1, 4));
    const result = replaceRange(state, span, "XYZ", {});

    const block = getTemplateContent(result.state, HDR_P1);
    expect(joinText(block?.inlineContent?.items)).toBe("aXYZa");
    expect(getBlock(result.state, HDR_P1)).toBeNull();
    expect(result.dirtyIds.has(HDR_P1)).toBe(true);
  });

  it("replaces a cross-block range across the two header paragraphs (reflected in templateContents)", () => {
    const state = buildWithHeaderBody();
    // Replace from hdr-c1 offset 3 to hdr-c2 offset 2 with "MID":
    //   "alp" + "MID" + "ta" → "alpMIDta" in hdr-c1; hdr-c2 removed.
    const span = createSpan(createPosition(HDR_P1, 3), createPosition(HDR_P2, 2));
    const result = replaceRange(state, span, "MID", {});

    const anchor = getTemplateContent(result.state, HDR_P1);
    expect(joinText(anchor?.inlineContent?.items)).toBe("alpMIDta");
    expect(getTemplateContent(result.state, HDR_P2)).toBeNull();
    expect(getBlock(result.state, HDR_P2)).toBeNull();
    expect(result.dirtyIds.has(HDR_P1)).toBe(true);
  });
});

describe("C.2c T7c — main-tree no-regression smoke (byte-identical structural path)", () => {
  it("split on a main-tree block still creates the new block in the main map", () => {
    const state = buildWithHeaderBody();
    const allocator = createTestAllocator("bp");
    const result = splitBlockAtPosition(state, createPosition(BODY_P, 4), allocator);
    const newId = "bp-0" as BlockId;
    // New block lives in the MAIN map (not templateContents).
    expect(getBlock(result.state, newId)).not.toBeNull();
    expect(getTemplateContent(result.state, newId)).toBeNull();
    expect(joinText(getBlock(result.state, BODY_P)?.inlineContent?.items)).toBe("body");
    expect(joinText(getBlock(result.state, newId)?.inlineContent?.items)).toBe(" text");
  });
});
