import { describe, it, expect } from "vitest";
import { createPosition, createSpan, asBlockId } from "../state";
import type { State } from "../state";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { normalizeSelectionForObjects, stepOffObject } from "./object-range";

const at = (b: string, o: number) => createPosition(asBlockId(b), o);
const para = (id: string, parentId: string, t: string, sib: { prevSiblingId?: string; nextSiblingId?: string } = {}) =>
  buildBlock({ id, type: "paragraph", parentId, ...sib, inlineContent: inlineContent([text(t)]) });
/** A 1×1 table `id` (row `${id}r`, cell `${id}c`) whose cell holds `inner`'s first..last child. */
const table = (id: string, parentId: string, first: string, last: string, sib: { prevSiblingId?: string; nextSiblingId?: string } = {}) => [
  buildBlock({ id, type: "table", parentId, ...sib, firstChildId: `${id}r`, lastChildId: `${id}r`, attrs: { columnWidths: [1] } }),
  buildBlock({ id: `${id}r`, type: "table-row", parentId: id, firstChildId: `${id}c`, lastChildId: `${id}c` }),
  buildBlock({ id: `${id}c`, type: "table-cell", parentId: `${id}r`, firstChildId: first, lastChildId: last }),
];

/** "abcd" | T[ "o" | U[ "i" ] | "o2" ] | "efgh" — U nested in T's cell. */
function nested(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p1" }),
      para("p0", "doc", "abcd", { nextSiblingId: "T" }),
      ...table("T", "doc", "o", "o2", { prevSiblingId: "p0", nextSiblingId: "p1" }),
      para("o", "Tc", "o", { nextSiblingId: "U" }),
      ...table("U", "Tc", "i", "i", { prevSiblingId: "o", nextSiblingId: "o2" }),
      para("i", "Uc", "i"),
      para("o2", "Tc", "", { prevSiblingId: "U" }),
      para("p1", "doc", "efgh", { prevSiblingId: "T" }),
    ],
  });
}

describe("normalizeSelectionForObjects — a range covers a table whole or not at all", () => {
  it("an endpoint inside a table, the other outside, lifts to the table (either direction)", () => {
    const s = nested();
    expect(normalizeSelectionForObjects(s, createSpan(at("o", 1), at("p1", 2)))).toEqual(createSpan(at("T", 0), at("p1", 2)));
    expect(normalizeSelectionForObjects(s, createSpan(at("p1", 2), at("o", 1)))).toEqual(createSpan(at("p1", 2), at("T", 0)));
  });

  it("nested tables lift to the OUTERMOST table not holding the other endpoint", () => {
    const s = nested();
    expect(normalizeSelectionForObjects(s, createSpan(at("p0", 1), at("i", 1)))).toEqual(createSpan(at("p0", 1), at("T", 0)));
    // The other endpoint shares T's cell: only U is partly covered.
    expect(normalizeSelectionForObjects(s, createSpan(at("o", 0), at("i", 1)))).toEqual(createSpan(at("o", 0), at("U", 0)));
  });

  it("leaves a range inside one table, a collapsed caret, a rule endpoint and a range across a section break as they are", () => {
    const s = nested();
    const inTable = createSpan(at("o", 0), at("o2", 0));
    expect(normalizeSelectionForObjects(s, inTable)).toBe(inTable);
    const caret = createSpan(at("i", 1), at("i", 1));
    expect(normalizeSelectionForObjects(s, caret)).toBe(caret);

    const sections = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "a", lastChildId: "hr" }),
        para("a", "s1", "a", { nextSiblingId: "hr" }),
        buildBlock({ id: "hr", type: "horizontal-line", parentId: "s1", prevSiblingId: "a" }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "b", lastChildId: "b" }),
        para("b", "s2", "b"),
      ],
    });
    const acrossBreak = createSpan(at("a", 0), at("b", 1));
    expect(normalizeSelectionForObjects(sections, acrossBreak)).toBe(acrossBreak);
    const toRule = createSpan(at("a", 0), at("hr", 0));
    expect(normalizeSelectionForObjects(sections, toRule)).toBe(toRule);
  });

  it("a table endpoint whose table holds the other endpoint collapses to that endpoint", () => {
    const s = nested();
    expect(normalizeSelectionForObjects(s, createSpan(at("T", 0), at("o", 1)))).toEqual(createSpan(at("o", 1), at("o", 1)));
    expect(normalizeSelectionForObjects(s, createSpan(at("i", 1), at("U", 0)))).toEqual(createSpan(at("i", 1), at("i", 1)));
  });
});

describe("stepOffObject — a focus extended off an object steps past it whole", () => {
  it("forward to the text after the object's subtree, backward to the end of the text before; undefined off objects", () => {
    const s = nested();
    expect(stepOffObject(s, at("T", 0), "forward")).toEqual(at("p1", 0));
    expect(stepOffObject(s, at("T", 0), "backward")).toEqual(at("p0", 4));
    expect(stepOffObject(s, at("U", 0), "forward")).toEqual(at("o2", 0));
    expect(stepOffObject(s, at("p0", 0), "forward")).toBeUndefined();
  });
});
