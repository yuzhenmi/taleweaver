// F-3: `patchFieldWidths` — the §4.4 growth mechanism. Spine-clones each frozen
// cascaded template body, overriding the `inlineSize` of every page-field atom whose
// render key is in `grownWidths` so the IFC lays it at the grown (worst-case value)
// width. Everything not on a path to a grown field keeps its ORIGINAL ref
// (identity-preserving). Mirrors substitutePageFields, but overrides width instead
// of substituting text.

import { describe, it, expect } from "vitest";
import { patchFieldWidths } from "./patch-field-widths";
import { cascadePass } from "../cascade";
import { createElementBox, createTextBox } from "../render/render-node";
import type { ElementBox } from "../render/render-node";
import type { BlockId } from "../state";

/** A cascaded page-field atom (carries computedStyle after cascade). */
function pageFieldAtom(embedKey: string): ElementBox {
  return createElementBox(embedKey, { display: "inline-block" }, [createTextBox(`${embedKey}/0`, {}, "00")], {
    embedType: "page-field",
    fieldKind: "page-count",
    numberStyle: "decimal",
  });
}

/** Cascade a body so its nodes carry computedStyle (what collect/patch operate on). */
function cascade(children: readonly ElementBox[]): ElementBox {
  const cascaded = cascadePass(createElementBox("body", { display: "block" }, children));
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/** Find a nested element by key in a cascaded tree. */
function findByKey(node: ElementBox, key: string): ElementBox | undefined {
  if (node.key === key) return node;
  for (const child of node.children) {
    if (child.type === "element") {
      const found = findByKey(child, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const HDR = "hdr" as BlockId;

describe("patchFieldWidths (F-3 §4.4 growth mechanism)", () => {
  it("returns the SAME map ref when grownWidths is empty (no work)", () => {
    const body = cascade([pageFieldAtom("body/inline/0")]);
    const templates = new Map<BlockId, ElementBox>([[HDR, body]]);
    expect(patchFieldWidths(templates, new Map())).toBe(templates);
  });

  it("overrides the inlineSize of the targeted page-field atom", () => {
    const para = createElementBox("hp", { display: "block" }, [
      createTextBox("hp/inline/0", {}, "Page "),
      pageFieldAtom("hp/inline/1"),
    ]);
    const body = cascade([para]);
    const origAtom = findByKey(body, "hp/inline/1");
    if (origAtom === undefined) throw new Error("no atom");
    const origInlineSize = origAtom.computedStyle?.inlineSize;
    const templates = new Map<BlockId, ElementBox>([[HDR, body]]);

    const out = patchFieldWidths(templates, new Map([["hp/inline/1", 24]]));
    const outBody = out.get(HDR);
    if (outBody === undefined) throw new Error("no body");
    const outAtom = findByKey(outBody, "hp/inline/1");
    if (outAtom === undefined) throw new Error("no out atom");
    expect(outAtom.computedStyle?.inlineSize).toBe(24);
    // the original atom is untouched (frozen input, no mutation)
    expect(origAtom.computedStyle?.inlineSize).toBe(origInlineSize);
    expect(origInlineSize).not.toBe(24);
  });

  it("identity-preserves siblings and non-targeted bodies (structural sharing)", () => {
    const paraA = createElementBox("ha", { display: "block" }, [
      createTextBox("ha/inline/0t", {}, "x"),
      pageFieldAtom("ha/inline/1"),
    ]);
    const bodyA = cascade([paraA]);
    const bodyB = cascade([createElementBox("hb", { display: "block" }, [pageFieldAtom("hb/inline/0")])]);
    const FA = "fa" as BlockId;
    const FB = "fb" as BlockId;
    const templates = new Map<BlockId, ElementBox>([[FA, bodyA], [FB, bodyB]]);

    const out = patchFieldWidths(templates, new Map([["ha/inline/1", 30]]));
    // body B has no grown field ⇒ same ref
    expect(out.get(FB)).toBe(bodyB);
    // body A's untouched leading text box keeps identity
    const outA = out.get(FA);
    if (outA === undefined) throw new Error("no body A");
    const outParaA = findByKey(outA, "ha");
    const origParaA = findByKey(bodyA, "ha");
    if (outParaA === undefined || origParaA === undefined) throw new Error("no para A");
    expect(outParaA.children[0]).toBe(origParaA.children[0]); // the "x" text box ref is shared
    // body A itself is a fresh clone (a descendant changed)
    expect(outA).not.toBe(bodyA);
  });

  it("leaves a body whose field key is NOT in grownWidths unchanged", () => {
    const body = cascade([createElementBox("hb", { display: "block" }, [pageFieldAtom("hb/inline/0")])]);
    const templates = new Map<BlockId, ElementBox>([[HDR, body]]);
    // grow a DIFFERENT key
    const out = patchFieldWidths(templates, new Map([["other/inline/9", 99]]));
    expect(out.get(HDR)).toBe(body); // nothing matched ⇒ same body ref
  });
});
