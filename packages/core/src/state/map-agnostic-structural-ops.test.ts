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
  it("creates the NEW header paragraph (the head) IN templateContents (NOT the main map) with correct rewiring", () => {
    const state = buildWithHeaderBody();
    // Split "alpha" at offset 3 → head "alp" (new id), tail "ha" keeps hdr-c1.
    const result = splitBlockAtPosition(state, createPosition(HDR_P1, 3), createTestAllocator("hp"));
    const newId = "hp-0" as BlockId;
    const head = getTemplateContent(result.state, newId);
    expect(head).not.toBeNull();
    expect(getBlock(result.state, newId)).toBeNull();
    expect(joinText(head?.inlineContent?.items)).toBe("alp");
    expect(head?.type).toBe("paragraph");
    expect(head?.parentId).toBe(HDR_ROOT);
    expect(head?.prevSiblingId).toBeNull();
    expect(head?.nextSiblingId).toBe(HDR_P1);
    const tail = getTemplateContent(result.state, HDR_P1);
    expect(joinText(tail?.inlineContent?.items)).toBe("ha");
    expect(tail?.nextSiblingId).toBe(HDR_P2);
    expect(getTemplateContent(result.state, HDR_ROOT)?.firstChildId).toBe(newId);
    expect(result.dirtyIds.has(HDR_P1)).toBe(true);
    expect(result.dirtyIds.has(newId)).toBe(true);
    expect(result.dirtyIds.has(HDR_ROOT)).toBe(true);
  });

  it("splitting the LAST header child: the tail keeps its id and stays the header root's last child", () => {
    const state = buildWithHeaderBody();
    const result = splitBlockAtPosition(state, createPosition(HDR_P2, 2), createTestAllocator("hp"));
    const newId = "hp-0" as BlockId;
    expect(joinText(getTemplateContent(result.state, newId)?.inlineContent?.items)).toBe("be");
    expect(joinText(getTemplateContent(result.state, HDR_P2)?.inlineContent?.items)).toBe("ta");
    const root = getTemplateContent(result.state, HDR_ROOT);
    expect(root?.firstChildId).toBe(HDR_P1);
    expect(root?.lastChildId).toBe(HDR_P2);
    expect(getTemplateContent(result.state, HDR_P1)?.nextSiblingId).toBe(newId);
  });
});

describe("C.2c T7c — mergeAdjacentBlocks inside a templateContents header body", () => {
  it("merges hdr-c1 into hdr-c2 (the survivor) in templateContents, removing hdr-c1", () => {
    const state = buildWithHeaderBody();
    const result = mergeAdjacentBlocks(state, HDR_P1, HDR_P2);
    const survivor = getTemplateContent(result.state, HDR_P2);
    expect(joinText(survivor?.inlineContent?.items)).toBe("alphabeta");
    expect(survivor?.prevSiblingId).toBeNull();
    expect(getTemplateContent(result.state, HDR_P1)).toBeNull();
    expect(getBlock(result.state, HDR_P1)).toBeNull();
    const root = getTemplateContent(result.state, HDR_ROOT);
    expect(root?.firstChildId).toBe(HDR_P2);
    expect(root?.lastChildId).toBe(HDR_P2);
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

    // The focus hdr-c2 survives with "alp" + its suffix "ta" → "alpta".
    const focus = getTemplateContent(result.state, HDR_P2);
    expect(joinText(focus?.inlineContent?.items)).toBe("alpta");
    expect(focus?.prevSiblingId).toBeNull();
    expect(getTemplateContent(result.state, HDR_P1)).toBeNull();
    expect(getBlock(result.state, HDR_P1)).toBeNull();
    expect(getTemplateContent(result.state, HDR_ROOT)?.firstChildId).toBe(HDR_P2);

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
    //   "alp" + "MID" + "ta" → "alpMIDta" in the surviving hdr-c2; hdr-c1 removed.
    const span = createSpan(createPosition(HDR_P1, 3), createPosition(HDR_P2, 2));
    const result = replaceRange(state, span, "MID", {});

    const focus = getTemplateContent(result.state, HDR_P2);
    expect(joinText(focus?.inlineContent?.items)).toBe("alpMIDta");
    expect(getTemplateContent(result.state, HDR_P1)).toBeNull();
    expect(getBlock(result.state, HDR_P1)).toBeNull();
    expect(result.dirtyIds.has(HDR_P2)).toBe(true);
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
    expect(joinText(getBlock(result.state, newId)?.inlineContent?.items)).toBe("body");
    expect(joinText(getBlock(result.state, BODY_P)?.inlineContent?.items)).toBe(" text");
  });
});
