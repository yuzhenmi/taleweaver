import { describe, it, expect } from "vitest";
import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { BlockBox, LayoutBox } from "@taleweaver/print";
import { INITIAL_COMPUTED_STYLE, asBlockId } from "@taleweaver/core";
import {
  computeUsedStyle,
  createBlockBox,
  createLineBox,
  createMarkerBox,
  createTextRunBox,
  createPageBox,
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
