// P3 M4 — float + footnote documents on the virtualized path (F7). The footnote
// re-fit measures a float page with the same real `layoutBlock` materialize runs,
// threads the float carry through its sweep, and lays every footnote body in its
// own BFC (a fresh float env).
//
// Mock shaper: 8px per char, 16px lines; pages 500 wide, no margins. A one-line
// footnote body takes a 13 + 16 = 29px slot, so a 160-tall page keeps 131px of body.

import { describe, it, expect } from "vitest";
import { cascadePass, createElementBox, createTextBox, createMockShaper } from "@taleweaver/core";
import type { BlockId, ElementBox, FootnoteAnchorRef, RenderNode, Style } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { buildVirtualPaginatedTree } from "../layout/virtual-producer";
import { paginationFallsBackToLegacy } from "../layout/measure-pass";
import { layoutTree } from "../layout/dispatch";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { PageConfig } from "../layout/page-config";
import type { PageBox } from "../layout/page-box";
import type { LayoutBox } from "../layout/layout-box";

const shaper = createMockShaper(8, 16);
const WORDS = "alpha bravo charl delta echox foxtr golfx hotel india juliz kiloz limaa mikee novem oscar papaa quebe romeo";
const SLOT_TOP = 160 - 29;

function page(blockSize: number): PageConfig {
  return { pageInlineSize: 500, pageBlockSize: blockSize, pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }, pageGap: 20 };
}

function para(key: string, body: string, extra: Partial<Style> = {}, before: readonly ElementBox[] = []): ElementBox {
  return createElementBox(key, { display: "block", ...extra } as Style, [...before, createTextBox(`${key}-t`, {}, body)]);
}
/** `n` one-line paragraph rows ("key0".."keyN-1") in one pre-formatted block. */
function rows(key: string, n: number, extra: Partial<Style> = {}): ElementBox {
  const t = Array.from({ length: n }, (_, i) => `${key}${i}`).join("\n");
  return createElementBox(key, { display: "block", whiteSpace: "pre", ...extra } as Style, [createTextBox(`${key}-t`, { whiteSpace: "pre" }, t)]);
}
function rowsLength(key: string, n: number): number {
  return Array.from({ length: n }, (_, i) => `${key}${i}`).join("\n").length;
}
function blockFloat(key: string, w: number, h: number): ElementBox {
  return createElementBox(key, { display: "block", float: "inline-start", inlineSize: w, blockSize: h } as Style, []);
}
/** A wrapped image (inline-block float) anchored in paragraph `blockId`. */
function wrappedImage(key: string, blockId: string, w: number, h: number): ElementBox {
  return createElementBox(key, { display: "inline-block", float: "inline-start" } as Style, [
    createElementBox(`${key}-img`, { display: "block", inlineSize: w, blockSize: h } as Style, []),
  ], { inlineFloat: { blockId: blockId as BlockId, offset: 0, offsetBlock: 0, exclusion: "side" } });
}

function cascaded(node: RenderNode): ElementBox {
  const c = cascadePass(node);
  if (c.type !== "element") throw new Error("cascade did not return an element");
  return c;
}

interface Doc {
  readonly root: ElementBox;
  readonly notes: ReadonlyMap<BlockId, ElementBox>;
  readonly anchors: readonly FootnoteAnchorRef[];
}
/** `notes`: [anchor block key, footnote body children]. */
function doc(children: readonly ElementBox[], notes: readonly (readonly [string, readonly ElementBox[]])[]): Doc {
  return {
    root: cascaded(createElementBox("doc", { display: "block" } as Style, [...children])),
    notes: new Map(notes.map(([, body], i) => [`n${i}` as BlockId, cascaded(createElementBox(`n${i}`, { display: "block" } as Style, [...body]))])),
    anchors: notes.map(([at], i) => ({ blockId: at as BlockId, contentBlockId: `n${i}` as BlockId, sectionId: null })),
  };
}

function build(d: Doc, cfg: PageConfig, prev?: VirtualLayoutTree): VirtualLayoutTree {
  const cs = d.root.computedStyle;
  if (cs === undefined) throw new Error("root is not cascaded");
  return buildVirtualPaginatedTree(d.root, makeRootContext(cs, cfg.pageInlineSize), shaper, cfg, prev, new Map(), d.notes, d.anchors);
}

/** A line: [owner, y, x, width, first offset, end offset, height] (page-relative; slot lines' owner is prefixed "slot:"). */
type LineGeo = readonly [string, number, number, number, number, number, number];
/** A float box: [key, y, x, width, height]. */
type FloatGeo = readonly [string, number, number, number, number];
interface PageGeo { readonly lines: LineGeo[]; readonly floats: FloatGeo[] }

function pageGeo(p: PageBox): PageGeo {
  const out: PageGeo = { lines: [], floats: [] };
  const walk = (box: LayoutBox, ox: number, oy: number, prefix: string): void => {
    const x = ox + box.x;
    const y = oy + box.y;
    if (box.type === "line") {
      out.lines.push([`${prefix}${box.ownerBlockId ?? ""}`, y, x, box.width, box.inlineOffsetStart, box.inlineOffsetEnd, box.height]);
      return;
    }
    if (box.type === "block" && box.computedStyle.float !== "none") out.floats.push([`${prefix}${box.key}`, y, x, box.width, box.height]);
    if ("children" in box) for (const c of box.children) walk(c, x, y, prefix);
  };
  for (const c of p.children) walk(c, 0, 0, "");
  if (p.footnoteSlot !== null) walk(p.footnoteSlot, 0, 0, "slot:");
  return out;
}

/** Every page, laid last page first (each page must lay out on its own); asserts forward order agrees. */
function pagesOf(d: Doc, cfg: PageConfig): PageGeo[] {
  const t = build(d, cfg);
  const backward = t.plan.entries.map((_, i) => i).reverse().map((i) => pageGeo(t.getPage(i))).reverse();
  const f = build(d, cfg);
  expect(f.plan.entries.map((_, i) => pageGeo(f.getPage(i))), "page order does not matter").toEqual(backward);
  return backward;
}

function linesOf(g: PageGeo | undefined, owner: string): LineGeo[] {
  if (g === undefined) throw new Error("no such page");
  return g.lines.filter((l) => l[0] === owner);
}

/** `owner`'s text is laid exactly once, in order, across the pages: no line lost or repeated. */
function expectContinuous(pages: readonly PageGeo[], owner: string, length: number): void {
  const lines = pages.flatMap((g) => linesOf(g, owner));
  expect(lines[0]?.[4], `${owner} starts at 0`).toBe(0);
  for (let i = 1; i < lines.length; i++) expect(lines[i]?.[4], `${owner} line ${i}`).toBe(lines[i - 1]?.[5]);
  expect(lines[lines.length - 1]?.[5], `${owner} ends at its end`).toBe(length);
}

function expectBodyAboveSlot(g: PageGeo | undefined, slotTop: number): void {
  if (g === undefined) throw new Error("no such page");
  for (const [owner, y, , , , , h] of g.lines) {
    if (!owner.startsWith("slot:")) expect(y + h, `${owner} line at ${y} overlaps the footnote slot`).toBeLessThanOrEqual(slotTop);
  }
}

function expectNoOverlap(g: PageGeo | undefined): void {
  if (g === undefined) throw new Error("no such page");
  for (const [key, fy, fx, fw, fh] of g.floats) {
    for (const [owner, y, x, w, , , h] of g.lines) {
      const crosses = y < fy + fh && y + h > fy && x < fx + fw && x + w > fx;
      expect(crosses, `line of ${owner} at y=${y} crosses ${key}`).toBe(false);
    }
  }
}

describe("float + footnote documents on the virtualized path (P3 M4)", () => {
  it("a float doc with a footnote lays out virtualized; its wrapped image stays on its page and the text breaks at the slot-reduced height", () => {
    // P1: a 300x64 image at its top (lines beside it are 200 wide = 4 words),
    // then full-width lines — 8 lines, 16..144. The footnote leaves 131px, so
    // the paragraph breaks before its last lines.
    const text = `${WORDS} ${WORDS} ${WORDS}`;
    const d = doc([para("P0", "intro"), para("P1", text, {}, [wrappedImage("img", "P1", 300, 64)])], [["P0", [para("n0p", "note")]]]);
    const cfg = page(160);
    expect(paginationFallsBackToLegacy(d.root)).toBe(false);
    const dispatched = layoutTree(d.root, 500, shaper, cfg, new Map(), d.notes, d.anchors);
    expect("plan" in dispatched, "dispatch builds a VirtualLayoutTree").toBe(true);

    const pages = pagesOf(d, cfg);
    expect(pages.length).toBe(2);
    expect(pages[0]?.floats).toEqual([["img", 16, 0, 300, 64]]);
    expect(pages[1]?.floats).toEqual([]);
    expect(linesOf(pages[0], "slot:n0p").length).toBe(1);
    const p0 = linesOf(pages[0], "P1");
    expect(p0.slice(0, 4).map((l) => [l[2], l[3]])).toEqual([[300, 200], [300, 200], [300, 200], [300, 200]]);
    expectBodyAboveSlot(pages[0], SLOT_TOP);
    expectNoOverlap(pages[0]);
    expect(linesOf(pages[1], "P1").length).toBeGreaterThan(0);
    expectContinuous(pages, "P1", text.length + 1);
  });

  it("a block float hanging past the slot-reduced bottom shadows the next page's top", () => {
    // f [16,130) fits the 131px body; c's lines stop at 128, so f hangs 2px
    // into page 2 and narrows its first line. Without the footnote nothing hangs.
    const d = doc([para("a", "a"), blockFloat("f", 200, 114), rows("c", 12)], [["a", [para("n0p", "note")]]]);
    const pages = pagesOf(d, page(160));
    expect(pages[0]?.floats).toEqual([["f", 16, 0, 200, 114]]);
    expectBodyAboveSlot(pages[0], SLOT_TOP);
    const next = linesOf(pages[1], "c");
    expect(next.map((l) => [l[1], l[2]]).slice(0, 2)).toEqual([[0, 200], [16, 0]]);
    expectContinuous(pages, "c", rowsLength("c", 12));
  });

  it("a block float that no longer fits above the slot is pushed to the next page's top", () => {
    // f [16,136) would cross the slot (131): it lands at page 2's top instead.
    const d = doc([para("a", "a"), blockFloat("f", 200, 120), rows("c", 12)], [["a", [para("n0p", "note")]]]);
    const pages = pagesOf(d, page(160));
    expect(pages[0]?.floats).toEqual([]);
    expect(pages[1]?.floats).toEqual([["f", 0, 0, 200, 120]]);
    for (const l of linesOf(pages[0], "c")) expect(l[2]).toBe(0);
    expect(linesOf(pages[1], "c")[0]?.[2]).toBe(200);
    expectBodyAboveSlot(pages[0], SLOT_TOP);
    expectNoOverlap(pages[1]);
    expectContinuous(pages, "c", rowsLength("c", 12));
  });

  it("a footnote body is its own BFC: its float narrows only its own lines, and body floats never reach the slot", () => {
    // n0 (page 1) holds a 200x40 float; n1 (page 2) is plain text under a body
    // float g that overflows page 2's body area down past the slot.
    const d = doc(
      [para("a", "a"), blockFloat("g", 150, 200), para("b", "b", { breakBefore: "page" })],
      [["a", [blockFloat("nf", 200, 40), para("n0p", "first")]], ["b", [para("n1p", "second")]]],
    );
    const pages = pagesOf(d, page(160));
    expect(linesOf(pages[0], "slot:n0p").map((l) => l[2])).toEqual([200]);
    expect(linesOf(pages[1], "slot:n1p").map((l) => l[2])).toEqual([0]);
  });

  it("T-ae: an edit that changes an earlier page's height keeps a reused page's float carry and break tokens in the current flow frame", () => {
    // Page 1: a (forced break). Page 2: b, then f [80,164) with c's first 5 rows
    // beside it; c resumes mid-paragraph on page 3 under f's last 4px. Growing a
    // shifts the flow frame of the reused pages 2–3 by 16px.
    const make = (aRows: number, prev?: Doc): Doc => {
      const fresh = doc(
        [rows("a", aRows, { breakAfter: "page" }), rows("b", 5), blockFloat("f", 200, 84), rows("c", 12)],
        [["a", [para("n0p", "note")]]],
      );
      if (prev === undefined) return fresh;
      // Only a is new: the later blocks and the note keep their references.
      return { ...prev, root: { ...prev.root, children: [fresh.root.children[0] ?? prev.root, ...prev.root.children.slice(1)] } };
    };
    const before = make(2);
    const after = make(3, before);
    const cfg = page(168);
    const incremental = build(after, cfg, build(before, cfg));
    const scratch = build(after, cfg);
    const geo = (t: VirtualLayoutTree) => t.plan.entries.map((_, i) => pageGeo(t.getPage(i)));
    expect(linesOf(geo(scratch)[2], "c").map((l) => l[2]).slice(0, 2)).toEqual([200, 0]);
    expect(geo(incremental)).toEqual(geo(scratch));
    const frame = (t: VirtualLayoutTree) => t.plan.entries.map((e) => [e.incomingActiveFloats, e.resumeInto, e.resumeOut]);
    expect(frame(incremental)).toEqual(frame(scratch));
    expectContinuous(geo(scratch), "c", rowsLength("c", 12));
  });
});
