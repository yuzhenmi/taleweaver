import { describe, it, expect } from "vitest";
import { getActiveFormatting } from "./active-formatting";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import type { ReadonlyAttrs } from "./attrs";
import { createPosition, createSpan } from "./block-position";
import type { Selection } from "./block-position";

/**
 * Build a single leaf block (id "p") whose inline content is the given items,
 * each described by `[text, attrs?]`. The block carries the optional
 * block-level `attrs` and `type` (default "paragraph").
 */
function doc(
  items: ReadonlyArray<readonly [string, ReadonlyAttrs?]>,
  opts?: { type?: string; attrs?: Record<string, unknown> },
) {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: opts?.type ?? "paragraph",
        parentId: "doc",
        attrs: opts?.attrs,
        inlineContent: inlineContent(items.map(([t, a]) => text(t, a))),
      }),
    ],
  });
}

/** A collapsed selection at (blockId, offset). */
function caret(blockId: string, offset: number): Selection {
  const p = createPosition(blockId as never, offset);
  return createSpan(p, p);
}

/** A range selection spanning (blockId, start)..(blockId, end). */
function range(blockId: string, start: number, end: number): Selection {
  return createSpan(
    createPosition(blockId as never, start),
    createPosition(blockId as never, end),
  );
}

describe("getActiveFormatting — inline toggles", () => {
  it("collapsed cursor inside a bold run → bold true", () => {
    // "abc" all bold; cursor at offset 2 (left-of-cursor item is the bold run).
    const state = doc([["abc", { bold: true }]]);
    expect(getActiveFormatting(state, caret("p", 2)).bold).toBe(true);
  });

  it("collapsed cursor inside a plain run → bold false", () => {
    const state = doc([["abc"]]);
    expect(getActiveFormatting(state, caret("p", 2)).bold).toBe(false);
  });

  it("range fully covering bold text → bold true", () => {
    const state = doc([["abc", { bold: true }]]);
    expect(getActiveFormatting(state, range("p", 0, 3)).bold).toBe(true);
  });

  it("range half bold / half plain → bold mixed", () => {
    // "ab" bold, "cd" plain — span 0..4 overlaps both.
    const state = doc([["ab", { bold: true }], ["cd"]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).bold).toBe("mixed");
  });

  it("range over plain text only → bold false", () => {
    const state = doc([["abcd"]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).bold).toBe(false);
  });

  it("#393: a run carrying BOTH underline + strikethrough reports both active", () => {
    // The read path reads the two inline attrs independently, so a multi-
    // decorated run surfaces both toggles as active at once (Google Docs
    // parity — toolbar lights up underline AND strikethrough together).
    const state = doc([["abc", { underline: true, strikethrough: true }]]);
    const fmt = getActiveFormatting(state, range("p", 0, 3));
    expect(fmt.underline).toBe(true);
    expect(fmt.strikethrough).toBe(true);
  });
});

describe("getActiveFormatting — inline values", () => {
  it("range where every item carries fontSize 24 → 24", () => {
    const state = doc([["ab", { fontSize: 24 }], ["cd", { fontSize: 24 }]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).fontSize).toBe(24);
  });

  it("range with differing fontSize → mixed", () => {
    const state = doc([["ab", { fontSize: 24 }], ["cd", { fontSize: 18 }]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).fontSize).toBe("mixed");
  });

  it("range with no fontSize attr → null", () => {
    const state = doc([["abcd"]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).fontSize).toBeNull();
  });

  it("string value (color) common across the span → that value", () => {
    const state = doc([["ab", { color: "#ff0000" }], ["cd", { color: "#ff0000" }]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).color).toBe("#ff0000");
  });

  it("collapsed cursor reads link from the left-of-cursor item", () => {
    const state = doc([["link", { link: "https://x.test" }]]);
    expect(getActiveFormatting(state, caret("p", 4)).link).toBe("https://x.test");
  });

  it("textTransform uniform across the span → that value", () => {
    const state = doc([
      ["ab", { textTransform: "uppercase" }],
      ["cd", { textTransform: "uppercase" }],
    ]);
    expect(getActiveFormatting(state, range("p", 0, 4)).textTransform).toBe("uppercase");
  });

  it("textTransform differing across the span → mixed", () => {
    const state = doc([
      ["ab", { textTransform: "uppercase" }],
      ["cd", { textTransform: "lowercase" }],
    ]);
    expect(getActiveFormatting(state, range("p", 0, 4)).textTransform).toBe("mixed");
  });

  it("range with no textTransform attr → null", () => {
    const state = doc([["abcd"]]);
    expect(getActiveFormatting(state, range("p", 0, 4)).textTransform).toBeNull();
  });
});

describe("getActiveFormatting — block attrs", () => {
  it("focus block textAlign center → center", () => {
    const state = doc([["abc"]], { attrs: { textAlign: "center" } });
    expect(getActiveFormatting(state, caret("p", 1)).textAlign).toBe("center");
  });

  it("textAlign differing across a multi-block range → mixed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2",
          attrs: { textAlign: "center" },
          inlineContent: inlineContent([text("aa")]),
        }),
        buildBlock({
          id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1",
          attrs: { textAlign: "end" },
          inlineContent: inlineContent([text("bb")]),
        }),
      ],
    });
    const sel = createSpan(createPosition("p1" as never, 0), createPosition("p2" as never, 2));
    expect(getActiveFormatting(state, sel).textAlign).toBe("mixed");
  });

  it("focus block with no textAlign attr → null", () => {
    const state = doc([["abc"]]);
    expect(getActiveFormatting(state, caret("p", 1)).textAlign).toBeNull();
  });

  it("paragraph block → blockType 'paragraph', headingLevel null", () => {
    const state = doc([["abc"]]);
    const fmt = getActiveFormatting(state, caret("p", 1));
    expect(fmt.blockType).toBe("paragraph");
    expect(fmt.headingLevel).toBeNull();
  });

  it("heading block → blockType 'heading', headingLevel from attrs.level", () => {
    const state = doc([["Title"]], { type: "heading", attrs: { level: 2 } });
    const fmt = getActiveFormatting(state, caret("p", 1));
    expect(fmt.blockType).toBe("heading");
    expect(fmt.headingLevel).toBe(2);
  });

  it("paragraph + heading multi-block range → blockType mixed", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2",
          inlineContent: inlineContent([text("aa")]),
        }),
        buildBlock({
          id: "p2", type: "heading", parentId: "doc", prevSiblingId: "p1",
          attrs: { level: 1 },
          inlineContent: inlineContent([text("bb")]),
        }),
      ],
    });
    const sel = createSpan(createPosition("p1" as never, 0), createPosition("p2" as never, 2));
    expect(getActiveFormatting(state, sel).blockType).toBe("mixed");
  });
});

describe("getActiveFormatting — empty block", () => {
  it("collapsed cursor in an empty paragraph → toggles false, values null, blockType 'paragraph'", () => {
    const state = doc([["", undefined]]);
    const fmt = getActiveFormatting(state, caret("p", 0));
    expect(fmt.bold).toBe(false);
    expect(fmt.italic).toBe(false);
    expect(fmt.underline).toBe(false);
    expect(fmt.strikethrough).toBe(false);
    expect(fmt.fontSize).toBeNull();
    expect(fmt.fontFamily).toBeNull();
    expect(fmt.color).toBeNull();
    expect(fmt.backgroundColor).toBeNull();
    expect(fmt.link).toBeNull();
    expect(fmt.textTransform).toBeNull();
    expect(fmt.blockType).toBe("paragraph");
    expect(fmt.headingLevel).toBeNull();
    expect(fmt.textAlign).toBeNull();
    expect(fmt.lineHeight).toBeNull();
    expect(fmt.marginInlineStart).toBeNull();
    expect(fmt.marginBlockStart).toBeNull();
    expect(fmt.marginBlockEnd).toBeNull();
  });
});
