import { describe, it, expect } from "vitest";
import { getOutline } from "./outline";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";

/**
 * Build a document whose children are the given blocks in order, each linked
 * sibling-to-sibling under a "doc" container. Each spec is `[id, type, attrs,
 * text]`; pass `null` text for a container-less (inlineContent === null) leaf
 * is not needed here — every entry gets inline content.
 */
function buildDoc(
  children: ReadonlyArray<{
    id: string;
    type: string;
    attrs?: Record<string, unknown>;
    text?: string;
  }>,
) {
  const blocks = [
    buildBlock({
      id: "doc",
      type: "document",
      firstChildId: children[0]?.id,
      lastChildId: children[children.length - 1]?.id,
    }),
    ...children.map((child, i) =>
      buildBlock({
        id: child.id,
        type: child.type,
        parentId: "doc",
        prevSiblingId: i > 0 ? children[i - 1].id : undefined,
        nextSiblingId: i < children.length - 1 ? children[i + 1].id : undefined,
        attrs: child.attrs,
        inlineContent: inlineContent(child.text ? [text(child.text)] : []),
      }),
    ),
  ];
  return buildState({ rootId: "doc", blocks });
}

describe("getOutline", () => {
  it("lists only heading blocks, in document order, with level + text", () => {
    const state = buildDoc([
      { id: "h1", type: "heading", attrs: { level: 1 }, text: "Chapter One" },
      { id: "p1", type: "paragraph", text: "body text" },
      { id: "h2", type: "heading", attrs: { level: 2 }, text: "Section A" },
      { id: "p2", type: "paragraph", text: "more body" },
      { id: "h3", type: "heading", attrs: { level: 3 }, text: "Subsection" },
    ]);
    expect(getOutline(state)).toEqual([
      { blockId: "h1", level: 1, text: "Chapter One" },
      { blockId: "h2", level: 2, text: "Section A" },
      { blockId: "h3", level: 3, text: "Subsection" },
    ]);
  });

  it("extracts the heading text", () => {
    const state = buildDoc([
      { id: "h", type: "heading", attrs: { level: 1 }, text: "Chapter One" },
    ]);
    expect(getOutline(state)).toEqual([
      { blockId: "h", level: 1, text: "Chapter One" },
    ]);
  });

  it("lists an empty heading with text \"\" (still an entry)", () => {
    const state = buildDoc([
      { id: "h", type: "heading", attrs: { level: 2 } },
    ]);
    expect(getOutline(state)).toEqual([{ blockId: "h", level: 2, text: "" }]);
  });

  it("reads level from attrs.level when 1–6", () => {
    const state = buildDoc([
      { id: "h", type: "heading", attrs: { level: 3 }, text: "X" },
    ]);
    expect(getOutline(state)[0]?.level).toBe(3);
  });

  it("defaults level to 1 for a missing level attr", () => {
    const state = buildDoc([{ id: "h", type: "heading", text: "X" }]);
    expect(getOutline(state)[0]?.level).toBe(1);
  });

  it("defaults level to 1 for an out-of-range level (0 or 9)", () => {
    const zero = buildDoc([
      { id: "h", type: "heading", attrs: { level: 0 }, text: "X" },
    ]);
    expect(getOutline(zero)[0]?.level).toBe(1);
    const nine = buildDoc([
      { id: "h", type: "heading", attrs: { level: 9 }, text: "X" },
    ]);
    expect(getOutline(nine)[0]?.level).toBe(1);
  });

  it("returns [] for a document with no headings", () => {
    const state = buildDoc([
      { id: "p1", type: "paragraph", text: "a" },
      { id: "p2", type: "paragraph", text: "b" },
    ]);
    expect(getOutline(state)).toEqual([]);
  });

  it("returns [] for an empty document (single empty paragraph)", () => {
    const state = buildDoc([{ id: "p", type: "paragraph" }]);
    expect(getOutline(state)).toEqual([]);
  });

  it("restricts to and orders by the given blockIds", () => {
    const state = buildDoc([
      { id: "h1", type: "heading", attrs: { level: 1 }, text: "One" },
      { id: "p", type: "paragraph", text: "body" },
      { id: "h2", type: "heading", attrs: { level: 2 }, text: "Two" },
    ]);
    // Reverse the heading order; paragraph in the list is skipped (non-heading).
    const ids: BlockId[] = ["h2" as BlockId, "p" as BlockId, "h1" as BlockId];
    expect(getOutline(state, { blockIds: ids })).toEqual([
      { blockId: "h2", level: 2, text: "Two" },
      { blockId: "h1", level: 1, text: "One" },
    ]);
  });

  it("skips blockIds without inline content (container/non-leaf)", () => {
    const state = buildDoc([
      { id: "h", type: "heading", attrs: { level: 1 }, text: "One" },
    ]);
    // "doc" is the document container (inlineContent === null) — skipped even
    // though it is not a heading anyway; the guard runs before the type check.
    const ids: BlockId[] = ["doc" as BlockId, "h" as BlockId];
    expect(getOutline(state, { blockIds: ids })).toEqual([
      { blockId: "h", level: 1, text: "One" },
    ]);
  });
});
