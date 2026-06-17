/**
 * F-0: the render branch for a `page-field` inline embed (page-number / page-count).
 *
 * The render pass emits the field as ONE inline-block atom whose child text is the
 * PLACEHOLDER (N reserved sizing glyphs) — page-agnostic, since the real value
 * depends on pagination (bound late, at materialize). `fieldKind`/`numberStyle`
 * ride in `metadata` for the layout field-resolution pass. Mirrors
 * `render-cross-reference.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { asBlockId, insertPageField, PAGE_FIELD_EMBED_TYPE, createPosition } from "../state";
import type { PageFieldNumberStyle } from "../state";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

/** Locate the single page-field element box (by metadata.embedType). Mirrors findCrossRef. */
function findPageField(root: RenderNode): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    const el = node as ElementBox;
    if (el.metadata?.embedType === PAGE_FIELD_EMBED_TYPE) found = el;
    for (const child of el.children) walk(child);
  }
  walk(root);
  return found;
}

function docWithField(fieldKind: "page-number" | "page-count", numberStyle?: PageFieldNumberStyle) {
  const state = buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("ab")]) }),
    ],
  });
  return insertPageField(state, createPosition(asBlockId("p"), 1), fieldKind, numberStyle).state;
}

describe("render — page-field placeholder wiring", () => {
  it("renders a page-number field as an inline-block atom with reserved placeholder glyphs + metadata", () => {
    const out = render(docWithField("page-number"), reg, attrReg);
    const atom = findPageField(out.root);
    if (atom === null) throw new Error("no page-field atom");
    // load-bearing: a single inline-block ATOM = one IFC token = one cursor stop (#407)
    expect(atom.style.display).toBe("inline-block");
    expect(atom.children).toHaveLength(1);
    const child = atom.children[0];
    if (child === undefined) throw new Error("expected one page-field child");
    expect(child.type).toBe("text");
    expect((child as TextBox).text).toBe("00"); // PAGE_FIELD_RESERVED_GLYPHS = 2
    expect(atom.metadata?.embedType).toBe(PAGE_FIELD_EMBED_TYPE);
    expect(atom.metadata?.fieldKind).toBe("page-number");
    expect(atom.metadata?.numberStyle).toBe("decimal");
  });

  it("carries page-count + a non-default numberStyle in metadata", () => {
    const out = render(docWithField("page-count", "lower-roman"), reg, attrReg);
    const atom = findPageField(out.root);
    if (atom === null) throw new Error("no page-field atom");
    expect(atom.metadata?.fieldKind).toBe("page-count");
    expect(atom.metadata?.numberStyle).toBe("lower-roman");
  });
});
