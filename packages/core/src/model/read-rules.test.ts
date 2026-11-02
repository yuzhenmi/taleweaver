import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { deriveDocument } from "./derive/derive-document";
import { getBlock, getEmbedContent, getTemplateContent, resolveBlock } from "./document/blocks";
import { listLevelConfig } from "./document/list-levels";
import { markerKey, markerRanges } from "./document/markers";
import { BUILTIN_OBJECT_KINDS, objectKindRegistry } from "./object-kinds";
import { BODIES_KEY, LIST_DEFS_KEY, META_MAP, SCHEMA_VERSION } from "./storage/keys";
import { childMap, flowOf } from "./storage/map-reads";
import {
  newBody,
  newFootnote,
  newHorizontalRule,
  newMarker,
  newObject,
  newParagraphMark,
  newSectionBreak,
  newSubflow,
  newTableOfContents,
} from "./storage/new-items";
import { childrenOf, fixture, idOf, mapAt, textOf } from "./test-helpers/fixture";

const derive = (doc: Y.Doc) => deriveDocument(doc, BUILTIN_OBJECT_KINDS);

describe("schema-4 root", () => {
  it("is created with schemaVersion 4 and reads as one empty paragraph in the final section", () => {
    const f = fixture();
    expect(f.doc.getMap(META_MAP).get("schemaVersion")).toBe(SCHEMA_VERSION);
    const d = derive(f.doc);
    const root = getBlock(d, f.rootId);
    expect(root?.type).toBe("document");
    const sections = childrenOf(d, "block", f.rootId);
    expect(sections.map((s) => s.id)).toEqual([`${f.rootId}/final`]);
    const paras = childrenOf(d, "block", `${f.rootId}/final`);
    expect(paras).toHaveLength(1);
    expect(paras[0]?.id).toBe(idOf(mapAt(f.piece, 0)));
    expect(paras[0]?.inlineContent?.items).toEqual([]);
  });
});

describe("R1 paragraphs", () => {
  it("reads type, attrs, mark attrs and break tags from the ¶'s flat keys; absent = default", () => {
    const f = fixture();
    f.piece.insert(0, "Title");
    f.piece.insertEmbed(5, newParagraphMark({ "p:type": "heading", "p:level": 1, "m:bold": true, "t:ins": "s1" }));
    f.piece.insert(6, "body");
    const d = derive(f.doc);
    const [h, p] = childrenOf(d, "block", `${f.rootId}/final`);
    expect(h).toMatchObject({ type: "heading", attrs: { level: 1 }, markAttrs: { bold: true }, breakSuggestion: { insertionId: "s1" } });
    expect(textOf(h)).toBe("Title");
    expect(p).toMatchObject({ type: "paragraph", attrs: {} });
    expect(p?.markAttrs).toBeUndefined();
    expect(p?.breakSuggestion).toBeUndefined();
    expect(h?.nextSiblingId).toBe(p?.id);
    expect(p?.prevSiblingId).toBe(h?.id);
  });

  it("carries formatting and merges equal runs across pieces", () => {
    const f = fixture();
    f.piece.insert(0, "ab", { bold: true });
    const second = new Y.Text();
    f.flow.insert(0, [second]);
    second.insert(0, "y");
    second.insert(1, "x", { bold: true });
    const d = derive(f.doc);
    const [p] = childrenOf(d, "block", `${f.rootId}/final`);
    expect(p?.inlineContent?.items).toEqual([
      { kind: "text", text: "y", attrs: {} },
      { kind: "text", text: "xab", attrs: { bold: true } },
    ]);
  });

  it("an empty run before a block object is nothing; a TOC is a block between paragraphs", () => {
    const f = fixture();
    f.piece.insertEmbed(0, newTableOfContents({ "a:depth": 3 }));
    const d = derive(f.doc);
    const kids = childrenOf(d, "block", `${f.rootId}/final`);
    expect(kids.map((b) => b.type)).toEqual(["table-of-contents", "paragraph"]);
    expect(kids[0]?.attrs).toEqual({ depth: 3 });
    expect(kids[0]?.inlineContent).toBeNull();
  });
});

describe("R2 debris", () => {
  it("non-empty text ended by a block object reads as a default paragraph `${object}/pre`", () => {
    const f = fixture();
    f.piece.insert(0, "x");
    f.piece.insertEmbed(1, newTableOfContents());
    const toc = idOf(mapAt(f.piece, 1));
    const kids = childrenOf(derive(f.doc), "block", `${f.rootId}/final`);
    expect(kids.map((b) => b.id)).toEqual([`${toc}/pre`, toc, idOf(mapAt(f.piece, 2))]);
    expect(kids[0]).toMatchObject({ type: "paragraph", attrs: {} });
    expect(textOf(kids[0])).toBe("x");
  });

  it("text after the final ¶ reads as `${holder}/end`", () => {
    const f = fixture();
    f.piece.insert(1, "tail");
    const kids = childrenOf(derive(f.doc), "block", `${f.rootId}/final`);
    expect(kids.map((b) => b.id)).toEqual([idOf(mapAt(f.piece, 0)), `${f.rootId}/end`]);
  });
});

describe("R4 / R5 sections and header links", () => {
  it("[S] ends a section with its s:* props; the last section takes DocMap's; links inherit / none / missing", () => {
    const f = fixture();
    const bodies = childMap(f.docMap, BODIES_KEY);
    bodies?.set("hdrA", newBody());
    f.piece.insert(0, "a");
    f.piece.insertEmbed(1, newParagraphMark());
    f.piece.insertEmbed(2, newSectionBreak({ "s:columnCount": 2, "h:header:default": "hdrA" }));
    f.piece.insert(3, "b");
    f.piece.insertEmbed(4, newParagraphMark());
    f.piece.insertEmbed(5, newSectionBreak({ "h:header:default": "missing" }));
    f.docMap.set("h:header:default", "none");
    const d = derive(f.doc);
    const sections = childrenOf(d, "block", f.rootId);
    const s1 = idOf(mapAt(f.piece, 2));
    const s2 = idOf(mapAt(f.piece, 5));
    expect(sections.map((s) => s.id)).toEqual([`${s1}/section`, `${s2}/section`, `${f.rootId}/final`]);
    expect(sections[0]?.attrs).toEqual({ columnCount: 2, headerBlockId: "h/hdrA" });
    expect(sections[1]?.attrs).toEqual({ headerBlockId: "h/hdrA" });
    expect(sections[2]?.attrs).toEqual({});
    expect(childrenOf(d, "block", `${s1}/section`).map(textOf)).toEqual(["a"]);
    expect(childrenOf(d, "block", `${s2}/section`).map(textOf)).toEqual(["b"]);
    expect(getTemplateContent(d, "h/hdrA")?.type).toBe("template-body");
    expect(childrenOf(d, "templateContent", "h/hdrA")).toHaveLength(1);
  });

  it("reads only canonical h: keys; aliases, non-strings and link-named s: keys are ignored", () => {
    const f = fixture();
    const bodies = childMap(f.docMap, BODIES_KEY);
    bodies?.set("A", newBody());
    bodies?.set("B", newBody());
    f.piece.insertEmbed(0, newParagraphMark());
    f.piece.insertEmbed(1, newSectionBreak({ "h:header:first": "A", "h:headerFirst:default": "B", "h:header:default:x": "B", "s:headerBlockId": "B", "h:footer:even": "A" }));
    f.docMap.set("h:header:first", 7);
    const sections = childrenOf(derive(f.doc), "block", f.rootId);
    expect(sections[0]?.attrs).toEqual({ headerFirstBlockId: "h/A", footerEvenBlockId: "h/A" });
    expect(sections[1]?.attrs).toEqual({ headerFirstBlockId: "h/A", footerEvenBlockId: "h/A" });
  });

  it("body ids are namespaced: a body keyed like the root or like a derived id collides with nothing", () => {
    const f = fixture();
    const bodies = childMap(f.docMap, BODIES_KEY);
    bodies?.set(f.rootId, newBody());
    bodies?.set("a", newBody());
    bodies?.set("a/end", newBody());
    const d = derive(f.doc);
    expect(getBlock(d, f.rootId)?.type).toBe("document");
    expect(getTemplateContent(d, `h/${f.rootId}`)?.type).toBe("template-body");
    expect(getTemplateContent(d, "h/a")?.firstChildId).not.toBe(getTemplateContent(d, "h/a%2Fend")?.firstChildId);
    expect([...d.flows.entries()]).toHaveLength(4);
  });

  it("body id escaping is total: a lone surrogate or a % reads without throwing", () => {
    const f = fixture();
    const bodies = childMap(f.docMap, BODIES_KEY);
    bodies?.set("\uD800x", newBody());
    bodies?.set("50%/2", newBody());
    const d = derive(f.doc);
    expect(getTemplateContent(d, "h/\uD800x")?.type).toBe("template-body");
    expect(getTemplateContent(d, "h/50%25%2F2")?.type).toBe("template-body");
  });

  it("a section with no paragraph has no children ([S][S])", () => {
    const f = fixture();
    f.piece.insertEmbed(0, newSectionBreak());
    f.piece.insertEmbed(0, newSectionBreak());
    const d = derive(f.doc);
    const sections = childrenOf(d, "block", f.rootId);
    expect(sections.map((s) => s.firstChildId)).toEqual([null, null, idOf(mapAt(f.piece, 2))]);
  });
});

describe("[S] outside the body flow, debris before [S]", () => {
  it("debris before an [S] is `${S}/pre`", () => {
    const f = fixture();
    f.piece.insert(0, "x");
    f.piece.insertEmbed(1, newSectionBreak());
    const s = idOf(mapAt(f.piece, 1));
    const d = derive(f.doc);
    expect(childrenOf(d, "block", `${s}/section`).map((b) => b.id)).toEqual([`${s}/pre`]);
  });

  it("an [S] in a header body only ends a run", () => {
    const f = fixture();
    const body = newBody();
    childMap(f.docMap, BODIES_KEY)?.set("H", body);
    const piece = flowOf(body)?.get(0);
    if (!(piece instanceof Y.Text)) throw new Error("no piece");
    piece.insert(0, "x");
    piece.insertEmbed(1, newSectionBreak());
    const s = idOf(mapAt(piece, 1));
    const kids = childrenOf(derive(f.doc), "templateContent", "h/H");
    expect(kids.map((b) => b.id)).toEqual([`${s}/pre`, idOf(mapAt(piece, 2))]);
  });
});

describe("R1 type / scalar reads", () => {
  it("a p:type naming a container or block-object type reads as paragraph; non-scalar values are not read", () => {
    const f = fixture();
    for (const t of ["section", "document", "table-of-contents", "footnote-body", "", 3]) {
      mapAt(f.piece, 0).set("p:type", t);
      expect(childrenOf(derive(f.doc), "block", `${f.rootId}/final`)[0]?.type).toBe("paragraph");
    }
    mapAt(f.piece, 0).set("p:indent", new Y.Map());
    mapAt(f.piece, 0).set("p:align", "center");
    mapAt(f.piece, 0).set("p:__proto__", "x");
    const attrs = childrenOf(derive(f.doc), "block", `${f.rootId}/final`)[0]?.attrs ?? {};
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
    expect(Object.keys(attrs).sort()).toEqual(["__proto__", "align"]);
  });
});

describe("R17 empty holder", () => {
  it("a footnote whose body has no flow reads as one empty paragraph", () => {
    const f = fixture();
    const fn = new Y.Map<unknown>();
    fn.set("k", "footnote");
    f.piece.insertEmbed(0, fn);
    const anchor = idOf(mapAt(f.piece, 0));
    const d = derive(f.doc);
    expect(childrenOf(d, "embedContent", `${anchor}/body`).map((b) => b.id)).toEqual([`${anchor}/body/end`]);
  });

  it("a flow with no ¶ and no content reads as one empty paragraph `${holder}/end`", () => {
    const f = fixture();
    f.piece.delete(0, 1);
    const kids = childrenOf(derive(f.doc), "block", `${f.rootId}/final`);
    expect(kids.map((b) => b.id)).toEqual([`${f.rootId}/end`]);
  });
});

describe("inline embeds", () => {
  it("reads image objects by kind; unregistered kinds and invalid required props read as placeholders", () => {
    const f = fixture();
    f.piece.insertEmbed(0, newObject("image", { w: 10, h: 20, wrap: "left", props: { src: "a.png" } }));
    f.piece.insertEmbed(1, newObject("image", { w: 5 }));
    f.piece.insertEmbed(2, newObject("image", { props: { src: "b.png", alt: 9 } }));
    f.piece.insertEmbed(3, newObject("acme:chart", { w: 30, h: 40, props: { data: "x" } }));
    mapAt(f.piece, 0).set("wrap", "behind");
    f.piece.insertEmbed(4, newHorizontalRule());
    const d = derive(f.doc);
    const items = childrenOf(d, "block", `${f.rootId}/final`)[0]?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "embed" ? i.properties : null))).toEqual([
      { kind: "image", placeholder: false, props: { src: "a.png", alt: "" }, width: 10, height: 20 },
      { kind: "image", placeholder: true, props: {}, width: 5 },
      { kind: "image", placeholder: false, props: { src: "b.png", alt: "" } },
      { kind: "acme:chart", placeholder: true, props: { data: "x" }, width: 30, height: 40 },
      {},
    ]);
    expect(items[4]).toMatchObject({ kind: "embed", embedType: "horizontal-line" });
    const reg = objectKindRegistry({ "acme:chart": { required: { data: "string" } } });
    const chart = deriveDocument(f.doc, reg).trees.block.get(childrenOf(d, "block", `${f.rootId}/final`)[0]?.id ?? "")?.inlineContent?.items[3];
    expect(chart?.kind === "embed" ? chart.properties["placeholder"] : null).toBe(false);
  });

  it("invalid markers, unknown kinds and JSON embeds are inert", () => {
    const f = fixture();
    f.piece.insertEmbed(0, newMarker("bookmark", "b1", "start"));
    const bad = new Y.Map<unknown>();
    bad.set("k", "marker");
    bad.set("ns", 3);
    f.piece.insertEmbed(1, bad);
    const unknown = new Y.Map<unknown>();
    unknown.set("k", "hologram");
    f.piece.insertEmbed(2, unknown);
    f.piece.insertEmbed(3, { legacy: true });
    const items = childrenOf(derive(f.doc), "block", `${f.rootId}/final`)[0]?.inlineContent?.items ?? [];
    expect(items).toEqual([{ kind: "embed", embedType: "marker", attrs: {}, properties: { ns: "bookmark", id: "b1", edge: "start" } }]);
  });

  it("footnote bodies live in the embedContents tree under `${anchor}/body`", () => {
    const f = fixture();
    f.piece.insert(0, "x");
    f.piece.insertEmbed(1, newFootnote());
    const anchor = idOf(mapAt(f.piece, 1));
    const d = derive(f.doc);
    const item = childrenOf(d, "block", `${f.rootId}/final`)[0]?.inlineContent?.items[1];
    expect(item).toMatchObject({ embedType: "footnote-anchor", properties: { contentBlockId: `${anchor}/body` } });
    expect(getEmbedContent(d, `${anchor}/body`)?.type).toBe("footnote-body");
    expect(childrenOf(d, "embedContent", `${anchor}/body`)).toHaveLength(1);
    expect(resolveBlock(d, `${anchor}/body`)?.kind).toBe("embedContent");
  });

  it("a sub-flow is read in place", () => {
    const f = fixture();
    f.piece.insert(0, "ad");
    const inner = new Y.Text();
    f.piece.insertEmbed(1, newSubflow(inner));
    inner.insert(0, "bc");
    const kids = childrenOf(derive(f.doc), "block", `${f.rootId}/final`);
    expect(kids.map(textOf)).toEqual(["abcd"]);
  });
});

describe("R11 lists / R12 markers", () => {
  it("R11: a missing def reads the default level; levels clamp to the def and to 8", () => {
    const f = fixture();
    const def = new Y.Map<unknown>();
    def.set("0:style", "disc");
    def.set("1:style", "circle");
    def.set("1:start", "bad");
    childMap(f.docMap, LIST_DEFS_KEY)?.set("L", def);
    const d = derive(f.doc);
    expect(listLevelConfig(d, "nope", 3)).toEqual({ style: "decimal", start: 1, restart: "after-break" });
    expect(listLevelConfig(d, "L", 5)).toEqual({ style: "circle", start: 1, restart: "after-break" });
    expect(listLevelConfig(d, "L", 0).style).toBe("disc");
  });

  it("R11 reads only the exact level-key spelling", () => {
    const f = fixture();
    const def = new Y.Map<unknown>();
    def.set("0:style", "disc");
    def.set("01:style", "square");
    def.set("1e0:style", "square");
    def.set(" 1:style", "square");
    def.set("1:style:junk", "square");
    childMap(f.docMap, LIST_DEFS_KEY)?.set("L", def);
    expect(derive(f.doc).listDefs.get("L")?.levels).toEqual([{ style: "disc", start: 1, restart: "after-break" }]);
  });

  it("R12 across flows: the body flow pairs before a header; a start and an end in different flows are inert", () => {
    const f = fixture();
    const body = newBody();
    childMap(f.docMap, BODIES_KEY)?.set("H", body);
    const hp = flowOf(body)?.get(0);
    if (!(hp instanceof Y.Text)) throw new Error("no piece");
    hp.insertEmbed(0, newMarker("c", "1", "start"));
    hp.insertEmbed(1, newMarker("c", "1", "end"));
    hp.insertEmbed(2, newMarker("c", "2", "start"));
    f.piece.insertEmbed(0, newMarker("c", "1", "start"));
    f.piece.insertEmbed(1, newMarker("c", "1", "end"));
    f.piece.insertEmbed(2, newMarker("c", "2", "end"));
    // a footnote body pairs after the body flow but before the header
    f.piece.insertEmbed(3, newFootnote());
    const fnPiece = flowOf(childMap(mapAt(f.piece, 3), "body") ?? f.docMap)?.get(0);
    if (!(fnPiece instanceof Y.Text)) throw new Error("no footnote piece");
    fnPiece.insertEmbed(0, newMarker("c", "3", "start"));
    fnPiece.insertEmbed(1, newMarker("c", "3", "end"));
    hp.insertEmbed(3, newMarker("c", "3", "start"));
    hp.insertEmbed(4, newMarker("c", "3", "end"));
    const d = derive(f.doc);
    const ranges = markerRanges(d);
    const p = childrenOf(d, "block", `${f.rootId}/final`)[0]?.id;
    expect(ranges.get(markerKey("c", "1"))?.start.blockId).toBe(p);
    expect(ranges.has(markerKey("c", "2"))).toBe(false);
    expect(ranges.get(markerKey("c", "3"))?.start.blockId).toBe(childrenOf(d, "embedContent", `${idOf(mapAt(f.piece, 3))}/body`)[0]?.id);
  });

  it("R12: the first start pairs with the first end after it; the rest are inert", () => {
    const f = fixture();
    f.piece.insertEmbed(0, newMarker("c", "1", "end"));
    f.piece.insertEmbed(1, newMarker("c", "1", "start"));
    f.piece.insert(2, "ab");
    f.piece.insertEmbed(4, newMarker("c", "1", "end"));
    f.piece.insertEmbed(5, newMarker("c", "1", "end"));
    const d = derive(f.doc);
    const p = childrenOf(d, "block", `${f.rootId}/final`)[0]?.id ?? "";
    expect(markerRanges(d).get(markerKey("c", "1"))).toEqual({ ns: "c", id: "1", start: { blockId: p, offset: 1 }, end: { blockId: p, offset: 4 } });
  });
});
