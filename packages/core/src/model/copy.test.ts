/** Model copy (`copy(ctx) → FragmentItem[]`): the inverse of paste — pasting a selection's copy over it reads the same. */
import { describe, expect, it } from "vitest";
import { copy } from "./commands/copy";
import { rangeOf } from "./commands/helpers/at";
import { chunked } from "./plan";
import { getEmbedContentIds, getTemplateContentIds } from "./document/blocks";
import { paste } from "./commands/paste";
import { selectAll } from "./commands/selections";
import { insertHeaderFooter } from "./commands/insert-header-footer";
import { insertMarker } from "./commands/insert-marker";
import { removeHeaderFooter } from "./commands/remove-header-footer";
import { setMarks } from "./commands/set-marks";
import { setParagraphAttrs } from "./commands/set-paragraph-attrs";
import { type ModelSelection, caretAt } from "./position/model-position";
import { paragraphLayout } from "./position/paragraph-layout";
import { newFootnoteOf, newHorizontalRule, newLineBreak, newObject, newParagraphMark, newSectionBreak, newTableOfContents } from "./storage/new-items";
import { childrenOf } from "./test-helpers/fixture";
import { type Harness, line } from "./test-helpers/harness";
import { raw } from "./test-helpers/table";

/** The read, with each section's header / footer link as its body's lines (a pasted [S] links fresh bodies: ids differ). */
function read(h: Harness): unknown {
  const d = h.version;
  const r = h.read();
  if (typeof r !== "object" || r === null || !("sections" in r) || !Array.isArray(r.sections)) return r;
  const sections: unknown[] = r.sections.map((s: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k.endsWith("BlockId") && typeof v === "string" ? childrenOf(d, "templateContent", v).map(line) : v])),
  );
  return { ...r, sections, templates: undefined };
}

/** Pasting `sel`'s copy over `sel` leaves the document reading the same. */
function roundTrips(h: Harness, sel: ModelSelection, label: string): void {
  h.selection = sel;
  // Ends that resolve to one caret position (either side of a float, R16) select nothing.
  if (rangeOf(h.ctx())?.collapsed === true) return;
  const before = read(h);
  const items = copy(h.ctx());
  expect(items, label).not.toBeNull();
  h.selection = sel;
  expect(h.run(paste, items ?? []), label).toBe(true);
  expect(read(h), label).toEqual(before);
}

describe("copy: text ranges and select-all (C1)", () => {
  /** Three paragraphs; "b" bold, the second a heading; a section break after the second. */
  const doc = (): Harness => {
    const h = raw("ab¶ cd¶ [S] ef¶");
    h.select([0, 1], [0, 2]);
    h.run(setMarks, { bold: true });
    h.caret(1, 0);
    h.run(setParagraphAttrs, { type: "heading" });
    return h;
  };

  it("one paragraph's text is text alone; across paragraphs, each ¶ but the last comes with its keys", () => {
    const h = doc();
    h.select([0, 0], [0, 2]);
    expect(copy(h.ctx())).toEqual([{ k: "text", text: "a" }, { k: "text", text: "b", attrs: { bold: true } }]);
    h.select([0, 1], [2, 1]);
    const items = copy(h.ctx());
    expect(items?.map((i) => i.k)).toEqual(["text", "para", "text", "para", "S", "text"]);
    expect(items?.[3]).toEqual({ k: "para", keys: { "p:type": "heading" } });
    h.caret(0, 1);
    expect(copy(h.ctx())).toBeNull();
  });

  it("round trip: every range of the body, and select-all", () => {
    roundTripAll(doc);
  });
});

/** Every range of `make()`'s body round-trips, and its select-all. */
function roundTripAll(make: () => Harness): void {
  // Positions in paragraphs only (a TOC block holds none).
  const at = (h: Harness): [number, number][] =>
    h.paragraphs().flatMap((p, i) => {
      const L = paragraphLayout(h.version, p.id);
      return L === null ? [] : Array.from({ length: L.length + 1 }, (_, o): [number, number] => [i, o]);
    });
  const points = at(make());
  for (let x = 0; x < points.length; x++) {
    for (let y = x + 1; y < points.length; y++) {
      const h = make();
      const [a, b] = [points[x], points[y]];
      if (a === undefined || b === undefined) continue;
      roundTrips(h, { anchor: h.at(...a), focus: h.at(...b) }, `${a}-${b}`);
    }
  }
  const h = make();
  roundTrips(h, selectAll(h.version) ?? h.selection, "all");
}

describe("copy: footnotes, inline atoms, floats, TOCs, debris and sections (C1)", () => {
  /**
   * `a[fn]b[br]¶ [float]c[placeholder]¶ [hr]¶ [toc] d¶ e [S] f¶ [S] g¶`: a footnote with a heading body, a floated image, an object of an unregistered kind (a placeholder), a rule, a
   * TOC with text right after it, debris before the first [S]. Section 1 has its own header (a page field); section 2
   * shows none and has its own footer; section 3 inherits both.
   */
  const doc = (): Harness => {
    const h = raw([
      "a",
      newFootnoteOf(...chunked([{ text: "n", attrs: {} }, { embed: newParagraphMark({ "p:type": "heading" }), attrs: {} }])),
      "b",
      newLineBreak(),
      newParagraphMark(),
      newObject("image", { w: 3, wrap: "left", props: { src: "a.png" } }),
      "c",
      newObject("acme:unknown", { props: { x: 1 } }),
      newParagraphMark(),
      newHorizontalRule(),
      newParagraphMark(),
      newTableOfContents({ "a:depth": 2 }),
      "d",
      newParagraphMark(),
      "e",
      newSectionBreak(),
      "f",
      newParagraphMark(),
      newSectionBreak(),
      "g",
    ]);
    const into = (region: "header" | "footer", text: { k: "field"; field: string } | { k: "text"; text: string }): void => {
      h.run(insertHeaderFooter, region);
      h.run(paste, [text]);
    };
    h.caret(0, 0);
    into("header", { k: "field", field: "page-number" });
    h.selection = caretAt(h.blockId(6), 0);
    h.run(removeHeaderFooter, "header");
    h.selection = caretAt(h.blockId(6), 0);
    into("footer", { k: "text", text: "F" });
    h.history.clear();
    return h;
  };

  it("reads what reads: section links against the section before, footnote bodies with their ¶, no anchors", () => {
    const h = doc();
    expect(h.dump()).toEqual(["paragraph:a[fn]b[br]", "paragraph:[img:left]c[img]", "paragraph:[hr]", "toc", "paragraph:d", "paragraph:e", "|", "paragraph:f", "|", "paragraph:g"]);
    h.selection = selectAll(h.version) ?? h.selection;
    const items = copy(h.ctx());
    expect(items?.[1]).toEqual({ k: "footnote", body: [{ k: "text", text: "n" }, { k: "para", keys: { "p:type": "heading" } }] });
    expect(items?.find((i) => i.k === "toc")).toEqual({ k: "toc", keys: { "a:depth": 2 } });
    const [s1, s2] = items?.filter((i) => i.k === "S") ?? [];
    expect(s1).toEqual({ k: "S", bodies: { "h:header:default": [{ k: "field", field: "page-number", numberStyle: "decimal" }, { k: "para" }] } });
    expect(s2).toEqual({ k: "S", keys: { "h:header:default": "none" }, bodies: { "h:footer:default": [{ k: "text", text: "F" }, { k: "para" }] } });
    // Anchors are not copied.
    h.select([0, 0], [0, 1]);
    h.run(insertMarker, "c", "m1");
    h.select([0, 0], [0, 4]); // [m a m] [fn]: the marker's edges are read units
    expect(copy(h.ctx())?.map((i) => i.k)).toEqual(["text", "footnote"]);
    h.select([0, 0], [0, 1]); // only the marker's start edge: nothing reads
    expect(copy(h.ctx())).toBeNull();
  });

  it("round trip: every range of the body, and select-all; select-all of a footnote body and of a header", () => {
    roundTripAll(doc);
    for (const ids of [getEmbedContentIds, getTemplateContentIds]) {
      const h = doc();
      const holder = ids(h.version)[0];
      if (holder === undefined) throw new Error("no body");
      roundTrips(h, selectAll(h.version, holder) ?? h.selection, `all of ${ids.name}`);
    }
  });
});
