// packages/core/src/state/map-agnostic-ops.test.ts
//
// C.2c T7b: the FIVE single-block Layer-3 edit ops must write into the OWNING
// Y.Map of the target block — not the hardcoded main `blocks` map. After
// C.2c T1-T7a a caret can sit inside a header/footer body, which lives in the
// templateContents tree; editing there (typing, attr changes, type changes,
// inline-attr ranges) must mutate the templateContents map, not throw or write
// to the wrong tree.
//
// Mechanism: each op resolves ONCE via `resolveBlock(state, id)` to get
// `{ block, kind }`, reads from `block`, and threads `kind` to every
// `getYBlock(doc, id, opName, kind)` write site. The main-tree path is
// byte-identical because `resolveBlock`'s first arm is `getBlock` and yields
// `kind: "block"`, so `getYBlock(..., "block")` === today's default.
//
// The five ops: insert-text, set-block-attrs, merge-block-attrs,
// set-block-type, apply-attrs. This file proves each MUTATES a
// templateContents header body and that the mutation is observable via
// `getTemplateContent` (and NOT via `getBlock`, which only sees the main map).
// The existing per-op suites are the no-regression guard for the main tree.

import { describe, it, expect } from "vitest";
import { insertText } from "./ops/insert-text";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { mergeBlockAttrs } from "./ops/merge-block-attrs";
import { setBlockType } from "./ops/set-block-type";
import { applyAttrsToRange } from "./ops/apply-attrs";
import { getBlock, getTemplateContent } from "./document";
import { createPosition, createSpan } from "./block-position";
import type { BlockKind, BlockKindResolver } from "./block-kinds";
import { TEST_RESOLVER, buildBlock, buildDocument, inlineContent, text } from "../test-utils/document-builders";
import type { BlockId } from "./block-id";
import type { Document } from "./document";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const HDR_C1 = "hdr-c1" as BlockId;
const HDR_C2 = "hdr-c2" as BlockId;
const BODY_P = "p" as BlockId;

// Narrow BlockKindResolver covering the built-in taxonomy (mirrors the one in
// set-block-type.test.ts). Document ops depend only on the BlockKindResolver
// shape, not the component module.
const TYPE_KINDS: Record<string, BlockKind> = {
  document: "container",
  header: "container",
  footer: "container",
  list: "container",
  table: "container",
  "table-row": "container",
  "table-cell": "container",
  paragraph: "inline-bearing-leaf",
  heading: "inline-bearing-leaf",
  "list-item": "inline-bearing-leaf",
  image: "atomic-leaf",
  "horizontal-line": "atomic-leaf",
};
const resolver: BlockKindResolver = {
  getBlockKind: (t) => TYPE_KINDS[t] ?? null,
  getStorageShape: (t) => TEST_RESOLVER.getStorageShape(t),
};

// A header template body: a ROOT container (parentId === null, in
// templateContents) with two child paragraphs ("alpha", "beta"). Main document
// is a single body paragraph. Same fixture shape as map-agnostic-helpers.test.ts.
function buildWithHeaderBody(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body")]),
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

describe("C.2c T7b — insertText into a templateContents header body", () => {
  it("inserts into the header paragraph (observable via getTemplateContent, NOT getBlock)", () => {
    const document = buildWithHeaderBody();
    // Insert "X" at offset 5 (end of "alpha").
    const result = insertText(document, createPosition(HDR_C1, 5), "X", {});
    const updated = getTemplateContent(result.document, HDR_C1);
    expect(updated?.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe(
      "alphaX",
    );
    // The header block is NOT in the main map.
    expect(getBlock(result.document, HDR_C1)).toBeNull();
    // dirtyIds reports the header child.
    expect(result.dirtyIds.has(HDR_C1)).toBe(true);
  });

  it("inserts mid-run (full-replace path) into the header paragraph", () => {
    const document = buildWithHeaderBody();
    // Insert with DIFFERENT attrs mid-"alpha" → full-replace split path.
    const result = insertText(document, createPosition(HDR_C1, 2), "Z", { bold: true });
    const updated = getTemplateContent(result.document, HDR_C1);
    const joined = updated?.inlineContent?.items
      .map((i) => (i.kind === "text" ? i.text : ""))
      .join("");
    expect(joined).toBe("alZpha");
    expect(getBlock(result.document, HDR_C1)).toBeNull();
  });
});

describe("C.2c T7b — setBlockAttrs on a templateContents header block", () => {
  it("sets attrs on the header child (observable via getTemplateContent)", () => {
    const document = buildWithHeaderBody();
    const result = setBlockAttrs(document, HDR_C1, { textAlign: "center" });
    expect(getTemplateContent(result.document, HDR_C1)?.attrs).toEqual({ textAlign: "center" });
    expect(getBlock(result.document, HDR_C1)).toBeNull();
    expect(result.dirtyIds.has(HDR_C1)).toBe(true);
  });

  it("equal-value setBlockAttrs is an identity no-op", () => {
    const document = buildWithHeaderBody();
    // hdr-c1 starts with {} attrs; set {} again → no-op identity.
    const result = setBlockAttrs(document, HDR_C1, {});
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("C.2c T7b — mergeBlockAttrs on a templateContents header block", () => {
  it("merges attrs on the header child (observable via getTemplateContent)", () => {
    const document = buildWithHeaderBody();
    const result = mergeBlockAttrs(document, HDR_C1, { textAlign: "right" });
    expect(getTemplateContent(result.document, HDR_C1)?.attrs).toEqual({ textAlign: "right" });
    expect(getBlock(result.document, HDR_C1)).toBeNull();
    expect(result.dirtyIds.has(HDR_C1)).toBe(true);
  });

  it("equal-value mergeBlockAttrs is an identity no-op", () => {
    const document = buildWithHeaderBody();
    const result = mergeBlockAttrs(document, HDR_C1, {});
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("C.2c T7b — setBlockType on a templateContents header block", () => {
  it("changes the header child's type (observable via getTemplateContent)", () => {
    const document = buildWithHeaderBody();
    const result = setBlockType(document, HDR_C1, "heading", resolver);
    expect(getTemplateContent(result.document, HDR_C1)?.type).toBe("heading");
    expect(getBlock(result.document, HDR_C1)).toBeNull();
    expect(result.dirtyIds.has(HDR_C1)).toBe(true);
  });

  it("same-type setBlockType is an identity no-op", () => {
    const document = buildWithHeaderBody();
    const result = setBlockType(document, HDR_C1, "paragraph", resolver);
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("C.2c T7b — applyAttrsToRange over a templateContents header range", () => {
  it("applies an inline attr over a range in the header paragraph", () => {
    const document = buildWithHeaderBody();
    // Bold offsets [1, 4) of "alpha" → split into a/lph/a, middle bold.
    const span = createSpan(createPosition(HDR_C1, 1), createPosition(HDR_C1, 4));
    const result = applyAttrsToRange(document, span, { bold: true });
    const items = getTemplateContent(result.document, HDR_C1)?.inlineContent?.items ?? [];
    // Expect three text runs: "a" {}, "lph" {bold}, "a" {}.
    expect(items.map((i) => (i.kind === "text" ? i.text : ""))).toEqual(["a", "lph", "a"]);
    const middle = nth(items, 1, "inline item");
    expect(middle.kind === "text" ? middle.attrs : null).toEqual({ bold: true });
    expect(getBlock(result.document, HDR_C1)).toBeNull();
    expect(result.dirtyIds.has(HDR_C1)).toBe(true);
  });

  it("applies an inline attr across the two header paragraphs", () => {
    const document = buildWithHeaderBody();
    // Span from hdr-c1 offset 1 to hdr-c2 offset 2 → both children touched.
    const span = createSpan(createPosition(HDR_C1, 1), createPosition(HDR_C2, 2));
    const result = applyAttrsToRange(document, span, { italic: true });
    expect(result.dirtyIds.has(HDR_C1)).toBe(true);
    expect(result.dirtyIds.has(HDR_C2)).toBe(true);
    const c1 = getTemplateContent(result.document, HDR_C1)?.inlineContent?.items ?? [];
    const c2 = getTemplateContent(result.document, HDR_C2)?.inlineContent?.items ?? [];
    // hdr-c1: "a" {}, "lpha" {italic}.
    expect(c1.map((i) => (i.kind === "text" ? i.text : ""))).toEqual(["a", "lpha"]);
    // hdr-c2: "be" {italic}, "ta" {}.
    expect(c2.map((i) => (i.kind === "text" ? i.text : ""))).toEqual(["be", "ta"]);
  });
});

describe("C.2c T7b — main-tree no-regression smoke (byte-identical path)", () => {
  it("insertText into a main-tree block still works and is observable via getBlock", () => {
    const document = buildWithHeaderBody();
    const result = insertText(document, createPosition(BODY_P, 4), "!", {});
    const items = getBlock(result.document, BODY_P)?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe("body!");
  });
});
