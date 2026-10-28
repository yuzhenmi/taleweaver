import { describe, it, expect } from "vitest";
import type { ComputedStyle, EditorConfig, State, UsedStyle } from "@taleweaver/core";
import type { BlockBox, LayoutBox } from "@taleweaver/print";
import {
  INITIAL_COMPUTED_STYLE,
  asBlockId,
  buildBlock,
  buildState,
  createDefaultAttrRegistry,
  createDefaultComponentRegistry,
  createEditorStateFromState,
  createMockShaper,
  createPosition,
  createSpan,
  inlineContent,
  paragraphComponent,
  reduceEditor,
  render,
  text,
} from "@taleweaver/core";
import {
  computeUsedStyle,
  createBlockBox,
  createLineBox,
  createMarkerBox,
  createTextRunBox,
  createPageBox,
  layoutTree,
} from "@taleweaver/print";
import { emitPageContent } from "./page-emitter";
import { createStandard14FontProvider } from "./font-provider";

const decode = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);

const PAGE_W = 200;
const PAGE_H = 100;

const CS: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, fontSize: 12, color: "#000000" };
// A real UsedStyle (all-zero borders fall out of the initial style) so the
// box background/border passes emit nothing and only text contributes.
const US: UsedStyle = computeUsedStyle(CS, PAGE_W, PAGE_H);

/** A text-run box whose `text` is `s`, 1:1 cluster widths of `w/len`. */
function run(s: string, x: number, y: number, w: number): LayoutBox {
  const each = w / Math.max(1, s.length);
  return createTextRunBox(
    `run-${s}`,
    /* inlineOffset */ x, /* blockOffset */ y, /* inlineSize */ w, /* blockSize */ 16,
    "horizontal-tb", "ltr", CS, US,
    s, s.length, PAGE_W,
    undefined, Array.from({ length: s.length }, () => each),
  );
}

/** A LineBox owned by `blockId` wrapping `child`. */
function line(blockId: string, child: LayoutBox, x: number, y: number, w: number): LayoutBox {
  return createLineBox(
    `${blockId}-line`,
    x, y, w, 16,
    "horizontal-tb", "ltr", CS, US,
    [child], 16, PAGE_W,
    asBlockId(blockId), 0, 1, true,
  );
}

/** The body fixture: a paragraph line + a list item (marker box THEN content line). */
function bodyChildren(): readonly LayoutBox[] {
  // Paragraph: one line owning "para", wrapping a text-run.
  const para = line("para", run("AB", 0, 0, 16), 0, 0, 100);

  // List item: a BlockBox keyed "li" whose children are, in order, a marker
  // box (key "li-marker", text "1.") and a content line owning "li".
  const marker = createMarkerBox(
    "li-marker",
    0, 0, 10, 16,
    "horizontal-tb", "ltr", CS, US,
    "1.", PAGE_W,
  );
  const liLine = line("li", run("XY", 12, 0, 16), 12, 0, 88);
  const li = createBlockBox(
    "li",
    0, 20, 100, 16,
    "horizontal-tb", "ltr", CS, US,
    [marker, liLine], PAGE_W,
  );
  return [para, li];
}

function bodyPage(): ReturnType<typeof createPageBox> {
  return createPageBox(
    "page-0",
    0, 0, PAGE_W, PAGE_H,
    "horizontal-tb", "ltr", CS, US,
    bodyChildren(),
    0, PAGE_W,
    /* headerSlot */ null, /* footerSlot */ null, /* footnoteSlot */ null,
    0, 0,
  );
}

/** A page whose only content is a header slot wrapping a paragraph line. */
function headerOnlyPage(): ReturnType<typeof createPageBox> {
  const headerLine = line("hdr", run("HH", 0, 0, 16), 0, 0, 100);
  const headerSlot: BlockBox = createBlockBox(
    "hdr",
    0, 0, 100, 16,
    "horizontal-tb", "ltr", CS, US,
    [headerLine], PAGE_W,
  );
  return createPageBox(
    "page-0",
    0, 0, PAGE_W, PAGE_H,
    "horizontal-tb", "ltr", CS, US,
    [],
    0, PAGE_W,
    headerSlot, null, null,
    0, 0,
  );
}

const deps = () => ({
  provider: createStandard14FontProvider(),
  fontResourceName: () => "/F0",
  imageResourceName: () => "/Im0",
});

describe("emitPageContent — tagged-PDF structure", () => {
  it("wraps the paragraph glyphs in /Span <</MCID 0>> BDC … EMC", () => {
    const result = emitPageContent(bodyPage(), {
      ...deps(),
      structureBlockIds: new Set(["para", "li"]),
    });
    const s = decode(result.contentBytes);
    // The paragraph run ("AB", glyphs <41>/<42>) sits between BDC mcid 0 and EMC.
    const bdc = s.indexOf("/Span <</MCID 0>> BDC");
    expect(bdc).toBeGreaterThanOrEqual(0);
    const emc = s.indexOf("EMC", bdc);
    expect(emc).toBeGreaterThan(bdc);
    const between = s.slice(bdc, emc);
    expect(between).toContain("<41> Tj");
    expect(between).toContain("<42> Tj");
  });

  it("wraps the list MARKER glyphs in their OWN distinct /Span <</MCID n>> BDC … EMC", () => {
    const result = emitPageContent(bodyPage(), {
      ...deps(),
      structureBlockIds: new Set(["para", "li"]),
    });
    const refs = result.structRefs;
    // Three refs: para (text), li-marker (marker), li (text). Find the marker's mcid.
    const markerRef = refs.find((r) => r.blockId === "li" && r.isMarker);
    expect(markerRef).toBeDefined();
    if (markerRef === undefined) throw new Error("no marker ref");
    const s = decode(result.contentBytes);
    const bdc = s.indexOf(`/Span <</MCID ${markerRef.mcid}>> BDC`);
    expect(bdc).toBeGreaterThanOrEqual(0);
    const emc = s.indexOf("EMC", bdc);
    expect(emc).toBeGreaterThan(bdc);
    // The marker glyph "1." → <31><2e>; pinned inside the marker's own sequence.
    const between = s.slice(bdc, emc);
    expect(between).toContain("Tj");
    // The marker mcid is distinct from the paragraph's mcid 0.
    expect(markerRef.mcid).not.toBe(0);
  });

  it("returns structRefs for paragraph, marker, and list-item content (correct blockId/isMarker)", () => {
    const result = emitPageContent(bodyPage(), {
      ...deps(),
      structureBlockIds: new Set(["para", "li"]),
    });
    const refs = result.structRefs;
    expect(refs).toContainEqual({ blockId: "para", mcid: 0, isMarker: false });
    // The list item contributes a marker ref AND a content ref, both blockId "li".
    expect(refs.some((r) => r.blockId === "li" && r.isMarker === true)).toBe(true);
    expect(refs.some((r) => r.blockId === "li" && r.isMarker === false)).toBe(true);
    // Every mcid is unique.
    const mcids = refs.map((r) => r.mcid);
    expect(new Set(mcids).size).toBe(mcids.length);
  });

  it("byte-golden: with NO structureBlockIds the output has no BDC/EMC and structRefs is empty", () => {
    const tagged = emitPageContent(bodyPage(), {
      ...deps(),
      structureBlockIds: new Set(["para", "li"]),
    });
    const untagged = emitPageContent(bodyPage(), deps());
    const s = decode(untagged.contentBytes);
    expect(s).not.toContain("BDC");
    expect(s).not.toContain("EMC");
    expect(untagged.structRefs).toEqual([]);
    // The untagged stream equals the tagged stream with every marked-content
    // operator line stripped — i.e. tagging only INSERTS BDC/EMC, nothing else.
    const taggedStripped = decode(tagged.contentBytes)
      .split("\n")
      .filter((ln) => !ln.endsWith("BDC") && ln !== "EMC")
      .join("\n");
    expect(taggedStripped).toBe(s);
  });

  it("byte-golden: a header-bearing page with NO structureBlockIds emits no BDC/EMC/Artifact and empty structRefs", () => {
    // Regression for #526 C1: header/footer text must NOT be wrapped in
    // /Artifact when tagging is inactive (untagged production path passes no
    // structureBlockIds). Without the gate this stream contained "/Artifact BDC".
    const untagged = emitPageContent(headerOnlyPage(), deps());
    const s = decode(untagged.contentBytes);
    expect(s).not.toContain("BDC");
    expect(s).not.toContain("EMC");
    expect(s).not.toContain("Artifact");
    expect(untagged.structRefs).toEqual([]);
  });

  it("wraps header-region text in /Artifact … EMC (no MCID) and emits no structRef", () => {
    const result = emitPageContent(headerOnlyPage(), {
      ...deps(),
      structureBlockIds: new Set(["hdr"]),
    });
    const s = decode(result.contentBytes);
    expect(s).toContain("/Artifact BDC");
    expect(s).not.toContain("/MCID");
    expect(result.structRefs).toEqual([]);
  });
});

describe("emitPageContent — change-tracking ¶ and section-break label are artifacts", () => {
  const componentRegistry = createDefaultComponentRegistry();
  const attrRegistry = createDefaultAttrRegistry();
  const base: EditorConfig = { componentRegistry, attrRegistry, containerWidth: 300 };
  const alice: EditorConfig = { ...base, suggestingAuthor: "alice", now: () => 1 };
  const at = (b: string, o: number) => createSpan(createPosition(asBlockId(b), o), createPosition(asBlockId(b), o));
  const state = (): State => {
    const ids = ["p0", "p1", "p2"];
    const s = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p2" }),
        ...["Anna", "Rosa", "Next"].map((t, i) => buildBlock({ id: ids[i] ?? "", type: "paragraph", parentId: "doc", prevSiblingId: ids[i - 1] ?? null, nextSiblingId: ids[i + 1] ?? null, inlineContent: inlineContent([text(t)]) })),
      ],
    });
    // A suggested join p0|p1 (¶ at the end of p0) and a suggested section break before p2
    // (an empty ¶ ending the first section, drawn as the section-break label).
    let e = createEditorStateFromState(s, at("p1", 0), alice);
    e = reduceEditor(e, { type: "DELETE_BACKWARD" }, alice);
    e = reduceEditor(reduceEditor(e, { type: "SET_SELECTION", selection: at("p2", 0) }, alice), { type: "SECTION_BREAK" }, alice);
    return e.state;
  };

  it("wraps the ¶ glyph and the section-break label (double rule + label) in /Artifact; the text spans exclude them", () => {
    const lt = layoutTree(render(state(), componentRegistry, attrRegistry).root, 300, createMockShaper(8, 16), {
      pageInlineSize: 300, pageBlockSize: 400, pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }, pageGap: 0,
    });
    if (lt.type !== "virtual-root") throw new Error("expected a paginated tree");
    const s = decode(emitPageContent(lt.getPage(0), { ...deps(), structureBlockIds: new Set(["p0", "p1", "p2"]) }).contentBytes);
    const sections = s.split("EMC");
    const artifacts = sections.filter((x) => x.includes("/Artifact BDC")).map((x) => x.slice(x.indexOf("/Artifact BDC")));
    const spans = sections.filter((x) => x.includes("/Span")).map((x) => x.slice(x.indexOf("/Span")));
    // ¶ = WinAnsi 0xB6.
    expect(artifacts.some((x) => x.includes("<b6> Tj"))).toBe(true);
    // The label "Section Break" and its double dotted rule (filled rects).
    expect(artifacts.some((x) => x.includes("<53> Tj"))).toBe(true);
    expect(artifacts.some((x) => (x.match(/ re\nf\n/g) ?? []).length > 10)).toBe(true);
    for (const span of spans) {
      expect(span).not.toContain("<b6>");
      expect(span).not.toContain("<53> Tj");
    }
  });

  it("a ¶ hanging into the page margin is clipped by the page box (q … re W n … Q), also under a (pdf-ignored) block transform", () => {
    // A transform on the paragraph makes the page box an OUTER clip of its ¶; pdf paints
    // untransformed, so it applies every clip flat.
    const shifted = createDefaultComponentRegistry();
    const shiftedParagraph: typeof paragraphComponent = {
      ...paragraphComponent,
      render: (view, ctx, inline) => {
        const el = paragraphComponent.render(view, ctx, inline);
        return el.type === "element" ? { ...el, style: { ...el.style, transform: [{ fn: "translateX", tx: 0 }] } } : el;
      },
    };
    shifted.register(shiftedParagraph);
    for (const reg of [componentRegistry, shifted]) {
      // "Anna" fills the 32-wide content box; the ¶ hangs into the 3px margin.
      const lt = layoutTree(render(state(), reg, attrRegistry).root, 38, createMockShaper(8, 16), {
        pageInlineSize: 38, pageBlockSize: 400, pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 3, inlineEnd: 3 }, pageGap: 0,
      });
      if (lt.type !== "virtual-root") throw new Error("expected a paginated tree");
      const s = decode(emitPageContent(lt.getPage(0), deps()).contentBytes);
      const glyph = s.indexOf("<b6> Tj");
      const clip = s.lastIndexOf("q\n", glyph);
      expect(glyph).toBeGreaterThan(0);
      // Clip rect: x = 35px (the content edge), width = 3px (to the page edge), in pt (× 0.75).
      expect(s.slice(clip, glyph)).toMatch(/q\n26\.25 \S+ 2\.25 \S+ re\nW\nn\n/);
      expect(s.indexOf("Q\n", glyph)).toBeGreaterThan(glyph);
    }
  });
});
