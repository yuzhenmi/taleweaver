// packages/core/src/layout/__tests__/page-field-geometry.test.ts
//
// F-2: the LATE-BINDING PROOF for layout-dependent page-fields. A page-number
// field in a header shows "1" on page 0, "2" on page 1 — bound per-page at
// MATERIALIZE (substituteLayoutFields), NOT at render (the render placeholder is
// page-agnostic). A page-count field shows the total on every page. Plus the
// §4.5 fingerprint fold: a value change (the doc grew a page → later page numbers
// shift) busts the carry-forward even though the cascaded header body is unchanged.
//
// Harness mirrors growing-slot.test.ts (the C.2c header/footer-slot test): a root
// carrying `{ headerBlockId }` metadata + a `bodies` map of cascaded header bodies,
// built via the real producer (exercises collectPageFields + resolvePageFields +
// the materialize substitution).

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import { asBlockId, insertPageField, createPosition, type BlockId } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import type { LayoutBox } from "../layout-box";
import type { PageBox } from "../page-box";
import { buildVirtualPaginatedTree } from "../virtual-producer";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { buildState, buildBlock, inlineContent, text } from "@taleweaver/core";

function cascadeRoot(
  rootStyle: Style,
  children: readonly ElementBox[],
  metadata?: Record<string, unknown>,
): ElementBox {
  const root = createElementBox("root", rootStyle, children, metadata);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function fixedBlock(key: string, blockSize: number): ElementBox {
  return createElementBox(key, { display: "block", blockSize } as Style, []);
}

/** A `page-field` inline-block atom (one IFC token), keyed with an inline render key. */
function pageFieldAtom(embedKey: string, fieldKind: "page-number" | "page-count"): ElementBox {
  return createElementBox(embedKey, { display: "inline-block" } as Style, [createTextBox(`${embedKey}/0`, {}, "00")], {
    embedType: "page-field",
    fieldKind,
    numberStyle: "decimal",
  });
}

/** A header body: a container whose single paragraph holds "Page " + a page-field atom. */
function headerBody(fieldKind: "page-number" | "page-count", lead: string): ElementBox {
  const para = createElementBox("hp", { display: "block" } as Style, [
    createTextBox("hp/inline/0", {}, lead),
    pageFieldAtom("hp/inline/1", fieldKind),
  ]);
  return cascadeRoot({ display: "block" }, [para]);
}

/**
 * A header whose page-count field uses a non-decimal `numberStyle` so a WIDE value
 * (e.g. lower-roman "viii" = 4 glyphs) overflows the 2-glyph placeholder reservation
 * — the input the §4.4 convergence loop must grow. `lead` is a long single word that
 * sits just inside the line so the grown field wraps the header to a second line.
 */
function romanCountHeader(lead: string): ElementBox {
  const para = createElementBox("hp", { display: "block" } as Style, [
    createTextBox("hp/inline/0", {}, lead),
    createElementBox("hp/inline/1", { display: "inline-block" } as Style, [createTextBox("hp/inline/1/0", {}, "00")], {
      embedType: "page-field",
      fieldKind: "page-count",
      numberStyle: "lower-roman",
    }),
  ]);
  return cascadeRoot({ display: "block" }, [para]);
}

function pageConfig(pageBlockSize: number): PageConfig {
  return {
    pageInlineSize: 600,
    pageBlockSize,
    pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 15, inlineEnd: 15 },
    pageGap: 20,
  };
}

const shaper = () => createMockShaper(8, 16);

function build(
  root: ElementBox,
  cfg: PageConfig,
  bodies: ReadonlyMap<BlockId, ElementBox>,
  prev?: ReturnType<typeof buildVirtualPaginatedTree>,
) {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  return buildVirtualPaginatedTree(root, ctx, shaper(), cfg, prev, bodies);
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

function headerText(page: PageBox): string {
  return page.headerSlot === null ? "" : collectText(page.headerSlot);
}

const HDR = "hdr-root" as BlockId;

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

/**
 * Build a header body the REAL way: a state whose `templateContents` header (root id
 * `HDR`) holds "Page " + a `page-field` inserted via the actual `insertPageField` op,
 * then run it through the REAL `render` pass (NOT a hand-built atom) and cascade it.
 * The other tests hand-build the page-field atom; this proves the render OUTPUT of a
 * page-field embed flows through collect → resolve → substitute unchanged — the seam
 * the user's in-browser smoke exercises (render → paginate → materialize).
 */
function renderedHeaderBody(fieldKind: "page-number" | "page-count"): ElementBox {
  let state = buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "bp", lastChildId: "bp" }),
      buildBlock({ id: "bp", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("body")]) }),
    ],
    templateContents: [
      buildBlock({ id: "hdr-root", type: "document", parentId: null, firstChildId: "hp", lastChildId: "hp" }),
      buildBlock({ id: "hp", type: "paragraph", parentId: "hdr-root", inlineContent: inlineContent([text("Page ")]) }),
    ],
  });
  state = insertPageField(state, createPosition(asBlockId("hp"), 5), fieldKind).state; // after "Page "
  const rendered = render(state, reg, attrReg);
  const body = rendered.templateContents.get(asBlockId("hdr-root"));
  if (body === undefined) throw new Error("no rendered header template body");
  const cascaded = cascadePass(body);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("page-field END-TO-END (real render → cascade → paginate → materialize)", () => {
  it("a page-number field rendered from a REAL state shows the per-page value across pages", () => {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: HDR });
    const bodies = new Map<BlockId, ElementBox>([[HDR, renderedHeaderBody("page-number")]]);
    const tree = build(root, pageConfig(300), bodies);

    expect(tree.plan.entries.length).toBe(3);
    expect(headerText(tree.getPage(0))).toContain("1");
    expect(headerText(tree.getPage(0))).not.toContain("00"); // placeholder GONE: render output flowed through
    expect(headerText(tree.getPage(1))).toContain("2");
    expect(headerText(tree.getPage(2))).toContain("3");
  });

  it("a page-count field rendered from a REAL state shows the total on every page", () => {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: HDR });
    const bodies = new Map<BlockId, ElementBox>([[HDR, renderedHeaderBody("page-count")]]);
    const tree = build(root, pageConfig(300), bodies);

    expect(tree.plan.entries.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(headerText(tree.getPage(i))).toContain("3");
  });
});

describe("page-field geometry (F-2 late-binding proof)", () => {
  it("a header page-number field shows 1 on page 0, 2 on page 1, 3 on page 2", () => {
    // 6 fixed blocks × 100; content area (300 − ~16 header − 10) ≈ 274 ⇒ 2 blocks/page ⇒ 3 pages.
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: HDR });
    const bodies = new Map<BlockId, ElementBox>([[HDR, headerBody("page-number", "Page ")]]);
    const tree = build(root, pageConfig(300), bodies);

    expect(tree.plan.entries.length).toBe(3);
    expect(headerText(tree.getPage(0))).toContain("1");
    expect(headerText(tree.getPage(0))).not.toContain("00"); // placeholder is GONE
    expect(headerText(tree.getPage(1))).toContain("2");
    expect(headerText(tree.getPage(2))).toContain("3");
  });

  it("a header page-count field shows the total (3) on EVERY page", () => {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: HDR });
    const bodies = new Map<BlockId, ElementBox>([[HDR, headerBody("page-count", "of ")]]);
    const tree = build(root, pageConfig(300), bodies);

    expect(tree.plan.entries.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(headerText(tree.getPage(i))).toContain("3");
    }
  });

  it("§4.4 convergence: a wide page-count value that wraps the header grows the slot and re-paginates", () => {
    // 24 fixed blocks × 90px. With the 2-glyph placeholder (16px field) the header is
    // ONE line (lead 552px + 16 = 568 ≤ 570 content width) ⇒ body area 274 ⇒ 3 blocks/
    // page ⇒ 8 pages. But the page-count at 8 pages is roman "viii" (4 glyphs = 32px),
    // which OVERFLOWS the reservation. The convergence loop grows the field to 32px,
    // re-runs computeSlotInsets — now lead 552 + 32 = 584 > 570 ⇒ the field wraps the
    // header to TWO lines ⇒ body area 258 ⇒ 2 blocks/page ⇒ 12 pages. At 12 pages the
    // value is "xii" (3 glyphs = 24px ≤ 32px reserved) ⇒ converged. WITHOUT the loop the
    // header would stay 1 line and the doc would be 8 pages showing "viii" — so this
    // asserts the feedback was resolved.
    const lead = "L".repeat(69); // 552px — just inside the 570px content width at the reserved field width
    const children = Array.from({ length: 24 }, (_, i) => fixedBlock(`b${i}`, 90));
    const root = cascadeRoot({ display: "block" }, children, { headerBlockId: HDR });
    const bodies = new Map<BlockId, ElementBox>([[HDR, romanCountHeader(lead)]]);
    const tree = build(root, pageConfig(300), bodies);

    expect(tree.plan.entries.length).toBe(12); // converged count (8 without the loop)
    // self-consistent: a 12-page doc shows roman 12 ("xii"), not the pre-convergence "viii"
    expect(headerText(tree.getPage(0))).toContain("xii");
    expect(headerText(tree.getPage(0))).not.toContain("viii");
  });

  it("field-free docs are unaffected (no header ⇒ no slot, byte-identical pagination)", () => {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const tree = build(root, pageConfig(300), new Map());
    expect(tree.getPage(0).headerSlot).toBeNull();
    expect(tree.plan.entries.length).toBe(3);
  });

  it("carry-forward: an unchanged page (same number) is reused; a page whose number shifts is re-materialized", () => {
    const headerBodyRef = headerBody("page-number", "Page ");
    const bodies = new Map<BlockId, ElementBox>([[HDR, headerBodyRef]]);

    // Tree A: 6 blocks ⇒ 3 pages.
    const childrenA = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA, { headerBlockId: HDR });
    const treeA = build(rootA, pageConfig(300), bodies);
    treeA.getPage(0);
    expect(headerText(treeA.getPage(2))).toContain("3");

    // Tree B: insert TWO blocks at the FRONT (push everything down 1 page ⇒ 4 pages).
    // The SAME cascaded header body ref is reused (only body content changed). Page 0's
    // first block ref changed (new front block) so page 0 re-materializes anyway; the
    // proof is that a LATER page whose number shifted reflects the NEW number, and the
    // page-count-style value-fold busts reuse purely on the value change.
    const childrenB = [fixedBlock("pre0", 100), fixedBlock("pre1", 100), ...childrenA];
    const rootB = cascadeRoot({ display: "block" }, childrenB, { headerBlockId: HDR });
    const treeB = build(rootB, pageConfig(300), bodies, treeA);

    expect(treeB.plan.entries.length).toBe(4);
    // page 3 (1-based "4") is new; pages show their own 1-based numbers freshly.
    expect(headerText(treeB.getPage(3))).toContain("4");
    expect(headerText(treeB.getPage(0))).toContain("1");
  });

  it("carry-forward: a page-COUNT field busts every page when the total changes (value fold, body ref unchanged)", () => {
    const headerBodyRef = headerBody("page-count", "of ");
    const bodies = new Map<BlockId, ElementBox>([[HDR, headerBodyRef]]);

    const childrenA = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA, { headerBlockId: HDR });
    const treeA = build(rootA, pageConfig(300), bodies);
    treeA.getPage(0);
    expect(headerText(treeA.getPage(0))).toContain("3"); // "of 3"

    // Append blocks so the doc grows to 4 pages: the page-count value changes 3 → 4.
    const childrenB = [...childrenA, fixedBlock("b6", 100), fixedBlock("b7", 100)];
    const rootB = cascadeRoot({ display: "block" }, childrenB, { headerBlockId: HDR });
    const treeB = build(rootB, pageConfig(300), bodies, treeA);
    expect(treeB.plan.entries.length).toBe(4);
    // Page 0's body content is UNCHANGED (same front blocks) and the header body REF is
    // the SAME — only the page-count VALUE changed (3 → 4). The value fold must bust it.
    expect(headerText(treeB.getPage(0))).toContain("4"); // NOT the stale "of 3"
  });
});
