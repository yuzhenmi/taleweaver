/**
 * `taleweaver-html` ENCODE: a pure `State` → HTML-string serialization (no
 * parser). Walks the main tree in document order, mapping each block to its
 * HTML element per the spec §4 table.
 *
 * Pure and platform-agnostic — no DOM APIs are used on the encode side (only
 * the decode side needs `DOMParser`). Lossy drops of CONTENT-bearing embeds
 * (footnote anchors, cross-references) emit a dev-mode `console.warn` naming the
 * dropped type + the lossless binary escape (spec §4 I1); other unsupported
 * embeds are skipped silently.
 */
import {
  getBlock,
  getListDefsForState,
  classifyListDef,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
  type State,
  type Block,
  type BlockId,
  type InlineContent,
  type ReadonlyAttrs,
} from "@taleweaver/core";
import { isDevMode } from "./dev-mode";
import { isExportSafeLinkUrl } from "./url-safety";

/** HTML-escape text content (& < > "). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Read a string attr, or undefined if not a string. */
function strAttr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
/** Read a number attr, or undefined if not a number. */
function numAttr(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** The content-bearing embed types whose drop warrants a dev warning (I1). */
const WARN_DROP_EMBED_TYPES: ReadonlySet<string> = new Set([
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
]);

/** Heading level 1–6 from attrs, defaulting to 1 when absent/out of range. */
function headingLevel(attrs: ReadonlyAttrs): number {
  const level = numAttr(attrs.level);
  if (level !== undefined && level >= 1 && level <= 6) return level;
  return 1;
}

/**
 * The stable inline-mark nesting order (outermost → innermost):
 * link > bold > italic > underline > strikethrough. Encoding wraps a run's text
 * from the inside out, so the OUTERMOST wrapper is applied LAST below.
 */
interface MarkSpec {
  readonly attrKey: string;
  /** Render an open/close pair around `inner`. `attrValue` is the active attr. */
  readonly wrap: (inner: string, attrValue: unknown) => string;
}
const MARK_SPECS: ReadonlyArray<MarkSpec> = [
  // Innermost first; the loop wraps in reverse so link ends up outermost.
  { attrKey: "strikethrough", wrap: (inner) => `<s>${inner}</s>` },
  { attrKey: "underline", wrap: (inner) => `<u>${inner}</u>` },
  { attrKey: "italic", wrap: (inner) => `<em>${inner}</em>` },
  { attrKey: "bold", wrap: (inner) => `<strong>${inner}</strong>` },
  {
    attrKey: "link",
    wrap: (inner, value) => {
      const url = strAttr(value);
      // Drop the <a> wrapper (keep the inner text) for a missing URL OR a URL
      // with a dangerous executable scheme (javascript:/data:/…) — the exported
      // HTML must never carry a link a downstream consumer could open to run
      // script. Mirrors the Cmd/Ctrl-click allowlist (HL.3).
      return url !== undefined && isExportSafeLinkUrl(url)
        ? `<a href="${escapeHtml(url)}">${inner}</a>`
        : inner;
    },
  },
];

function isMarkActive(value: unknown): boolean {
  return value !== undefined && value !== false;
}

/** Wrap escaped text in its active mark elements (innermost → outermost). */
function wrapMarks(escapedText: string, attrs: ReadonlyAttrs): string {
  let out = escapedText;
  for (const spec of MARK_SPECS) {
    const value = attrs[spec.attrKey];
    if (isMarkActive(value)) {
      out = spec.wrap(out, value);
    }
  }
  return out;
}

/** A dev-warning emitter that warns at most once per distinct dropped type. */
function makeDropWarner(): (embedType: string) => void {
  const warned = new Set<string>();
  return (embedType: string): void => {
    if (!WARN_DROP_EMBED_TYPES.has(embedType)) return;
    if (warned.has(embedType)) return;
    warned.add(embedType);
    if (!isDevMode()) return;
    const g = globalThis as { console?: { warn(...args: unknown[]): void } };
    g.console?.warn(
      `[@taleweaver/dom] taleweaver-html encode dropped a content-bearing ` +
        `"${embedType}" embed — the HTML format does not support it, so this ` +
        `content is LOST on export. Use the "taleweaver-binary" format for ` +
        `lossless, id-preserving interchange.`,
    );
  };
}

/** Encode a leaf block's inline content (text runs + hard-breaks). */
function encodeInline(
  content: InlineContent | null,
  warnDrop: (embedType: string) => void,
): string {
  if (content === null) return "";
  let out = "";
  for (const item of content.items) {
    if (item.kind === "text") {
      out += wrapMarks(escapeHtml(item.text), item.attrs);
    } else if (item.embedType === "hard-break") {
      out += "<br>";
    } else {
      // Unsupported embed: dropped (dev-warns for content-bearing types).
      warnDrop(item.embedType);
    }
  }
  return out;
}

/** Encode a single non-list leaf block. Returns "" for unsupported types. */
function encodeLeaf(block: Block, warnDrop: (embedType: string) => void): string {
  const inner = encodeInline(block.inlineContent, warnDrop);
  switch (block.type) {
    case "heading": {
      const level = headingLevel(block.attrs);
      return `<h${level}>${inner}</h${level}>`;
    }
    case "paragraph":
      return `<p>${inner}</p>`;
    case "horizontal-line":
      return "<hr>";
    case "image": {
      const src = strAttr(block.attrs.src) ?? "";
      const width = numAttr(block.attrs.width);
      const height = numAttr(block.attrs.height);
      let attrsStr = ` src="${escapeHtml(src)}"`;
      if (width !== undefined) attrsStr += ` width="${width}"`;
      if (height !== undefined) attrsStr += ` height="${height}"`;
      return `<img${attrsStr}>`;
    }
    default:
      // Unsupported block type — dropped on export.
      return "";
  }
}

/**
 * Encode a run of CONSECUTIVE list-item blocks (a `Run` is a maximal sequence
 * sharing the same listId) into one `<ul>`/`<ol>`, nesting by listLevel via a
 * stack. Arbitrary depth: as listLevel rises we open nested lists; as it falls
 * we close them. The `tag` ("ul"/"ol") is fixed for the whole run (a list's
 * ordered/unordered nature is its level-0 def).
 */
function encodeListRun(
  items: ReadonlyArray<{ level: number; inner: string }>,
  tag: string,
): string {
  let out = "";
  // The stack tracks how many lists are currently OPEN (one per nesting level
  // 0..depth). We always have an `<li>` open for the deepest level once started.
  let openLevels = 0; // number of open <ul>/<ol> tags
  let liOpenAtLevel = -1; // the level whose <li> is currently open (-1 = none)

  const openList = (): void => {
    out += `<${tag}>`;
    openLevels++;
  };
  const closeList = (): void => {
    out += `</${tag}>`;
    openLevels--;
  };
  const closeLiIfOpen = (): void => {
    if (liOpenAtLevel >= 0) {
      out += "</li>";
      liOpenAtLevel = -1;
    }
  };

  for (const item of items) {
    const target = item.level + 1; // # of list tags that should be open
    if (target > openLevels) {
      // Going deeper: nest new lists INSIDE the current open <li> (do not close it).
      while (openLevels < target) {
        openList();
      }
    } else if (target < openLevels) {
      // Going shallower: close the current <li> + lists down to the target depth.
      closeLiIfOpen();
      while (openLevels > target) {
        closeList();
        // After closing a nested list, the parent <li> that contained it closes too.
        out += "</li>";
        liOpenAtLevel = -1;
      }
    } else {
      // Same level: close the previous sibling <li>.
      closeLiIfOpen();
    }
    out += `<li>${item.inner}`;
    liOpenAtLevel = item.level;
  }
  // Close everything still open.
  closeLiIfOpen();
  while (openLevels > 0) {
    closeList();
    if (openLevels > 0) out += "</li>";
  }
  return out;
}

type ListDefMap = ReturnType<typeof getListDefsForState>;

/**
 * Encode a `table` block to `<table>`: an optional `<colgroup>` carrying the
 * per-column widths (from the `columnWidths` fractions → percentages, for
 * Google Docs / Word fidelity), then each `table-row` → `<tr>` and each
 * `table-cell` → `<td>`. A cell's `rowSpan` / `colSpan` attr (omitted = 1) emits
 * a `rowspan` / `colspan` attribute only when > 1; the cell's content is encoded
 * RECURSIVELY via {@link encodeBlockSequence} (so nested lists / tables in a
 * cell serialize too). A ragged / malformed table still encodes whatever rows
 * and cells it has — export never throws.
 */
function encodeTable(
  state: State,
  table: Block,
  listDefs: ListDefMap,
  warnDrop: (embedType: string) => void,
): string {
  let out = "<table>";

  const widths = table.attrs.columnWidths;
  if (Array.isArray(widths) && widths.length > 0) {
    out += "<colgroup>";
    for (const w of widths) {
      out +=
        typeof w === "number"
          ? `<col style="width:${+(w * 100).toFixed(4)}%">`
          : "<col>";
    }
    out += "</colgroup>";
  }

  let rowId = table.firstChildId;
  while (rowId !== null) {
    const row = getBlock(state, rowId);
    if (row === null) break;
    if (row.type === "table-row") {
      out += "<tr>";
      let cellId = row.firstChildId;
      while (cellId !== null) {
        const cellBlock = getBlock(state, cellId);
        if (cellBlock === null) break;
        if (cellBlock.type === "table-cell") {
          out += encodeCell(state, cellBlock, listDefs, warnDrop);
        }
        cellId = cellBlock.nextSiblingId;
      }
      out += "</tr>";
    }
    rowId = row.nextSiblingId;
  }

  return out + "</table>";
}

/** Encode one `table-cell` → `<td>` with optional span attrs + recursive content. */
function encodeCell(
  state: State,
  cell: Block,
  listDefs: ListDefMap,
  warnDrop: (embedType: string) => void,
): string {
  const rowSpan = numAttr(cell.attrs.rowSpan);
  const colSpan = numAttr(cell.attrs.colSpan);
  let attrsStr = "";
  if (rowSpan !== undefined && rowSpan > 1) attrsStr += ` rowspan="${rowSpan}"`;
  if (colSpan !== undefined && colSpan > 1) attrsStr += ` colspan="${colSpan}"`;
  const inner = encodeBlockSequence(state, cell.firstChildId, listDefs, warnDrop);
  return `<td${attrsStr}>${inner}</td>`;
}

/**
 * Encode a sequence of sibling blocks starting at `firstChildId` (the document
 * root's children, or a table cell's children) in document order: consecutive
 * same-listId list-items group into one `<ul>`/`<ol>`; a `table` → `<table>`
 * (see {@link encodeTable}); every other block → {@link encodeLeaf}. Recursive
 * via `encodeTable` → `encodeCell`, so nested structures serialize.
 */
function encodeBlockSequence(
  state: State,
  firstChildId: BlockId | null,
  listDefs: ListDefMap,
  warnDrop: (embedType: string) => void,
): string {
  const blocks: Block[] = [];
  let childId = firstChildId;
  while (childId !== null) {
    const block = getBlock(state, childId);
    if (block === null) break;
    blocks.push(block);
    childId = block.nextSiblingId;
  }

  let out = "";
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "list-item") {
      const listId = strAttr(block.attrs.listId) ?? "";
      // Gather the maximal consecutive run sharing this listId.
      const runItems: { level: number; inner: string }[] = [];
      let j = i;
      while (j < blocks.length && blocks[j].type === "list-item") {
        const itemBlock = blocks[j];
        const itemListId = strAttr(itemBlock.attrs.listId) ?? "";
        if (itemListId !== listId) break;
        const level = numAttr(itemBlock.attrs.listLevel) ?? 0;
        runItems.push({
          level: level >= 0 ? level : 0,
          inner: encodeInline(itemBlock.inlineContent, warnDrop),
        });
        j++;
      }
      const def = listDefs.get(listId);
      const tag = def !== undefined && classifyListDef(def) === "unordered" ? "ul" : "ol";
      out += encodeListRun(runItems, tag);
      i = j;
    } else if (block.type === "table") {
      out += encodeTable(state, block, listDefs, warnDrop);
      i++;
    } else {
      out += encodeLeaf(block, warnDrop);
      i++;
    }
  }
  return out;
}

/**
 * Encode the document State to an HTML string. Walks the main tree's top-level
 * blocks in document order via {@link encodeBlockSequence}.
 */
export function encodeHtml(state: State): string {
  const root = getBlock(state, state.rootId);
  if (root === null) return "<body></body>";
  const body = encodeBlockSequence(
    state,
    root.firstChildId,
    getListDefsForState(state),
    makeDropWarner(),
  );
  return `<body>${body}</body>`;
}
