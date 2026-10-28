/**
 * Deleting a section break (Word): ONE step deletes the section-end
 * item — the ¶ of the section's last paragraph — so the paragraphs merge by the
 * paragraph rule and the content joins the FOLLOWING section (whose attrs it takes;
 * no section-attr copy). There is no leading `#s0` section: content before the first
 * break belongs to that section, and the last section is the final section.
 */
import { describe, it, expect } from "vitest";
import { deleteSectionBreak } from "./merge-section";
import { getBlock, type State } from "../state";
import { buildFlowDoc } from "../../test-utils/state-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import type { BlockId } from "../block-id";

const id = (s: string) => s as BlockId;
const childIds = (s: State, parent: string): string[] => {
  const out: string[] = [];
  for (let c = getBlock(s, id(parent))?.firstChildId ?? null; c !== null; c = getBlock(s, c)?.nextSiblingId ?? null) out.push(c);
  return out;
};

describe("deleteSectionBreak", () => {
  it("merges the section's last paragraph with the next one; the content takes the FOLLOWING section", () => {
    const state = buildFlowDoc([
      { sec: "S1", attrs: { pageWidth: 50 }, children: [{ p: "a", t: "a" }, { p: "b", t: "b", type: "heading", attrs: { level: 1 } }] },
      { sec: "F", attrs: { pageWidth: 100 }, children: [{ p: "c", t: "c" }, { p: "d", t: "d" }] },
    ]);
    const r = deleteSectionBreak(state, id("S1"));
    expect(flowShape(r.state, "doc")).toBe('a:"a" c:"bc" d:"d"');
    expect(childIds(r.state, "doc")).toEqual(["F"]);
    expect(childIds(r.state, "F")).toEqual(["a", "c", "d"]);
    expect(getBlock(r.state, id("F"))?.attrs).toEqual({ pageWidth: 100 });
    // Paragraph rule: the non-empty left paragraph's formatting is applied to the survivor.
    expect(getBlock(r.state, id("c"))?.type).toBe("heading");
    expect([...r.dirtyIds]).toEqual(expect.arrayContaining(["a", "b", "c", "S1", "F", "doc"]));
    assertInvariantI(r.state, "storage");
  });

  it("three sections: deleting the middle break leaves the first section untouched", () => {
    const state = buildFlowDoc([
      { sec: "S1", children: [{ p: "a", t: "a" }] },
      { sec: "S2", attrs: { pageWidth: 2 }, children: [{ p: "b", t: "b" }] },
      { sec: "F", attrs: { pageWidth: 3 }, children: [{ p: "c", t: "c" }] },
    ]);
    const r = deleteSectionBreak(state, id("S2"));
    expect(flowShape(r.state, "doc")).toBe('a:"a"/S1 c:"bc"');
    expect(childIds(r.state, "doc")).toEqual(["S1", "F"]);
    expect(getBlock(r.state, id("S1"))?.nextSiblingId).toBe("F");
  });

  it("an empty paragraph carrying the break is removed; the next paragraph keeps its formatting", () => {
    const state = buildFlowDoc([
      { sec: "S1", children: [{ p: "a", t: "a" }, { p: "e", t: "" }] },
      { sec: "F", children: [{ p: "h", t: "h", type: "heading", attrs: { level: 1 } }] },
    ]);
    const r = deleteSectionBreak(state, id("S1"));
    expect(flowShape(r.state, "doc")).toBe('a:"a" h:"h"');
    expect(getBlock(r.state, id("h"))?.type).toBe("heading");
  });

  it("content before the first break belongs to THAT section (no `#s0`); deleting it joins everything into the final section", () => {
    const state = buildFlowDoc([{ p: "lead", t: "x" }, { sec: "S1", children: [{ p: "b", t: "b" }] }, { sec: "F", children: [{ p: "c", t: "c" }] }]);
    expect(getBlock(state, id("lead"))?.parentId).toBe("S1");
    expect(getBlock(state, id("doc#s0"))).toBeNull();
    const r = deleteSectionBreak(state, id("S1"));
    expect(flowShape(r.state, "doc")).toBe('lead:"x" c:"bc"');
    expect(getBlock(r.state, id("lead"))?.parentId).toBe("F");
  });

  it("the final section has no break: identity no-op; a break before a table that invariant I needs is kept", () => {
    const state = buildFlowDoc([{ sec: "S1", children: [{ p: "a", t: "a" }] }, { sec: "F", children: [{ p: "b", t: "b" }] }]);
    const same = deleteSectionBreak(state, id("F"));
    expect(same.state).toBe(state);
    expect(same.dirtyIds.size).toBe(0);
    const table = buildFlowDoc([{ sec: "S1", children: [{ p: "a", t: "a" }] }, { sec: "F", children: [{ table: "T", cells: ["c1"] }, { p: "z", t: "z" }] }]);
    const kept = deleteSectionBreak(table, id("S1"));
    expect(kept.state).toBe(table);
    expect(flowShape(kept.state, "doc")).toBe('a:"a"/S1 [T] z:"z"');
  });

  it("validation: a missing id or a non-section throws", () => {
    const state = buildFlowDoc([{ sec: "S1", children: [{ p: "a", t: "a" }] }, { sec: "F", children: [{ p: "b", t: "b" }] }]);
    expect(() => deleteSectionBreak(state, id("nope"))).toThrow(/not found/);
    expect(() => deleteSectionBreak(state, id("a"))).toThrow(/not a section/);
  });
});
