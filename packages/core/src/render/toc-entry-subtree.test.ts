import { describe, it, expect } from "vitest";
import type { OutlineEntry } from "../state/outline";
import type { BlockId } from "../state";
import { CROSS_REFERENCE_EMBED_TYPE, TAB_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS } from "../state";
import type { TocAttrs } from "../components/table-of-contents-attrs";
import { DEFAULT_TOC_ATTRS } from "../components/table-of-contents-attrs";
import { buildTocEntrySubtree } from "./toc-entry-subtree";
import type { ElementBox, TextBox } from "./render-node";

const TOC_ID = "toc1" as BlockId;

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function entry(id: string, level: number, text: string): OutlineEntry {
  return { blockId: id as BlockId, level, text };
}

function asElement(node: { type: string }): ElementBox {
  if (node.type !== "element") throw new Error("expected element box");
  return node as ElementBox;
}

function asText(node: { type: string }): TextBox {
  if (node.type !== "text") throw new Error("expected text box");
  return node as TextBox;
}

describe("buildTocEntrySubtree", () => {
  it("emits one entry-line block per outline entry whose level ∈ attrs.levels (dense indices)", () => {
    const outline: OutlineEntry[] = [
      entry("h1", 1, "Intro"),
      entry("h2", 3, "Deep"), // level 3 NOT in levels → dropped
      entry("h3", 2, "Body"),
    ];
    const attrs: TocAttrs = { ...DEFAULT_TOC_ATTRS, levels: [1, 2] };
    const boxes = buildTocEntrySubtree(outline, attrs, TOC_ID);

    expect(boxes).toHaveLength(2);
    // dense indices: 0 (h1), 1 (h3) — the dropped h2 does not consume an index.
    expect(nth(boxes, 0, "entry box").key).toBe(`${TOC_ID}/entry/0`);
    expect(nth(boxes, 1, "entry box").key).toBe(`${TOC_ID}/entry/1`);
    // second surviving entry is the level-2 heading "Body" / id "h3".
    expect(nth(boxes, 1, "entry box").metadata?.navTarget).toBe("h3" as BlockId);
  });

  it("entry-line block: block display, margin per level, content-edge tab stop, nav metadata", () => {
    const outline: OutlineEntry[] = [
      entry("hA", 1, "One"),
      entry("hB", 3, "Three"),
    ];
    const attrs: TocAttrs = { ...DEFAULT_TOC_ATTRS, levels: [1, 2, 3], indentStep: 18, leader: "dot" };
    const boxes = buildTocEntrySubtree(outline, attrs, TOC_ID);

    const first = nth(boxes, 0, "entry box");
    expect(first.style.display).toBe("block");
    expect(first.style.marginInlineStart).toBe(0); // level 1 → 0
    expect(first.style.tabStops).toEqual([
      { position: 0, alignment: "content-edge", leader: "dot" },
    ]);
    expect(first.metadata).toEqual({ tocEntry: true, navTarget: "hA" as BlockId });

    const second = nth(boxes, 1, "entry box");
    expect(second.style.marginInlineStart).toBe(2 * 18); // level 3 → 2*indentStep
    expect(second.metadata).toEqual({ tocEntry: true, navTarget: "hB" as BlockId });
  });

  it("children: text run, tab box, page atom (showPageNumbers default true)", () => {
    const outline: OutlineEntry[] = [entry("hA", 2, "Chapter")];
    const attrs: TocAttrs = { ...DEFAULT_TOC_ATTRS };
    const boxes = buildTocEntrySubtree(outline, attrs, TOC_ID);

    const block = nth(boxes, 0, "entry box");
    expect(block.children).toHaveLength(3);

    const textRunNode = nth(block.children, 0, "text run node");
    const tabNode = nth(block.children, 1, "tab node");
    const pageNode = nth(block.children, 2, "page node");
    const textRun = asText(textRunNode);
    expect(textRun.key).toBe(`${TOC_ID}/entry/0/text`);
    expect(textRun.text).toBe("Chapter");

    const tabBox = asElement(tabNode);
    expect(tabBox.key).toBe(`${TOC_ID}/entry/0/tab`);
    expect(tabBox.style.display).toBe("inline-block");
    expect(tabBox.style.inlineSize).toBe(0);
    expect(tabBox.metadata?.embedType).toBe(TAB_EMBED_TYPE);

    const pageAtom = asElement(pageNode);
    expect(pageAtom.key).toBe(`${TOC_ID}/toc/0`);
    expect(pageAtom.style.display).toBe("inline-block");
    expect(pageAtom.metadata).toEqual({
      embedType: CROSS_REFERENCE_EMBED_TYPE,
      refMode: "page",
      targetId: "hA" as BlockId,
      numberStyle: "decimal",
    });
    // exactly ONE placeholder text child, key `${tocId}/toc/0/0`, reserved glyphs.
    expect(pageAtom.children).toHaveLength(1);
    const placeholder = asText(nth(pageAtom.children, 0, "placeholder text"));
    expect(placeholder.key).toBe(`${TOC_ID}/toc/0/0`);
    expect(placeholder.text).toBe("0".repeat(PAGE_FIELD_RESERVED_GLYPHS));
  });

  it("showPageNumbers:false → only the text run, no tab stops, nav metadata preserved", () => {
    const outline: OutlineEntry[] = [entry("hA", 1, "Solo")];
    const attrs: TocAttrs = { ...DEFAULT_TOC_ATTRS, showPageNumbers: false };
    const boxes = buildTocEntrySubtree(outline, attrs, TOC_ID);

    const block = nth(boxes, 0, "entry box");
    expect(block.children).toHaveLength(1);
    expect(asText(nth(block.children, 0, "text run")).text).toBe("Solo");
    expect(block.style.tabStops).toBeUndefined();
    expect(block.metadata).toEqual({ tocEntry: true, navTarget: "hA" as BlockId });
  });

  it("empty outline → []", () => {
    expect(buildTocEntrySubtree([], DEFAULT_TOC_ATTRS, TOC_ID)).toEqual([]);
  });

  it("all entries filtered out → []", () => {
    const outline: OutlineEntry[] = [entry("hA", 4, "Deep")];
    const attrs: TocAttrs = { ...DEFAULT_TOC_ATTRS, levels: [1, 2] };
    expect(buildTocEntrySubtree(outline, attrs, TOC_ID)).toEqual([]);
  });
});
