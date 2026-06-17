// packages/core/src/layout/__tests__/cross-ref-page-field.test.ts
//
// S6b: the END-TO-END proof for MAIN-BODY page-mode cross-references. A `"page"`
// cross-reference in the body resolves to the target block's 1-based page number —
// bound late at MATERIALIZE (substituteLayoutFields on the body root), AFTER the
// §4.4 width-convergence loop has re-wrapped the host block against the resolved
// value's width. This is the body analogue of page-field-geometry.test.ts (which
// proves the same seam for a header page-field).
//
// Harness mirrors page-field-geometry.test.ts: hand-built `fixedBlock` body children
// (an attr-driven block-size doesn't exist in the cascade, so a real render can't
// produce a predictable page-spanning body — the page-field test hand-builds the same
// way) plus a HAND-BUILT cross-ref placeholder atom whose shape exactly matches the
// real `render` output (inline-block, one "00" text child, refMode/targetId/numberStyle
// metadata — see render-cross-reference.test.ts). Everything else flows through the REAL
// producer: collectPageFields → §4.4 convergence → resolvePageFields → substituteLayoutFields
// → materialize.

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import type { LayoutBox } from "../layout-box";
import type { PageBox } from "../page-box";
import { buildVirtualPaginatedTree } from "../virtual-producer";
import { cascadePassIncremental } from "@taleweaver/core";
import { CROSS_REFERENCE_EMBED_TYPE } from "@taleweaver/core";
import { PAGE_FIELD_RESERVED_GLYPHS } from "@taleweaver/core";
import { BROKEN_CROSS_REFERENCE_TEXT } from "@taleweaver/core";

const shaper = () => createMockShaper(8, 16);
const RESERVED = "0".repeat(PAGE_FIELD_RESERVED_GLYPHS); // "00"

function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", rootStyle, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/**
 * Cascade a doc root carrying a doc-wide `columnCount` metadata override — `buildSectionPlan`
 * (inside `buildVirtualPaginatedTree`) reads this off the root box to derive the doc-wide column
 * default, so a 2-column doc flows through the producer's §4.4 convergence + multicol measure↔
 * materialize path. `cascadePass` preserves metadata (block-type/column attrs are open-schema).
 */
function cascadeRootWithColumns(
  rootStyle: Style,
  children: readonly ElementBox[],
  columnCount: number,
): ElementBox {
  const root = createElementBox("root", rootStyle, children, { columnCount });
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/** A fixed-height block child (a top-level page-spanning unit), keyed by its block id. */
function fixedBlock(key: string, blockSize: number): ElementBox {
  return createElementBox(key, { display: "block", blockSize } as Style, []);
}

/**
 * A page-mode cross-reference PLACEHOLDER atom — the exact render shape (one inline-block
 * IFC token, lone "00" reserved-glyph text child, refMode/targetId/numberStyle metadata)
 * `render` emits for a `refMode: "page"` cross-ref (render-cross-reference.test.ts). The
 * `embedKey` MUST be an inline render key (`${blockId}/inline/${i}`) so collectPageFields
 * derives the host block id from it.
 */
function crossRefPageAtom(embedKey: string, targetId: string): ElementBox {
  return createElementBox(embedKey, { display: "inline-block" } as Style, [createTextBox(`${embedKey}/0`, {}, RESERVED)], {
    embedType: CROSS_REFERENCE_EMBED_TYPE,
    refMode: "page",
    targetId,
    numberStyle: "decimal",
  });
}

/**
 * A body host paragraph (top-level block `hostId`) holding "see page " + a page-mode
 * cross-ref atom targeting `targetId`. A small fixed block-size so the host fits with
 * other blocks on a page predictably.
 */
function hostParagraph(hostId: string, targetId: string): ElementBox {
  return createElementBox(hostId, { display: "block" } as Style, [
    createTextBox(`${hostId}/inline/0`, {}, "see page "),
    crossRefPageAtom(`${hostId}/inline/1`, targetId),
  ]);
}

function pageConfig(pageBlockSize: number): PageConfig {
  return {
    pageInlineSize: 600,
    pageBlockSize,
    pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 15, inlineEnd: 15 },
    pageGap: 20,
  };
}

function build(root: ElementBox, cfg: PageConfig) {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  return buildVirtualPaginatedTree(root, ctx, shaper(), cfg);
}

/**
 * Locate the cross-reference inline-block atom in a laid-out box subtree by its render
 * KEY. The IFC stamps an inline-block box with a derived key ending in the source render
 * key (`…-${blockId}/inline/${i}`), so we match by suffix; render metadata is not carried
 * onto the inline-block layout box, only the key. `embedKey` is the atom's render key
 * (`${hostId}/inline/1`).
 */
function findCrossRefBox(box: LayoutBox, embedKey: string): LayoutBox | null {
  if (typeof box.key === "string" && box.key.endsWith(embedKey)) return box;
  if ("children" in box) {
    for (const child of box.children) {
      const found = findCrossRefBox(child, embedKey);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Concatenate all text in a laid-out box subtree. */
function collectText(box: LayoutBox): string {
  let s = "";
  if ("text" in box && typeof box.text === "string") s += box.text;
  if ("children" in box) {
    for (const child of box.children) s += collectText(child);
  }
  return s;
}

/** The resolved display text of the cross-ref atom on a materialized page (its body box). */
function crossRefTextOnPage(page: PageBox, embedKey: string): string {
  const body = page.children[0];
  if (body === undefined) throw new Error("page has no body box");
  const atom = findCrossRefBox(body, embedKey);
  if (atom === null) throw new Error("no cross-ref atom on page body");
  return collectText(atom);
}

const HOST_REF_KEY = "p/inline/1"; // the host paragraph "p"'s cross-ref atom render key

describe("main-body page-mode cross-reference (S6b end-to-end)", () => {
  it("resolves a body cross-ref to the target block's 1-based page number across a 2-page doc", () => {
    // Host paragraph "p" (top-level) holds the cross-ref to "B". Two 100px fillers
    // follow, then the target "B". pageBlockSize 300 ⇒ content area 280 ⇒ 2 blocks/
    // page. Page 0: [p, f0]; page 1: [f1, B]. The cross-ref renders on page 0 and must
    // show "2" (B's 1-based page).
    const children = [
      hostParagraph("p", "B"),
      fixedBlock("f0", 100),
      fixedBlock("f1", 100),
      fixedBlock("B", 100),
    ];
    const root = cascadeRoot({ display: "block" }, children);
    const tree = build(root, pageConfig(300));

    expect(tree.plan.entries.length).toBe(2);
    expect(tree.plan.pageSpanOfBlock("B")?.first).toBe(1);

    // placeholder → plan → resolve → substitute → materialize, end-to-end.
    expect(crossRefTextOnPage(tree.getPage(0), HOST_REF_KEY)).toBe("2");
    expect(crossRefTextOnPage(tree.getPage(0), HOST_REF_KEY)).not.toBe(RESERVED); // placeholder GONE
  });

  it("a body with NO cross-ref is unaffected (no main-body field ⇒ byte-identical)", () => {
    const children = [fixedBlock("a", 100), fixedBlock("b", 100)];
    const root = cascadeRoot({ display: "block" }, children);
    const tree = build(root, pageConfig(300));
    expect(tree.plan.entries.length).toBe(1);
    const body = tree.getPage(0).children[0];
    if (body === undefined) throw new Error("no body");
    expect(findCrossRefBox(body, HOST_REF_KEY)).toBeNull();
  });

  it("§4.4 convergence: a body cross-ref to a 3-digit page grows through the loop without measure↔materialize drift", () => {
    // 280px-tall fixed blocks at content-height 280 ⇒ exactly ONE block per page. The
    // host "p" is page 0; 99 fillers occupy pages 1..99; the target "B" lands on page
    // index 100 (1-based "101") — a 3-glyph value, WIDER than the 2-glyph "00"
    // placeholder. The §4.4 loop must grow the body cross-ref atom's reservation and
    // re-wrap the host consistently across measure + materialize (the dev-mode drift
    // asserts in bfc/multicol would throw if the patched metas disagreed). A clean
    // "101" proves the grow path works without drift. The host paragraph fits on page 0
    // alongside no filler because its own block-size (~one line) < 280.
    const NUM_FILLERS = 99;
    const children: ElementBox[] = [hostParagraph("p", "B")];
    for (let i = 0; i < NUM_FILLERS; i++) children.push(fixedBlock(`f${i}`, 280));
    children.push(fixedBlock("B", 280));
    const root = cascadeRoot({ display: "block" }, children);
    const tree = build(root, pageConfig(300));

    // host (page 0) + 99 fillers (pages 1..99) + target (page 100) = 101 pages.
    expect(tree.plan.entries.length).toBe(101);
    expect(tree.plan.pageSpanOfBlock("B")?.first).toBe(100); // 0-based ⇒ 1-based "101"

    // The grown 3-glyph value, resolved + substituted + materialized on the host page.
    expect(crossRefTextOnPage(tree.getPage(0), HOST_REF_KEY)).toBe("101");
    expect(crossRefTextOnPage(tree.getPage(0), HOST_REF_KEY)).not.toBe(RESERVED);
  });

  it("LDF-3: a body cross-ref to a DELETED / unresolvable target materializes BROKEN_CROSS_REFERENCE_TEXT", () => {
    // The broken-ref path through MATERIALIZE: when `plan.pageSpanOfBlock(targetId)` is null
    // (target block id does not exist), `resolvePageFields` stores the `""` sentinel value;
    // `substituteLayoutFields` then maps `"" → BROKEN_CROSS_REFERENCE_TEXT` (the same constant
    // render-time number/text broken refs use). Host "p" targets a NON-EXISTENT block; the
    // resolved atom on the host page reads the broken-ref text, not a page number.
    const children = [
      hostParagraph("p", "DOES_NOT_EXIST"),
      fixedBlock("f0", 100),
    ];
    const root = cascadeRoot({ display: "block" }, children);
    const tree = build(root, pageConfig(300));

    expect(tree.plan.pageSpanOfBlock("DOES_NOT_EXIST")).toBeNull(); // target genuinely absent
    expect(crossRefTextOnPage(tree.getPage(0), HOST_REF_KEY)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(crossRefTextOnPage(tree.getPage(0), HOST_REF_KEY)).not.toBe(RESERVED); // placeholder gone
  });

  it("LDF-3: when the target MOVES to a later page, the host page re-materializes with the NEW page number (§4.9 fingerprint fold busts reuse)", () => {
    // The highest-value test: prove the §4.9 per-page fingerprint fold (a main-body field's
    // value on its host page) busts the carry-forward memo when the target's resolved page
    // changes — so the host page does NOT reuse a stale page number.
    //
    // Faithful incremental rebuild: build 1's RAW child boxes are REUSED by reference in
    // build 2 (only a filler is INSERTED before the target), and build 2 cascades via the REAL
    // `cascadePassIncremental` path, which short-circuits unchanged children (p, f0) to their
    // build-1 cascaded refs. So page 0 ([p, f0]) is structurally IDENTICAL across both trees —
    // its `children` fingerprint refs match — and the ONLY fingerprint difference on page 0 is
    // the folded main-body value string ("2" → "3"). Build 2 carries build 1 as `prevTree`, so
    // the carry-forward memo is genuinely eligible to reuse page 0; it is correctly rejected by
    // the value fold alone. This exercises exactly the §4.9 re-materialize the audit credits.
    //
    // pageConfig(300) ⇒ content 280 ⇒ a single 280px filler fills a page. The host paragraph
    // "p" (~one line) sits ALONE on page 0 (p + a 280px filler overflows 280), so page 0 is
    // structurally `[p]` in BOTH builds — its `children` fingerprint refs are identical and the
    // ONLY page-0 fingerprint difference is the §4.9 main-body value fold. Each filler past f0
    // owns its own page, so inserting one filler before the target shifts the target one page
    // later WITHOUT touching page 0's child set.
    const cfg = pageConfig(300);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);

    // RAW build-1 children (kept so build 2 can reuse the unchanged ones by reference).
    const p = hostParagraph("p", "B");
    const f0 = fixedBlock("f0", 280);
    const f1 = fixedBlock("f1", 280);
    const B = fixedBlock("B", 280);
    const root1Raw = createElementBox("root", { display: "block" } as Style, [p, f0, f1, B]);
    const root1 = cascadePass(root1Raw);
    if (root1.type !== "element") throw new Error("cascadePass returned non-element");
    const tree1 = buildVirtualPaginatedTree(root1, ctx, shaper(), cfg);

    // Build 1: page0 [p], page1 [f0], page2 [f1], page3 [B] ⇒ B on page index 3 ⇒ host shows "4".
    expect(tree1.plan.entries.length).toBe(4);
    expect(tree1.plan.pageSpanOfBlock("p")?.first).toBe(0); // host alone on page 0
    expect(tree1.plan.pageSpanOfBlock("B")?.first).toBe(3);
    // Materialize the host page so build 2's memo has a PageBox to (try to) reuse.
    expect(crossRefTextOnPage(tree1.getPage(0), HOST_REF_KEY)).toBe("4");

    // Build 2: INSERT a 280px filler between f0 and f1 — REUSING p, f0, f1, B by reference so
    // the incremental cascade preserves their cascaded refs. The insertion is strictly AFTER
    // page 0, so page 0 stays `[p]` structurally (same child refs); only B's page moves.
    const fNew = fixedBlock("fNew", 280);
    const root2Raw = createElementBox("root", { display: "block" } as Style, [p, f0, fNew, f1, B]);
    const root2Cascaded = cascadePassIncremental(root2Raw, root1Raw, root1);
    if (root2Cascaded.type !== "element") throw new Error("cascadePassIncremental returned non-element");
    const tree2 = buildVirtualPaginatedTree(root2Cascaded, ctx, shaper(), cfg, tree1);

    // Build 2: page0 [p], page1 [f0], page2 [fNew], page3 [f1], page4 [B] ⇒ B on page index 4 ⇒ "5".
    expect(tree2.plan.entries.length).toBe(5);
    expect(tree2.plan.pageSpanOfBlock("p")?.first).toBe(0); // host STILL alone on page 0 (unchanged)
    expect(tree2.plan.pageSpanOfBlock("B")?.first).toBe(4);

    // THE LOCK: the host page (page 0) re-materializes with the NEW value "5", NOT the stale
    // reused "4". Page 0's structural fingerprint (its `[p]` child ref) is UNCHANGED across the
    // two trees, so the carry-forward memo is genuinely eligible to reuse build 1's PageBox; it
    // is correctly rejected ONLY by the §4.9 value fold ("4" → "5"). Without that fold the host
    // page would reuse the stale "4".
    expect(crossRefTextOnPage(tree2.getPage(0), HOST_REF_KEY)).toBe("5");
  });

  it("R-F6: a 2-COLUMN body cross-ref to a SUB-reservation page value materializes the atom at the RESERVATION width (no measure↔materialize drift)", () => {
    // The R-F6 regression. A single-DIGIT resolved value ("2") is NARROWER than the 2-glyph
    // "00" reservation. Pre-fix, the MEASURE pass planned the body atom at the 2-glyph
    // reservation width while MATERIALIZE shrink-to-fit the laid-out atom to the 1-glyph real
    // value — so a multi-column page could fit MORE children at materialize than the plan
    // assigned (`MultiColumnBox` construction's `breakTokensEqual` dev-assert is the drift
    // tripwire; single-column corrupts silently). The fix width-patches materialize's body root
    // to the SAME reservation the converged measure pass used, so both size the atom identically.
    //
    // The decisive, fix-DEPENDENT assertion below is the materialized atom's `inlineSize`: with
    // the fix it is the 2-glyph reservation width (== one extra glyph wider than the 1-glyph
    // value); WITHOUT the materialize-side width-patch it shrink-to-fits to the narrower 1-glyph
    // value width — exactly the measure↔materialize size disagreement R-F6 closes. (A fixture
    // that makes that 1-glyph width delta TIP a column-break — turning the silent size drift into
    // the `breakTokensEqual` THROW — is shaper-sensitive and brittle; the inlineSize assertion
    // locks the same root cause directly and deterministically.)
    //
    // 2 columns; host "p" (cross-ref to "B") leads, then fillers, then "B". A modest
    // page-block-size yields a couple of pages so the target lands on a single-digit page.
    const children: ElementBox[] = [hostParagraph("p", "B")];
    for (let i = 0; i < 6; i++) children.push(fixedBlock(`f${i}`, 120));
    children.push(fixedBlock("B", 120));
    const root = cascadeRootWithColumns({ display: "block" }, children, 2);
    const tree = build(root, pageConfig(300));

    // The target resolves to a sub-reservation single-digit page value (1 glyph < "00").
    const targetPage = tree.plan.pageSpanOfBlock("B")?.first;
    if (targetPage === undefined || targetPage === null) throw new Error("target B has no page");
    const value = String(targetPage + 1);
    expect(value.length).toBeLessThan(RESERVED.length); // 1 < 2 ⇒ sub-reservation

    // Materializing EVERY page must not throw the multicol drift dev-assert.
    for (let i = 0; i < tree.plan.entries.length; i++) {
      expect(() => tree.getPage(i)).not.toThrow();
    }

    // The host page's body is genuinely a MultiColumnBox (the multicol materialize path is
    // exercised, not a single-column fallback), and the cross-ref atom lives inside a column.
    const hostPage = tree.plan.pageSpanOfBlock("p")?.first ?? 0;
    const body = tree.getPage(hostPage).children[0];
    if (body === undefined) throw new Error("host page has no body box");
    expect(body.type).toBe("multicolumn");

    const atom = findCrossRefBoxDeep(tree.getPage(hostPage), HOST_REF_KEY);
    if (atom === null) throw new Error("no cross-ref atom in multicol page");

    // VALUE: substituted to the target's 1-based page (placeholder gone).
    expect(collectText(atom)).toBe(value);
    expect(collectText(atom)).not.toBe(RESERVED);

    // WIDTH (the R-F6 lock): the atom is sized to the 2-glyph RESERVATION the measure pass used —
    // NOT shrink-to-fit the narrower 1-glyph value. The mock shaper (createMockShaper(8, 16)) gives
    // every glyph a fixed 8px advance, so the reservation is RESERVED.length × 8 and the value is
    // value.length × 8 (strictly narrower). Pre-fix `atom.inlineSize` was the VALUE width (one
    // glyph narrower) — the measure↔materialize disagreement that lets a column over-fill; the fix
    // makes it the RESERVATION width. This assertion is RED without the materialize-side patch.
    const GLYPH_PX = 8; // createMockShaper(8, 16) advance — see `shaper` above
    expect(atom.inlineSize).toBe(RESERVED.length * GLYPH_PX); // 2-glyph reservation, not the value
    expect(atom.inlineSize).toBeGreaterThan(value.length * GLYPH_PX); // wider than the 1-glyph value
  });
});

/**
 * Multicol-aware analogue of {@link findCrossRefBox}: a 2-column page's body is a
 * `MultiColumnBox` whose atoms live under `columns` rather than `children`, so walk BOTH the
 * box tree and the column tree, matching the atom by render-key suffix.
 */
function findCrossRefBoxDeep(page: PageBox, embedKey: string): LayoutBox | null {
  let result: LayoutBox | null = null;
  const visit = (node: LayoutBox): void => {
    if (result !== null) return;
    if (typeof node.key === "string" && node.key.endsWith(embedKey)) {
      result = node;
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
    if ("columns" in node) for (const col of node.columns) visit(col);
  };
  visit(page);
  return result;
}
