import type { PageBox, PdfOutlineNode } from "@taleweaver/print";
import { PdfWriter, pdfString, pdfTextString } from "./pdf-writer";
import { emitPageContent } from "./page-emitter";
import { createStandard14FontProvider, type PdfFontProvider, type PdfFontHandle } from "./font-provider";
import type { PdfImageProvider, PdfImageHandle } from "./image-provider";
import { mediaBoxOf, pointYUp } from "./coordinate";
import type { PdfStructureNode } from "./pdf-structure";

export interface EmitPdfInput {
  readonly pageCount: number;
  readonly getPage: (i: number) => PageBox;
  /** Defaults to the standard-14 provider. */
  readonly fontProvider?: PdfFontProvider;
  /** Resolves layout image `src`s to embeddable Image XObjects. Absent ⇒ every
   *  image draws a grey placeholder and NO /XObject resource dict is emitted. */
  readonly imageProvider?: PdfImageProvider;
  /** Resolves a cross-reference / TOC target block id to its destination, for
   *  internal /GoTo links. Built controller-side via
   *  `makeInternalDestinationResolver` (core). Absent ⇒ internal-link annots are
   *  skipped (e.g. tests with no internal links, or a caller that opts out).
   *  Returns `null` for a broken / unresolvable target ⇒ no annot. */
  readonly resolveInternalDestination?: (targetId: string) => { readonly pageIndex: number; readonly yTopPx: number; readonly xLeftPx: number } | null;
  /** The document outline (heading bookmark tree) → a catalog-level `/Outlines`.
   *  Built controller-side via core's `buildPdfOutline`. Absent or empty ⇒ NO
   *  `/Outlines` (the catalog stays byte-identical). */
  readonly outline?: readonly PdfOutlineNode[];
  /** The document's tagged-structure tree (PDF standard structure elements),
   *  mapped controller-side from core's accessibility projection via
   *  `mapAccessibilityTree`. Drives the `/StructTreeRoot` + marked content.
   *  Absent ⇒ NO structure tree is emitted (the document stays untagged). The
   *  emitter consumer is added in a later slice; this field is the contract. */
  readonly structureTree?: PdfStructureNode;
  /** The document's natural language (a BCP-47 tag, e.g. `"en-US"`) → the
   *  catalog `/Lang`. Absent ⇒ no `/Lang` is emitted. */
  readonly lang?: string;
}

/**
 * Emit a multi-page PDF (standard-14 fonts): text + page geometry (phase a) and
 * box graphics — backgrounds, borders, rules, decorations, tab leaders (phase b).
 * Streams page content via `getPage(i)`; writes the page tree, per-page page
 * objects, a shared font resource dict, and the catalog.
 */
export function emitPdf(input: EmitPdfInput): Uint8Array {
  const provider = input.fontProvider ?? createStandard14FontProvider();
  const writer = new PdfWriter();

  const perPage: {
    content: Uint8Array;
    width: number;
    height: number;
    linkRects: readonly { readonly url: string; readonly rect: readonly [number, number, number, number] }[];
    internalLinkRects: readonly { readonly targetId: string; readonly rect: readonly [number, number, number, number] }[];
  }[] = [];
  // Handles that actually emit glyphs, deduped by `fontKey`, in first-encountered
  // document order. Drives both the written font objects and the resource dict.
  const usedHandleByKey = new Map<string, PdfFontHandle>();
  // Image handles actually placed, deduped by `imageKey`, in first-encountered
  // document order. Drives both the written Image XObjects and the resource dict.
  const usedImageByKey = new Map<string, PdfImageHandle>();

  // Assign one stable `/Fn` resource name per `fontKey` in encounter order.
  const fontNameByKey = new Map<string, string>();
  const fontResourceName = (fontKey: string): string => {
    const existing = fontNameByKey.get(fontKey);
    if (existing !== undefined) return existing;
    const name = `/F${fontNameByKey.size}`;
    fontNameByKey.set(fontKey, name);
    return name;
  };

  // Assign one stable `/Imn` resource name per `imageKey` in encounter order.
  const imageNameByKey = new Map<string, string>();
  const imageResourceName = (imageKey: string): string => {
    const existing = imageNameByKey.get(imageKey);
    if (existing !== undefined) return existing;
    const name = `/Im${imageNameByKey.size}`;
    imageNameByKey.set(imageKey, name);
    return name;
  };

  // #526 tagged PDF — when a structure tree is supplied, derive the set of every
  // block id it carries (DFS). Passing this into the page-emitter's `deps`
  // activates T3's marked-content tagging; absent ⇒ NO tagging at all (the
  // content streams + page/catalog dicts stay byte-identical to the untagged
  // baseline). Each page's returned `structRefs` are captured alongside the
  // page object ids to drive the `/StructTreeRoot` ParentTree + StructElems.
  const structureTree = input.structureTree;
  const structureBlockIds =
    structureTree !== undefined ? collectStructureBlockIds(structureTree) : undefined;
  const perPageStructRefs: StructRef[][] = [];

  for (let i = 0; i < input.pageCount; i++) {
    const page = input.getPage(i);
    const { contentBytes, usedHandles, usedImages, linkRects, internalLinkRects, structRefs } = emitPageContent(page, {
      provider,
      fontResourceName,
      imageProvider: input.imageProvider,
      imageResourceName,
      ...(structureBlockIds !== undefined ? { structureBlockIds } : {}),
    });
    for (const h of usedHandles) {
      const k = h.fontKey;
      if (!usedHandleByKey.has(k)) usedHandleByKey.set(k, h);
    }
    for (const im of usedImages) {
      if (!usedImageByKey.has(im.imageKey)) usedImageByKey.set(im.imageKey, im);
    }
    perPage.push({ content: contentBytes, width: page.width, height: page.height, linkRects, internalLinkRects });
    perPageStructRefs.push([...structRefs]);
  }

  // The provider writes its own font objects (simple Type1 here; composite for
  // the embedded path) and returns the handle→objId map. Allocated BEFORE the
  // page tree / content / page objects, so font object ids come first.
  const usedHandles = [...usedHandleByKey.values()];
  const objIdByHandle = provider.writeFontObjects(usedHandles, writer);

  // Image XObjects are written alongside the font objects (before the page tree),
  // so their object ids precede `pagesId`. Skipped entirely when no provider is
  // configured or no image was placed — leaving the resource dict image-free.
  const usedImages = [...usedImageByKey.values()];
  const objIdByImage =
    input.imageProvider !== undefined && usedImages.length > 0
      ? input.imageProvider.writeImageObjects(usedImages, writer)
      : new Map<PdfImageHandle, number>();

  const fontDictEntries = usedHandles
    .map((h) => {
      const name = fontResourceName(h.fontKey);
      const id = objIdByHandle.get(h);
      if (id === undefined) throw new Error(`pdf: font object missing for ${h.fontKey}`);
      return `${name} ${id} 0 R`;
    })
    .join(" ");
  // The /XObject sub-dict is appended ONLY when at least one image was placed, so
  // an image-free document's resource dict stays byte-identical to the font-only
  // form (`<< /Font << … >> >>`) — the byte-golden regression gate.
  const imageDictEntries =
    usedImages.length > 0
      ? ` /XObject << ${usedImages
          .map((im) => {
            const id = objIdByImage.get(im);
            if (id === undefined) throw new Error(`pdf: image object missing for ${im.imageKey}`);
            return `${imageResourceName(im.imageKey)} ${id} 0 R`;
          })
          .join(" ")} >>`
      : "";
  const resourcesBody = `<< /Font << ${fontDictEntries} >>${imageDictEntries} >>`;

  const pagesId = writer.allocate();

  // Pre-allocate every page object id BEFORE writing any page, so a page-1
  // internal /GoTo annot can forward-reference a later page's object id (PDF
  // indirect refs are legal forward refs; `finish` only requires every allocated
  // id be written). NOTE: this reorders object ids vs the pre-#522 interleaving →
  // the std-14 byte-golden fixture regenerates (design M3); the
  // /Annots-omitted-when-link-free invariant still holds.
  const pageObjIds: number[] = perPage.map(() => writer.allocate());

  for (let i = 0; i < perPage.length; i++) {
    const p = perPage[i];
    if (p === undefined) throw new Error(`emit-pdf: perPage[${i}] unexpectedly undefined`);
    const contentId = writer.allocate();
    writer.writeStream(contentId, "<< >>", p.content);
    // One /Link annotation object per collected rect (allocated per page). The
    // /Annots key is appended ONLY when this page has >=1 link, so a link-free
    // page's /Page dict stays byte-identical to before (the byte-golden gate),
    // mirroring the /XObject-only-when-images pattern above.
    const annotIds: number[] = [];
    for (const lr of p.linkRects) {
      // The /URI is emitted as a PDF Latin-1 literal string; a URL with a code
      // point > 0xFF cannot be encoded (non-ASCII/IDN hosts are out of scope —
      // the design's "ASCII / percent-encoded input only" contract). Skip it
      // gracefully (text still renders, link just isn't clickable) rather than
      // crashing in encodeLatin1.
      const isLatin1Encodable = [...lr.url].every((ch) => {
        const cp = ch.codePointAt(0);
        return cp !== undefined && cp <= 0xff;
      });
      if (!isLatin1Encodable) continue;
      const [llx, lly, urx, ury] = lr.rect;
      const annotId = writer.allocate();
      writer.writeObject(
        annotId,
        `<< /Type /Annot /Subtype /Link /Rect [${llx} ${lly} ${urx} ${ury}] ` +
          `/Border [0 0 0] ` +
          `/A << /Type /Action /S /URI /URI ${pdfString(lr.url)} >> >>`,
      );
      annotIds.push(annotId);
    }
    // Internal /GoTo /Link annots — resolved via the injected closure to a
    // concrete (pageIndex, top-left) destination, then emitted as a /GoTo action
    // referencing the TARGET page's PRE-ALLOCATED object id (a legal forward
    // ref). Merged into the SAME annotIds → the same /Annots array as the /URI
    // annots above. Skipped entirely when no resolver is injected.
    const resolveDest = input.resolveInternalDestination;
    if (resolveDest !== undefined) {
      for (const ilr of p.internalLinkRects) {
        const dest = resolveDest(ilr.targetId);
        if (dest === null) continue; // broken ref → no annot (graceful)
        const targetPage = perPage[dest.pageIndex];
        const targetPageId = pageObjIds[dest.pageIndex];
        if (targetPage === undefined || targetPageId === undefined) continue; // defensive: out-of-range dest
        const [leftPt, topPt] = pointYUp(dest.xLeftPx, dest.yTopPx, targetPage.height);
        const [llx, lly, urx, ury] = ilr.rect;
        const annotId = writer.allocate();
        writer.writeObject(
          annotId,
          `<< /Type /Annot /Subtype /Link /Rect [${llx} ${lly} ${urx} ${ury}] ` +
            `/Border [0 0 0] ` +
            `/A << /Type /Action /S /GoTo /D [${targetPageId} 0 R /XYZ ${leftPt} ${topPt} 0] >> >>`,
        );
        annotIds.push(annotId);
      }
    }
    const annotsBody = annotIds.length > 0 ? ` /Annots [${annotIds.map((id) => `${id} 0 R`).join(" ")}]` : "";
    const pageId = pageObjIds[i];
    if (pageId === undefined) throw new Error(`emit-pdf: pageObjIds[${i}] unexpectedly undefined`);
    const [x0, y0, x1, y1] = mediaBoxOf(p.width, p.height);
    // #526 tagged PDF — page `i` is ParentTree key `i`. The `/StructParents`
    // entry is appended ONLY when tagging is active (structureBlockIds defined),
    // keeping the untagged /Page dict byte-identical.
    const structParentsBody = structureBlockIds !== undefined ? ` /StructParents ${i}` : "";
    writer.writeObject(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R ` +
        `/MediaBox [${x0} ${y0} ${x1} ${y1}] ` +
        `/Resources ${resourcesBody} ` +
        `/Contents ${contentId} 0 R${annotsBody}${structParentsBody} >>`,
    );
  }

  const kids = pageObjIds.map((id) => `${id} 0 R`).join(" ");
  writer.writeObject(
    pagesId,
    `<< /Type /Pages /Count ${pageObjIds.length} /Kids [${kids}] >>`,
  );

  // Outline (bookmark) tree → catalog-level /Outlines. Two-pass: allocate every
  // outline-item object id (DFS pre-order) BEFORE writing any, so sibling/child
  // forward-refs are valid (like the pageObjIds pre-allocation). Omit entirely
  // when there is no outline (catalog stays byte-identical).
  let outlinesRef = "";
  const outline = input.outline;
  if (outline !== undefined && outline.length > 0) {
    interface OItem {
      readonly id: number;
      readonly node: PdfOutlineNode;
      readonly parentId: number;
      readonly prevId: number | null;
      readonly nextId: number | null;
      readonly firstChildId: number | null;
      readonly lastChildId: number | null;
      readonly count: number;
    }
    const descendantCount = (n: PdfOutlineNode): number =>
      n.children.reduce((s, c) => s + 1 + descendantCount(c), 0);
    const outlineRootId = writer.allocate();
    const items: OItem[] = [];
    const build = (
      nodes: readonly PdfOutlineNode[],
      parentId: number,
    ): { firstId: number | null; lastId: number | null } => {
      const ids = nodes.map(() => writer.allocate());
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const id = ids[i];
        if (node === undefined || id === undefined) throw new Error(`pdf: outline node ${i} missing (unreachable)`);
        const childLinks = build(node.children, id);
        items.push({
          id, node, parentId,
          prevId: i > 0 ? (ids[i - 1] ?? null) : null,
          nextId: i < nodes.length - 1 ? (ids[i + 1] ?? null) : null,
          firstChildId: childLinks.firstId,
          lastChildId: childLinks.lastId,
          count: descendantCount(node),
        });
      }
      const first = ids.length > 0 ? (ids[0] ?? null) : null;
      const last = ids.length > 0 ? (ids[ids.length - 1] ?? null) : null;
      return { firstId: first, lastId: last };
    };
    const rootLinks = build(outline, outlineRootId);

    for (const it of items) {
      const parts: string[] = [`/Title ${pdfTextString(it.node.title)}`, `/Parent ${it.parentId} 0 R`];
      if (it.prevId !== null) parts.push(`/Prev ${it.prevId} 0 R`);
      if (it.nextId !== null) parts.push(`/Next ${it.nextId} 0 R`);
      if (it.firstChildId !== null) parts.push(`/First ${it.firstChildId} 0 R`);
      if (it.lastChildId !== null) parts.push(`/Last ${it.lastChildId} 0 R`);
      if (it.count > 0) parts.push(`/Count ${it.count}`);
      const dest = it.node.dest;
      if (dest !== null) {
        const targetPage = perPage[dest.pageIndex];
        const targetPageId = pageObjIds[dest.pageIndex];
        if (targetPage !== undefined && targetPageId !== undefined) {
          const [leftPt, topPt] = pointYUp(dest.xLeftPx, dest.yTopPx, targetPage.height);
          parts.push(`/Dest [${targetPageId} 0 R /XYZ ${leftPt} ${topPt} 0]`);
        }
      }
      writer.writeObject(it.id, `<< ${parts.join(" ")} >>`);
    }

    if (rootLinks.firstId === null || rootLinks.lastId === null) {
      throw new Error("pdf: non-empty outline has no first/last item (unreachable)");
    }
    writer.writeObject(
      outlineRootId,
      `<< /Type /Outlines /First ${rootLinks.firstId} 0 R /Last ${rootLinks.lastId} 0 R /Count ${items.length} >>`,
    );
    outlinesRef = ` /Outlines ${outlineRootId} 0 R`;
  }

  // #526 tagged PDF — the `/StructTreeRoot` object graph + per-page ParentTree.
  // Built only when a structure tree was supplied (the gate `structureBlockIds`
  // mirrors); absent ⇒ the catalog stays byte-identical (no /StructTreeRoot, no
  // /MarkInfo, no /Lang). Mirrors the `/Outlines` two-pass pattern: pre-allocate
  // every object id (so forward-refs are valid), then write each object.
  let structRootRef = "";
  if (structureTree !== undefined && structureBlockIds !== undefined) {
    structRootRef = emitStructTree(
      writer,
      structureTree,
      perPageStructRefs,
      pageObjIds,
      perPage.length,
    );
  }

  const catalogId = writer.allocate();
  // Append the structure-tree + marked-content catalog keys ONLY when tagging is
  // active. `/Lang` is emitted only for a non-empty BCP-47 tag.
  const langBody =
    structureTree !== undefined && input.lang !== undefined && input.lang !== ""
      ? ` /Lang ${pdfString(input.lang)}`
      : "";
  writer.writeObject(
    catalogId,
    `<< /Type /Catalog /Pages ${pagesId} 0 R${outlinesRef}${structRootRef}${langBody} >>`,
  );

  return writer.finish(catalogId);
}

// ── #526 tagged-PDF: structure-tree emit ─────────────────────────────────────

/** One marked-content correlation returned by the page-emitter (a structure-leaf
 *  block id, the MCID it was wrapped with, and whether it is a list/footnote
 *  MARKER → routed to the element's `Lbl`). Restated locally as the element type
 *  of `PageEmitResult.structRefs` (the source interface is page-emitter-internal). */
interface StructRef {
  readonly blockId: string;
  readonly mcid: number;
  readonly isMarker: boolean;
}

/**
 * DFS-collect the LEAF `blockId`s in a structure tree — the blocks whose painted
 * content carries an MCID. A leaf is a node with no structure children
 * (paragraph/heading/list-item/figure); CONTAINER nodes (document/list/table/
 * row/cell) are excluded because their text lives in descendant leaf blocks, and
 * including a container would mis-tag a non-leaf sibling that inherits the
 * container's owner block id down the box tree (e.g. a decorative image directly
 * under the document would otherwise be tagged as the Document's content rather
 * than an /Artifact). The page-emitter consults this set to decide which body
 * content gets an MCID.
 */
function collectStructureBlockIds(node: PdfStructureNode): Set<string> {
  const out = new Set<string>();
  const visit = (n: PdfStructureNode): void => {
    if (n.blockId !== null && n.children.length === 0) out.add(n.blockId);
    for (const c of n.children) visit(c);
  };
  visit(node);
  return out;
}

/** The per-element MCID correlation gathered for one StructElem: the (pageIndex,
 *  mcid) pairs whose marked content this element owns. */
interface ElemMcrs {
  /** (pageIndex, mcid) pairs this element's `/K` lists as `/MCR` dicts. */
  readonly mcrs: { pageIndex: number; mcid: number }[];
}

/**
 * Emit the `/StructTreeRoot` object graph + the ParentTree number tree and
 * return the catalog ref fragment (` /StructTreeRoot N 0 R`).
 *
 * Walk the structure tree DFS, allocating one StructElem id per node. A
 * `listitem` (role `"LI"`) ALSO gets a child `Lbl` + `LBody` so the numbered
 * marker's MCIDs attach to the `Lbl` and the item's content MCIDs to the
 * `LBody`. A `blockId → owning StructElem id` resolver routes each page's
 * `structRefs` to the element that owns its MCID (a list-item routes by
 * `isMarker`: true → its `Lbl`, false → its `LBody`).
 */
function emitStructTree(
  writer: PdfWriter,
  tree: PdfStructureNode,
  perPageStructRefs: readonly (readonly StructRef[])[],
  pageObjIds: readonly number[],
  pageCount: number,
): string {
  // Pre-allocate the root + ParentTree ids first (so they precede the elements).
  const structRootId = writer.allocate();
  const parentTreeId = writer.allocate();

  // One record per emitted StructElem (the StructTreeRoot's Document is the top).
  interface ElemRec {
    id: number;
    role: PdfStructureNode["role"];
    parentId: number;
    alt: string | undefined;
    /** Child StructElem ids (containers). Leaves have none. */
    childIds: number[];
    /** Marked-content refs (leaves: glyphs/marker/image). Containers have none. */
    mcrs: ElemMcrs["mcrs"];
  }
  const elems: ElemRec[] = [];

  // For a normal tagged leaf: blockId → its own StructElem id.
  const ownerByBlockId = new Map<string, number>();
  // For a list-item block: blockId → { lbl, lbody } element ids.
  const listOwnerByBlockId = new Map<string, { lbl: number; lbody: number }>();

  // DFS-allocate ids and build the element records (forward-refs resolved on
  // write, mirroring the /Outlines two-pass). Returns the allocated element id.
  const build = (node: PdfStructureNode, parentId: number): number => {
    const id = writer.allocate();

    if (node.role === "LI") {
      // A list item: allocate its Lbl + LBody leaf elements. The LI is a
      // CONTAINER whose /K = [Lbl, LBody]; the marker MCIDs route to Lbl, the
      // content MCIDs to LBody.
      const lblId = writer.allocate();
      const lbodyId = writer.allocate();
      elems.push({ id, role: "LI", parentId, alt: undefined, childIds: [lblId, lbodyId], mcrs: [] });
      elems.push({ id: lblId, role: "Lbl", parentId: id, alt: undefined, childIds: [], mcrs: [] });
      elems.push({ id: lbodyId, role: "LBody", parentId: id, alt: undefined, childIds: [], mcrs: [] });
      if (node.blockId !== null) {
        listOwnerByBlockId.set(node.blockId, { lbl: lblId, lbody: lbodyId });
      }
      // A list item carries no further structure children in this model.
      return id;
    }

    const childIds: number[] = [];
    for (const child of node.children) {
      childIds.push(build(child, id));
    }
    elems.push({
      id,
      role: node.role,
      parentId,
      alt: node.role === "Figure" ? node.alt ?? "" : undefined,
      childIds,
      mcrs: [],
    });
    // A leaf (no structure children) can own MCIDs by its block id.
    if (node.blockId !== null && childIds.length === 0) {
      ownerByBlockId.set(node.blockId, id);
    }
    return id;
  };

  const documentId = build(tree, structRootId);

  // ParentTree: one array per page, indexed by MCID, of owning StructElem ids.
  // Each `parentTreeByPage[i][mcid]` is the element id that owns that mcid.
  const parentTreeByPage: number[][] = perPageStructRefs.map(() => []);

  const resolveOwner = (ref: StructRef): number => {
    const listOwner = listOwnerByBlockId.get(ref.blockId);
    if (listOwner !== undefined) return ref.isMarker ? listOwner.lbl : listOwner.lbody;
    const owner = ownerByBlockId.get(ref.blockId);
    if (owner === undefined) {
      // A structRef whose block id maps to no StructElem is a contract breach
      // (the structureBlockIds set is derived from this same tree). Fail loud,
      // mirroring the existing `unreachable` throws — never silently drop an MCID.
      throw new Error(
        `emit-pdf: tagged structRef for block "${ref.blockId}" maps to no StructElem (unreachable)`,
      );
    }
    return owner;
  };

  const elemById = new Map<number, ElemRec>(elems.map((e) => [e.id, e]));

  for (let pageIndex = 0; pageIndex < perPageStructRefs.length; pageIndex++) {
    const refs = perPageStructRefs[pageIndex];
    if (refs === undefined) throw new Error(`emit-pdf: perPageStructRefs[${pageIndex}] undefined`);
    const arr = parentTreeByPage[pageIndex];
    if (arr === undefined) throw new Error(`emit-pdf: parentTreeByPage[${pageIndex}] undefined`);
    for (const ref of refs) {
      const ownerId = resolveOwner(ref);
      const ownerElem = elemById.get(ownerId);
      if (ownerElem === undefined) {
        throw new Error(`emit-pdf: owner element ${ownerId} missing (unreachable)`);
      }
      ownerElem.mcrs.push({ pageIndex, mcid: ref.mcid });
      arr[ref.mcid] = ownerId;
    }
  }

  // Write each StructElem object. A leaf's /K lists its /MCR dicts; a container's
  // /K lists child StructElem refs. The Document's /P is the StructTreeRoot.
  const pageRef = (pageIndex: number): number => {
    const id = pageObjIds[pageIndex];
    if (id === undefined) throw new Error(`emit-pdf: pageObjIds[${pageIndex}] missing for MCR (unreachable)`);
    return id;
  };

  for (const elem of elems) {
    const parts: string[] = [
      `/Type /StructElem`,
      `/S /${elem.role}`,
      `/P ${elem.parentId} 0 R`,
    ];
    if (elem.role === "Figure") {
      parts.push(`/Alt ${pdfTextString(elem.alt ?? "")}`);
    }
    // /K — child StructElem refs (container) OR /MCR dicts (leaf). A leaf never
    // has both; a container has childIds; an element with neither omits /K.
    if (elem.childIds.length > 0) {
      parts.push(`/K [${elem.childIds.map((id) => `${id} 0 R`).join(" ")}]`);
    } else if (elem.mcrs.length > 0) {
      const mcrDicts = elem.mcrs
        .map((m) => `<< /Type /MCR /Pg ${pageRef(m.pageIndex)} 0 R /MCID ${m.mcid} >>`)
        .join(" ");
      parts.push(`/K [${mcrDicts}]`);
    }
    writer.writeObject(elem.id, `<< ${parts.join(" ")} >>`);
  }

  // Write the ParentTree number tree: /Nums [ key <arr 0 R> … ]. Each per-page
  // array is its own object, indexed by MCID, of owning element refs.
  const numsParts: string[] = [];
  for (let pageIndex = 0; pageIndex < parentTreeByPage.length; pageIndex++) {
    const arr = parentTreeByPage[pageIndex];
    if (arr === undefined) throw new Error(`emit-pdf: parentTreeByPage[${pageIndex}] undefined on write`);
    const arrId = writer.allocate();
    const arrBody = arr
      .map((elemId, mcid) => {
        if (elemId === undefined) {
          // A hole in the MCID sequence = an mcid with no owner = a bug (every
          // emitted MCID is recorded in a structRef).
          throw new Error(`emit-pdf: ParentTree page ${pageIndex} has no owner for mcid ${mcid} (unreachable)`);
        }
        return `${elemId} 0 R`;
      })
      .join(" ");
    writer.writeObject(arrId, `[${arrBody}]`);
    numsParts.push(`${pageIndex} ${arrId} 0 R`);
  }
  writer.writeObject(parentTreeId, `<< /Nums [${numsParts.join(" ")}] >>`);

  // The StructTreeRoot. /ParentTreeNextKey = pageCount (page keys are [0,
  // pageCount); reserve [pageCount, …) for future annotation /StructParent keys).
  writer.writeObject(
    structRootId,
    `<< /Type /StructTreeRoot /K ${documentId} 0 R /ParentTree ${parentTreeId} 0 R /ParentTreeNextKey ${pageCount} >>`,
  );

  return ` /StructTreeRoot ${structRootId} 0 R /MarkInfo << /Marked true >>`;
}
