// packages/core/src/layout/__tests__/toc-pagination.test.ts
//
// END-TO-END proof that a LIVE `table-of-contents` block — whose entry lines are
// SYNTHESIZED at render time (`renderBlockBody` → `buildTocEntrySubtree`) and never
// stored in state — flows through the REAL paginated layout (render → cascade →
// `buildVirtualPaginatedTree` → `getPage`) and its per-entry page-number atoms
// resolve LATE to the right heading page numbers via the shipped field pipeline.
//
// Each TOC entry's page-number atom is a `"page"`-mode cross-reference keyed
// `${tocId}/toc/${i}` (host = the plan-indexed TOC block), so this is the TOC
// analogue of `cross-ref-page-field.test.ts` (a body cross-ref resolving to a
// target's page) — but driven through a REAL rendered State, not hand-built atoms.
//
// The doc is built the real way: a `buildState` main tree (TOC + headings +
// image fillers), run through `render` (the TOC branch synthesizes the entries),
// then `cascadePass(rendered.root)` and `layoutTree(..., pageConfig)`. Image blocks
// with a fixed `height` attr are the deterministic page-spanning fillers (mirroring
// `cross-ref-page-field.test.ts`'s `fixedBlock`).

import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "../dispatch";
import { createMockShaper } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { buildBlock, buildState, inlineContent, text } from "@taleweaver/core";
import type { Block } from "@taleweaver/core";
import type { State } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import type { LayoutBox } from "../layout-box";
import type { PageBox } from "../page-box";
import type { VirtualLayoutTree } from "../virtual-layout-tree";
import { PAGE_FIELD_RESERVED_GLYPHS } from "@taleweaver/core";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();
const shaper = () => createMockShaper(8, 16);
const RESERVED = "0".repeat(PAGE_FIELD_RESERVED_GLYPHS); // "00"

function pageConfig(pageBlockSize: number): PageConfig {
  return {
    pageInlineSize: 600,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };
}

/** Render a real State (TOC entries synthesized) → cascade root → paginate. */
function paginate(state: State, cfg: PageConfig): VirtualLayoutTree {
  const rendered = render(state, reg, attrReg);
  const cascaded = cascadePass(rendered.root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element root");
  const tree = layoutTree(cascaded, cfg.pageInlineSize, shaper(), cfg);
  // `layoutTree` with a `pageConfig` over a `display:block` root returns a
  // `VirtualLayoutTree` (the producer path); the discriminant narrows it.
  if (tree.type !== "virtual-root") {
    throw new Error(`paginate: expected a VirtualLayoutTree, got "${tree.type}"`);
  }
  return tree;
}

/** Concatenate all text in a laid-out box subtree. */
function collectText(box: LayoutBox): string {
  let s = "";
  if ("text" in box && typeof box.text === "string") s += box.text;
  if ("children" in box) {
    for (const child of box.children) s += collectText(child);
  }
  if ("columns" in box) {
    for (const col of (box as { columns: readonly LayoutBox[] }).columns) s += collectText(col);
  }
  return s;
}

/** Find a TOC page-number atom (render key `${tocId}/toc/${i}`) by render-key suffix. */
function findTocAtom(box: LayoutBox, tocId: string, i: number): LayoutBox | null {
  const suffix = `${tocId}/toc/${i}`;
  if (typeof box.key === "string" && box.key.endsWith(suffix)) return box;
  if ("children" in box) {
    for (const child of box.children) {
      const found = findTocAtom(child, tocId, i);
      if (found !== null) return found;
    }
  }
  if ("columns" in box) {
    for (const col of (box as { columns: readonly LayoutBox[] }).columns) {
      const found = findTocAtom(col, tocId, i);
      if (found !== null) return found;
    }
  }
  return null;
}

/** The resolved page-number text of TOC entry `i`, searched across ALL pages. */
function tocEntryValue(tree: VirtualLayoutTree, tocId: string, i: number): string {
  for (let p = 0; p < tree.plan.entries.length; p++) {
    const atom = findTocAtom(tree.getPage(p), tocId, i);
    if (atom !== null) return collectText(atom);
  }
  throw new Error(`no TOC atom ${tocId}/toc/${i} on any page`);
}

/**
 * The set of TOC entry INDICES whose page-number atom is materialized on a page.
 * The page atom's render key is `${tocId}/toc/${i}`; the IFC stamps DERIVED keys
 * that END WITH that segment (e.g. `…-ib4-toc/toc/0`), so we identify each entry
 * `i` by its atom-box key ending in `${tocId}/toc/${i}` — NOT by a substring of an
 * ancestor entry-line key (`${tocId}/entry/${i}/…`), which would over-count.
 */
function tocEntryIndicesOnPage(page: PageBox, tocId: string, maxIndex: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i <= maxIndex; i++) {
    if (findTocAtom(page, tocId, i) !== null) out.add(i);
  }
  return out;
}

/** A fixed-height image filler block (deterministic page-spanning unit). */
function imageFiller(id: string, prev: string, next: string | null, height: number): Block {
  return buildBlock({
    id,
    type: "image",
    parentId: "doc",
    prevSiblingId: prev,
    nextSiblingId: next,
    attrs: { src: "/x.png", width: 10, height },
  });
}

describe("TOC end-to-end through paginated layout + fields", () => {
  it("SCENARIO 1: each entry's page-number atom resolves to its heading's 1-based page", () => {
    // Layout: [TOC, h1 "Introduction", filler→push h2 to page 2, h2 "Details",
    // filler→push h3 to page 3, h3 "Appendix"]. pageBlockSize 100 ⇒ 100px content/
    // page. A 90px filler after each heading forces the next heading onto the next
    // page. The TOC + h1 sit on page 0 (1-based "1"); h2 on page 1 ("2"); h3 on
    // page 2 ("3").
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "toc", lastChildId: "h3" }),
      buildBlock({
        id: "toc", type: "table-of-contents", parentId: "doc",
        nextSiblingId: "h1", inlineContent: null,
      }),
      buildBlock({
        id: "h1", type: "heading", parentId: "doc", prevSiblingId: "toc",
        nextSiblingId: "f1", attrs: { level: 1 },
        inlineContent: inlineContent([text("Introduction")]),
      }),
      imageFiller("f1", "h1", "h2", 90),
      buildBlock({
        id: "h2", type: "heading", parentId: "doc", prevSiblingId: "f1",
        nextSiblingId: "f2", attrs: { level: 1 },
        inlineContent: inlineContent([text("Details")]),
      }),
      imageFiller("f2", "h2", "h3", 90),
      buildBlock({
        id: "h3", type: "heading", parentId: "doc", prevSiblingId: "f2",
        nextSiblingId: null, attrs: { level: 1 },
        inlineContent: inlineContent([text("Appendix")]),
      }),
    ];
    const tree = paginate(buildState({ rootId: "doc", blocks }), pageConfig(100));

    // The fillers force the three headings onto THREE DISTINCT, increasing pages —
    // so the three entries must resolve to three different page numbers (the binding
    // is non-trivial). The exact page indices are derived from the plan (robust to
    // line-height) rather than asserted from fixture arithmetic.
    const h1p = tree.plan.pageSpanOfBlock("h1")?.first ?? -1;
    const h2p = tree.plan.pageSpanOfBlock("h2")?.first ?? -1;
    const h3p = tree.plan.pageSpanOfBlock("h3")?.first ?? -1;
    expect(h1p).toBeGreaterThanOrEqual(0);
    expect(h2p).toBeGreaterThan(h1p);
    expect(h3p).toBeGreaterThan(h2p);

    // Each entry's atom shows ITS heading's 1-based page — bound LATE, placeholder gone.
    expect(tocEntryValue(tree, "toc", 0)).toBe(String(h1p + 1));
    expect(tocEntryValue(tree, "toc", 1)).toBe(String(h2p + 1));
    expect(tocEntryValue(tree, "toc", 2)).toBe(String(h3p + 1));
    expect(tocEntryValue(tree, "toc", 0)).not.toBe(RESERVED);
    // The three values are genuinely DISTINCT (no stale/shared resolution).
    expect(new Set([
      tocEntryValue(tree, "toc", 0),
      tocEntryValue(tree, "toc", 1),
      tocEntryValue(tree, "toc", 2),
    ]).size).toBe(3);
  });

  it("SCENARIO 2: a TOC over many headings FRAGMENTS across a page break (no entry dropped or duplicated)", () => {
    // 8 headings → 8 TOC entry lines (one block-level line each, ~16px). A short
    // pageBlockSize forces the TOC's entry-line children to split across pages: the
    // synthesized multi-child TOC block must FRAGMENT through the BFC. pageBlockSize
    // 70 ⇒ ~4 entry lines/page ⇒ the 8 entries split over 2 pages. Headings follow
    // the TOC (each one short) so the doc has enough pages to host all entries.
    const N = 8;
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "toc", lastChildId: `h${N - 1}` }),
      buildBlock({
        id: "toc", type: "table-of-contents", parentId: "doc",
        nextSiblingId: "h0", inlineContent: null,
      }),
    ];
    for (let i = 0; i < N; i++) {
      const prev = i === 0 ? "toc" : `h${i - 1}`;
      const next = i === N - 1 ? null : `h${i + 1}`;
      blocks.push(
        buildBlock({
          id: `h${i}`, type: "heading", parentId: "doc", prevSiblingId: prev,
          nextSiblingId: next, attrs: { level: 1 },
          inlineContent: inlineContent([text(`Heading ${i}`)]),
        }),
      );
    }
    const tree = paginate(buildState({ rootId: "doc", blocks }), pageConfig(70));

    // The TOC's entry lines must split: some entries on page 0, the rest on a later
    // page — the synthesized multi-child TOC block FRAGMENTS through the BFC.
    const onPage0 = tocEntryIndicesOnPage(tree.getPage(0), "toc", N - 1);
    expect(onPage0.size).toBeGreaterThan(0);
    expect(onPage0.size).toBeLessThan(N); // genuine fragmentation, not all-on-one-page

    // Union of entry atoms across ALL pages = exactly the N entries, each materialized
    // on EXACTLY ONE page (no entry dropped, no entry duplicated across the break).
    const seen = new Map<number, number>();
    for (let p = 0; p < tree.plan.entries.length; p++) {
      for (const i of tocEntryIndicesOnPage(tree.getPage(p), "toc", N - 1)) {
        seen.set(i, (seen.get(i) ?? 0) + 1);
      }
    }
    expect(seen.size).toBe(N); // every entry present
    for (const [, count] of seen) expect(count).toBe(1); // none duplicated

    // Every entry resolves to a real heading page number (placeholder gone everywhere).
    for (let i = 0; i < N; i++) {
      const v = tocEntryValue(tree, "toc", i);
      expect(v).not.toBe(RESERVED);
      expect(Number.isNaN(Number(v))).toBe(false);
    }
  });

  it("SCENARIO 3: two TOC anchors each fold their own entry page numbers independently", () => {
    // Two TOCs in one doc. Both list the SAME outline (the whole-doc headings), but
    // each TOC's atoms are keyed by ITS OWN block id, so the per-page fingerprint
    // fold (`pageFieldValuesForFingerprint`, keyed by host TOC block) resolves each
    // independently. h1 on page 0, h2 on a later page.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "tocA", lastChildId: "h2" }),
      buildBlock({
        id: "tocA", type: "table-of-contents", parentId: "doc",
        nextSiblingId: "tocB", inlineContent: null,
      }),
      buildBlock({
        id: "tocB", type: "table-of-contents", parentId: "doc",
        prevSiblingId: "tocA", nextSiblingId: "h1", inlineContent: null,
      }),
      buildBlock({
        id: "h1", type: "heading", parentId: "doc", prevSiblingId: "tocB",
        nextSiblingId: "f1", attrs: { level: 1 },
        inlineContent: inlineContent([text("Alpha")]),
      }),
      imageFiller("f1", "h1", "h2", 90),
      buildBlock({
        id: "h2", type: "heading", parentId: "doc", prevSiblingId: "f1",
        nextSiblingId: null, attrs: { level: 1 },
        inlineContent: inlineContent([text("Beta")]),
      }),
    ];
    const tree = paginate(buildState({ rootId: "doc", blocks }), pageConfig(100));

    const h1Page = (tree.plan.pageSpanOfBlock("h1")?.first ?? -1) + 1;
    const h2Page = (tree.plan.pageSpanOfBlock("h2")?.first ?? -1) + 1;
    expect(h2Page).toBeGreaterThan(h1Page); // they really are on different pages

    // Each TOC independently resolves the same two headings to the same page numbers.
    for (const tocId of ["tocA", "tocB"]) {
      expect(tocEntryValue(tree, tocId, 0)).toBe(String(h1Page));
      expect(tocEntryValue(tree, tocId, 1)).toBe(String(h2Page));
      expect(tocEntryValue(tree, tocId, 0)).not.toBe(RESERVED);
      expect(tocEntryValue(tree, tocId, 1)).not.toBe(RESERVED);
    }
  });

  it("SCENARIO 4: a heading on a 2-digit page resolves its multi-digit page number end-to-end (no truncation)", () => {
    // Push a heading past page 9 so its 1-based page number is TWO digits ("10"+).
    // This locks that a multi-digit TOC page number resolves + substitutes correctly
    // end-to-end (the "10" fits the 2-glyph "00" reservation exactly — no GROWTH).
    //
    // NOTE: reservation GROWTH (a value WIDER than "00", i.e. a 3-digit page) is the
    // §4.4 convergence-loop path, already unit-tested in `field-convergence.test.ts`
    // and exercised end-to-end for a body cross-ref in `cross-ref-page-field.test.ts`
    // ("…grows to a 3-digit page…"). Forcing a 3-digit page here would need a ~100-page
    // fixture; per the slice's feature-selection test that bloat is skipped — the
    // shared field machinery is identical whether the host is a body block or a TOC.
    //
    // 11 × 95px fillers between two headings at 100px content/page ⇒ ~one filler per
    // page ⇒ the second heading lands past page 9.
    const NUM_FILLERS = 11;
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "toc", lastChildId: "hLast" }),
      buildBlock({
        id: "toc", type: "table-of-contents", parentId: "doc",
        nextSiblingId: "hFirst", inlineContent: null,
      }),
      buildBlock({
        id: "hFirst", type: "heading", parentId: "doc", prevSiblingId: "toc",
        nextSiblingId: "f0", attrs: { level: 1 },
        inlineContent: inlineContent([text("First")]),
      }),
    ];
    for (let i = 0; i < NUM_FILLERS; i++) {
      const prev = i === 0 ? "hFirst" : `f${i - 1}`;
      const next = i === NUM_FILLERS - 1 ? "hLast" : `f${i + 1}`;
      blocks.push(imageFiller(`f${i}`, prev, next, 95));
    }
    blocks.push(
      buildBlock({
        id: "hLast", type: "heading", parentId: "doc", prevSiblingId: `f${NUM_FILLERS - 1}`,
        nextSiblingId: null, attrs: { level: 1 },
        inlineContent: inlineContent([text("Last")]),
      }),
    );
    const tree = paginate(buildState({ rootId: "doc", blocks }), pageConfig(100));

    const lastPage = (tree.plan.pageSpanOfBlock("hLast")?.first ?? -1) + 1;
    expect(lastPage).toBeGreaterThanOrEqual(10); // a 2-digit page number

    // The first heading is on page 1 — a concrete single-digit anchor (catches a bug
    // that corrupted entry 0 while entry 1 still resolved).
    expect(tocEntryValue(tree, "toc", 0)).toBe("1");
    // The second entry shows the full multi-digit page — both digits, not truncated to one.
    expect(tocEntryValue(tree, "toc", 1)).toBe(String(lastPage));
    expect(tocEntryValue(tree, "toc", 1).length).toBe(String(lastPage).length); // ≥2 digits, intact
    expect(tocEntryValue(tree, "toc", 1)).not.toBe(RESERVED); // not the "00" placeholder
  });
});
