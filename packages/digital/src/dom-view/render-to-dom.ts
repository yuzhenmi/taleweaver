import {
  type RenderNode,
  type TextBox,
  type ElementBox,
  type ComputedStyle,
  type State,
  type ComponentRegistry,
  type AttrRegistry,
  type SuggestionView,
  render,
  cascadePass,
  isExportSafeLinkUrl,
} from "@taleweaver/core";
import { computedStyleToInlineStyle } from "./computed-style-to-css";

export interface RenderDocumentToDomOptions {
  readonly suggestionView?: SuggestionView;
  readonly stampBlockIds?: boolean; // digital controller passes true
}

/**
 * Render a document `State` into real DOM the browser flows to any width — the
 * read-only digital view. Pipeline: render() → cascadePass() → renderNodeToDom().
 * No engine geometry, no pages: the browser does layout. Pass `suggestionView`
 * to choose tracked-changes ("suggesting", default) vs clean ("final") output.
 */
export function renderDocumentToDom(
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  doc: Document,
  options?: RenderDocumentToDomOptions,
): HTMLElement {
  const out = render(
    state,
    componentRegistry,
    attrRegistry,
    options?.suggestionView !== undefined ? { suggestionView: options.suggestionView } : undefined,
  );
  const root = cascadePass(out.root);
  const dom = renderNodeToDom(root, doc, options?.stampBlockIds ?? false);
  // The document root component is display:block → one <div>. If it ever unwraps
  // (fragment) or skips (null), wrap so the HTMLElement contract holds.
  if (dom instanceof HTMLElement) return dom;
  const wrapper = doc.createElement("div");
  if (dom !== null) wrapper.appendChild(dom);
  return wrapper;
}

/**
 * Map a single styled-tree node to DOM. Returns `null` for nodes that emit
 * nothing (`display:none`).
 */
export function renderNodeToDom(node: RenderNode, doc: Document, stamp = false): Node | null {
  if (node.type === "text") return textBoxToDom(node, doc);
  return elementBoxToDom(node, doc, stamp);
}

function elementBoxToDom(box: ElementBox, doc: Document, stamp: boolean): Node | null {
  const m = box.metadata;
  const display = box.computedStyle?.display ?? "block";

  // First-match: metadata flags before generic display. Tag selection reads the
  // CASCADED computedStyle.display, never the pre-cascade style.display.
  if (m?.headingLevel !== undefined) {
    const h = doc.createElement(`h${m.headingLevel}`);
    applyStyle(h, box);
    stampBlockId(h, box, stamp, "block");
    appendChildren(h, box.children, doc, childStamp(stamp, "block"));
    fillEmptyLineHost(h, "block", doc);
    return h;
  }
  if (m?.horizontalLine === true) {
    const hr = doc.createElement("hr");
    applyStyle(hr, box);
    stampBlockId(hr, box, stamp, "block");
    return hr;
  }
  if (m?.image !== undefined) {
    const img = doc.createElement("img");
    img.setAttribute("src", m.image.src);
    img.setAttribute("width", String(m.image.width));
    img.setAttribute("height", String(m.image.height));
    img.setAttribute("alt", m.image.alt ?? "");
    applyStyle(img, box);
    // A block image box reached on the block path IS stamped; an inline-image inner box reached
    // via the inline-embed subtree arrives with stamp=false (childStamp turned it off), so this
    // no-ops there — the F6 fix.
    stampBlockId(img, box, stamp, "block");
    return img;
  }
  if (m?.blockType === "section" || display === "contents") {
    // Unwrap: emit children into a fragment (the section box has no tag).
    const frag = doc.createDocumentFragment();
    // A section/`display:contents` box is a transparent block container — keep the block path.
    appendChildren(frag, box.children, doc, childStamp(stamp, "block"));
    return frag;
  }
  if (display === "none") return null;

  const tag =
    display === "list-item" ? "li"
    : display === "table" ? "table"
    : display === "table-row" ? "tr"
    : display === "table-cell" ? "td"
    : display === "inline" ? "span"
    : display === "inline-block" ? "span"
    : "div"; // block / flow-root / fallback
  const elem = doc.createElement(tag);
  if (display === "inline-block") elem.style.display = "inline-block";
  applyStyle(elem, box);
  stampBlockId(elem, box, stamp, display);
  stampInlineEmbed(elem, box, stamp);
  // childStamp forces stamp=false when `display` is inline/inline-block (run-wrapper OR
  // inline-embed outer box) — so the inline-image inner display:block box never sees stamp=true.
  appendChildren(elem, box.children, doc, childStamp(stamp, display));
  fillEmptyLineHost(elem, display, doc);
  return elem;
}

/**
 * Block-level flow leaves that host a LINE of inline content (paragraph, heading, list-item,
 * table-cell). When such a leaf has no inline content, a browser gives it no line box → zero
 * height → the blank line is invisible and the caret cannot land in it. Replace its content with
 * a marked filler `<br>` so the empty line shows and is clickable — the digital analog of the
 * canvas path's empty-line strut, and the same trailing-`<br>` trick contenteditable editors
 * (ProseMirror/Lexical) use. The selection bridge measures it as ZERO content units and pins the
 * caret BEFORE it (offset 0), so offsets are unaffected.
 *
 * "Empty" is decided by CONTENT, not child-node count: an empty paragraph renders as a `<div>`
 * holding an empty styled `<span>` (it carries the cascaded white-space etc.), which still has no
 * line box. So we fill when the block has no text AND no replaced/embed content, and use
 * `replaceChildren` to drop the empty styled span(s) — leaving exactly the filler so the bridge's
 * "filler-only block" check stays trivial. Structural containers (`table`/`table-row`) and inline
 * boxes are excluded by display; a block that hosts NESTED block elements (a `[data-block-id]`
 * child — e.g. a table-cell wrapping an empty paragraph) is excluded too, so its real block
 * children are never wiped (the empty leaf paragraph inside gets the filler instead).
 */
const LINE_HOST_DISPLAYS: ReadonlySet<ComputedStyle["display"]> = new Set([
  "block", "flow-root", "list-item", "table-cell",
]);
function fillEmptyLineHost(elem: HTMLElement, display: ComputedStyle["display"], doc: Document): void {
  if (!LINE_HOST_DISPLAYS.has(display)) return;
  if (elem.querySelector("[data-block-id]") !== null) return; // a container (nested blocks), not an empty line
  if ((elem.textContent ?? "") !== "") return; // has text → already has a line box
  if (elem.querySelector("img, [data-inline-embed]") !== null) return; // replaced/embed content → has a box
  const br = doc.createElement("br");
  br.setAttribute("data-tw-empty-line", "");
  elem.replaceChildren(br); // drop empty styled spans; the filler IS the line box
}

/** Block-level display values — the ones that can host more block boxes (F6 propagation gate). */
function isBlockLevelDisplay(display: ComputedStyle["display"]): boolean {
  return display !== "inline" && display !== "inline-block";
}

/**
 * Stamp `data-block-id={box.key}` on a BLOCK-LEVEL element box only (digital, 2a / F6 option (a)).
 * The caller passes a `stamp` flag that is TRUE only on the block-render path and is forced FALSE
 * the moment recursion descends into inline-expansion content (a run-wrapper OR an inline-embed
 * subtree). So this stamps iff: `stamp` is still true (no inline ancestor) AND the box is NOT an
 * inline embed AND its `display` is block-level. The inline-embed and inline-run-wrapper guards
 * here are belt-and-braces — the `stamp=false` propagation in `childStamp` already prevents any
 * inline-expansion descendant (including the inline-image inner `display:block` box, key
 * `${blockId}/inline/${i}/0`) from reaching this with `stamp=true`. The bridge walks up to the
 * nearest `[data-block-id]`, so stamping a composite inline key would corrupt every offset
 * mapping (spec C1/F6) — hence the strict block-only gate.
 */
function stampBlockId(elem: HTMLElement, box: ElementBox, stamp: boolean, display: ComputedStyle["display"]): void {
  if (!stamp) return;
  if (box.metadata?.embedType !== undefined) return; // inline embed → never data-block-id
  if (!isBlockLevelDisplay(display)) return;
  elem.setAttribute("data-block-id", box.key);
}

/** Stamp `data-inline-embed` on an inline-embed element box (digital, 2a / spec F1). */
function stampInlineEmbed(elem: HTMLElement, box: ElementBox, stamp: boolean): void {
  if (!stamp) return;
  if (box.metadata?.embedType === undefined) return;
  elem.setAttribute("data-inline-embed", "");
}

/**
 * The `stamp` flag to pass into a box's CHILD recursion. It stays TRUE only while we are on the
 * block→block path: descending into ANY inline-level box (a run-wrapper OR an inline-embed outer
 * box, both `display` inline/inline-block) forces it FALSE for the whole subtree, so no
 * inline-expansion descendant is ever stamped (F6 option (a)).
 */
function childStamp(stamp: boolean, display: ComputedStyle["display"]): boolean {
  return stamp && isBlockLevelDisplay(display);
}

function applyStyle(elem: HTMLElement, box: ElementBox): void {
  const cs: ComputedStyle | undefined = box.computedStyle;
  if (cs === undefined) return;
  const css = computedStyleToInlineStyle(cs);
  if (css !== "") {
    const existing = elem.getAttribute("style");
    elem.setAttribute("style", existing !== null && existing !== "" ? `${existing}; ${css}` : css);
  }
}

interface ListMeta { readonly level: number; readonly listId: string; readonly ordered: boolean }

// A grouped list-item carries metadata.list; anything else (or a list-item whose
// marker was unresolved) is a "plain" child appended directly.
function listMetaOf(node: RenderNode): ListMeta | undefined {
  if (node.type !== "element") return undefined;
  if ((node.computedStyle?.display ?? "block") !== "list-item") return undefined;
  return node.metadata?.list;
}

// Append each child's DOM, grouping consecutive list-items into nested
// <ul>/<ol>. Mirrors encodeListRun in html-encode.ts (string-based).
function appendChildren(parent: Node, children: readonly RenderNode[], doc: Document, stamp: boolean): void {
  // Stack of open list containers, one per nesting level (index = level).
  let stack: Array<{ el: HTMLElement; listId: string }> = [];

  for (const child of children) {
    const lm = listMetaOf(child);
    if (lm === undefined) {
      stack = []; // a non-list child ends any open list run
      const dom = renderNodeToDom(child, doc, stamp);
      if (dom !== null) parent.appendChild(dom);
      continue;
    }
    // Clamp a non-contiguous level jump (e.g. 0 -> 2) so the deeper list nests
    // under the deepest currently-open item instead of escaping to the root.
    const level = Math.min(lm.level, stack.length);
    // Pop levels deeper than this item.
    if (stack.length > level + 1) stack = stack.slice(0, level + 1);
    const atLevel = stack[level];
    if (atLevel === undefined || atLevel.listId !== lm.listId) {
      // (Re)open a list container at this level. Reset the browser's native list
      // furniture (its own inline-start padding + native marker) to zero/none: the
      // ENGINE owns the marker (rendered explicitly from `markerText`) and the indent
      // gutter (the list-item's cascaded `padding-inline-start`). Without this reset
      // the native `<ul>` padding stacks ON TOP of the engine indent and the native
      // marker hangs OUTSIDE the content boundary; and a host stylesheet's
      // `list-style: none` would silently kill the only marker.
      const listEl = doc.createElement(lm.ordered ? "ol" : "ul");
      listEl.setAttribute("style", "margin: 0; padding: 0; list-style: none");
      const mount = level > 0 ? (lastListItem(stack[level - 1]?.el) ?? parent) : parent;
      mount.appendChild(listEl);
      stack = stack.slice(0, level);
      stack[level] = { el: listEl, listId: lm.listId };
    }
    const li = doc.createElement("li");
    // The <li> carries the list-item's own cascaded block style (textAlign,
    // lineHeight, INDENT margin, writingMode, spacing, color, and the structural
    // `padding-inline-start` gutter) — same as every other ElementBox branch. Its
    // inline content recurses into the <li>.
    if (child.type === "element") {
      applyStyle(li, child);
      // `list-style: none` (host CSS may set it either way; we own the marker) +
      // `position: relative` so the marker can sit absolutely in the gutter.
      const liStyle = li.getAttribute("style");
      li.setAttribute("style", `${liStyle !== null && liStyle !== "" ? `${liStyle}; ` : ""}list-style: none; position: relative`);
      stampBlockId(li, child, stamp, "list-item");
      appendChildren(li, child.children, doc, childStamp(stamp, "list-item"));
      fillEmptyLineHost(li, "list-item", doc); // BEFORE the marker: an empty item must still get a filler
      renderListMarker(li, child.computedStyle?.markerText, doc); // generated marker (abs-pos, bridge-excluded) LAST

    }
    stack[level]?.el.appendChild(li);
  }
}

/**
 * Render the list-item's GENERATED marker — the engine-resolved `markerText` (a bullet glyph
 * like "•" or a formatted number like "1." / "v." that already encodes the document's
 * format AND ordinal, start/restart included) — exactly as the paginated path does (the BFC
 * reads the same `computedStyle.markerText`). The marker sits absolutely in the gutter the
 * list-item's `padding-inline-start` reserves (`inset-inline-start: 0` → the inline-start of
 * the `<li>`, with content flowing at the padding edge). It is `contenteditable="false"` +
 * `data-tw-marker` so it is NOT editable and the selection bridge measures it as ZERO content
 * units (generated content, zero cursor stops — the same contract as the paginated marker box).
 * Absent/empty `markerText` (a non-numbered item) emits no marker.
 */
function renderListMarker(li: HTMLElement, markerText: string | undefined, doc: Document): void {
  if (markerText === undefined || markerText === "") return;
  const marker = doc.createElement("span");
  marker.setAttribute("data-tw-marker", "");
  marker.setAttribute("contenteditable", "false");
  // `inset-block-start: 0` PINS the marker to the item's top. The marker is
  // appended LAST (after the content / the empty-line `<br>` filler), so without an
  // explicit block-start its absolute position falls back to its STATIC position —
  // which for an EMPTY item is the line AFTER the filler `<br>`, dropping the bullet
  // to the next line until content is typed. Pinning keeps it on the first line in
  // both the empty and non-empty cases.
  marker.setAttribute("style", "position: absolute; inset-inline-start: 0; inset-block-start: 0; user-select: none; pointer-events: none; white-space: nowrap");
  marker.appendChild(doc.createTextNode(markerText));
  li.appendChild(marker);
}

function lastListItem(listEl: HTMLElement | undefined): HTMLElement | null {
  if (listEl === undefined) return null;
  const items = listEl.querySelectorAll(":scope > li");
  const last = items.item(items.length - 1);
  return last instanceof HTMLElement ? last : null;
}

function textBoxToDom(box: TextBox, doc: Document): Node {
  const cs: ComputedStyle | undefined = box.computedStyle;
  const textNode = doc.createTextNode(box.text);

  // Build inline markup inside-out: text → [span style] → <s> → <u> → <em> → <strong> → <a>.
  let current: Node = textNode;
  const css = cs !== undefined ? computedStyleToInlineStyle(cs) : "";
  if (css !== "") {
    const span = doc.createElement("span");
    span.setAttribute("style", css);
    span.appendChild(current);
    current = span;
  }
  if (cs?.lineThrough === true) current = wrap(doc, "s", current);
  if (cs?.underline === true) current = wrap(doc, "u", current);
  if (cs?.fontStyle === "italic") current = wrap(doc, "em", current);
  if (cs?.fontWeight === "bold") current = wrap(doc, "strong", current);

  if (box.link !== undefined && isExportSafeLinkUrl(box.link)) {
    const a = doc.createElement("a");
    a.setAttribute("href", box.link);
    a.appendChild(current);
    current = a;
  }
  return current;
}

function wrap(doc: Document, tag: string, child: Node): HTMLElement {
  const el = doc.createElement(tag);
  el.appendChild(child);
  return el;
}
