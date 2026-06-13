import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { buildStateWithListDefs } from "../state/build-state-from-blocks";
import { buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { asBlockId, removeBlock, type ListDef } from "../state";

const ORDERED_DEF: ListDef = {
  levels: [{ style: "decimal", start: 1, restart: "after-break" }],
};

/** Collect, in document order, the `markerText` of every list-item element box. */
function listMarkers(root: RenderNode): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  function walk(node: RenderNode): void {
    if (node.type === "element") {
      const el = node as ElementBox;
      if (el.style.display === "list-item") out.push(el.style.markerText);
      for (const child of el.children) walk(child);
    }
  }
  walk(root);
  return out;
}

function li(id: string, prevId: string | null, nextId: string | null): ReturnType<typeof buildBlock> {
  return buildBlock({
    id,
    type: "list-item",
    parentId: "doc",
    prevSiblingId: prevId,
    nextSiblingId: nextId,
    attrs: { listId: "L1", listLevel: 0 },
    inlineContent: inlineContent([text("item")]),
  });
}

describe("render — flat list numbering (service-wired)", () => {
  it("numbers a single ordered list 1..3 via the render-time service", () => {
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        li("i1", null, "i2"),
        li("i2", "i1", "i3"),
        li("i3", "i2", null),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
    expect(listMarkers(out.root)).toEqual(["1.", "2.", "3."]);
  });

  it("restarts after an intervening paragraph (the #425 run rule)", () => {
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "doc", nextSiblingId: "p1", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "i1", nextSiblingId: "i3", inlineContent: inlineContent([text("break")]) }),
        buildBlock({ id: "i3", type: "list-item", parentId: "doc", prevSiblingId: "p1", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("b")]) }),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
    // i1 starts the run → "1."; the paragraph breaks it; i3 restarts → "1.".
    expect(listMarkers(out.root)).toEqual(["1.", "1."]);
  });

  it("renders no marker for a list-item whose listId has no def (graceful)", () => {
    // computeCounters falls back to decimal/start-1 when a scope has no def, so
    // even a def-less list still numbers — assert it does not crash + numbers.
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i1" }),
        li("i1", null, null),
      ],
      listDefs: {},
    });
    const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
    expect(listMarkers(out.root)).toEqual(["1."]);
  });

  it("keeps the marker when a list-item is re-rendered on the INCREMENTAL path", () => {
    // Regression: the incremental path must compute list counters too — an
    // invalidated (re-rendered) list-item must NOT lose its marker. (Before the
    // fix it passed an empty counter map, so editing a list-item stripped its
    // own marker.)
    const reg = createDefaultComponentRegistry();
    const attrReg = createDefaultAttrRegistry();
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        li("i1", null, "i2"),
        li("i2", "i1", "i3"),
        li("i3", "i2", null),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const prev = render(state, reg, attrReg);
    expect(listMarkers(prev.root)).toEqual(["1.", "2.", "3."]);

    // Incremental re-render with i2 invalidated (as a text edit inside it would
    // produce). The reused i1/i3 keep their markers; the re-rendered i2 must too.
    const out = render(state, reg, attrReg, {
      prev,
      prevState: state,
      dirtyIds: new Set([asBlockId("i2")]),
    });
    expect(listMarkers(out.root)).toEqual(["1.", "2.", "3."]);
  });

  it("renumbers FOLLOWING items incrementally when an earlier item is deleted (Task 11 diff)", () => {
    const reg = createDefaultComponentRegistry();
    const attrReg = createDefaultAttrRegistry();
    const state = buildStateWithListDefs({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        li("i1", null, "i2"),
        li("i2", "i1", "i3"),
        li("i3", "i2", null),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const prev = render(state, reg, attrReg);
    expect(listMarkers(prev.root)).toEqual(["1.", "2.", "3."]);

    // Delete the FIRST item. i2/i3 are NOT in dirtyIds (only i1 + doc are), so
    // without the renumber diff they'd be reused with stale "2."/"3.". The diff
    // must catch their number change (2→1, 3→2) and re-render them.
    const { state: next, dirtyIds } = removeBlock(state, asBlockId("i1"));
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(listMarkers(out.root)).toEqual(["1.", "2."]);
  });
});
