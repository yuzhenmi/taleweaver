/**
 * Section break (Word): inserting a break at (P, k) is a SPLIT whose
 * new terminator is a section-end item — the head H (new id) ends the new section S′,
 * which copies the containing section's attrs; the tail keeps P in the containing
 * section. A section always holds ≥ 1 paragraph, so there is no "empty leading
 * section" no-op. A caret outside a root-flow paragraph (a table cell) breaks before
 * the top-level block holding it.
 */
import { describe, it, expect } from "vitest";
import { applySectionBreak, buildSectionBreakPlan, applySectionBreakInTx } from "./section-break";
import { getBlock, type Document } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { createHistory } from "../history";
import { buildBlock, buildState, buildFlowDoc, inlineContent } from "../../test-utils/state-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import { createPosition, createSpan } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";

const id = (s: string) => s as BlockId;
const childIds = (s: Document, parent: string): string[] => {
  const out: string[] = [];
  for (let c = getBlock(s, id(parent))?.firstChildId ?? null; c !== null; c = getBlock(s, c)?.nextSiblingId ?? null) out.push(c);
  return out;
};
const fin = (s: Document): string => {
  const f = getBlock(s, id("doc"))?.lastChildId;
  if (f === null || f === undefined) throw new Error("no final section");
  return f;
};
const four = () => buildFlowDoc([{ p: "p1", t: "1" }, { p: "p2", t: "2" }, { p: "p3", t: "three" }, { p: "p4", t: "4" }]);

describe("applySectionBreak — a split whose new terminator is a section-end", () => {
  it("at (P, 0) of a section-less document: an empty head ends the new section; the final section keeps P onward", () => {
    const state = four();
    const F = fin(state);
    const r = applySectionBreak(state, createPosition(id("p3"), 0), createTestAllocator("s"));
    expect(flowShape(r.state, "doc")).toBe('p1:"1" p2:"2" s-0:""/s-1 p3:"three" p4:"4"');
    expect(childIds(r.state, "doc")).toEqual(["s-1", F]);
    expect(childIds(r.state, "s-1")).toEqual(["p1", "p2", "s-0"]);
    expect(childIds(r.state, F)).toEqual(["p3", "p4"]);
    expect(r.newCursorBlockId).toBe("p3");
    expect([...r.dirtyIds]).toEqual(expect.arrayContaining(["s-0", "s-1", "p3", F, "doc"]));
    assertInvariantI(r.state, "storage");
  });

  it("mid-paragraph: the head [0, k) ends the new section", () => {
    const r = applySectionBreak(four(), createPosition(id("p3"), 2), createTestAllocator("s"));
    expect(flowShape(r.state, "doc")).toBe('p1:"1" p2:"2" s-0:"th"/s-1 p3:"ree" p4:"4"');
    expect(r.newCursorBlockId).toBe("p3");
  });

  it("at the first paragraph: the new section holds the empty head (never an empty section)", () => {
    const r = applySectionBreak(four(), createPosition(id("p1"), 0), createTestAllocator("s"));
    expect(flowShape(r.state, "doc")).toBe('s-0:""/s-1 p1:"1" p2:"2" p3:"three" p4:"4"');
    expect(childIds(r.state, "s-1")).toEqual(["s-0"]);
  });

  it("S′ copies the CONTAINING section's attrs (explicit section, or the final one); H copies P's attrs", () => {
    const state = buildFlowDoc([
      { sec: "S", attrs: { pageWidth: 50 }, children: [{ p: "p1", t: "1" }, { p: "p2", t: "2", type: "heading", attrs: { level: 2 } }, { p: "p3", t: "3" }] },
      { sec: "F", attrs: { pageWidth: 100 }, children: [{ p: "p4", t: "4" }] },
    ]);
    const r = applySectionBreak(state, createPosition(id("p2"), 1), createTestAllocator("s"));
    expect(flowShape(r.state, "doc")).toBe('p1:"1" s-0:"2"/s-1 p2:"" p3:"3"/S p4:"4"');
    expect(childIds(r.state, "doc")).toEqual(["s-1", "S", "F"]);
    expect(getBlock(r.state, id("s-1"))?.attrs).toEqual({ pageWidth: 50 });
    expect(getBlock(r.state, id("s-0"))?.type).toBe("heading");
    expect(getBlock(r.state, id("s-0"))?.attrs).toEqual({ level: 2 });
    const inFinal = applySectionBreak(r.state, createPosition(id("p4"), 0), createTestAllocator("t"));
    expect(getBlock(inFinal.state, id("t-1"))?.attrs).toEqual({ pageWidth: 100 });
    expect(childIds(inFinal.state, "doc")).toEqual(["s-1", "S", "t-1", "F"]);
    assertInvariantI(inFinal.state, "storage");
  });

  it("a caret in a table cell breaks before the table (a fresh empty paragraph ends the new section)", () => {
    const state = buildFlowDoc([{ p: "p1", t: "1" }, { table: "T", cells: ["c1"] }, { p: "p2", t: "2" }]);
    const r = applySectionBreak(state, createPosition(id("c1"), 0), createTestAllocator("s"));
    expect(flowShape(r.state, "doc")).toMatch(/^p1:"1" \S+:""\/s-0 \[T\] p2:"2"$/);
    expect(childIds(r.state, "doc")[0]).toBe("s-0");
    expect(r.newCursorBlockId).toBe("c1");
    assertInvariantI(r.state, "storage");
  });

  it("one transaction: one undo restores the section-less document", () => {
    const state = four();
    const history = createHistory(state);
    const r = applySectionBreak(state, createPosition(id("p3"), 2), createTestAllocator("s"));
    const sel = createSpan(createPosition(id("p3"), 2), createPosition(id("p3"), 2));
    history.commit(r, { before: sel, after: sel });
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo");
    expect(flowShape(undone.state, "doc")).toBe('p1:"1" p2:"2" p3:"three" p4:"4"');
    expect(history.canUndo()).toBe(false);
  });

  it("(guard) applySectionBreakInTx throws outside a transaction; a block not under the root throws", () => {
    const state = four();
    const plan = buildSectionBreakPlan(state, createPosition(id("p2"), 0), createTestAllocator("sec"));
    expect(() => applySectionBreakInTx(state[STATE_INTERNAL].doc, plan)).toThrow(/applySectionBreak: must be called inside Y\.Doc\.transact/);
    const orphan = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
        buildBlock({ id: "orphan", type: "paragraph", parentId: null, inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => applySectionBreak(orphan, createPosition(id("orphan"), 0), createTestAllocator("sec"))).toThrow(/not under document root/);
  });
});
