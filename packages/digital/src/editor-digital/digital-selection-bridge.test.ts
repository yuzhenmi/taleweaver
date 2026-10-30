import { describe, it, expect } from "vitest";
import { asBlockId, createPosition, createSpan, createDefaultComponentRegistry, createDefaultAttrRegistry, firstLeafBlock, getBlock, type BlockId, type EditorAction } from "@taleweaver/core";
import { createDigitalSelectionBridge } from "./digital-selection-bridge";
import { createDigitalController } from "./digital-controller";

/** Build a contenteditable root with one block `<div data-block-id>` containing children. */
function rootWith(blockId: string, build: (block: HTMLElement) => void): HTMLElement {
  const root = document.createElement("div");
  const block = document.createElement("div");
  block.setAttribute("data-block-id", blockId);
  build(block);
  root.appendChild(block);
  document.body.appendChild(root);
  return root;
}

describe("DigitalSelectionBridge.domToPosition — plain text run (2b)", () => {
  it("maps a caret inside a single text node to {blockId, offset}", () => {
    const root = rootWith("b1", (block) => {
      block.appendChild(document.createTextNode("hello"));
    });
    const bridge = createDigitalSelectionBridge(root, window);
    const textNode = root.querySelector("[data-block-id]")?.firstChild;
    if (!(textNode instanceof Text)) throw new Error("text");
    const pos = bridge.domToPosition(textNode, 3);
    expect(pos).toEqual(createPosition(asBlockId("b1"), 3));
  });

  it("maps a caret across two text nodes (run-wrapper split) accumulating lengths", () => {
    const root = rootWith("b1", (block) => {
      block.appendChild(document.createTextNode("ab"));
      const strong = document.createElement("strong");
      strong.appendChild(document.createTextNode("cd"));
      block.appendChild(strong);
    });
    const bridge = createDigitalSelectionBridge(root, window);
    const strongText = root.querySelector("strong")?.firstChild;
    if (!(strongText instanceof Text)) throw new Error("strong text");
    // caret at offset 1 inside "cd" → block offset 2 (ab) + 1 = 3
    expect(bridge.domToPosition(strongText, 1)).toEqual(createPosition(asBlockId("b1"), 3));
  });

  it("returns null for a node outside any data-block-id", () => {
    const root = document.createElement("div");
    const orphan = document.createTextNode("x");
    root.appendChild(orphan);
    const bridge = createDigitalSelectionBridge(root, window);
    expect(bridge.domToPosition(orphan, 0)).toBeNull();
  });
});

describe("DigitalSelectionBridge.domToPosition — across an inline embed (F1, highest-risk)", () => {
  // Block content: "ab" + <embed (footnote "12")> + "cd".  Model offsets:
  //   a=0 b=1 [embed]=2 (1 unit) c=3 d=4 → length 5.  The embed's inner glyph "12" must NOT
  //   add 2 units; it counts as 1.
  function buildEmbedBlock(): HTMLElement {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("ab"));
    const embed = document.createElement("span");
    embed.setAttribute("data-inline-embed", "");
    embed.appendChild(document.createTextNode("12")); // multi-char inner glyph
    block.appendChild(embed);
    block.appendChild(document.createTextNode("cd"));
    root.appendChild(block);
    document.body.appendChild(root);
    return root;
  }

  it("offset just BEFORE the embed", () => {
    const root = buildEmbedBlock();
    const bridge = createDigitalSelectionBridge(root, window);
    const firstText = root.querySelector("[data-block-id]")?.firstChild;
    if (!(firstText instanceof Text)) throw new Error("text");
    expect(bridge.domToPosition(firstText, 2)).toEqual(createPosition(asBlockId("b1"), 2));
  });

  it("offset AFTER the embed does NOT drift (embed = 1 unit, not 2)", () => {
    const root = buildEmbedBlock();
    const bridge = createDigitalSelectionBridge(root, window);
    const block = root.querySelector("[data-block-id]");
    const lastText = block?.lastChild;
    if (!(lastText instanceof Text)) throw new Error("text");
    // caret at offset 1 inside "cd" → 2 (ab) + 1 (embed) + 1 = 4
    expect(bridge.domToPosition(lastText, 1)).toEqual(createPosition(asBlockId("b1"), 4));
  });

  it("a caret addressed AT the embed element (parent, childIndex) lands on its boundary", () => {
    const root = buildEmbedBlock();
    const bridge = createDigitalSelectionBridge(root, window);
    const block = root.querySelector("[data-block-id]");
    if (!(block instanceof HTMLElement)) throw new Error("block");
    // block childNodes: [text "ab", embed, text "cd"]. childIndex 1 = before the embed = offset 2.
    expect(bridge.domToPosition(block, 1)).toEqual(createPosition(asBlockId("b1"), 2));
    // childIndex 2 = after the embed = offset 3.
    expect(bridge.domToPosition(block, 2)).toEqual(createPosition(asBlockId("b1"), 3));
  });

  it("two embeds in sequence — each counts as 1, not inner glyph length", () => {
    // Block: "a" + <embed "12"> + <embed "34"> + "b" ; model offsets a=0,embed1=1,embed2=2,b=3
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("a"));
    const e1 = document.createElement("span");
    e1.setAttribute("data-inline-embed", "");
    e1.appendChild(document.createTextNode("12"));
    block.appendChild(e1);
    const e2 = document.createElement("span");
    e2.setAttribute("data-inline-embed", "");
    e2.appendChild(document.createTextNode("34"));
    block.appendChild(e2);
    block.appendChild(document.createTextNode("b"));
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    const lastText = block.lastChild;
    if (!(lastText instanceof Text)) throw new Error("text");
    // caret at start of "b" → 1(a)+1(embed1)+1(embed2) = 3, NOT 1+2+2=5
    expect(bridge.domToPosition(lastText, 0)).toEqual(createPosition(asBlockId("b1"), 3));
  });

  it("embed at block start — text after it maps correctly", () => {
    // Block: <embed "12"> + "ab" ; model offsets embed=0,a=1,b=2
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    const embed = document.createElement("span");
    embed.setAttribute("data-inline-embed", "");
    embed.appendChild(document.createTextNode("12"));
    block.appendChild(embed);
    block.appendChild(document.createTextNode("ab"));
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    const textNode = block.lastChild;
    if (!(textNode instanceof Text)) throw new Error("text");
    // caret at offset 0 in "ab" → 1(embed)+0 = 1, NOT 0
    expect(bridge.domToPosition(textNode, 0)).toEqual(createPosition(asBlockId("b1"), 1));
  });
});

describe("DigitalSelectionBridge.positionToDom (model → browser Selection, 2b)", () => {
  it("round-trips a collapsed caret in a text run", () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("hello"));
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    const pos = createPosition(asBlockId("b1"), 3);
    bridge.positionToDom(createSpan(pos, pos));
    const back = bridge.readDomSelection();
    expect(back?.anchor).toEqual(pos);
    expect(back?.focus).toEqual(pos);
  });

  it("round-trips an offset just after an inline embed", () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("ab"));
    const embed = document.createElement("span");
    embed.setAttribute("data-inline-embed", "");
    embed.appendChild(document.createTextNode("12"));
    block.appendChild(embed);
    block.appendChild(document.createTextNode("cd"));
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    const pos = createPosition(asBlockId("b1"), 3); // just after the embed
    bridge.positionToDom(createSpan(pos, pos));
    expect(bridge.readDomSelection()?.focus).toEqual(pos);
  });

  it("skips a generated list marker (data-tw-marker) in offset accounting", () => {
    // A list item renders as <li>{content}<span data-tw-marker>1.</span></li> (marker LAST).
    // The marker carries text "1." but contributes ZERO content offsets — the caret/offset
    // machinery must skip it, else every offset in the item shifts by the marker's length.
    const root = document.createElement("div");
    const li = document.createElement("li");
    li.setAttribute("data-block-id", "b1");
    li.appendChild(document.createTextNode("ab"));
    const marker = document.createElement("span");
    marker.setAttribute("data-tw-marker", "");
    marker.appendChild(document.createTextNode("1.")); // 2 chars that must NOT count
    li.appendChild(marker);
    root.appendChild(li);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    // Caret after "ab" → model offset 2 (the marker's "1." is not counted).
    const pos = createPosition(asBlockId("b1"), 2);
    bridge.positionToDom(createSpan(pos, pos));
    expect(bridge.readDomSelection()?.focus).toEqual(pos);
    // And a DOM caret inside the content text maps back ignoring the marker.
    const text = li.firstChild;
    if (text === null) throw new Error("text");
    expect(bridge.domToPosition(text, 1)).toEqual(createPosition(asBlockId("b1"), 1));
  });

  it("pins the caret BEFORE an empty block's filler <br> (offset 0, not a phantom 2nd line)", () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    const br = document.createElement("br");
    br.setAttribute("data-tw-empty-line", ""); // the renderer's empty-line filler
    block.appendChild(br);
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    const pos = createPosition(asBlockId("b1"), 0);
    bridge.positionToDom(createSpan(pos, pos));
    const sel = window.getSelection();
    // The DOM caret must be BEFORE the filler <br> — (block, 0), not (block, 1).
    expect(sel?.focusNode).toBe(block);
    expect(sel?.focusOffset).toBe(0);
    // And it round-trips back to model offset 0 (the filler contributes zero content units).
    expect(bridge.readDomSelection()?.focus).toEqual(pos);
  });

  it("places an anchor→focus ranged selection in document direction", () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("hello"));
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window);
    bridge.positionToDom(createSpan(createPosition(asBlockId("b1"), 1), createPosition(asBlockId("b1"), 4)));
    const back = bridge.readDomSelection();
    expect(back?.anchor).toEqual(createPosition(asBlockId("b1"), 1));
    expect(back?.focus).toEqual(createPosition(asBlockId("b1"), 4));
  });
});

describe("DigitalSelectionBridge — injected blockElementLookup (I1: O(1) positionToDom)", () => {
  it("resolves the block via the lookup instead of scanning root", () => {
    // `root` is EMPTY (no `[data-block-id]` descendants), so the querySelectorAll fallback would
    // resolve nothing and positionToDom would no-op. The block lives elsewhere in the document and
    // is reachable ONLY through the injected lookup. If the selection lands on the block's text, the
    // lookup (not a root scan) resolved it.
    const root = document.createElement("div");
    document.body.appendChild(root);
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("hello"));
    document.body.appendChild(block);

    let lookupCalls = 0;
    const lookup = (blockId: ReturnType<typeof asBlockId>): HTMLElement | null => {
      lookupCalls++;
      return blockId === asBlockId("b1") ? block : null;
    };
    const bridge = createDigitalSelectionBridge(root, window, lookup);
    const pos = createPosition(asBlockId("b1"), 3);
    bridge.positionToDom(createSpan(pos, pos));

    expect(lookupCalls).toBeGreaterThan(0);
    const sel = window.getSelection();
    expect(sel?.focusNode).toBe(block.firstChild);
    expect(sel?.focusOffset).toBe(3);
  });

  it("falls back to the root scan when no lookup is injected (standalone bridge)", () => {
    const root = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-block-id", "b1");
    block.appendChild(document.createTextNode("hello"));
    root.appendChild(block);
    document.body.appendChild(root);
    const bridge = createDigitalSelectionBridge(root, window); // no lookup
    const pos = createPosition(asBlockId("b1"), 2);
    bridge.positionToDom(createSpan(pos, pos));
    expect(bridge.readDomSelection()?.focus).toEqual(pos);
  });
});

// A range covers an OBJECT block (rule / image / table — core `isObjectBlock`) whole; an
// endpoint on one is `(objectId, 0)`. Through the real controller + reconciler on
// "abcd" | object | "" (fresh document per case).
describe("DigitalSelectionBridge — range endpoints on object blocks", () => {
  const OBJECTS: Record<string, EditorAction> = {
    rule: { type: "INSERT_HORIZONTAL_LINE" },
    image: { type: "INSERT_IMAGE", src: "data:image/png;base64,AA==", width: 4, height: 4 },
    table: { type: "INSERT_TABLE", rows: 1, cols: 1 },
  };

  function mount(object: EditorAction) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const controller = createDigitalController({
      container, componentRegistry: createDefaultComponentRegistry(), attrRegistry: createDefaultAttrRegistry(), containerWidth: 800, doc: document,
    });
    controller.dispatch({ type: "INSERT_TEXT", text: "abcd" });
    controller.dispatch(object);
    const st = controller.editorState.state;
    const first = firstLeafBlock(st, st.rootId);
    const section = first === null ? null : getBlock(st, first)?.parentId ?? null;
    const ids: BlockId[] = [];
    for (let id = section === null ? null : getBlock(st, section)?.firstChildId ?? null; id !== null; id = getBlock(st, id)?.nextSiblingId ?? null) ids.push(id);
    const [text, obj, after] = ids;
    const el = (id: BlockId | undefined) => container.querySelector(`[data-block-id="${id ?? ""}"]`);
    const objEl = el(obj);
    const textNode = el(text)?.querySelector("span")?.firstChild ?? null;
    if (text === undefined || obj === undefined || after === undefined || objEl === null || textNode === null) throw new Error("fixture");
    const parent = objEl.parentNode;
    const index = parent === null ? -1 : Array.prototype.indexOf.call(parent.childNodes, objEl);
    return { container, controller, text, obj, after, objEl, textNode, parent, index, afterEl: el(after) };
  }

  const domSel = () => {
    const s = window.getSelection();
    return s === null ? null : [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset];
  };

  for (const [name, action] of Object.entries(OBJECTS)) {
    it(`${name}: a model range ending / starting on it covers its element whole, and reads back unchanged`, () => {
      const m = mount(action);
      const p = createPosition;
      // Ending on it (forward and backward): the boundary AFTER the element.
      m.controller.dispatch({ type: "SET_SELECTION", selection: createSpan(p(m.text, 1), p(m.obj, 0)) });
      expect(domSel()).toEqual([m.textNode, 1, m.parent, m.index + 1]);
      // Starting on it, backward: the anchor sits BEFORE the element.
      m.controller.dispatch({ type: "SET_SELECTION", selection: createSpan(p(m.after, 0), p(m.obj, 0)) });
      expect(domSel()).toEqual([m.afterEl, 0, m.parent, m.index]);
      // The DOM selection reads back as the same model selection (no re-dispatch loop).
      document.dispatchEvent(new Event("selectionchange"));
      expect(m.controller.editorState.selection).toEqual(createSpan(p(m.after, 0), p(m.obj, 0)));
      m.controller.destroy();
      m.container.remove();
    });
  }

  it("a native drag from text into a table cell becomes a selection of the whole table", () => {
    const m = mount(OBJECTS.table ?? { type: "INSERT_HORIZONTAL_LINE" });
    const cellBlock = m.objEl.querySelector("td [data-block-id]");
    if (cellBlock === null) throw new Error("no cell paragraph");
    window.getSelection()?.setBaseAndExtent(m.textNode, 1, cellBlock, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(m.controller.editorState.selection).toEqual(createSpan(createPosition(m.text, 1), createPosition(m.obj, 0)));
    // …and the DOM selection is re-projected to cover the table.
    expect(domSel()).toEqual([m.textNode, 1, m.parent, m.index + 1]);
    m.controller.destroy();
    m.container.remove();
  });

  it("a native selection ending at the boundary around an image or between blocks maps to blocks, never a container", () => {
    const m = mount(OBJECTS.image ?? { type: "INSERT_HORIZONTAL_LINE" });
    const sel = window.getSelection();
    if (sel === null || m.parent === null) throw new Error("no selection");
    const p = createPosition;
    // Text → just after the image (the parent boundary the browser reports on an image).
    sel.setBaseAndExtent(m.textNode, 1, m.parent, m.index + 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(m.controller.editorState.selection).toEqual(createSpan(p(m.text, 1), p(m.obj, 0)));
    // Backward (anchor after the image = the range's end): anchored on the image.
    m.controller.dispatch({ type: "SET_SELECTION", selection: createSpan(p(m.text, 0), p(m.text, 0)) });
    sel.setBaseAndExtent(m.parent, m.index + 1, m.textNode, 1);
    document.dispatchEvent(new Event("selectionchange"));
    expect(m.controller.editorState.selection).toEqual(createSpan(p(m.obj, 0), p(m.text, 1)));
    // The gap after the image as a START: the next block's start.
    sel.setBaseAndExtent(m.parent, m.index + 1, m.afterEl ?? m.parent, 0);
    document.dispatchEvent(new Event("selectionchange"));
    expect(m.controller.editorState.selection).toEqual(createSpan(p(m.after, 0), p(m.after, 0)));
    // A container boundary before the image as an end: the text block's end.
    sel.setBaseAndExtent(m.textNode, 1, m.parent, m.index);
    document.dispatchEvent(new Event("selectionchange"));
    expect(m.controller.editorState.selection).toEqual(createSpan(p(m.text, 1), p(m.text, 4)));
    m.controller.destroy();
    m.container.remove();
  });
});
