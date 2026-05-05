import { describe, it, expect } from "vitest";
import { replaceRange } from "./replace-range";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("replaceRange — basic single-block replacement", () => {
  // doc > [p("hello world")]
  // Replace range [3, 7) with "FOO" — drops "lo w", inserts "FOO" at position 3.
  // Expected: p("helFOOorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range and inserts the replacement text at the seam", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", {});

    const block = result.state.blocks.get("p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helFOOorld", attrs: {} });

    // dirtyIds: just the modified block (deleteRange dirties "p"; insertText dirties "p"; union = {"p"}).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});

describe("replaceRange — same-block coverage", () => {
  it("replaces a range mid-text-item, inheriting the caller's attrs (NOT the deleted range's attrs)", () => {
    // [text("hello world", { bold: true })] — replace [3, 7) with "FOO" + {italic: true}.
    // Expected items: text("hel", {bold:true}), text("FOO", {italic:true}), text("orld", {bold:true})
    // The inserted text takes the caller's attrs ({italic:true}); the surviving
    // halves keep the block's original attrs ({bold:true}). No run-merging at the
    // seams because attrs differ.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", { italic: true });

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "FOO", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ text: "orld", attrs: { bold: true } });
  });

  it("replaces a range and run-merges with neighbors when attrs match", () => {
    // [text("hello world", { bold: true })] — replace [3, 7) with "FOO" + {bold: true}.
    // After: prefix text("hel", {bold}) + insert text("FOO", {bold}) + suffix text("orld", {bold}).
    // All three have same attrs → run-merged into one item: text("helFOOorld", {bold:true}).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", { bold: true });

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helFOOorld", attrs: { bold: true } });
  });

  it("replaces a range covering an embed item with text", () => {
    // [text("a"), embed("img"), text("b")] — replace [1, 2) (the embed) with "X" + {}.
    // After: anchor [text("a"), text("X"), text("b")] — all same attrs → run-merged.
    // Final: [text("aXb", {})]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = replaceRange(state, span, "X", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "aXb", attrs: {} });
  });

  it("replaces a range that spans multiple text items", () => {
    // [text("ab"), text("cd"), text("ef")] — replace [1, 5) with "Z" + {}.
    // After delete: [text("a"), text("f")] (run-merged from "a" + "f" = "af").
    // After insert at offset 1 (which is now end-of-"a"): [text("aZf", {})] (run-merged).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = replaceRange(state, span, "Z", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "aZf", attrs: {} });
  });
});

describe("replaceRange — cross-block coverage", () => {
  it("replaces a cross-block (adjacent-pair) range with text", () => {
    // doc > [p1("hello"), p2(" world")]
    // Replace from p1@2 to p2@3 with "FOO" + {}.
    // After delete: anchor block has "he" + "rld" = "herld" (p2 deleted).
    // After insert at p1@2: "he" + "FOO" + "rld" = "heFOOrld".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = replaceRange(state, span, "FOO", {});

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "heFOOrld", attrs: {} });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    // dirtyIds: union of deleteRange's dirtyIds ({p1, p2, doc}) + insertText's ({p1}) = {p1, p2, doc}.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("replaces a cross-block range with intervening leaves", () => {
    // doc > [p1("hello"), p2("middle"), p3("world")]
    // Replace from p1@2 to p3@2 with "Z" + {}.
    // After delete: p1 has "he" + "rld" = "herld"; p2 and p3 deleted.
    // After insert at p1@2: "he" + "Z" + "rld" = "heZrld".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("middle")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p3" as BlockId, 2));
    const result = replaceRange(state, span, "Z", {});

    const p1 = result.state.blocks.get("p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "heZrld", attrs: {} });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    expect(result.state.blocks.has("p3" as BlockId)).toBe(false);

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });

  it("inserted text uses the caller's attrs (independent of the surviving anchor block's attrs)", () => {
    // doc > [p1("hello", {bold}), p2(" world", {italic})] — replace p1@2 → p2@3 with "FOO" + {underline: true}.
    // After delete: p1 absorbs "he" {bold} + "rld" {italic} = [text("he", {bold}), text("rld", {italic})].
    // After insert at p1@2: [text("he", {bold}), text("FOO", {underline: true}), text("rld", {italic})].
    // No run-merging since all three have different attrs.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world", { italic: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = replaceRange(state, span, "FOO", { underline: true });

    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "he", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "FOO", attrs: { underline: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { italic: true } });
  });

  it("nested: cross-block replacement inside a section container", () => {
    // doc > section > [p1("hello"), p2(" world")] — replace cross-block inside the section.
    // section's lastChildId rewires; doc untouched.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = replaceRange(state, span, "X", {});

    expect(result.state.blocks.get("p1" as BlockId)?.inlineContent?.items[0]).toMatchObject({ text: "heXrld" });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    expect(result.state.blocks.get("section" as BlockId)?.lastChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("section"); // unchanged
  });
});

describe("replaceRange — edge cases", () => {
  it("collapsed span + empty text is a pure no-op (returns same state, empty dirtyIds)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = replaceRange(state, createSpan(pos, pos), "", {});
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("collapsed span + non-empty text equals insertText at that position", () => {
    // [text("hello")] — collapsed at offset 2 + insert "XY".
    // Expected: [text("heXYllo")] (insert in middle, run-merged).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = replaceRange(state, createSpan(pos, pos), "XY", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "heXYllo", attrs: {} });
    // dirtyIds: just the modified block.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });

  it("non-collapsed span + empty text equals deleteRange (delete only, no insert)", () => {
    // [text("hello world")] — delete [3, 7) with empty text → "helorld".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helorld" });
  });

  it("reverse-order span normalizes correctly", () => {
    // Replace from p@7 to p@3 with "FOO" + {} — same as [3, 7) after normalization.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 7), createPosition("p" as BlockId, 3));
    const result = replaceRange(state, span, "FOO", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helFOOorld" });
  });
});

describe("replaceRange — block-level invariants", () => {
  it("preserves embed-referenced content blocks (no cascade-delete)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + standalone fn-body.
    // Replace p1@0 → p2@0 with "X" + {} — focus's items[0..) keeps the embed; merged into p1; then "X" inserted at p1@0.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("see")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]) }),
        buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: createInlineContent([text("footnote text")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 0));
    const result = replaceRange(state, span, "X", {});

    expect(result.state.blocks.has("fn-body" as BlockId)).toBe(true);
    // p1's content: prefix=[] + "X" inserted at offset 0 + focus.suffix=[embed] → [text("X"), embed].
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "X" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "footnote-anchor" });
  });

  it("preserves structural sharing for blocks NOT touched", () => {
    // doc > [p0, p1, p2, p3] — replace cross-block from p1@2 to p2@2 with "Z".
    // p0 is untouched.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: createInlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("end")]) }),
      ],
    });
    const beforeP0 = state.blocks.get("p0" as BlockId);
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = replaceRange(state, span, "Z", {});
    expect(result.state.blocks.get("p0" as BlockId)).toBe(beforeP0);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 4));
    const result = replaceRange(state, span, "FOO", {});
    expect(result.state).not.toBe(state);
    // Original state still has the original block content.
    expect(state.blocks.get("p" as BlockId)?.inlineContent?.items[0]).toMatchObject({ text: "hello" });
  });

  it("dirtyIds is the union of underlying deleteRange + insertText dirtyIds (full replace)", () => {
    // Cross-block replace where deleteRange dirties {p1, p2, p3, doc} and insertText dirties {p1}.
    // Union (deduped) = {p1, p2, p3, doc}.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("middle")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p3" as BlockId, 2));
    const result = replaceRange(state, span, "X", {});
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });
});

describe("replaceRange — error propagation", () => {
  it("propagates deleteRange's missing-anchor error (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/anchor block ".+" not found/);
  });

  it("propagates deleteRange's container-endpoint error", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/anchor block ".+" is a container/);
  });

  it("propagates deleteRange's cross-parent error", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section1", lastChildId: "section2" }),
        buildBlock({ id: "section1", type: "section", parentId: "doc", nextSiblingId: "section2", firstChildId: "p_a", lastChildId: "p_a" }),
        buildBlock({ id: "p_a", type: "paragraph", parentId: "section1", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "section2", type: "section", parentId: "doc", prevSiblingId: "section1", firstChildId: "p_b", lastChildId: "p_b" }),
        buildBlock({ id: "p_b", type: "paragraph", parentId: "section2", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p_a" as BlockId, 0), createPosition("p_b" as BlockId, 1));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/cross-parent spans are not supported/);
  });

  it("propagates cross-context error (no common ancestor)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/no common ancestor/);
  });

  it("propagates offset-out-of-range error", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 999));
    expect(() => replaceRange(state, span, "X", {})).toThrow(/out of range/);
  });

  it("propagates insertText's offset-out-of-range error for collapsed-span insert-only path", () => {
    // Collapsed span at out-of-range offset, non-empty text → bypasses deleteRange,
    // goes straight to insertText, which throws.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 999);
    expect(() => replaceRange(state, createSpan(pos, pos), "X", {})).toThrow(/out of range/);
  });
});
