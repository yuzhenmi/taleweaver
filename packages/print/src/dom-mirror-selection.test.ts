import { describe, it, expect } from "vitest";
import type { BlockId, Position } from "@taleweaver/core";
import type { Selection as EngineSelection } from "@taleweaver/core";
import {
  positionFromMirrorNode,
  locateOffsetInMirror,
  placeMirrorSelection,
  readMirrorSelection,
} from "./dom-mirror-selection";

const bid = (s: string): BlockId => s as BlockId;

function mirror(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("dom-mirror-selection node<->Position", () => {
  const PARA =
    '<p data-block-id="p1">' +
    '<span data-offset-start="0" data-offset-end="5">Hello</span>' +
    '<span data-offset-start="5" data-offset-end="11"> world</span>' +
    "</p>";

  it("maps a text-node point to {blockId, offset}", () => {
    const root = mirror(PARA);
    const secondRun = root.querySelectorAll("span")[1];
    if (secondRun === undefined) throw new Error("expected a second run");
    const textNode = secondRun.firstChild as Text; // " world"
    const pos = positionFromMirrorNode(textNode, 3); // after " wo"
    expect(pos).toEqual({ blockId: bid("p1"), offset: 8 });
  });

  it("returns null for a point outside any run", () => {
    const root = mirror('<div>bare</div>');
    expect(positionFromMirrorNode(root.firstChild as Node, 0)).toBeNull();
  });

  it("locates the text node + offset for a Position (inverse)", () => {
    const root = mirror(PARA);
    const pos: Position = { blockId: bid("p1"), offset: 8 };
    const loc = locateOffsetInMirror(root, pos);
    expect(loc).not.toBeNull();
    expect(loc?.node.textContent).toBe(" world");
    expect(loc?.nodeOffset).toBe(3);
    // shared run boundary (offset 5) → canonical home is the LATER run at its start
    const boundary = locateOffsetInMirror(root, { blockId: bid("p1"), offset: 5 });
    expect(boundary?.node.textContent).toBe(" world");
    expect(boundary?.nodeOffset).toBe(0);
    // document-end (offset 11) → end of the last run's text (the `best` path)
    const docEnd = locateOffsetInMirror(root, { blockId: bid("p1"), offset: 11 });
    expect(docEnd?.node.textContent).toBe(" world");
    expect(docEnd?.nodeOffset).toBe(6);
  });

  it("locates a position inside an emphasized (nested) run", () => {
    const root = mirror(
      '<p data-block-id="p1">' +
        '<span data-offset-start="0" data-offset-end="5"><strong><em>Hello</em></strong></span>' +
      "</p>",
    );
    const loc = locateOffsetInMirror(root, { blockId: bid("p1"), offset: 3 });
    expect(loc).not.toBeNull();
    expect(loc?.node.textContent).toBe("Hello");
    expect(loc?.nodeOffset).toBe(3);
    // round-trip: the mapped-back Position equals the original
    if (loc) {
      expect(positionFromMirrorNode(loc.node, loc.nodeOffset)).toEqual({
        blockId: bid("p1"),
        offset: 3,
      });
    }
  });

  it("round-trips: locate then map returns the original Position", () => {
    const root = mirror(PARA);
    const pos: Position = { blockId: bid("p1"), offset: 2 };
    const loc = locateOffsetInMirror(root, pos);
    expect(loc).not.toBeNull();
    if (loc) {
      expect(positionFromMirrorNode(loc.node, loc.nodeOffset)).toEqual(pos);
    }
  });
});

describe("dom-mirror-selection place/read (browser Selection)", () => {
  const PARA =
    '<p data-block-id="p1">' +
    '<span data-offset-start="0" data-offset-end="11">Hello world</span>' +
    "</p>";

  it("places a collapsed engine selection into the browser Selection", () => {
    const root = mirror(PARA);
    document.body.appendChild(root);
    const sel: EngineSelection = {
      anchor: { blockId: bid("p1"), offset: 3 },
      focus: { blockId: bid("p1"), offset: 3 },
    };
    placeMirrorSelection(root, sel, window);
    const browser = window.getSelection();
    expect(browser?.isCollapsed).toBe(true);
    expect(readMirrorSelection(root, window)).toEqual(sel);
    root.remove();
  });

  it("round-trips a ranged selection", () => {
    const root = mirror(PARA);
    document.body.appendChild(root);
    const sel: EngineSelection = {
      anchor: { blockId: bid("p1"), offset: 0 },
      focus: { blockId: bid("p1"), offset: 5 },
    };
    placeMirrorSelection(root, sel, window);
    expect(readMirrorSelection(root, window)).toEqual(sel);
    root.remove();
  });

  it("covers a range's object endpoint (rule / image / table) whole, either direction", () => {
    const root = mirror(
      '<p data-block-id="p1"><span data-offset-start="0" data-offset-end="4">abcd</span></p>' +
        '<hr data-block-id="hr">' +
        '<span role="img" data-block-id="img"></span>' +
        '<table data-block-id="t"><tbody><tr data-block-id="r"><td data-block-id="c">' +
        '<p data-block-id="cp"><span data-offset-start="0" data-offset-end="1">x</span></p>' +
        "</td></tr></tbody></table>" +
        '<p data-block-id="p2"></p>',
    );
    document.body.appendChild(root);
    const text = root.querySelector("span")?.firstChild ?? null;
    const p2 = root.lastElementChild;
    const at = (blockId: string, offset: number): Position => ({ blockId: bid(blockId), offset });
    const placed = (anchor: Position, focus: Position) => {
      placeMirrorSelection(root, { anchor, focus }, window);
      const b = window.getSelection();
      return b === null ? null : [b.anchorNode, b.anchorOffset, b.focusNode, b.focusOffset];
    };
    // Ending on an object: the boundary AFTER its element (children: p1, hr, img, table, p2).
    expect(placed(at("p1", 1), at("hr", 0))).toEqual([text, 1, root, 2]);
    expect(placed(at("p1", 1), at("img", 0))).toEqual([text, 1, root, 3]);
    expect(placed(at("p1", 1), at("t", 0))).toEqual([text, 1, root, 4]);
    // Starting on one (backward too): the boundary BEFORE it; an empty paragraph at its start.
    expect(placed(at("t", 0), at("p2", 0))).toEqual([root, 3, p2, 0]);
    expect(placed(at("p2", 0), at("hr", 0))).toEqual([p2, 0, root, 1]);
    expect(placed(at("hr", 0), at("t", 0))).toEqual([root, 1, root, 4]);
    root.remove();
  });
});
