/**
 * F-2: `substitutePageFields` — spine-clone substitution of page-field placeholders
 * with their per-page value (the late-binding seam, mirroring FN-6.2b). page-number
 * → formatCounter(pageIndex+1); page-count → globalFieldValues. Identity-preserving
 * for everything not on a path to a page-field; never mutates the frozen input.
 */
import { describe, it, expect } from "vitest";
import { substitutePageFields } from "./substitute-page-fields";
import { createElementBox, createTextBox } from "../render/render-node";
import type { ElementBox } from "../render/render-node";

function pageFieldAtom(embedKey: string, fieldKind: "page-number" | "page-count"): ElementBox {
  return createElementBox(embedKey, { display: "inline-block" }, [createTextBox(`${embedKey}/0`, {}, "00")], {
    embedType: "page-field",
    fieldKind,
    numberStyle: "decimal",
  });
}

/** The text of the lone page-field atom's child text box (the substituted value). */
function fieldValueText(body: ElementBox): string {
  const atom = body.children.find(
    (c): c is ElementBox => c.type === "element" && c.metadata?.embedType === "page-field",
  );
  if (atom === undefined) throw new Error("no page-field atom");
  const child = atom.children[0];
  if (child === undefined || child.type !== "text") throw new Error("no child text");
  return child.text;
}

describe("substitutePageFields (F-2)", () => {
  it("replaces a page-number placeholder with the 1-based page index on a spine-clone", () => {
    const body = createElementBox("hdr", {}, [createTextBox("hdr/t", {}, "Page "), pageFieldAtom("hdr/inline/1", "page-number")], {});
    const out = substitutePageFields(body, /* pageIndex */ 2, new Map());
    expect(fieldValueText(out)).toBe("3"); // page 3 (1-based)
    // identity-preserving: the leading "Page " text box is the SAME ref
    expect(out.children[0]).toBe(body.children[0]);
    // the original body is untouched (frozen, no mutation)
    expect(fieldValueText(body)).toBe("00");
  });

  it("substitutes a page-count placeholder from globalFieldValues", () => {
    const body = createElementBox("hdr", {}, [pageFieldAtom("hdr/inline/1", "page-count")], {});
    const out = substitutePageFields(body, 0, new Map([["hdr/inline/1", "10"]]));
    expect(fieldValueText(out)).toBe("10");
  });

  it("returns the SAME body ref when it contains no page-fields (no clone)", () => {
    const plain = createElementBox("hdr", {}, [createTextBox("hdr/t", {}, "Header")], {});
    expect(substitutePageFields(plain, 0, new Map())).toBe(plain);
  });

  it("leaves a page-count field UNCHANGED when its global value is absent (no fabricated digit)", () => {
    // A page-number-only run (no globalFieldValues built) must not invent a page-count value.
    const body = createElementBox("hdr", {}, [pageFieldAtom("hdr/inline/1", "page-count")], {});
    const out = substitutePageFields(body, 4, new Map());
    expect(out).toBe(body); // nothing to substitute → same ref
    expect(fieldValueText(body)).toBe("00"); // placeholder untouched
  });

  it("substitutes a page-field nested below the body root (spine-clone preserves siblings)", () => {
    const atom = pageFieldAtom("p/inline/0", "page-number");
    const para = createElementBox("p", {}, [createTextBox("p/t", {}, "x"), atom], {});
    const sibling = createTextBox("sib", {}, "sibling");
    const body = createElementBox("hdr", {}, [sibling, para], {});
    const out = substitutePageFields(body, 0, new Map());
    // the nested field got its value
    const outPara = out.children.find((c): c is ElementBox => c.type === "element" && c.key === "p");
    if (outPara === undefined) throw new Error("no para");
    expect(fieldValueText(outPara)).toBe("1");
    // the untouched sibling text box kept its identity
    expect(out.children[0]).toBe(sibling);
    // the para's leading "x" text box kept its identity (only the field leaf changed)
    expect(outPara.children[0]).toBe(para.children[0]);
  });

  it("throws (dev) on a malformed page-field atom with more than one child", () => {
    // A page-field atom must have EXACTLY one child (the placeholder text box).
    const malformed = createElementBox("hdr/inline/0", { display: "inline-block" }, [
      createTextBox("hdr/inline/0/0", {}, "00"),
      createTextBox("hdr/inline/0/1", {}, "extra"),
    ], { embedType: "page-field", fieldKind: "page-number", numberStyle: "decimal" });
    const body = createElementBox("hdr", {}, [malformed], {});
    expect(() => substitutePageFields(body, 0, new Map())).toThrow(/exactly one text child/);
  });

  it("substitutes a non-decimal page-number style", () => {
    const atom = createElementBox("hdr/inline/0", { display: "inline-block" }, [createTextBox("hdr/inline/0/0", {}, "00")], {
      embedType: "page-field",
      fieldKind: "page-number",
      numberStyle: "lower-roman",
    });
    const body = createElementBox("hdr", {}, [atom], {});
    const out = substitutePageFields(body, 3, new Map()); // page 4 → "iv"
    expect(fieldValueText(out)).toBe("iv");
  });
});
