import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { TEST_RESOLVER, buildState } from "../test-utils/state-builders";
import { buildStateWithListDefs } from "../state/build-state-from-blocks";
import { buildBlock, inlineContent, text, embed } from "../test-utils/state-builders";
import * as Y from "yjs";
import { asBlockId, getBlock, createHistory, insertText, removeBlock, setBlockAttrs, reparentChildren, deleteRange, createSpan, createPosition, insertCrossReference, splitBlockAtPosition, createState, freshState, subscribeForeignChanges, type ListDef, type BlockId } from "../state";
import { createTestAllocator } from "../state/block-id";
import { STATE_INTERNAL } from "../state/state-internal";
import { resetPerfTrace, setPerfTraceEnabled, report } from "../perf/perf-trace";
import { CROSS_REFERENCE_EMBED_TYPE, PAGE_FIELD_RESERVED_GLYPHS, BOOKMARK_START_EMBED_TYPE, BOOKMARK_END_EMBED_TYPE, type InlineItem, type State } from "../state";
import { BROKEN_CROSS_REFERENCE_TEXT } from "./resolve-cross-reference";
import { buildCrossReferenceIndex, updateCrossReferenceIndex } from "./collect-cross-references";

/** `items` wrapped in a bookmark's markers (fields target bookmarks). */
function bookmarked(id: string, items: InlineItem[]): InlineItem[] {
  return [embed(BOOKMARK_START_EMBED_TYPE, { bookmarkId: id }), ...items, embed(BOOKMARK_END_EMBED_TYPE, { bookmarkId: id })];
}

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();
const ORDERED_DEF: ListDef = {
  levels: [{ style: "decimal", start: 1, restart: "after-break" }],
};

/**
 * Locate the single cross-reference element box in a render tree (by its
 * `metadata.embedType`). Returns null if absent (the first, in document order, when several). A cross-reference renders as
 * ONE inline-block ElementBox holding exactly one TextBox child — that atom
 * shape is the property under test (one IFC token = the state model's 1-unit
 * EmbedItem offset).
 */
function findCrossRef(root: RenderNode): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    const el = node as ElementBox;
    if (el.metadata?.embedType === CROSS_REFERENCE_EMBED_TYPE) found ??= el;
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
          inlineContent: inlineContent([...bookmarked("h", [text("Introduction")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            text("See "),
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" }),
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
    const state = buildStateWithListDefs({ resolver: TEST_RESOLVER,
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
          inlineContent: inlineContent([...bookmarked("i2", [text("second")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "i2",
          inlineContent: inlineContent([
            text("see item "),
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "i2", refMode: "number" }),
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
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "ghost", refMode: "text" }),
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
          inlineContent: inlineContent([...bookmarked("h", [text("Plain")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "number" }),
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
          inlineContent: inlineContent([...bookmarked("h", [text("Intro")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    expect(crossRefText(findCrossRef(render(state, reg, attrReg).root) as ElementBox)).toBe("Intro");

    // Append to the target; a fresh full render must show the new text.
    const { state: next } = insertText(state, createPosition(asBlockId("h"), 6), "duction", {});
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
          inlineContent: inlineContent([...bookmarked("h", [text("Introduction")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            text("see page "),
            embed(CROSS_REFERENCE_EMBED_TYPE, {
              bookmarkId: "h",
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
          inlineContent: inlineContent([...bookmarked("h", [text("Title")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" }),
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
          inlineContent: inlineContent([...bookmarked("h", [text("Intro")])]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" }),
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
    const { state: next, dirtyIds } = insertText(state, createPosition(asBlockId("h"), 6), "duction", {});
    expect(dirtyIds.has(asBlockId("p"))).toBe(false); // host genuinely not dirty
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("Introduction");
    // `prev`'s index was consumed by that render; reusing `prev` rebuilds it (and still refreshes the host).
    const again = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(again.root) as ElementBox)).toBe("Introduction");
  });

  it("re-renders the ref host to broken-ref when the bookmarked text is deleted (host not in dirtyIds)", () => {
    // "h" is the target; "mid" sits between it and the host "p".
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({
          id: "h",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "mid",
          inlineContent: inlineContent([...bookmarked("h", [text("Intro")])]),
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
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    const prev = render(state, reg, attrReg);
    expect(crossRefText(findCrossRef(prev.root) as ElementBox)).toBe("Intro");

    // Deleting exactly the bookmarked text removes the bookmark; only "h" is dirty
    // (a whole-block removal would also dirty the root and re-render every block).
    const history = createHistory(state);
    const caret = createSpan(createPosition(asBlockId("h"), 1), createPosition(asBlockId("h"), 1));
    history.beginEntry("delete", 0, caret);
    const deleted = deleteRange(state, createSpan(createPosition(asBlockId("h"), 1), createPosition(asBlockId("h"), 6)));
    history.commit(deleted, { before: caret, after: caret });
    const { state: next, dirtyIds } = deleted;
    expect([...dirtyIds]).toEqual([asBlockId("h")]);
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    // Undo restores the markers: the bookmark pairs again (broken → paired), host still not dirty.
    const undone = history.undo();
    if (undone === null) throw new Error("expected an undo");
    expect(undone.dirtyIds.has(asBlockId("p"))).toBe(false);
    const restored = render(undone.state, reg, attrReg, { prev: out, prevState: next, dirtyIds: undone.dirtyIds });
    expect(crossRefText(findCrossRef(restored.root) as ElementBox)).toBe("Intro");
  });

  it("re-renders a number-mode host when the target RENUMBERS without itself being dirty", () => {
    // Refs a bookmark starting in i3 (the 3rd item → "3"). Moving i1 to another list renumbers i3 to "2";
    // only i1 is dirty (an attribute change — not the root, whose invalidation would
    // re-render every block), so only the list-renumber diff surfaces i3, and the
    // cross-reference expansion must pick the host up via that set.
    const state = buildStateWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "p" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "doc", nextSiblingId: "i2", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "i2", type: "list-item", parentId: "doc", prevSiblingId: "i1", nextSiblingId: "i3", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("b")]) }),
        // The bookmark starts in i3 and ends in q: a number reads the START's paragraph.
        buildBlock({ id: "i3", type: "list-item", parentId: "doc", prevSiblingId: "i2", nextSiblingId: "q", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([embed(BOOKMARK_START_EMBED_TYPE, { bookmarkId: "i3" }), text("c")]) }),
        buildBlock({ id: "q", type: "paragraph", parentId: "doc", prevSiblingId: "i3", nextSiblingId: "p", inlineContent: inlineContent([text("d"), embed(BOOKMARK_END_EMBED_TYPE, { bookmarkId: "i3" })]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "q",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "i3", refMode: "number" }),
          ]),
        }),
      ],
      listDefs: { L1: ORDERED_DEF, L2: ORDERED_DEF },
    });
    const prev = render(state, reg, attrReg);
    expect(crossRefText(findCrossRef(prev.root) as ElementBox)).toBe("3");

    const { state: next, dirtyIds } = setBlockAttrs(state, asBlockId("i1"), { listId: "L2", listLevel: 0 });
    expect([...dirtyIds]).toEqual([asBlockId("i1")]);
    expect(dirtyIds.has(asBlockId("p"))).toBe(false); // host not dirty either
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("2");
    // Only the START's paragraph decides the number: a renumbered block the range merely
    // covers re-renders no host.
    const none = new Set<BlockId>();
    const idx = buildCrossReferenceIndex(next);
    expect([...updateCrossReferenceIndex(idx, next, next, none, new Set([asBlockId("q")])).staleHosts]).toEqual([]);
  });

  it("populates RenderOutput.crossReferenceIndex (bookmark → hosts, bookmark → range) on the full path", () => {
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({ id: "h", type: "paragraph", parentId: "doc", nextSiblingId: "p", inlineContent: inlineContent([...bookmarked("h", [text("Intro")])]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([
            embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" }),
          ]),
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    expect([...(out.crossReferenceIndex.hosts.get("h") ?? [])]).toEqual([asBlockId("p")]);
    expect(out.crossReferenceIndex.bookmarks.get("h")).toEqual({ start: createPosition(asBlockId("h"), 1), end: createPosition(asBlockId("h"), 6) });
  });

  it("a keystroke in a bookmarked heading reads O(1) blocks of the index, independent of document size", () => {
    // n paragraphs, a bookmark over every 10th, a text-mode field to it in the next.
    const visitedForKeystroke = (n: number): number => {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const state = buildState({
        rootId: asBlockId("doc"),
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: ids[n - 1] ?? "p0" }),
          ...ids.map((id, i) =>
            buildBlock({
              id,
              type: "paragraph",
              parentId: "doc",
              prevSiblingId: i > 0 ? ids[i - 1] : undefined,
              nextSiblingId: i < n - 1 ? ids[i + 1] : undefined,
              inlineContent: inlineContent(
                i % 10 === 0
                  ? bookmarked(`b${i}`, [text("Heading")])
                  : i % 10 === 1
                    ? [text("see "), embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: `b${i - 1}`, refMode: "text" })]
                    : [text("body")],
              ),
            }),
          ),
        ],
      });
      const prev = render(state, reg, attrReg);
      const { state: next, dirtyIds } = insertText(state, createPosition(asBlockId("p0"), 3), "x", {});
      resetPerfTrace();
      setPerfTraceEnabled(true);
      const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
      setPerfTraceEnabled(false);
      const visited = report().entries.find((e) => e.label === "crossReferences.blockRead")?.count ?? 0;
      // The field still resolves the edited text, and the range shifted in place.
      expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("Hexading");
      expect(out.crossReferenceIndex.bookmarks.get("b0")).toEqual({ start: createPosition(asBlockId("p0"), 1), end: createPosition(asBlockId("p0"), 9) });
      return visited;
    };
    const small = visitedForKeystroke(200);
    expect(small).toBeLessThanOrEqual(2);
    expect(visitedForKeystroke(2000)).toBe(small);
  });

  it("keeps the incrementally maintained index equal to a full rebuild across edits (bookmark insert, typing inside / outside a multi-block span, Enter inside it, deleting its start block, moving its end block)", () => {
    // h1 … h4 then the host paragraph; a bookmark spanning h1 … h3 (start in h1, end in h3).
    const state0 = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h1", lastChildId: "p" }),
        buildBlock({ id: "h1", type: "paragraph", parentId: "doc", nextSiblingId: "h2", inlineContent: inlineContent([text("a"), embed(BOOKMARK_START_EMBED_TYPE, { bookmarkId: "s" }), text("bc")]) }),
        buildBlock({ id: "h2", type: "paragraph", parentId: "doc", prevSiblingId: "h1", nextSiblingId: "h3", inlineContent: inlineContent([text("mid")]) }),
        buildBlock({ id: "h3", type: "paragraph", parentId: "doc", prevSiblingId: "h2", nextSiblingId: "h4", inlineContent: inlineContent([text("de"), embed(BOOKMARK_END_EMBED_TYPE, { bookmarkId: "s" }), text("f")]) }),
        buildBlock({ id: "h4", type: "paragraph", parentId: "doc", prevSiblingId: "h3", nextSiblingId: "p", inlineContent: inlineContent([text("tail")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "h4", inlineContent: inlineContent([embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "s", refMode: "text" })]) }),
      ],
    });
    let state = state0;
    let out = render(state, reg, attrReg);
    const step = (r: { state: typeof state; dirtyIds: ReadonlySet<ReturnType<typeof asBlockId>> }, expected: string): void => {
      out = render(r.state, reg, attrReg, { prev: out, prevState: state, dirtyIds: r.dirtyIds });
      state = r.state;
      const full = render(state, reg, attrReg).crossReferenceIndex;
      expect(out.crossReferenceIndex.bookmarks).toEqual(full.bookmarks);
      expect(out.crossReferenceIndex.hosts).toEqual(full.hosts);
      expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe(expected);
    };
    // Typing in a MIDDLE block of the span (neither marker's block is dirty).
    step(insertText(state, createPosition(asBlockId("h2"), 1), "X", {}), "bc\nmXid\nde");
    // Enter in the middle block: the new (head) block is inside the span; typing in it shows.
    const split = splitBlockAtPosition(state, createPosition(asBlockId("h2"), 2), createTestAllocator("n"));
    step(split, "bc\nmX\nid\nde");
    step(insertText(state, createPosition(split.newBlockId, 0), "Y", {}), "bc\nYmX\nid\nde");
    // Typing before the start marker in the start block shifts the range in place.
    step(insertText(state, createPosition(asBlockId("h1"), 0), "Z", {}), "bc\nYmX\nid\nde");
    // Typing after the end block (outside the span) does not touch the field.
    step(insertText(state, createPosition(asBlockId("h4"), 0), "Q", {}), "bc\nYmX\nid\nde");
    // A new bookmark + field (insertCrossReference writes markers around h4).
    step(insertCrossReference(state, createPosition(asBlockId("p"), 1), asBlockId("h4"), "text"), "bc\nYmX\nid\nde");
    // Deleting the START block keeps the bookmark on the remaining text (its start
    // marker moves to the next block: a pairing change).
    step(removeBlock(state, asBlockId("h1")), "YmX\nid\nde");
    // MOVING the end block before the start breaks the bookmark; moving it back repairs it.
    const parent = getBlock(state, asBlockId("h3"))?.parentId ?? asBlockId("doc");
    step(reparentChildren(state, [asBlockId("h3")], parent, split.newBlockId), BROKEN_CROSS_REFERENCE_TEXT);
    step(reparentChildren(state, [asBlockId("h3")], parent, asBlockId("h4")), "YmX\nid\nde");
  });

  describe("MOVES (block ids kept; neither the parent nor a marker block's neighbour is dirty)", () => {
    const para = (id: string, prev: string | undefined, next: string | undefined, items: InlineItem[]) =>
      buildBlock({ id, type: "paragraph", parentId: "doc", prevSiblingId: prev, nextSiblingId: next, inlineContent: inlineContent(items) });
    const table = (prev: string, next: string, cellItems: InlineItem[]) => [
      buildBlock({ id: "T", type: "table", parentId: "doc", prevSiblingId: prev, nextSiblingId: next, firstChildId: "r", lastChildId: "r" }),
      buildBlock({ id: "r", type: "table-row", parentId: "T", firstChildId: "c", lastChildId: "c" }),
      buildBlock({ id: "c", type: "table-cell", parentId: "r", firstChildId: "c1", lastChildId: "c1" }),
      buildBlock({ id: "c1", type: "paragraph", parentId: "c", inlineContent: inlineContent(cellItems) }),
    ];
    const start = (id: string) => embed(BOOKMARK_START_EMBED_TYPE, { bookmarkId: id });
    const end = (id: string) => embed(BOOKMARK_END_EMBED_TYPE, { bookmarkId: id });
    const field = (id: string) => embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: id, refMode: "text" });
    /** Move `block` before `before`, render incrementally, and check against a full render. */
    const moveAndRender = (state: State, block: string, before: string) => {
      const prev = render(state, reg, attrReg);
      const parent = getBlock(state, asBlockId(block))?.parentId ?? asBlockId("doc");
      const r = reparentChildren(state, [asBlockId(block)], parent, asBlockId(before));
      expect(r.dirtyIds.has(parent)).toBe(false);
      const out = render(r.state, reg, attrReg, { prev, prevState: state, dirtyIds: r.dirtyIds });
      expect(out.crossReferenceIndex.bookmarks).toEqual(render(r.state, reg, attrReg).crossReferenceIndex.bookmarks);
      return { r, out };
    };

    it("moving a paragraph holding a bookmark END before its start breaks the bookmark", () => {
      const state = buildState({
        rootId: asBlockId("doc"),
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "Q0", lastChildId: "H" }),
          para("Q0", undefined, "Q1", [text("q0")]),
          para("Q1", "Q0", "A", [text("q1")]),
          para("A", "Q1", "P1", [start("s"), text("a")]),
          para("P1", "A", "E", [text("p1")]),
          para("E", "P1", "P2", [text("e"), end("s")]),
          para("P2", "E", "H", [text("p2")]),
          para("H", "P2", undefined, [field("s")]),
        ],
      });
      const { out } = moveAndRender(state, "E", "Q1");
      expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    });

    it("moving a table whose cell holds a bookmark END before its start breaks the bookmark", () => {
      const state = buildState({
        rootId: asBlockId("doc"),
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "Q0", lastChildId: "H" }),
          para("Q0", undefined, "Q1", [text("q0")]),
          para("Q1", "Q0", "A", [text("q1")]),
          para("A", "Q1", "P1", [start("s"), text("a")]),
          para("P1", "A", "T", [text("p1")]),
          ...table("P1", "P2", [text("cell"), end("s")]),
          para("P2", "T", "H", [text("p2")]),
          para("H", "P2", undefined, [field("s")]),
        ],
      });
      const { r, out } = moveAndRender(state, "T", "Q1");
      expect(r.dirtyIds.has(asBlockId("c1"))).toBe(false);
      expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    });

    it("a table moved INTO a bookmark's span is covered: typing in its (not dirty) cell refreshes the field", () => {
      const state = buildState({
        rootId: asBlockId("doc"),
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "X", lastChildId: "H" }),
          para("X", undefined, "M1", [start("w"), text("x")]),
          para("M1", "X", "M2", [text("m1")]),
          para("M2", "M1", "Y", [text("m2")]),
          para("Y", "M2", "Q", [text("y"), end("w")]),
          para("Q", "Y", "T", [text("q")]),
          ...table("Q", "H", [text("cell")]),
          para("H", "T", undefined, [field("w")]),
        ],
      });
      const { r, out: prev } = moveAndRender(state, "T", "M2");
      const typed = insertText(r.state, createPosition(asBlockId("c1"), 4), "!", {});
      expect([...typed.dirtyIds]).toEqual([asBlockId("c1")]);
      const out = render(typed.state, reg, attrReg, { prev, prevState: r.state, dirtyIds: typed.dirtyIds });
      expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("x\nm1\ncell!\nm2\ny");
    });
  });

  it("refreshes a field when a REMOTE edit changes its bookmarked text", () => {
    const base = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({ id: "h", type: "paragraph", parentId: "doc", nextSiblingId: "p", inlineContent: inlineContent([...bookmarked("h", [text("Intro")])]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "h", inlineContent: inlineContent([embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: "h", refMode: "text" })]) }),
      ],
    });
    const localDoc = new Y.Doc();
    Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(base[STATE_INTERNAL].doc));
    const local = createState({ rootId: base.rootId, doc: localDoc, resolver: TEST_RESOLVER });
    const prev = render(local, reg, attrReg);
    let dirty: ReadonlySet<ReturnType<typeof asBlockId>> = new Set();
    subscribeForeignChanges(local, "self", (ids) => {
      dirty = ids;
    }, () => {});
    base[STATE_INTERNAL].doc.on("update", (u: Uint8Array) => Y.applyUpdate(localDoc, u, "peer"));
    insertText(base, createPosition(asBlockId("h"), 6), "!", {});
    const next = freshState(local, dirty);
    const out = render(next, reg, attrReg, { prev, prevState: local, dirtyIds: dirty });
    expect(dirty.has(asBlockId("p"))).toBe(false);
    expect(crossRefText(findCrossRef(out.root) as ElementBox)).toBe("Intro!");
  });
});
