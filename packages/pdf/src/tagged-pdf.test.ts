// packages/pdf/src/tagged-pdf.test.ts
//
// #526 (T5) — end-to-end tagged-PDF (`/StructTreeRoot` + marked content).
//
// Drives a REAL editor document (heading + paragraphs + ordered list + 2×2
// table with a pinned header row + a labeled image + a decorative image + an
// HR + a page header), runs it through the REAL paginated layout (`getPage`),
// maps the core accessibility projection to the pdf structure model
// (`mapAccessibilityTree(buildAccessibilityTree(state))`), emits via `emitPdf`,
// then `parsePdf`s the bytes and asserts the structure graph + BOTH correlation
// directions (page `/StructParents` → ParentTree → StructElem `/MCR` → page).
//
// The document is built with `buildDocumentFromTree` (mints real block ids),
// so the layout boxes' `key`s and the structure tree's `blockId`s share the
// SAME ids — the only way to exercise the real MCID↔StructElem correlation
// end-to-end (a synthetic PageBox fixture cannot).

import { describe, it, expect } from "vitest";
import * as core from "@taleweaver/core";
import { createLayoutDriver, type LayoutConfig } from "@taleweaver/print";
import { emitPdf, type EmitPdfInput } from "./emit-pdf";
import { mapAccessibilityTree, type PdfStructureNode } from "./pdf-structure";
import { parsePdf, type ParsedPdf } from "./pdf-parse";
import { createMockImageProvider } from "./mock-image-provider";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function frozenInline(items: ReadonlyArray<core.TextItem | core.EmbedItem>): core.InlineContent {
  return { items: [...items] };
}
function textItem(content: string): core.TextItem {
  return { kind: "text", text: content, attrs: {} };
}

// ── Real tagged document + emit input ────────────────────────────────────────

const ORDERED_DEF: core.ListDef = { levels: [{ style: "decimal", start: 1, restart: "never" }] };

/**
 * Build the e2e `EmitPdfInput` (and the mapped `structureTree`) from a REAL
 * editor document. Returns the input WITH `structureTree`/`lang` set; the
 * untagged control re-derives the same input minus `structureTree`.
 */
function buildTaggedInput(): {
  taggedInput: EmitPdfInput;
  untaggedInput: EmitPdfInput;
  structureTree: PdfStructureNode;
} {
  const tree: core.ContainerBlockNode = {
    type: "document",
    children: [
      { type: "heading", attrs: { level: 1 }, inlineContent: frozenInline([textItem("Title")]) },
      { type: "paragraph", inlineContent: frozenInline([textItem("Para one.")]) },
      { type: "paragraph", inlineContent: frozenInline([textItem("Para two.")]) },
      { type: "list-item", attrs: { listId: "L1", listLevel: 0 }, inlineContent: frozenInline([textItem("Item")]) },
      { type: "image", attrs: { src: "/cat.png", width: 40, height: 30, alt: "A cat" }, inlineContent: frozenInline([]) },
      { type: "image", attrs: { src: "/deco.png", width: 40, height: 30, alt: "" }, inlineContent: frozenInline([]) },
      { type: "horizontal-line", inlineContent: frozenInline([]) },
      {
        type: "table",
        attrs: { headerRowCount: 1 },
        children: [
          {
            type: "table-row",
            children: [
              { type: "table-cell", children: [{ type: "paragraph", inlineContent: frozenInline([textItem("H0")]) }] },
              { type: "table-cell", children: [{ type: "paragraph", inlineContent: frozenInline([textItem("H1")]) }] },
            ],
          },
          {
            type: "table-row",
            children: [
              { type: "table-cell", children: [{ type: "paragraph", inlineContent: frozenInline([textItem("C0")]) }] },
              { type: "table-cell", children: [{ type: "paragraph", inlineContent: frozenInline([textItem("C1")]) }] },
            ],
          },
        ],
      },
    ],
  };

  const state = core.buildDocumentFromTree(
    tree,
    { L1: ORDERED_DEF },
    core.createTestAllocator("blk"),
  );

  // Geometry-free editor config (Phase 0b: `measurer` moved to the print
  // backend's `LayoutConfig`; the core reducer never sees it).
  const componentRegistry = core.createDefaultComponentRegistry();
  const attrRegistry = core.createDefaultAttrRegistry();
  const pageConfig: core.PageConfig = {
    pageInlineSize: 360,
    pageBlockSize: 800,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
  const containerWidth = 360;
  const config: core.EditorConfig = {
    componentRegistry,
    attrRegistry,
    containerWidth,
    pageConfig,
  };

  // Insert a page header and type into it (a `banner` template body → /Artifact,
  // dropped from the structure tree). Done through the REAL editor so the header
  // materializes into each page's `headerSlot`.
  const selection = core.initialSelectionForState(state);
  let editor = core.createEditorStateFromState(state, selection, config);
  editor = core.reduceEditor(editor, { type: "INSERT_HEADER" }, config);
  editor = core.reduceEditor(editor, { type: "INSERT_TEXT", text: "Header" }, config);

  // Run the print backend's render → cascade → layout pipeline (the geometric
  // half that left core in the dual-mode split) to get the paginated tree.
  const layoutConfig: LayoutConfig = {
    measurer: core.createMockMeasurer(8, 16),
    componentRegistry,
    attrRegistry,
    pageConfig,
  };
  const layoutTree = createLayoutDriver(layoutConfig).rebuild(editor.state, containerWidth, null);
  if (layoutTree.type !== "virtual-root") {
    throw new Error("tagged-pdf test: expected a paginated VirtualLayoutTree");
  }

  const mapped = mapAccessibilityTree(core.buildAccessibilityTree(editor.state));
  if (mapped === null) throw new Error("tagged-pdf test: structureTree mapped to null");

  // A real image provider so the labeled figure draws an XObject (the structRef
  // is emitted regardless, but this keeps the figure path faithful).
  const imageProvider = createMockImageProvider({
    images: { "/cat.png": { w: 4, h: 4 }, "/deco.png": { w: 4, h: 4 } },
  });

  const base: Omit<EmitPdfInput, "structureTree" | "lang"> = {
    pageCount: layoutTree.plan.entries.length,
    getPage: (i) => layoutTree.getPage(i),
    imageProvider,
  };

  return {
    taggedInput: { ...base, structureTree: mapped, lang: "en" },
    untaggedInput: { ...base },
    structureTree: mapped,
  };
}

// ── Parse-back helpers ───────────────────────────────────────────────────────

/** The catalog (`/Root`) dict body. */
function catalogBody(pdf: ParsedPdf): string {
  const rootId = pdf.rootId();
  if (rootId === null) throw new Error("no /Root");
  return pdf.object(rootId) ?? "";
}

/** Follow `/<Key> N 0 R` in `body` to the referenced object's body. */
function followRef(pdf: ParsedPdf, body: string, key: string): { id: number; body: string } {
  const re = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`);
  const m = body.match(re);
  if (m === null) throw new Error(`dict missing /${key} ref`);
  const id = Number(nth(m, 1, `${key} ref`));
  return { id, body: pdf.object(id) ?? "" };
}

/** Every `/S /<Role>` token at the top of a StructElem `body` — the element role. */
function structRole(body: string): string {
  const m = body.match(/\/S\s+\/(\w+)/);
  if (m === null) throw new Error(`StructElem missing /S role: ${body.slice(0, 80)}`);
  return nth(m, 1, "role");
}

/** The list of child StructElem ids referenced by `/K [ … ]` (indirect refs only). */
function kidElemIds(body: string): number[] {
  const m = body.match(/\/K\s+(\[[^\]]*\]|\d+\s+0\s+R)/);
  if (m === null) return [];
  const inner = nth(m, 1, "K");
  return [...inner.matchAll(/(\d+)\s+0\s+R/g)].map((mm) => Number(nth(mm, 1, "kid")));
}

/** Resolve the `/K` of a StructElem into child StructElem bodies (by role), skipping MCR dicts. */
function childElems(pdf: ParsedPdf, body: string): { id: number; body: string; role: string }[] {
  const out: { id: number; body: string; role: string }[] = [];
  for (const id of kidElemIds(body)) {
    const childBody = pdf.object(id);
    if (childBody === null) continue;
    if (!/\/Type\s*\/StructElem/.test(childBody)) continue;
    out.push({ id, body: childBody, role: structRole(childBody) });
  }
  return out;
}

/** Page object body at page index `i` (via /Pages /Kids order). */
function pageObjBodyAt(pdf: ParsedPdf, i: number): { id: number; body: string } {
  const cat = catalogBody(pdf);
  const pages = followRef(pdf, cat, "Pages");
  const kidsM = pages.body.match(/\/Kids\s+\[([^\]]*)\]/);
  if (kidsM === null) throw new Error("pages missing /Kids");
  const ids = [...(kidsM[1] ?? "").matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(nth(m, 1, "kid")));
  const id = nth(ids, i, "page obj id");
  return { id, body: pdf.object(id) ?? "" };
}

/** The decompressed concatenation of one page's content stream. */
function pageContent(pdf: ParsedPdf, pageBody: string): string {
  const m = pageBody.match(/\/Contents\s+(\d+)\s+0\s+R/);
  if (m === null) throw new Error("page missing /Contents");
  const stream = pdf.streamObject(Number(nth(m, 1, "contents")));
  if (stream === null) throw new Error("content stream not found");
  return new TextDecoder("latin1").decode(stream.payload);
}

/** Parse the ParentTree `/Nums [ k <arr 0 R> … ]` → Map<key, elemId[]> (one array per page key). */
function parentTreeNums(pdf: ParsedPdf, parentTreeBody: string): Map<number, number[]> {
  const numsM = parentTreeBody.match(/\/Nums\s+\[([\s\S]*)\]/);
  if (numsM === null) throw new Error("ParentTree missing /Nums");
  const inner = numsM[1] ?? "";
  const out = new Map<number, number[]>();
  // Pairs of: <key:int> <arrObj 0 R>
  const re = /(\d+)\s+(\d+)\s+0\s+R/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(inner)) !== null) {
    const key = Number(nth(mm, 1, "key"));
    const arrId = Number(nth(mm, 2, "arr id"));
    const arrBody = pdf.object(arrId) ?? "";
    const elemIds = [...arrBody.matchAll(/(\d+)\s+0\s+R/g)].map((x) => Number(nth(x, 1, "elem")));
    out.set(key, elemIds);
  }
  return out;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("emitPdf — tagged PDF (#526 T5)", () => {
  it("wires the catalog: /MarkInfo, /StructTreeRoot, /Lang", () => {
    const { taggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(taggedInput));
    const cat = catalogBody(pdf);
    expect(cat).toContain("/MarkInfo << /Marked true >>");
    expect(cat).toMatch(/\/StructTreeRoot\s+\d+\s+0\s+R/);
    expect(cat).toContain("/Lang (en)");
  });

  it("emits a /StructTreeRoot with /K → Document, /ParentTree, /ParentTreeNextKey", () => {
    const { taggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(taggedInput));
    const cat = catalogBody(pdf);
    const root = followRef(pdf, cat, "StructTreeRoot");
    expect(root.body).toContain("/Type /StructTreeRoot");
    expect(root.body).toMatch(/\/ParentTree\s+\d+\s+0\s+R/);
    // /ParentTreeNextKey == page count (1 page here; reserves [pageCount,…) for annots).
    const pageCount = pdf.pageBodies().length;
    expect(root.body).toContain(`/ParentTreeNextKey ${pageCount}`);
    // /K → the Document StructElem.
    const doc = followRef(pdf, root.body, "K");
    expect(structRole(doc.body)).toBe("Document");
    // The Document's /P points back at the StructTreeRoot.
    expect(doc.body).toContain(`/P ${root.id} 0 R`);
  });

  it("mirrors the document shape: Document → H1, P, P, L→LI→{Lbl,LBody}, Table→TR→TH/TD, Figure(/Alt); no banner/HR/decorative", () => {
    const { taggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(taggedInput));
    const root = followRef(pdf, catalogBody(pdf), "StructTreeRoot");
    const doc = followRef(pdf, root.body, "K");
    const top = childElems(pdf, doc.body);
    const roles = top.map((c) => c.role);

    // Order-faithful top-level roles. NO Lbl/LBody/TR/TH/TD here (nested).
    expect(roles).toEqual(["H1", "P", "P", "L", "Figure", "Table"]);

    // No banner StructElem anywhere (header is /Artifact); no separator/HR element.
    const allElems = Array.from({ length: pdf.objectCount }, (_, i) => pdf.object(i + 1) ?? "")
      .filter((b) => /\/Type\s*\/StructElem/.test(b))
      .map(structRole);
    expect(allElems).not.toContain("banner");
    expect(allElems).not.toContain("Sect");
    // Exactly ONE Figure (labeled) — the decorative image emits none.
    expect(allElems.filter((r) => r === "Figure")).toHaveLength(1);

    // The Figure carries non-empty /Alt.
    const figure = top.find((c) => c.role === "Figure");
    if (figure === undefined) throw new Error("no Figure element");
    expect(figure.body).toMatch(/\/Alt\s*\(A cat\)/);

    // L → exactly one LI → [Lbl, LBody].
    const list = top.find((c) => c.role === "L");
    if (list === undefined) throw new Error("no L element");
    const listItems = childElems(pdf, list.body);
    expect(listItems.map((c) => c.role)).toEqual(["LI"]);
    const liKids = childElems(pdf, nth(listItems, 0, "LI").body);
    expect(liKids.map((c) => c.role)).toEqual(["Lbl", "LBody"]);

    // Table → 2 TR; row 0 cells are TH (pinned header), row 1 cells are TD.
    const table = top.find((c) => c.role === "Table");
    if (table === undefined) throw new Error("no Table element");
    const rows = childElems(pdf, table.body);
    expect(rows.map((c) => c.role)).toEqual(["TR", "TR"]);
    expect(childElems(pdf, nth(rows, 0, "row0").body).map((c) => c.role)).toEqual(["TH", "TH"]);
    expect(childElems(pdf, nth(rows, 1, "row1").body).map((c) => c.role)).toEqual(["TD", "TD"]);
  });

  it("correlates BOTH directions: page /StructParents → ParentTree[mcid] → StructElem whose /MCR points back at (page, mcid)", () => {
    const { taggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(taggedInput));
    const root = followRef(pdf, catalogBody(pdf), "StructTreeRoot");
    const parentTree = followRef(pdf, root.body, "ParentTree");
    const nums = parentTreeNums(pdf, parentTree.body);

    const page0 = pageObjBodyAt(pdf, 0);
    // The page carries /StructParents == its ParentTree key.
    const spM = page0.body.match(/\/StructParents\s+(\d+)/);
    expect(spM).not.toBeNull();
    const key = Number(nth(spM ?? [], 1, "StructParents"));
    const elemByMcid = nums.get(key);
    if (elemByMcid === undefined) throw new Error(`ParentTree has no entry for key ${key}`);
    expect(elemByMcid.length).toBeGreaterThan(0);

    // For mcid 0 (the heading), the resolved StructElem's /K must contain an /MCR
    // back-referencing /Pg page0 + /MCID 0 (the round-trip).
    const elem0 = nth(elemByMcid, 0, "elem for mcid 0");
    const elem0Body = pdf.object(elem0) ?? "";
    const mcrRe = new RegExp(`/Type\\s*/MCR[\\s\\S]*?/Pg\\s+${page0.id}\\s+0\\s+R[\\s\\S]*?/MCID\\s+0`);
    const altRe = new RegExp(`/MCID\\s+0[\\s\\S]*?/Pg\\s+${page0.id}\\s+0\\s+R`);
    expect(mcrRe.test(elem0Body) || altRe.test(elem0Body)).toBe(true);
  });

  it("wraps the numbered-list MARKER in /Span <</MCID n>> whose mcid maps (via ParentTree) to the Lbl StructElem", () => {
    const { taggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(taggedInput));
    const root = followRef(pdf, catalogBody(pdf), "StructTreeRoot");
    const parentTree = followRef(pdf, root.body, "ParentTree");
    const nums = parentTreeNums(pdf, parentTree.body);

    // Find the Lbl element id.
    const doc = followRef(pdf, root.body, "K");
    const list = childElems(pdf, doc.body).find((c) => c.role === "L");
    if (list === undefined) throw new Error("no L");
    const li = nth(childElems(pdf, list.body), 0, "LI");
    const lbl = childElems(pdf, li.body).find((c) => c.role === "Lbl");
    if (lbl === undefined) throw new Error("no Lbl");

    // The Lbl's /MCR gives the (page, mcid); that mcid in the ParentTree resolves back to Lbl.
    const mcrM = lbl.body.match(/\/MCID\s+(\d+)/);
    expect(mcrM).not.toBeNull();
    const markerMcid = Number(nth(mcrM ?? [], 1, "marker mcid"));
    const page0 = pageObjBodyAt(pdf, 0);
    const key = Number(nth(page0.body.match(/\/StructParents\s+(\d+)/) ?? [], 1, "key"));
    const elems = nums.get(key) ?? [];
    expect(nth(elems, markerMcid, "lbl by mcid")).toBe(lbl.id);

    // The content stream wraps the marker glyphs in /Span <</MCID markerMcid>> BDC … EMC.
    const content = pageContent(pdf, page0.body);
    const bdc = content.indexOf(`/Span <</MCID ${markerMcid}>> BDC`);
    expect(bdc).toBeGreaterThanOrEqual(0);
    const emc = content.indexOf("EMC", bdc);
    expect(emc).toBeGreaterThan(bdc);
    // The marker glyph "1." appears inside that sequence.
    expect(content.slice(bdc, emc)).toContain("Tj");
  });

  it("emits the header text inside /Artifact … EMC (excluded from the structure tree)", () => {
    const { taggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(taggedInput));
    const page0 = pageObjBodyAt(pdf, 0);
    const content = pageContent(pdf, page0.body);
    expect(content).toContain("/Artifact BDC");
    // Walk every `/Artifact BDC … EMC` sequence; the header is the GLYPH-bearing
    // artifact (the decorative image is also an artifact, but contains a Do, not
    // a Tj). The header's first glyph "H" → <48>.
    let foundGlyphArtifact = false;
    let from = content.indexOf("/Artifact BDC");
    while (from >= 0) {
      const emc = content.indexOf("EMC", from);
      if (emc < 0) break;
      const slice = content.slice(from, emc);
      if (slice.includes("Tj") && slice.includes("<48>")) foundGlyphArtifact = true;
      // The header artifact must carry NO /MCID (it is not tagged structure).
      if (slice.includes("Tj")) expect(slice).not.toContain("/MCID");
      from = content.indexOf("/Artifact BDC", emc);
    }
    expect(foundGlyphArtifact).toBe(true);
  });

  it("control: emitting the SAME input WITHOUT structureTree is untagged (no /StructTreeRoot, /MarkInfo, BDC)", () => {
    const { untaggedInput } = buildTaggedInput();
    const pdf = parsePdf(emitPdf(untaggedInput));
    const cat = catalogBody(pdf);
    expect(cat).not.toContain("/StructTreeRoot");
    expect(cat).not.toContain("/MarkInfo");
    expect(cat).not.toContain("/Lang");
    // No page carries /StructParents, and no content stream carries BDC.
    for (const body of pdf.pageBodies()) {
      expect(body).not.toContain("/StructParents");
      expect(pageContent(pdf, body)).not.toContain("BDC");
    }
  });
});
