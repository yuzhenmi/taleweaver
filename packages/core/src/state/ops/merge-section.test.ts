/**
 * Deleting a section break (Word): ONE step deletes the section-end
 * item — the ¶ of the section's last paragraph — so the paragraphs merge by the
 * paragraph rule and the content joins the FOLLOWING section (whose attrs it takes;
 * no section-attr copy). There is no leading `#s0` section: content before the first
 * break belongs to that section, and the last section is the final section.
 */
import { describe, it, expect } from "vitest";
import { deleteSectionBreak } from "./merge-section";
import { getBlock, type Document } from "../document";
import { buildFlowDoc } from "../../test-utils/document-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import type { BlockId } from "../block-id";

const id = (s: string) => s as BlockId;
const childIds = (s: Document, parent: string): string[] => {
  const out: string[] = [];
  for (let c = getBlock(s, id(parent))?.firstChildId ?? null; c !== null; c = getBlock(s, c)?.nextSiblingId ?? null) out.push(c);
  return out;
};

describe("deleteSectionBreak", () => {
  it("merges the section's last paragraph with the next one; the content takes the FOLLOWING section", () => {
    const document = buildFlowDoc([
      { sec: "S1", attrs: { pageWidth: 50 }, children: [{ p: "a", t: "a" }, { p: "b", t: "b", type: "heading", attrs: { level: 1 } }] },
      { sec: "F", attrs: { pageWidth: 100 }, children: [{ p: "c", t: "c" }, { p: "d", t: "d" }] },
    ]);
    const r = deleteSectionBreak(document, id("S1"));
    expect(flowShape(r.document, "doc")).toBe('a:"a" c:"bc" d:"d"');
    expect(childIds(r.document, "doc")).toEqual(["F"]);
    expect(childIds(r.document, "F")).toEqual(["a", "c", "d"]);
    expect(getBlock(r.document, id("F"))?.attrs).toEqual({ pageWidth: 100 });
    // Paragraph rule: the non-empty left paragraph's formatting is applied to the survivor.
    expect(getBlock(r.document, id("c"))?.type).toBe("heading");
    expect([...r.dirtyIds]).toEqual(expect.arrayContaining(["a", "b", "c", "S1", "F", "doc"]));
    assertInvariantI(r.document, "storage");
  });

  it("three sections: deleting the middle break leaves the first section untouched", () => {
    const document = buildFlowDoc([
      { sec: "S1", children: [{ p: "a", t: "a" }] },
      { sec: "S2", attrs: { pageWidth: 2 }, children: [{ p: "b", t: "b" }] },
      { sec: "F", attrs: { pageWidth: 3 }, children: [{ p: "c", t: "c" }] },
    ]);
    const r = deleteSectionBreak(document, id("S2"));
    expect(flowShape(r.document, "doc")).toBe('a:"a"/S1 c:"bc"');
    expect(childIds(r.document, "doc")).toEqual(["S1", "F"]);
    expect(getBlock(r.document, id("S1"))?.nextSiblingId).toBe("F");
  });

  it("an empty paragraph carrying the break is removed; the next paragraph keeps its formatting", () => {
    const document = buildFlowDoc([
      { sec: "S1", children: [{ p: "a", t: "a" }, { p: "e", t: "" }] },
      { sec: "F", children: [{ p: "h", t: "h", type: "heading", attrs: { level: 1 } }] },
    ]);
    const r = deleteSectionBreak(document, id("S1"));
    expect(flowShape(r.document, "doc")).toBe('a:"a" h:"h"');
    expect(getBlock(r.document, id("h"))?.type).toBe("heading");
  });

  it("content before the first break belongs to THAT section (no `#s0`); deleting it joins everything into the final section", () => {
    const document = buildFlowDoc([{ p: "lead", t: "x" }, { sec: "S1", children: [{ p: "b", t: "b" }] }, { sec: "F", children: [{ p: "c", t: "c" }] }]);
    expect(getBlock(document, id("lead"))?.parentId).toBe("S1");
    expect(getBlock(document, id("doc#s0"))).toBeNull();
    const r = deleteSectionBreak(document, id("S1"));
    expect(flowShape(r.document, "doc")).toBe('lead:"x" c:"bc"');
    expect(getBlock(r.document, id("lead"))?.parentId).toBe("F");
  });

  it("the final section has no break: identity no-op; a break before a table that invariant I needs is kept", () => {
    const document = buildFlowDoc([{ sec: "S1", children: [{ p: "a", t: "a" }] }, { sec: "F", children: [{ p: "b", t: "b" }] }]);
    const same = deleteSectionBreak(document, id("F"));
    expect(same.document).toBe(document);
    expect(same.dirtyIds.size).toBe(0);
    const table = buildFlowDoc([{ sec: "S1", children: [{ p: "a", t: "a" }] }, { sec: "F", children: [{ table: "T", cells: ["c1"] }, { p: "z", t: "z" }] }]);
    const kept = deleteSectionBreak(table, id("S1"));
    expect(kept.document).toBe(table);
    expect(flowShape(kept.document, "doc")).toBe('a:"a"/S1 [T] z:"z"');
  });

  it("validation: a missing id or a non-section throws", () => {
    const document = buildFlowDoc([{ sec: "S1", children: [{ p: "a", t: "a" }] }, { sec: "F", children: [{ p: "b", t: "b" }] }]);
    expect(() => deleteSectionBreak(document, id("nope"))).toThrow(/not found/);
    expect(() => deleteSectionBreak(document, id("a"))).toThrow(/not a section/);
  });
});
