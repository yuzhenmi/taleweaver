/**
 * `taleweaver-html` DECODE: HTML string → `State`, via the browser-native
 * `DOMParser` (present under jsdom in dom tests). Walks the parsed `body`,
 * mapping supported elements to declarative `BlockNode`s (spec §4 table), then
 * lowers the flat block list to a `State` with `buildDocumentFromTree`.
 *
 * Per spec §4 (I2), this decoder NEVER throws `MalformedDocumentError`:
 * `DOMParser` is lenient, the empty-paragraph fallback covers no-content input,
 * the typed `string` contract rules out non-string input, and the
 * discriminated-union `BlockNode` makes the container-XOR-leaf invariant a
 * compile-time guarantee.
 */
import {
  buildDocumentFromTree,
  newListId,
  type State,
  type IdAllocator,
  type ListDef,
  type BlockNode,
  type ContainerBlockNode,
  type InlineItem,
  type ReadonlyAttrs,
  HARD_BREAK_EMBED_TYPE,
} from "@taleweaver/core";
import { isExportSafeLinkUrl } from "./url-safety";

/** Default ordered (decimal) / unordered (disc) list defs for a decoded list. */
function decimalListDef(): ListDef {
  return { levels: [{ style: "decimal", start: 1, restart: "always" }] };
}
function discListDef(): ListDef {
  return { levels: [{ style: "disc", start: 1, restart: "always" }] };
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
  node: ChildNode,
  activeAttrs: ReadonlyAttrs,
  out: InlineItem[],
): void {
  if (node instanceof Text) {
    const value = node.data;
    if (value.length > 0) {
      out.push({ kind: "text", text: value, attrs: activeAttrs });
    }
    return;
  }
  if (!(node instanceof Element)) return;

  const tag = node.tagName.toUpperCase();
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
  el: Element,
  activeAttrs: ReadonlyAttrs,
  out: InlineItem[],
): void {
  for (const node of Array.from(el.childNodes)) {
    accumulateNode(node, activeAttrs, out);
  }
}

/** Build a leaf BlockNode's inline content from an element's children. */
function inlineContentOf(el: Element): { items: InlineItem[] } {
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
  el: Element,
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

  // `style` is only present on HTMLElement (not the base Element). SVG / generic
  // elements have no inline text-align to read.
  if (el instanceof HTMLElement) {
    const align = el.style.textAlign;
    if (align !== "" && TEXT_ALIGN_KEYWORDS.has(align)) {
      const logical = logicalTextAlign(align);
      if (logical !== undefined) set("textAlign", logical);
    }
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
  listEl: Element,
  listId: string,
  depth: number,
  acc: DecodeAccumulator,
  inherited: InheritedBlockAttrs,
): void {
  for (const child of Array.from(listEl.children)) {
    const childTag = child.tagName.toUpperCase();
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
    const nestedLists: Element[] = [];
    for (const liChild of Array.from(child.childNodes)) {
      if (liChild instanceof Element) {
        const t = liChild.tagName.toUpperCase();
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
    acc.blocks.push({
      type: "list-item",
      attrs: { ...liInherited, listId, listLevel: depth },
      inlineContent: { items },
    });
    // Recurse nested lists, keeping the same listId, deeper level.
    for (const nested of nestedLists) {
      walkList(nested, listId, depth + 1, acc, liInherited);
    }
  }
}

/** Map a single top-level body element to BlockNode(s) appended to `acc`. */
function decodeBlockElement(
  el: Element,
  acc: DecodeAccumulator,
  parentInherited: InheritedBlockAttrs,
): void {
  const tag = el.tagName.toUpperCase();
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
    default:
      // Unknown block element: ignored, but recurse so a wrapper's supported
      // children (e.g. a <div> containing <p>s) still surface. The wrapper's own
      // inheritable block attrs (lang/hyphens/text-align) cascade to those
      // children via `inherited`.
      for (const child of Array.from(el.children)) {
        decodeBlockElement(child, acc, inherited);
      }
      return;
  }
}

/** Decode an HTML string to a State. Never throws (spec §4 I2). */
export function decodeHtml(html: string, allocator: IdAllocator): State {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const acc: DecodeAccumulator = { blocks: [], listDefs: {} };

  // The document <body> may itself carry inheritable block attrs (lang/hyphens/
  // text-align) — read them as the root inherited set so a `<body lang="en">`
  // wrapper applies to every block.
  const rootInherited = resolveInheritedAttrs(doc.body, {});
  for (const child of Array.from(doc.body.children)) {
    decodeBlockElement(child, acc, rootInherited);
  }

  // Empty / all-unsupported body → a single empty paragraph (a valid minimal doc).
  if (acc.blocks.length === 0) {
    acc.blocks.push({ type: "paragraph", inlineContent: { items: [] } });
  }

  const root: ContainerBlockNode = { type: "document", children: acc.blocks };
  return buildDocumentFromTree(root, acc.listDefs, allocator);
}
