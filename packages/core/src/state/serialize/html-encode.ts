/**
 * `taleweaver-html` ENCODE: a pure `State` → HTML-string serialization (no
 * parser). Walks the main tree in document order, mapping each block to its
 * HTML element per the spec §4 table.
 *
 * Pure and platform-agnostic — no DOM APIs are used on the encode side (only
 * the decode side needs to parse HTML, via an injected `HtmlParser`). Lossy
 * drops of CONTENT-bearing embeds
 * (footnote anchors, cross-references) emit a dev-mode `console.warn` naming the
 * dropped type + the lossless binary escape (spec §4 I1); other unsupported
 * embeds are skipped silently.
 */
import { getBlock } from "../state";
import { docHasLists } from "../document-order";
import { getListDefsForState, classifyListDef } from "../list-defs";
import { collectListEvents, computeCounters } from "../../numbering";
import type { CounterValue } from "../../numbering";
import { FOOTNOTE_ANCHOR_EMBED_TYPE } from "../ops/insert-footnote";
import { CROSS_REFERENCE_EMBED_TYPE } from "../ops/insert-cross-reference";
import { HARD_BREAK_EMBED_TYPE } from "../hard-break";
import { INLINE_IMAGE_EMBED_TYPE, type InlineContent } from "../inline-content";
import type { State } from "../state";
import type { Block } from "../block";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { isExportSafeLinkUrl } from "../../url-safety";
import { isDevMode } from "../dev-mode";

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
      `[@taleweaver/core] taleweaver-html encode dropped a content-bearing ` +
        `"${embedType}" embed — the HTML format does not support it, so this ` +
        `content is LOST on export. Use the "taleweaver-binary" format for ` +
        `lossless, id-preserving interchange.`,
    );
  };
}

/**
 * Construct an `<img>` tag from an image's `src` / `width` / `height` / `alt`.
 * Shared by the BLOCK image (`encodeLeaf`) and the INLINE image embed
 * (`encodeInline`) so the two paths stay byte-identical.
 *
 * `src` is SANITIZED through the same export allowlist as `<a href>` (#466) for
 * consistency + defense-in-depth: a `javascript:` / `data:` / `vbscript:` /
 * `file:` scheme is dropped to `""` (relative paths + http(s) survive). Browsers
 * do not execute `javascript:` in an `<img src>` the way they do in an `<a href>`,
 * but applying one allowlist keeps encode symmetric with decode (`html-decode.ts`
 * already drops these schemes on a decoded `<img src>`) and forecloses novel-scheme
 * risk without per-scheme analysis. (`data:image/…` inline-image support is a
 * future rich-paste concern — see `html-decode.ts` ~`data:image` note.)
 *
 * `alt` is the accessible name. `strAttr` returns the string as-is — `""` for a
 * DECORATIVE image (emit `alt=""`, NOT dropped) and `undefined` when absent
 * (omit the attribute entirely → unlabeled).
 */
function emitImgTag(
  src: string | undefined,
  width: number | undefined,
  height: number | undefined,
  alt: string | undefined,
): string {
  const safeSrc = src !== undefined && isExportSafeLinkUrl(src) ? src : "";
  let attrsStr = ` src="${escapeHtml(safeSrc)}"`;
  if (width !== undefined) attrsStr += ` width="${width}"`;
  if (height !== undefined) attrsStr += ` height="${height}"`;
  if (alt !== undefined) attrsStr += ` alt="${escapeHtml(alt)}"`;
  return `<img${attrsStr}>`;
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
    } else if (item.embedType === HARD_BREAK_EMBED_TYPE) {
      out += "<br>";
    } else if (item.embedType === INLINE_IMAGE_EMBED_TYPE) {
      // An inline image (Google Docs "In line" positioning) flows in line with
      // text, so it emits an INLINE `<img>` right here in the run — NOT a block
      // sibling. The `properties` bag is coerced with the same string/numeric
      // guards the block image uses, and `emitImgTag` applies the identical
      // src-sanitization + attribute construction (DRY with `encodeLeaf`).
      out += emitImgTag(
        strAttr(item.properties.src),
        numAttr(item.properties.width),
        numAttr(item.properties.height),
        strAttr(item.properties.alt),
      );
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
    case "image":
      return emitImgTag(
        strAttr(block.attrs.src),
        numAttr(block.attrs.width),
        numAttr(block.attrs.height),
        strAttr(block.attrs.alt),
      );
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
 *
 * Ordinal fidelity (#552): for an ORDERED run each item carries its resolved
 * numeric ordinal (`value`, from the numbering engine). We emit `<ol start=N>`
 * when a freshly-opened list's first item is N≠1 (its level's `start`), and
 * `<li value=N>` when an item breaks the natural +1 sequence (a mid-list
 * restart / `listCounterOverride`). `expectedAtLevel[L]` tracks the number HTML
 * will assign to the next `<li>` at level L, so a per-item `value` is emitted
 * only when the resolved ordinal diverges from it — matching Google Docs / Word
 * export. Unordered (`<ul>`) runs ignore `value` entirely (bullets have no
 * number).
 */
function encodeListRun(
  items: ReadonlyArray<{ level: number; inner: string; value?: number }>,
  tag: string,
): string {
  const ordered = tag === "ol";
  let out = "";
  // The stack tracks how many lists are currently OPEN (one per nesting level
  // 0..depth). We always have an `<li>` open for the deepest level once started.
  let openLevels = 0; // number of open <ul>/<ol> tags
  let liOpenAtLevel = -1; // the level whose <li> is currently open (-1 = none)
  // The ordinal HTML will auto-assign to the next <li> at each level (index =
  // level). Undefined ⇒ that level's list was just opened, so its `<ol start>`
  // (or the default 1) carries the first item's number with no per-item `value`.
  const expectedAtLevel: number[] = [];

  // Open a list tag at the deepest (`isFinal`) opening for `item`. Only the
  // final open receives the item's `start`; intermediate skip-level opens are
  // plain (default-1) lists.
  const openList = (startValue: number | undefined): void => {
    out +=
      ordered && startValue !== undefined && startValue !== 1
        ? `<ol start="${startValue}">`
        : `<${tag}>`;
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
      // Only the FINAL (deepest) open carries this item's start ordinal.
      while (openLevels < target) {
        const isFinal = openLevels === target - 1;
        openList(isFinal ? item.value : undefined);
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
      // The deeper levels' running ordinals are gone with their closed lists.
      expectedAtLevel.length = target;
    } else {
      // Same level: close the previous sibling <li>.
      closeLiIfOpen();
    }
    out += emitLiTag(item, ordered, expectedAtLevel);
    out += item.inner;
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

/**
 * The opening `<li>` tag for one ordered/unordered item, advancing the
 * per-level expected-ordinal ledger (#552). For an unordered list, or an item
 * the numbering engine left unresolved, this is a bare `<li>`. For an ordered
 * item whose resolved ordinal diverges from what HTML would auto-assign, it is
 * `<li value=N>`; a divergence at the FIRST item of a freshly-opened list was
 * already carried by `<ol start=N>` (its `expectedAtLevel` is still undefined),
 * so no redundant `value` is emitted there.
 */
function emitLiTag(
  item: { level: number; value?: number },
  ordered: boolean,
  expectedAtLevel: number[],
): string {
  if (!ordered || item.value === undefined) return "<li>";
  const expected = expectedAtLevel[item.level];
  const tag =
    expected !== undefined && item.value !== expected
      ? `<li value="${item.value}">`
      : "<li>";
  expectedAtLevel[item.level] = item.value + 1;
  return tag;
}

type ListDefMap = ReturnType<typeof getListDefsForState>;

/** Resolved list ordinals keyed by list-item blockId (numbering engine output). */
type Counters = ReadonlyMap<BlockId, CounterValue>;

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
  counters: Counters,
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
          out += encodeCell(state, cellBlock, listDefs, counters, warnDrop);
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
  counters: Counters,
  warnDrop: (embedType: string) => void,
): string {
  const rowSpan = numAttr(cell.attrs.rowSpan);
  const colSpan = numAttr(cell.attrs.colSpan);
  let attrsStr = "";
  if (rowSpan !== undefined && rowSpan > 1) attrsStr += ` rowspan="${rowSpan}"`;
  if (colSpan !== undefined && colSpan > 1) attrsStr += ` colspan="${colSpan}"`;
  const inner = encodeBlockSequence(state, cell.firstChildId, listDefs, counters, warnDrop);
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
  counters: Counters,
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
    if (block === undefined) {
      throw new Error(`html-encode: block at ${i} unexpectedly undefined`);
    }
    if (block.type === "list-item") {
      const listId = strAttr(block.attrs.listId) ?? "";
      // Gather the maximal consecutive run sharing this listId.
      const runItems: { level: number; inner: string; value?: number }[] = [];
      let j = i;
      while (j < blocks.length && blocks[j]?.type === "list-item") {
        const itemBlock = blocks[j];
        if (itemBlock === undefined) {
          throw new Error(`html-encode: list-item block at ${j} unexpectedly undefined`);
        }
        const itemListId = strAttr(itemBlock.attrs.listId) ?? "";
        if (itemListId !== listId) break;
        const level = numAttr(itemBlock.attrs.listLevel) ?? 0;
        runItems.push({
          level: level >= 0 ? level : 0,
          inner: encodeInline(itemBlock.inlineContent, warnDrop),
          value: counters.get(itemBlock.id)?.value,
        });
        j++;
      }
      const def = listDefs.get(listId);
      const tag = def !== undefined && classifyListDef(def) === "unordered" ? "ul" : "ol";
      out += encodeListRun(runItems, tag);
      i = j;
    } else if (block.type === "table") {
      out += encodeTable(state, block, listDefs, counters, warnDrop);
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
  const listDefs = getListDefsForState(state);
  // Resolve list ordinals via the SAME numbering engine the render path uses
  // (single source of truth — never re-derived here), so `<ol start>` / `<li value>`
  // match the on-screen marker numbers. `docHasLists` short-circuits the walk for
  // list-free documents.
  const counters: Counters = docHasLists(state)
    ? computeCounters(collectListEvents(state), listDefs)
    : new Map();
  const body = encodeBlockSequence(state, root.firstChildId, listDefs, counters, makeDropWarner());
  return `<body>${body}</body>`;
}
