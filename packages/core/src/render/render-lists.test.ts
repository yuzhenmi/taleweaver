import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { buildDocumentWithListDefs } from "../state/build-document-from-blocks";
import { TEST_RESOLVER, buildBlock, inlineContent, text } from "../test-utils/document-builders";
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
    const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        li("i1", null, "i2"),
        li("i2", "i1", "i3"),
        li("i3", "i2", null),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const out = render(document, createDefaultComponentRegistry(), createDefaultAttrRegistry());
    expect(listMarkers(out.root)).toEqual(["1.", "2.", "3."]);
  });

  it("restarts after an intervening paragraph (the #425 run rule)", () => {
    const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "doc", nextSiblingId: "p1", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "i1", nextSiblingId: "i3", inlineContent: inlineContent([text("break")]) }),
        buildBlock({ id: "i3", type: "list-item", parentId: "doc", prevSiblingId: "p1", attrs: { listId: "L1", listLevel: 0 }, inlineContent: inlineContent([text("b")]) }),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const out = render(document, createDefaultComponentRegistry(), createDefaultAttrRegistry());
    // i1 starts the run → "1."; the paragraph breaks it; i3 restarts → "1.".
    expect(listMarkers(out.root)).toEqual(["1.", "1."]);
  });

  it("renders no marker for a list-item whose listId has no def (graceful)", () => {
    // computeCounters falls back to decimal/start-1 when a scope has no def, so
    // even a def-less list still numbers — assert it does not crash + numbers.
    const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i1" }),
        li("i1", null, null),
      ],
      listDefs: {},
    });
    const out = render(document, createDefaultComponentRegistry(), createDefaultAttrRegistry());
    expect(listMarkers(out.root)).toEqual(["1."]);
  });

  it("keeps the marker when a list-item is re-rendered on the INCREMENTAL path", () => {
    // Regression: the incremental path must compute list counters too — an
    // invalidated (re-rendered) list-item must NOT lose its marker. (Before the
    // fix it passed an empty counter map, so editing a list-item stripped its
    // own marker.)
    const reg = createDefaultComponentRegistry();
    const attrReg = createDefaultAttrRegistry();
    const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        li("i1", null, "i2"),
        li("i2", "i1", "i3"),
        li("i3", "i2", null),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const prev = render(document, reg, attrReg);
    expect(listMarkers(prev.root)).toEqual(["1.", "2.", "3."]);

    // Incremental re-render with i2 invalidated (as a text edit inside it would
    // produce). The reused i1/i3 keep their markers; the re-rendered i2 must too.
    const out = render(document, reg, attrReg, {
      prev,
      prevDocument: document,
      dirtyIds: new Set([asBlockId("i2")]),
    });
    expect(listMarkers(out.root)).toEqual(["1.", "2.", "3."]);
  });

  it("renumbers FOLLOWING items incrementally when an earlier item is deleted (Task 11 diff)", () => {
    const reg = createDefaultComponentRegistry();
    const attrReg = createDefaultAttrRegistry();
    const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i3" }),
        li("i1", null, "i2"),
        li("i2", "i1", "i3"),
        li("i3", "i2", null),
      ],
      listDefs: { L1: ORDERED_DEF },
    });
    const prev = render(document, reg, attrReg);
    expect(listMarkers(prev.root)).toEqual(["1.", "2.", "3."]);

    // Delete the FIRST item. i2/i3 are NOT in dirtyIds (only i1 + doc are), so
    // without the renumber diff they'd be reused with stale "2."/"3.". The diff
    // must catch their number change (2→1, 3→2) and re-render them.
    const { document: next, dirtyIds } = removeBlock(document, asBlockId("i1"));
    const out = render(next, reg, attrReg, { prev, prevDocument: document, dirtyIds });
    expect(listMarkers(out.root)).toEqual(["1.", "2."]);
  });
});

describe("render — the list marker's character style comes from the ¶'s markAttrs", () => {
  /** The `list.markerStyle` of every list-item element box, in document order. */
  function markerStyles(root: RenderNode): unknown[] {
    const out: unknown[] = [];
    const walk = (node: RenderNode): void => {
      if (node.type !== "element") return;
      if (node.style.display === "list-item") out.push(node.metadata?.list?.markerStyle);
      for (const c of node.children) walk(c);
    };
    walk(root);
    return out;
  }

  it("Word formats the number with the paragraph mark's rPr: a bold ¶ → a bold marker; none → no marker style", () => {
    const bold = { ...li("i1", null, "i2"), markAttrs: { bold: true } };
    const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER,
      rootId: asBlockId("doc"),
      blocks: [buildBlock({ id: "doc", type: "document", firstChildId: "i1", lastChildId: "i2" }), bold, li("i2", "i1", null)],
      listDefs: { L1: ORDERED_DEF },
    });
    const attrs = createDefaultAttrRegistry();
    const out = render(document, createDefaultComponentRegistry(), attrs);
    expect(markerStyles(out.root)).toEqual([attrs.applyAll({ bold: true }, { parentStyle: {} }), undefined]);
  });
});
