/**
 * `taleweaver-html` DECODE: HTML string → `State`, via an INJECTED
 * {@link HtmlParser}. The parser turns the string into a DOM-free
 * {@link HtmlNode} body (a browser host adapts `DOMParser`, a server host adapts
 * parse5/jsdom) — core itself references NO DOM type. The walk maps supported
 * elements to declarative `BlockNode`s (spec §4 table), then lowers the flat
 * block list to a `State` with `buildDocumentFromTree`.
 *
 * Per spec §4 (I2), this decoder NEVER throws `MalformedDocumentError`: a
 * conforming `HtmlParser` is lenient, the empty-paragraph fallback covers
 * no-content input, the typed `string` contract rules out non-string input, and
 * the discriminated-union `BlockNode` makes the container-XOR-leaf invariant a
 * compile-time guarantee.
 */
import { buildDocumentFromTree } from "../build-document-from-tree";
import type {
  BlockNode,
  ContainerBlockNode,
} from "../build-document-from-tree";
import { newListId } from "../block-id";
import type { IdAllocator } from "../block-id";
import type { State } from "../state";
import { classifyListDef } from "../list-defs";
import type { ListDef } from "../list-defs";
import { HARD_BREAK_EMBED_TYPE } from "../hard-break";
import type { InlineItem } from "../inline-content";
import type { ReadonlyAttrs } from "../attrs";
import { isExportSafeLinkUrl } from "../../url-safety";
import type { HtmlNode, HtmlParser } from "./html-node";

/** Default ordered (decimal) / unordered (disc) list defs for a decoded list. */
function decimalListDef(): ListDef {
  return { levels: [{ style: "decimal", start: 1, restart: "always" }] };
}
function discListDef(): ListDef {
  return { levels: [{ style: "disc", start: 1, restart: "always" }] };
}

/**
 * Parse an `<ol start>` / `<li value>` ordinal attribute (#554). HTML permits any
 * integer (the encoder only emits positive ones); a non-integer / absent value
 * yields `undefined`.
 */
function parseOrdinal(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
}

/**
 * Record the `<ol>` level at `depth` for an ORDERED decoded list (#554),
 * reconstructing the per-level `listDefs` entry the encoder derived `<ol start>`
 * from. Ensures `levels` is CONTIGUOUS up to `depth` (intermediate gaps filled
 * with the base level-0 config, `start: 1`) so `computeCounters`'s level lookup
 * — which clamps an over-deep level to `levels.length - 1` — never maps a deeper
 * level back onto a shallower explicit start. When `start` is given, it overrides
 * that level's start; otherwise the level keeps its default (1), which is exactly
 * what a bare `<ol>` (no `start`) round-trips to.
 */
function recordOrderedLevel(
  acc: DecodeAccumulator,
  listId: string,
  depth: number,
  start: number | undefined,
): void {
  const def = acc.listDefs[listId];
  if (def === undefined) return;
  const base = def.levels[0] ?? { style: "decimal", start: 1, restart: "always" };
  const levels = [...def.levels];
  while (levels.length <= depth) {
    levels.push({ ...base, start: 1 });
  }
  if (start !== undefined) {
    levels[depth] = { ...(levels[depth] ?? base), start };
  }
  acc.listDefs[listId] = { levels };
}

/** Recognized mark-element tag names → the inline attr they add (boolean marks). */
const BOOLEAN_MARK_TAGS: Readonly<Record<string, string>> = {
  STRONG: "bold",
  B: "bold",
  EM: "italic",
  I: "italic",
  U: "underline",
  S: "strikethrough",
  DEL: "strikethrough",
};

/**
 * Dispatch a SINGLE DOM node into inline items under the current mark set: a
 * text node becomes a TextItem stamped with `activeAttrs`; a mark element ADDS
 * its attr to the set and recurses (order-independent, M1); `<a href>` adds
 * `link = href` (M2); `<br>` becomes a hard-break embed; any other element
 * (unknown wrapper, or a block-level child appearing inside inline content) is
 * recursed into with the same active attrs so its text survives. The unit shared
 * by both the leaf-element walk (`accumulateInline`) and the `<li>` walk
 * (`walkList`) — so marks / `<br>` inside a list item are handled identically to
 * those inside a paragraph.
 */
function accumulateNode(
  node: HtmlNode,
  activeAttrs: ReadonlyAttrs,
  out: InlineItem[],
): void {
  if (node.kind === "text") {
    const value = node.data;
    if (value.length > 0) {
      out.push({ kind: "text", text: value, attrs: activeAttrs });
    }
    return;
  }
  if (node.kind !== "element") return;

  const tag = node.tagName;
  if (tag === "BR") {
    out.push({ kind: "embed", embedType: HARD_BREAK_EMBED_TYPE, attrs: {}, properties: {} });
    return;
  }
  const markKey = BOOLEAN_MARK_TAGS[tag];
  if (markKey !== undefined) {
    accumulateInline(node, { ...activeAttrs, [markKey]: true }, out);
    return;
  }
  if (tag === "A") {
    const href = node.getAttribute("href");
    // Sanitize at the untrusted-input trust boundary, symmetric with the export
    // side (#466 `isExportSafeLinkUrl`): a `javascript:`/`data:`/`vbscript:` href
    // is dropped (the link text is still kept), so a decoded document never
    // carries an executable-scheme `link` attr.
    const nextAttrs =
      href !== null && isExportSafeLinkUrl(href)
        ? { ...activeAttrs, link: href }
        : activeAttrs;
    accumulateInline(node, nextAttrs, out);
    return;
  }
  // Unknown wrapper (e.g. <span>) or stray block-level child: recurse, preserving
  // the active mark set so the text is not lost.
  accumulateInline(node, activeAttrs, out);
}

/**
 * Accumulate the inline content of an element by dispatching each of its child
 * nodes through `accumulateNode`.
 */
function accumulateInline(
  el: HtmlNode,
  activeAttrs: ReadonlyAttrs,
  out: InlineItem[],
): void {
  for (const node of el.childNodes) {
    accumulateNode(node, activeAttrs, out);
  }
}

/** Build a leaf BlockNode's inline content from an element's children. */
function inlineContentOf(el: HtmlNode): { items: InlineItem[] } {
  const items: InlineItem[] = [];
  accumulateInline(el, {}, items);
  return { items };
}

/** Heading level 1–6 from an h1–h6 tag, defaulting to 1. */
function headingLevelFromTag(tag: string): number {
  const n = Number(tag.slice(1));
  return n >= 1 && n <= 6 ? n : 1;
}

interface DecodeAccumulator {
  readonly blocks: BlockNode[];
  readonly listDefs: Record<string, ListDef>;
}

/**
 * Block-level cascade attributes that authored HTML can declare and that INHERIT
 * to descendant blocks (mirroring the engine cascade): `lang` → the content
 * language, `hyphens` → the hyphenation mode, `textAlign` → paragraph alignment.
 * Read off an element and threaded down so a wrapping `<div lang="en"
 * hyphens="auto" style="text-align: justify">` applies to every paragraph inside
 * it without repeating the attributes on each. A child element's own value
 * overrides the inherited one.
 */
type InheritedBlockAttrs = Readonly<Record<string, string>>;

const HYPHENS_KEYWORDS = new Set(["none", "manual", "auto"]);
const TEXT_ALIGN_KEYWORDS = new Set(["start", "end", "center", "justify", "left", "right"]);

/** Map the physical CSS `text-align` keywords to the engine's logical keywords. */
function logicalTextAlign(value: string): string | undefined {
  switch (value) {
    case "left":
    case "start":
      return "start";
    case "right":
    case "end":
      return "end";
    case "center":
      return "center";
    case "justify":
      return "justify";
    default:
      return undefined;
  }
}

/**
 * Merge an element's own inheritable block attributes over the inherited set.
 * `lang`/`hyphens` come from attributes; `text-align` from the inline `style`.
 * Unknown / invalid values are ignored (the inherited value survives).
 */
function resolveInheritedAttrs(
  el: HtmlNode,
  inherited: InheritedBlockAttrs,
): InheritedBlockAttrs {
  let next: Record<string, string> | undefined;
  const set = (key: string, value: string): void => {
    next = next ?? { ...inherited };
    next[key] = value;
  };

  const lang = el.getAttribute("lang");
  if (lang !== null && lang.trim() !== "") set("lang", lang.trim());

  const hyphens = el.getAttribute("hyphens");
  if (hyphens !== null && HYPHENS_KEYWORDS.has(hyphens.trim())) set("hyphens", hyphens.trim());

  // The decode reads exactly one inline-style property (`text-align`); the seam
  // exposes it DOM-free via `getStyleProperty`. Non-element / non-styled nodes
  // return null (no inline text-align to read).
  const align = el.getStyleProperty("textAlign") ?? "";
  if (align !== "" && TEXT_ALIGN_KEYWORDS.has(align)) {
    const logical = logicalTextAlign(align);
    if (logical !== undefined) set("textAlign", logical);
  }

  return next ?? inherited;
}

/** Merge inherited block attrs into a block's own attrs (own attrs win). */
function withInheritedAttrs(
  inherited: InheritedBlockAttrs,
  own?: ReadonlyAttrs,
): ReadonlyAttrs | undefined {
  const keys = Object.keys(inherited);
  if (keys.length === 0) return own;
  return { ...inherited, ...(own ?? {}) };
}

/**
 * Walk a `<ul>`/`<ol>` list element, emitting a FLAT list-item BlockNode per
 * `<li>` (the Google-Docs flat list model). `listId` + `depth` are threaded
 * down: a nested list inside an `<li>` KEEPS the listId and increments depth
 * (arbitrary depth, C2). Each `<li>`'s direct inline content becomes the item's
 * inlineContent; a nested `<ul>`/`<ol>` inside the `<li>` recurses.
 */
function walkList(
  listEl: HtmlNode,
  listId: string,
  depth: number,
  acc: DecodeAccumulator,
  inherited: InheritedBlockAttrs,
): void {
  // #554: for an ORDERED list, reconstruct this level's `start` from `<ol start>`
  // (or default 1) so HTML ordinals round-trip. Done per nested `<ol>` element so
  // each depth's start is captured. Unordered (bullet) lists carry no ordinal.
  const def = acc.listDefs[listId];
  const ordered = def !== undefined && classifyListDef(def) === "ordered";
  if (ordered) {
    recordOrderedLevel(acc, listId, depth, parseOrdinal(listEl.getAttribute("start")));
  }
  for (const child of listEl.children) {
    const childTag = child.tagName;
    // A list nested DIRECTLY inside a list, with NO intervening `<li>` — the shape
    // the encoder emits for a list-LEVEL JUMP (level 0 → 2 opens `<ol><ol>` where
    // only the deepest gets an `<li>`), and a common Word/Google-Docs/web paste
    // shape. Recurse one level deeper so its items are not silently dropped.
    if (childTag === "UL" || childTag === "OL") {
      walkList(child, listId, depth + 1, acc, resolveInheritedAttrs(child, inherited));
      continue;
    }
    if (childTag !== "LI") continue;
    const liInherited = resolveInheritedAttrs(child, inherited);
    // The <li>'s own inline content (text + marks), excluding nested lists.
    const items: InlineItem[] = [];
    const nestedLists: HtmlNode[] = [];
    for (const liChild of child.childNodes) {
      if (liChild.kind === "element") {
        const t = liChild.tagName;
        if (t === "UL" || t === "OL") {
          nestedLists.push(liChild);
          continue;
        }
      }
      // Dispatch this node (text, mark element, <br>, <a>, wrapper) the SAME way
      // paragraph/heading inline content is built — so marks and hard-breaks
      // inside an <li> are preserved, not silently dropped.
      accumulateNode(liChild, {}, items);
    }
    // #554: an ORDERED item's `<li value>` becomes a listCounterOverride (the
    // mid-list restart the numbering engine forces a value from). Bullet items
    // carry no ordinal, so the attr is read only for ordered lists.
    const override = ordered ? parseOrdinal(child.getAttribute("value")) : undefined;
    const liAttrs: ReadonlyAttrs =
      override !== undefined
        ? { ...liInherited, listId, listLevel: depth, listCounterOverride: override }
        : { ...liInherited, listId, listLevel: depth };
    acc.blocks.push({
      type: "list-item",
      attrs: liAttrs,
      inlineContent: { items },
    });
    // Recurse nested lists, keeping the same listId, deeper level.
    for (const nested of nestedLists) {
      walkList(nested, listId, depth + 1, acc, liInherited);
    }
  }
}

/**
 * Tags that begin a NEW block inside cell flow content. Everything else (text, the
 * boolean-mark tags, `<a>`, `<br>`, `<span>`/unknown inline wrappers) is treated as
 * inline and grouped into a paragraph. `DIV` is included — Google Docs / Word wrap
 * cell content in `<div>` paragraph surrogates; it recurses through `decodeFlowContent`
 * (NOT `decodeBlockElement`'s element-only `default` arm), so a `<div>bare text</div>`
 * surrogate keeps its text (two `<div>`s → two paragraphs).
 */
const BLOCK_LEVEL_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "IMG", "UL", "OL", "TABLE", "DIV",
]);

/**
 * Decode an element's mixed flow content (block + inline children) into a `BlockNode[]`.
 * Used for a table cell, whose children commonly mix bare inline text (`<td>text</td>`)
 * with block elements (`<td><p>A</p>tail</td>`). Inline runs are grouped into synthetic
 * `paragraph`s (inheriting the cell's cascade via `withInheritedAttrs`); block-level
 * elements dispatch through `decodeBlockElement`. A cell sub-accumulator shares the root
 * `acc.listDefs` (same reference) so cell-level lists register document-wide.
 */
function decodeFlowContent(
  el: HtmlNode,
  acc: DecodeAccumulator,
  inherited: InheritedBlockAttrs,
): BlockNode[] {
  const cellAcc: DecodeAccumulator = { blocks: [], listDefs: acc.listDefs };
  let pending: InlineItem[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    cellAcc.blocks.push({
      type: "paragraph",
      attrs: withInheritedAttrs(inherited),
      inlineContent: { items: pending },
    });
    pending = [];
  };
  for (const child of el.childNodes) {
    if (child.kind === "element" && BLOCK_LEVEL_TAGS.has(child.tagName)) {
      flush();
      if (child.tagName === "DIV") {
        // A <div> surrogate may hold bare text (which `decodeBlockElement`'s
        // element-only `default` arm would drop), so recurse it as flow content.
        cellAcc.blocks.push(
          ...decodeFlowContent(child, acc, resolveInheritedAttrs(child, inherited)),
        );
      } else {
        decodeBlockElement(child, cellAcc, inherited);
      }
    } else {
      accumulateNode(child, {}, pending);
    }
  }
  flush();
  return cellAcc.blocks;
}

/** Parse a `colspan`/`rowspan` attribute to an integer ≥ 1 (default 1). */
function parseSpan(raw: string | null): number {
  if (raw === null) return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** Parse a `<col style="width:X%">` to a fraction, or null for missing/non-`%` widths. */
function parseColWidth(col: HtmlNode): number | null {
  const raw = col.getStyleProperty("width");
  if (raw === null) return null;
  const match = /^([\d.]+)%$/.exec(raw.trim());
  if (match === null || match[1] === undefined) return null;
  const frac = Number.parseFloat(match[1]) / 100;
  return Number.isFinite(frac) && frac > 0 ? frac : null;
}

/** Fill `null` (unknown-width) columns with an equal share of the remaining fraction. */
function fillEqualShare(widths: ReadonlyArray<number | null>): number[] {
  const knownSum = widths.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const nullCount = widths.filter((w) => w === null).length;
  const each = nullCount > 0 ? Math.max(0, 1 - knownSum) / nullCount : 0;
  return widths.map((w) => (w === null ? each : w));
}

/** Decode a `<tr>` to a `table-row` container; each `<td>`/`<th>` becomes a `table-cell`. */
function decodeTableRow(
  rowEl: HtmlNode,
  acc: DecodeAccumulator,
  inherited: InheritedBlockAttrs,
): ContainerBlockNode {
  const rowInherited = resolveInheritedAttrs(rowEl, inherited);
  const cells: ContainerBlockNode[] = [];
  for (const cellEl of rowEl.children) {
    if (cellEl.tagName !== "TD" && cellEl.tagName !== "TH") continue;
    const cellInherited = resolveInheritedAttrs(cellEl, rowInherited);
    const attrs: Record<string, number> = {};
    const colSpan = parseSpan(cellEl.getAttribute("colspan"));
    const rowSpan = parseSpan(cellEl.getAttribute("rowspan"));
    if (colSpan > 1) attrs.colSpan = colSpan;
    if (rowSpan > 1) attrs.rowSpan = rowSpan;
    let children = decodeFlowContent(cellEl, acc, cellInherited);
    if (children.length === 0) children = [{ type: "paragraph", inlineContent: { items: [] } }];
    cells.push({ type: "table-cell", attrs, children });
  }
  return { type: "table-row", children: cells };
}

/**
 * Decode a `<table>` into a nested `table` → `table-row` → `table-cell` ContainerBlockNode
 * subtree, PUSHED into `acc.blocks` (the inverse of `encodeTable`). `<thead>`/`<tbody>`/
 * `<tfoot>` wrappers and bare `<tr>` are flattened into the row sequence; a LEADING
 * `<thead>` sets `headerRowCount` (#487); `<colgroup>` `%` widths become `columnWidths`.
 * `inherited` is the table's already-resolved cascade (threaded to rows/cells/leaves).
 */
function decodeTable(
  el: HtmlNode,
  acc: DecodeAccumulator,
  inherited: InheritedBlockAttrs,
): void {
  const rowEls: HtmlNode[] = [];
  let headerRowCount = 0;
  let sawBodyRows = false; // a tbody/tfoot/bare-tr was seen → a later thead is mid-table
  let columnWidths: number[] | undefined;

  for (const child of el.children) {
    switch (child.tagName) {
      case "COLGROUP": {
        const widths: Array<number | null> = [];
        let anyUsable = false;
        for (const col of child.children) {
          if (col.tagName !== "COL") continue;
          const w = parseColWidth(col);
          if (w !== null) anyUsable = true;
          widths.push(w);
        }
        if (anyUsable) columnWidths = fillEqualShare(widths);
        break;
      }
      case "THEAD": {
        const theadRows = child.children.filter((c) => c.tagName === "TR");
        if (!sawBodyRows) headerRowCount = theadRows.length; // leading thead only
        for (const r of theadRows) rowEls.push(r);
        break;
      }
      case "TBODY":
      case "TFOOT": {
        sawBodyRows = true;
        for (const r of child.children) if (r.tagName === "TR") rowEls.push(r);
        break;
      }
      case "TR":
        sawBodyRows = true;
        rowEls.push(child);
        break;
      default:
        break; // <caption> and unknowns: skipped (caption is a deferred facet)
    }
  }

  const rows = rowEls.map((rowEl) => decodeTableRow(rowEl, acc, inherited));
  const attrs: Record<string, number | number[]> = {};
  if (columnWidths !== undefined) attrs.columnWidths = columnWidths;
  if (headerRowCount > 0) attrs.headerRowCount = headerRowCount;
  acc.blocks.push({ type: "table", attrs, children: rows });
}

/** Map a single top-level body element to BlockNode(s) appended to `acc`. */
function decodeBlockElement(
  el: HtmlNode,
  acc: DecodeAccumulator,
  parentInherited: InheritedBlockAttrs,
): void {
  const tag = el.tagName;
  const inherited = resolveInheritedAttrs(el, parentInherited);
  switch (tag) {
    case "P":
      acc.blocks.push({
        type: "paragraph",
        attrs: withInheritedAttrs(inherited),
        inlineContent: inlineContentOf(el),
      });
      return;
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      acc.blocks.push({
        type: "heading",
        attrs: withInheritedAttrs(inherited, { level: headingLevelFromTag(tag) }),
        inlineContent: inlineContentOf(el),
      });
      return;
    case "HR":
      acc.blocks.push({ type: "horizontal-line", inlineContent: { items: [] } });
      return;
    case "IMG": {
      // Sanitize `src` symmetrically with `<a href>` (above): a dangerous-scheme
      // src (`javascript:`/`data:`/`vbscript:`) is dropped to "" so a decoded
      // image never feeds an executable-scheme URL to the canvas image loader.
      // (`data:image` paste support is a future rich-paste concern; the untrusted
      // boundary stays allowlist-only per `url-safety.ts`.)
      const rawSrc = el.getAttribute("src");
      const src = rawSrc !== null && isExportSafeLinkUrl(rawSrc) ? rawSrc : "";
      const attrs: Record<string, string | number> = { src };
      const width = el.getAttribute("width");
      const height = el.getAttribute("height");
      if (width !== null && width.trim() !== "" && !Number.isNaN(Number(width))) {
        attrs.width = Number(width);
      }
      if (height !== null && height.trim() !== "" && !Number.isNaN(Number(height))) {
        attrs.height = Number(height);
      }
      // `alt` is the accessible name. Preserve all three states: a present
      // attribute (incl. `alt=""` → DECORATIVE) maps to `attrs.alt`; an absent
      // attribute leaves no `alt` key (unlabeled).
      const alt = el.getAttribute("alt");
      if (alt !== null) attrs.alt = alt;
      acc.blocks.push({ type: "image", attrs, inlineContent: { items: [] } });
      return;
    }
    case "UL":
    case "OL": {
      const listId = newListId();
      acc.listDefs[listId] = tag === "OL" ? decimalListDef() : discListDef();
      walkList(el, listId, 0, acc, inherited);
      return;
    }
    case "TABLE":
      decodeTable(el, acc, inherited);
      return;
    default:
      // Unknown block element: ignored, but recurse so a wrapper's supported
      // children (e.g. a <div> containing <p>s) still surface. The wrapper's own
      // inheritable block attrs (lang/hyphens/text-align) cascade to those
      // children via `inherited`.
      for (const child of el.children) {
        decodeBlockElement(child, acc, inherited);
      }
      return;
  }
}

/**
 * Decode an HTML string to a State. Never throws (spec §4 I2). The host injects
 * `parseHtml` (a DOM-free {@link HtmlParser}) — it parses `html` and returns the
 * BODY as an `HtmlNode`; the walk below references no DOM type.
 */
export function decodeHtml(
  html: string,
  allocator: IdAllocator,
  parseHtml: HtmlParser,
): State {
  const body = parseHtml(html);
  const acc: DecodeAccumulator = { blocks: [], listDefs: {} };

  // The document <body> may itself carry inheritable block attrs (lang/hyphens/
  // text-align) — read them as the root inherited set so a `<body lang="en">`
  // wrapper applies to every block.
  const rootInherited = resolveInheritedAttrs(body, {});
  for (const child of body.children) {
    decodeBlockElement(child, acc, rootInherited);
  }

  // Empty / all-unsupported body → a single empty paragraph (a valid minimal doc).
  if (acc.blocks.length === 0) {
    acc.blocks.push({ type: "paragraph", inlineContent: { items: [] } });
  }

  const root: ContainerBlockNode = { type: "document", children: acc.blocks };
  return buildDocumentFromTree(root, acc.listDefs, allocator);
}
