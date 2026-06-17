/**
 * F-1: `collectPageFields` — the field-spec extraction walk over the CASCADED
 * render trees (template header/footer bodies + the main tree). Emits one
 * `FieldSpec` per `page-field` inline-block atom, keyed by its stable render key
 * and carrying the atom's `computedStyle` (for width measurement downstream).
 */
import { describe, it, expect } from "vitest";
import { collectPageFields } from "./collect-page-fields";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { asBlockId } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// Build a CASCADED body ElementBox (computedStyle present — collectPageFields walks
// cascaded trees) containing a page-field inline-block atom with metadata.
function bodyWithField(blockId: string, embedKey: string, fieldKind: "page-number" | "page-count"): ElementBox {
  const rawAtom = createElementBox(embedKey, { display: "inline-block" }, [createTextBox(`${embedKey}/0`, {}, "00")], {
    embedType: "page-field",
    fieldKind,
    numberStyle: "decimal",
  });
  const atom = Object.freeze({ ...rawAtom, computedStyle: INITIAL_COMPUTED_STYLE });
  const rawBody = createElementBox(blockId, {}, [atom], {});
  return Object.freeze({ ...rawBody, computedStyle: INITIAL_COMPUTED_STYLE });
}

describe("collectPageFields (F-1 extraction)", () => {
  it("finds page-field atoms in template bodies, keyed by render key, host=template", () => {
    const headerKey = "hdr1/inline/2";
    const templateContents = new Map([[asBlockId("hdr1"), bodyWithField("hdr1", headerKey, "page-count")]]);
    const specs = collectPageFields(templateContents, []);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      embedKey: headerKey,
      host: "template",
      hostBlockId: "hdr1",
      fieldType: "page-count",
      numberStyle: "decimal",
    });
    expect(nth(specs, 0, "spec").computedStyle).toBe(INITIAL_COMPUTED_STYLE);
  });

  it("finds page-field atoms in main-tree blocks, host=main; two fields get distinct specs", () => {
    const main = [
      bodyWithField("blkA", "blkA/inline/0", "page-number"),
      bodyWithField("blkB", "blkB/inline/1", "page-count"),
    ];
    const specs = collectPageFields(new Map(), main);
    expect(specs.map((s) => s.embedKey).sort()).toEqual(["blkA/inline/0", "blkB/inline/1"]);
    expect(specs.every((s) => s.host === "main")).toBe(true);
    // hostBlockId is derived from the atom's own render key → the host LEAF block.
    expect(specs.find((s) => s.embedKey === "blkA/inline/0")?.hostBlockId).toBe("blkA");
    expect(specs.find((s) => s.embedKey === "blkB/inline/1")?.hostBlockId).toBe("blkB");
  });

  it("derives hostBlockId from the atom's OWN key, even when nested below the top-level child", () => {
    // A page-field in a leaf "para" nested inside a top-level container "table".
    const rawAtom = createElementBox("para/inline/0", { display: "inline-block" }, [createTextBox("para/inline/0/0", {}, "00")], {
      embedType: "page-field",
      fieldKind: "page-number",
      numberStyle: "decimal",
    });
    const atom = Object.freeze({ ...rawAtom, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawPara = createElementBox("para", {}, [atom], {});
    const para = Object.freeze({ ...rawPara, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawTable = createElementBox("table", {}, [para], {});
    const table = Object.freeze({ ...rawTable, computedStyle: INITIAL_COMPUTED_STYLE });
    const specs = collectPageFields(new Map(), [table]);
    expect(specs).toHaveLength(1);
    // hostBlockId is the host LEAF ("para"), NOT the top-level ancestor ("table").
    expect(nth(specs, 0, "spec").hostBlockId).toBe("para");
  });

  it("returns [] when there are no page-fields", () => {
    expect(collectPageFields(new Map(), [])).toEqual([]);
  });

  it("ignores non-page-field embeds (e.g. a footnote anchor)", () => {
    const rawAnchor = createElementBox("blk/inline/0", { display: "inline-block" }, [createTextBox("blk/inline/0/0", {}, "1")], {
      embedType: "footnote-anchor",
      contentBlockId: "fn",
    });
    const anchor = Object.freeze({ ...rawAnchor, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawBody = createElementBox("blk", {}, [anchor], {});
    const body = Object.freeze({ ...rawBody, computedStyle: INITIAL_COMPUTED_STYLE });
    expect(collectPageFields(new Map(), [body])).toEqual([]);
  });

  it("emits a cross-ref-page spec for a page-mode cross-reference placeholder atom", () => {
    const rawAtom = createElementBox("blk/inline/0", { display: "inline-block" }, [createTextBox("blk/inline/0/0", {}, "00")], {
      embedType: "cross-reference",
      refMode: "page",
      targetId: "tgt",
      numberStyle: "decimal",
    });
    const atom = Object.freeze({ ...rawAtom, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawBody = createElementBox("blk", {}, [atom], {});
    const body = Object.freeze({ ...rawBody, computedStyle: INITIAL_COMPUTED_STYLE });
    const specs = collectPageFields(new Map(), [body]);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      fieldType: "cross-ref-page",
      embedKey: "blk/inline/0",
      host: "main",
      hostBlockId: "blk",
      targetId: "tgt",
      numberStyle: "decimal",
    });
    expect(nth(specs, 0, "spec").computedStyle).toBe(INITIAL_COMPUTED_STYLE);
  });

  it("emits a cross-ref-page spec for a TOC-entry atom keyed with /toc/, host = the TOC block", () => {
    // A synthesized TOC entry page-number atom: a page-mode cross-ref whose render
    // key is `${tocId}/toc/${i}` (NOT an /inline/ key). hostBlockId must derive
    // from the part before "/toc/" = the real (plan-indexed) TOC block.
    const rawAtom = createElementBox("toc1/toc/0", { display: "inline-block" }, [createTextBox("toc1/toc/0/0", {}, "00")], {
      embedType: "cross-reference",
      refMode: "page",
      targetId: "heading1",
      numberStyle: "decimal",
    });
    const atom = Object.freeze({ ...rawAtom, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawBody = createElementBox("toc1", {}, [atom], { tableOfContents: true });
    const body = Object.freeze({ ...rawBody, computedStyle: INITIAL_COMPUTED_STYLE });
    const specs = collectPageFields(new Map(), [body]);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      fieldType: "cross-ref-page",
      embedKey: "toc1/toc/0",
      host: "main",
      hostBlockId: "toc1",
      targetId: "heading1",
      numberStyle: "decimal",
    });
  });

  it("skips a cross-ref-page atom whose target id is missing/non-string (no spec)", () => {
    const rawAtom = createElementBox("blk/inline/0", { display: "inline-block" }, [createTextBox("blk/inline/0/0", {}, "00")], {
      embedType: "cross-reference",
      refMode: "page",
      targetId: null,
      numberStyle: "decimal",
    });
    const atom = Object.freeze({ ...rawAtom, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawBody = createElementBox("blk", {}, [atom], {});
    const body = Object.freeze({ ...rawBody, computedStyle: INITIAL_COMPUTED_STYLE });
    expect(collectPageFields(new Map(), [body])).toEqual([]);
  });

  it("throws if a page-field atom has no computedStyle (walk must run on cascaded trees)", () => {
    // A PRE-cascade atom (no computedStyle) — a programming error this guard catches.
    const atom = createElementBox("blk/inline/0", { display: "inline-block" }, [createTextBox("blk/inline/0/0", {}, "00")], {
      embedType: "page-field",
      fieldKind: "page-number",
      numberStyle: "decimal",
    });
    const body = createElementBox("blk", {}, [atom], {});
    expect(() => collectPageFields(new Map(), [body])).toThrow();
  });

  it("throws if a cross-ref-page atom has no computedStyle (walk must run on cascaded trees)", () => {
    // Parallel to the page-field guard: a PRE-cascade cross-ref-page atom.
    const atom = createElementBox("blk/inline/0", { display: "inline-block" }, [createTextBox("blk/inline/0/0", {}, "00")], {
      embedType: "cross-reference",
      refMode: "page",
      targetId: "tgt",
      numberStyle: "decimal",
    });
    const body = createElementBox("blk", {}, [atom], {});
    expect(() => collectPageFields(new Map(), [body])).toThrow();
  });

  it("throws if a cross-ref-page atom's key is neither an inline nor a toc render key", () => {
    // Key lacks both the "/inline/" and "/toc/" separators → fieldHostBlockId
    // returns null → cannot derive hostBlockId → guard throws.
    const rawAtom = createElementBox("blk", { display: "inline-block" }, [createTextBox("blk/0", {}, "00")], {
      embedType: "cross-reference",
      refMode: "page",
      targetId: "tgt",
      numberStyle: "decimal",
    });
    const atom = Object.freeze({ ...rawAtom, computedStyle: INITIAL_COMPUTED_STYLE });
    const rawBody = createElementBox("root", {}, [atom], {});
    const body = Object.freeze({ ...rawBody, computedStyle: INITIAL_COMPUTED_STYLE });
    expect(() => collectPageFields(new Map(), [body])).toThrow();
  });
});
