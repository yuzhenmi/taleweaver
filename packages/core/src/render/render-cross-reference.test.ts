import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { buildState } from "../test-utils/state-builders";
import { buildStateWithListDefs } from "../state/build-state-from-blocks";
import { buildBlock, inlineContent, text, embed } from "../test-utils/state-builders";
import { asBlockId, insertText, removeBlock, createPosition, type ListDef } from "../state";
import { CROSS_REFERENCE_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS } from "../state";
import { BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();
const ORDERED_DEF: ListDef = {
  levels: [{ style: "decimal", start: 1, restart: "after-break" }],
};

/**
 * Locate the single cross-reference element box in a render tree (by its
 * `metadata.embedType`). Returns null if absent. A cross-reference renders as
 * ONE inline-block ElementBox holding exactly one TextBox child — that atom
 * shape is the property under test (one IFC token = the state model's 1-unit
 * EmbedItem offset).
 */
function findCrossRef(root: RenderNode): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    const el = node as ElementBox;
    if (el.metadata?.embedType === CROSS_REFERENCE_EMBED_TYPE) found = el;
    for (const child of el.children) walk(child);
  }
  walk(root);
  return found;
}

/** The resolved display string of a cross-reference atom (its lone text child). */
function crossRefText(el: ElementBox): string {
  expect(el.children).toHaveLength(1);
  const child = el.children[0];
  if (child === undefined) throw new Error("expected one cross-ref child");
  expect(child.type).toBe("text");
  return (child as TextBox).text;
}

describe("render — cross-reference field wiring", () => {
  it("renders a text-mode reference as an inline-block atom carrying the target's text", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("Introduction")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            text("See "),
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
            text(" above."),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    const el = findCrossRef(out.root);
    expect(el).not.toBeNull();
    // The atom is an inline-block (one IFC token), NOT a bare text box that would
    // tokenize the resolved string into N tokens and drift the offset accumulator.
    expect(el?.style.display).toBe("inline-block");
    expect(crossRefText(el as ElementBox)).toBe("Introduction");
    // The atom MUST carry `targetId` in EVERY ref mode so the PDF exporter can
    // emit an internal /GoTo link to the target block (#522). text-mode included.
    expect(el?.metadata?.targetId).toBe("h");
  });

  it("renders a number-mode reference as the target list-item's counter", () => {
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "p" }),
        buildBlock({
          id: "i1",
          type: "list-item",
          parentId: "doc",
          nextSiblingId: "i2",
          attrs: { listId: "L1", listLevel: 0 },
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "i2",
          type: "list-item",
          parentId: "doc",
          prevSiblingId: "i1",
          nextSiblingId: "p",
          attrs: { listId: "L1", listLevel: 0 },
          inlineContent: inlineContent([text("second")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "i2",
          inlineContent: inlineContent([
            text("see item "),
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "i2", refMode: "number" }),
          ]),
        }),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const out = render(state, reg, attrReg);
    const el = findCrossRef(out.root);
    // i2 is the 2nd list-item → counter `formatted` "2". A cross-reference shows
    // the bare number (Word's paragraph-number field); the trailing "." in the
    // list MARKER is the level suffix, not part of the counter value.
    expect(crossRefText(el as ElementBox)).toBe("2");
    // The atom MUST carry `targetId` in EVERY ref mode for the PDF /GoTo link
    // (#522). number-mode included.
    expect(el?.metadata?.targetId).toBe("i2");
  });

  it("renders the broken-reference text for a dangling target", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "ghost", refMode: "text" }),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    const el = findCrossRef(out.root);
    expect(crossRefText(el as ElementBox)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("renders the broken-reference text for a number ref to an unnumbered target", () => {
    // A `number` ref to a plain (non-list-item) paragraph: the target is absent
    // from the list-counter map → broken-ref.
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("Plain")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "number" }),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    const el = findCrossRef(out.root);
    expect(crossRefText(el as ElementBox)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("reflects an edit to the target's text on full re-render", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("Intro")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    expect(crossRefText(findCrossRef(render(state, reg, attrReg).root) as ElementBox)).toBe("Intro");

    // Append to the target; a fresh full render must show the new text.
    const { state: next } = insertText(state, createPosition(asBlockId("h"), 5), "duction", {});
    expect(crossRefText(findCrossRef(render(next, reg, attrReg).root) as ElementBox)).toBe("Introduction");
  });

  it("renders a page-mode reference as a placeholder atom carrying refMode/targetId/numberStyle metadata", () => {
    // A "page" cross-ref is a LAYOUT-dependent field: the target's page is not
    // known at render time, so it renders a PLACEHOLDER atom (like a page-field),
    // carrying the metadata the later layout field-resolution pass discriminates
    // on. The number/text branches still resolve at render time (unchanged).
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("Introduction")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            text("see page "),
            embed(CROSS_REFERENCE_EMBED_TYPE, {
              targetId: "h",
              refMode: "page",
              numberStyle: "decimal",
            }),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    const el = findCrossRef(out.root);
    expect(el).not.toBeNull();
    // One inline-block atom = one IFC token = one cursor stop (#407).
    expect(el?.style.display).toBe("inline-block");
    // The metadata MUST carry refMode + targetId + numberStyle (R-F2) so the
    // later collect/resolve/substitute passes can discriminate the page branch.
    expect(el?.metadata?.refMode).toBe("page");
    expect(el?.metadata?.targetId).toBe("h");
    expect(el?.metadata?.numberStyle).toBe("decimal");
    // The lone text child is the reserved-glyph placeholder ("00"), NOT a resolved
    // value — the real page number is bound late at materialize.
    expect(crossRefText(el as ElementBox)).toBe("0".repeat(PAGE_FIELD_RESERVED_GLYPHS));
  });

  it("renders the atom on the incremental path when the ref host is invalidated", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("Title")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    const prev = render(state, reg, attrReg);
    expect(crossRefText(findCrossRef(prev.root) as ElementBox)).toBe("Title");

    // Re-render incrementally with the ref host "p" invalidated (a no-op state
    // change for the assertion's purposes): the incremental walker must still
    // produce the inline-block atom with the resolved text, not crash on the
    // newly-threaded `numbering` map.
    const out = render(state, reg, attrReg, {
      prev,
      prevState: state,
      dirtyIds: new Set([asBlockId("p")]),
    });
    const el = findCrossRef(out.root);
    expect(el?.style.display).toBe("inline-block");
    expect(crossRefText(el as ElementBox)).toBe("Title");
  });
});

describe("render — cross-reference incremental dirty-propagation (XR.S4)", () => {
  it("re-renders the ref host when the TARGET's text is edited (host not in dirtyIds)", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("Intro")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    const prev = render(state, reg, attrReg);
    expect(crossRefText(findCrossRef(prev.root) as ElementBox)).toBe("Intro");

    // Edit the TARGET only. dirtyIds names "h" (and the doc chain), NOT the host
    // "p". Without the crossReferenceIndex expansion the incremental walk would
    // REUSE p's cached node with the stale "Intro"; the expansion must invalidate
    // p because its target "h" changed value.
    const { state: next, dirtyIds } = insertText(state, createPosition(asBlockId("h"), 5), "duction", {});
    expect(dirtyIds.has(asBlockId("p"))).toBe(false); // host genuinely not dirty
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("Introduction");
  });

  it("re-renders the ref host to broken-ref when the TARGET is deleted (host not in dirtyIds)", () => {
    // "h" is the target; "mid" sits between it and the host "p" so deleting "h"
    // does NOT make "p" an adjacent sibling (p stays out of dirtyIds).
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "mid",
          inlineContent: inlineContent([text("Intro")]),
        }),
        buildBlock({
          id: "mid",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          nextSiblingId: "p",
          inlineContent: inlineContent([text("middle")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "mid",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    const prev = render(state, reg, attrReg);
    expect(crossRefText(findCrossRef(prev.root) as ElementBox)).toBe("Intro");

    const { state: next, dirtyIds } = removeBlock(state, asBlockId("h"));
    expect(dirtyIds.has(asBlockId("p"))).toBe(false); // host genuinely not dirty
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });

  it("re-renders a number-mode host when the target RENUMBERS without itself being dirty", () => {
    // Refs i3 (the 3rd item → "3"). Deleting i1 renumbers i3 to "2"; i3 is NOT
    // adjacent to i1, so i3 ∉ dirtyIds — only the list-renumber diff surfaces it,
    // and the cross-reference expansion must pick the host up via that set.
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "p" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "doc", nextSiblingId: "i2", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "i2", type: "list-item", parentId: "doc", prevSiblingId: "i1", nextSiblingId: "i3", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "i3", type: "list-item", parentId: "doc", prevSiblingId: "i2", nextSiblingId: "p", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("c")]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "i3",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "i3", refMode: "number" }),
          ]),
        }),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const prev = render(state, reg, attrReg);
    expect(crossRefText(findCrossRef(prev.root) as ElementBox)).toBe("3");

    const { state: next, dirtyIds } = removeBlock(state, asBlockId("i1"));
    expect(dirtyIds.has(asBlockId("i3"))).toBe(false); // target renumbers but isn't dirty
    expect(dirtyIds.has(asBlockId("p"))).toBe(false); // host not dirty either
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("2");
  });

  it("populates RenderOutput.crossReferenceIndex (target → hosts) on the full path", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({ id: "h", type: "paragraph", parentId: "doc", nextSiblingId: "p", inlineContent: inlineContent([text("Intro")]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    expect([...(out.crossReferenceIndex.get(asBlockId("h")) ?? [])]).toEqual([asBlockId("p")]);
  });

  it("REUSES the cached index (no O(N) rebuild) when no dirty block touches a cross-reference", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "q" }),
        buildBlock({ id: "h", type: "paragraph", parentId: "doc", nextSiblingId: "p", inlineContent: inlineContent([text("Intro")]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          nextSiblingId: "q",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { targetId: "h", refMode: "text" }),
          ]),
        }),
        buildBlock({ id: "q", type: "paragraph", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([text("z")]) }),
      ],
    });
    const prev = render(state, reg, attrReg);
    // Edit the unrelated paragraph "q" — it holds no cross-reference, so the
    // target→hosts index is provably unchanged and must be reused by reference.
    const { state: next, dirtyIds } = insertText(state, createPosition(asBlockId("q"), 1), "zz", {});
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(out.crossReferenceIndex).toBe(prev.crossReferenceIndex);
  });
});
