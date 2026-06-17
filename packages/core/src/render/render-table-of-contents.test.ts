/**
 * TOC render-walk wiring: the `table-of-contents` branch in `renderBlockBody`
 * synthesizes the entry-line subtree from the document outline at render time
 * (derive-not-store), instead of emitting the zero-height component stub.
 *
 * Each entry line carries the heading text + (when page numbers show) a
 * content-edge tab + a `"page"`-mode cross-reference ATOM keyed `${tocId}/toc/${i}`
 * so the SHIPPED layout field pipeline (`collectPageFields`) binds the real page
 * number late. Mirrors `render-page-field.test.ts` / `render-cross-reference.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { asBlockId, CROSS_REFERENCE_EMBED_TYPE } from "../state";
import { cascadePass } from "../cascade/cascade-pass";
import { collectPageFields } from "@taleweaver/print";
import { DEFAULT_TOC_ATTRS } from "../components/table-of-contents-attrs";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// DEFAULT_TOC_ATTRS as a plain block-attrs record. A spread of the `TocAttrs`
// interface (`{ ...DEFAULT_TOC_ATTRS }`) is typed as `TocAttrs`, which a named
// interface without an index signature is NOT assignable to
// `Record<string, unknown>`; an explicit object literal is.
const DEFAULT_ATTRS_RECORD: Record<string, unknown> = {
  levels: DEFAULT_TOC_ATTRS.levels,
  leader: DEFAULT_TOC_ATTRS.leader,
  showPageNumbers: DEFAULT_TOC_ATTRS.showPageNumbers,
  indentStep: DEFAULT_TOC_ATTRS.indentStep,
};

/** Locate the TOC block's render box (the ElementBox tagged `tableOfContents`). */
function findToc(root: RenderNode): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    if (node.metadata?.tableOfContents === true) found = node;
    for (const child of node.children) walk(child);
  }
  walk(root);
  return found;
}

/** The lone text-run text of an entry line (its first descendant TextBox). */
function firstTextOf(node: RenderNode): string {
  let out: string | null = null;
  function walk(n: RenderNode): void {
    if (out !== null) return;
    if (n.type === "text") {
      out = n.text;
      return;
    }
    for (const child of n.children) walk(child);
  }
  walk(node);
  if (out === null) throw new Error("no text descendant");
  return out;
}

/** Locate the `${tocId}/toc/${i}` page atom inside an entry line. */
function findPageAtom(entry: ElementBox, tocId: string, i: number): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    if (node.key === `${tocId}/toc/${i}`) found = node;
    for (const child of node.children) walk(child);
  }
  walk(entry);
  return found;
}

const TOC_ID = "toc1";
const H1_ID = "h1";
const H2_ID = "h2";

/**
 * Build a doc: h1 "Introduction", a paragraph, h2 "Details", then a TOC block.
 * `tocAttrs` is the TOC block's attrs (so a test can pass `{}` to exercise the
 * validators' defaults or `{ levels: [1] }` for the level-filter case).
 */
function docWithToc(tocAttrs: Readonly<Record<string, unknown>>) {
  return buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: H1_ID, lastChildId: TOC_ID }),
      buildBlock({
        id: H1_ID,
        type: "heading",
        parentId: "doc",
        nextSiblingId: "p",
        attrs: { level: 1 },
        inlineContent: inlineContent([text("Introduction")]),
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: H1_ID,
        nextSiblingId: H2_ID,
        inlineContent: inlineContent([text("body")]),
      }),
      buildBlock({
        id: H2_ID,
        type: "heading",
        parentId: "doc",
        prevSiblingId: "p",
        nextSiblingId: TOC_ID,
        attrs: { level: 2 },
        inlineContent: inlineContent([text("Details")]),
      }),
      buildBlock({
        id: TOC_ID,
        type: "table-of-contents",
        parentId: "doc",
        prevSiblingId: H2_ID,
        attrs: tocAttrs,
        inlineContent: null,
      }),
    ],
  });
}

describe("render — table-of-contents entry-subtree wiring", () => {
  it("synthesizes one entry line per heading (text + page atom), not the zero-height stub", () => {
    const out = render(docWithToc(DEFAULT_ATTRS_RECORD), reg, attrReg);
    const toc = findToc(out.root);
    if (toc === null) throw new Error("no TOC box");

    // Two outline headings → two entry-line children (NOT the empty stub).
    expect(toc.children).toHaveLength(2);

    // Entry text runs read the headings in document order.
    expect(firstTextOf(nth(toc.children, 0, "entry 0"))).toBe("Introduction");
    expect(firstTextOf(nth(toc.children, 1, "entry 1"))).toBe("Details");

    // Entry 0's page atom is a `"page"`-mode cross-ref keyed `${tocId}/toc/0`,
    // targeting the Introduction heading — the shape `collectPageFields` needs.
    const atom = findPageAtom(nth(toc.children, 0, "entry 0") as ElementBox, TOC_ID, 0);
    if (atom === null) throw new Error("no page atom for entry 0");
    expect(atom.key).toBe(`${TOC_ID}/toc/0`);
    expect(atom.metadata?.embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect(atom.metadata?.refMode).toBe("page");
    expect(atom.metadata?.targetId).toBe(H1_ID);

    // The lone child of the page atom is the reserved-glyph placeholder text.
    expect(atom.children).toHaveLength(1);
    const placeholder = nth(atom.children, 0, "placeholder");
    expect(placeholder.type).toBe("text");
    expect((placeholder as TextBox).text.length).toBeGreaterThan(0);
  });

  it("feeds the shipped field pipeline: collectPageFields emits a cross-ref-page spec per entry, host = TOC block", () => {
    const out = render(docWithToc(DEFAULT_ATTRS_RECORD), reg, attrReg);
    const toc = findToc(out.root);
    if (toc === null) throw new Error("no TOC box");

    // collectPageFields walks CASCADED trees (it throws on an atom with no
    // computedStyle), so cascade the TOC subtree first, then run the real pass.
    const cascadedToc = cascadePass(toc);
    const specs = collectPageFields(new Map(), [cascadedToc]);
    const xrefSpecs = specs.filter((s) => s.fieldType === "cross-ref-page");
    expect(xrefSpecs).toHaveLength(2);
    for (const spec of xrefSpecs) {
      expect(spec.hostBlockId).toBe(asBlockId(TOC_ID));
    }
    // The two specs target the two headings, in document order.
    expect(xrefSpecs.map((s) => s.fieldType === "cross-ref-page" ? s.targetId : null)).toEqual([
      asBlockId(H1_ID),
      asBlockId(H2_ID),
    ]);
  });

  it("defaults the TOC options off attrs `{}` via the validators (all levels, page numbers on)", () => {
    const out = render(docWithToc({}), reg, attrReg);
    const toc = findToc(out.root);
    if (toc === null) throw new Error("no TOC box");
    // Default levels include both 1 and 2 → both headings show.
    expect(toc.children).toHaveLength(2);
    // Default showPageNumbers === true → each entry carries a page atom.
    expect(findPageAtom(nth(toc.children, 0, "entry 0") as ElementBox, TOC_ID, 0)).not.toBeNull();
  });

  it("filters by `levels`: a level-[1] TOC emits only the level-1 heading", () => {
    const out = render(docWithToc({ levels: [1] }), reg, attrReg);
    const toc = findToc(out.root);
    if (toc === null) throw new Error("no TOC box");
    expect(toc.children).toHaveLength(1);
    expect(firstTextOf(nth(toc.children, 0, "entry 0"))).toBe("Introduction");
  });

  it("emits a zero-children TOC box when the document has no headings (not the stub)", () => {
    // A doc with only the TOC block (no headings) → getOutline → [] → no entries.
    // The branch must still run buildTocEntrySubtree (returning the tagged TOC box
    // with no children), NOT fall through to the zero-height component stub.
    const state = buildState({
      rootId: asBlockId("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: TOC_ID, lastChildId: TOC_ID }),
        buildBlock({
          id: TOC_ID,
          type: "table-of-contents",
          parentId: "doc",
          attrs: DEFAULT_ATTRS_RECORD,
          inlineContent: null,
        }),
      ],
    });
    const out = render(state, reg, attrReg);
    const toc = findToc(out.root);
    if (toc === null) throw new Error("no TOC box");
    expect(toc.children).toHaveLength(0);
  });
});
