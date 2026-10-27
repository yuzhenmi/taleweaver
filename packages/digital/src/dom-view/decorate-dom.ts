import type { BlockDecorations, Decoration, WidgetDecoration } from "@taleweaver/core";

/**
 * DOM drawing for core decorations. Decorations are view-only: every node this
 * module creates is either a wrapper around existing document text (`data-tw-deco`) or a
 * zero-offset, non-editable widget (`data-tw-widget`), so the selection bridge's offset walk
 * and the document model are unaffected.
 */

/** Attribute on every wrapper/widget element: the decoration's id. */
export const DECO_ID_ATTR = "data-tw-deco";
/** Attribute marking a widget element (zero content offsets; skipped by the caret). Its
 *  value is the widget's side: "-1" (before its position) or "1" (after). */
export const WIDGET_ATTR = "data-tw-widget";
/** Attribute on a block element listing its block-decoration ids (space-separated). */
export const BLOCK_DECO_ATTR = "data-tw-block-deco";

/** True for engine-generated DOM that carries no content offsets (list marker, widget). */
export function isGeneratedNode(node: Node): boolean {
  return node instanceof HTMLElement && (node.hasAttribute("data-tw-marker") || node.hasAttribute(WIDGET_ATTR));
}

export function isWidget(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.hasAttribute(WIDGET_ATTR);
}

function isDecoWrapper(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.hasAttribute(DECO_ID_ATTR) && !node.hasAttribute(WIDGET_ATTR);
}

function isInlineEmbed(node: Node): boolean {
  return node instanceof HTMLElement && node.hasAttribute("data-inline-embed");
}

/** A syntactically valid attribute name (what `setAttribute` accepts without throwing). */
const ATTRIBUTE_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;

/**
 * Host attributes are applied verbatim EXCEPT invalid names and names the engine owns
 * (its `data-tw-*` markers, block/embed stamps, editability, class/style) and inline event
 * handlers — a decoration must not be able to break rendering, corrupt offset mapping or
 * change editability.
 */
function isAllowedAttribute(name: string): boolean {
  if (!ATTRIBUTE_NAME.test(name)) return false;
  const n = name.toLowerCase();
  return !(
    n.startsWith("data-tw-") ||
    n === "data-block-id" ||
    n === "data-inline-embed" ||
    n === "contenteditable" ||
    n === "class" ||
    n === "style" ||
    n.startsWith("on")
  );
}

function addClasses(el: HTMLElement, cls: string | undefined, added?: string[]): void {
  for (const c of (cls ?? "").split(/\s+/)) {
    if (c === "" || el.classList.contains(c)) continue;
    el.classList.add(c);
    added?.push(c);
  }
}

/**
 * Apply a decoration's engine visual through the CSSOM: `setProperty` validates each value
 * per property, so a value can never smuggle extra declarations into the style attribute.
 */
function applyVisual(el: HTMLElement, d: Decoration): void {
  const bg = d.style?.backgroundColor;
  if (bg !== undefined) el.style.setProperty("background-color", bg);
  const u = d.style?.underline;
  if (u !== undefined) {
    el.style.setProperty("text-decoration-line", "underline");
    el.style.setProperty("text-decoration-style", u.style ?? "solid");
    if (u.color !== undefined) el.style.setProperty("text-decoration-color", u.color);
    el.style.setProperty("text-decoration-skip-ink", "none");
  }
}

/**
 * Put host-supplied classes + attributes on `el` (decorations, inline-mark
 * `toDom`), filtering reserved / unsafe attribute names (see `isAllowedAttribute`).
 */
export function applyHostClassAndAttributes(
  el: HTMLElement,
  cls: string | undefined,
  attributes: Readonly<Record<string, string>> | undefined,
): void {
  addClasses(el, cls);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (isAllowedAttribute(name)) el.setAttribute(name, value);
  }
}

function applyAttrs(el: HTMLElement, d: Decoration): void {
  applyHostClassAndAttributes(el, d.class, d.attributes);
  applyVisual(el, d);
}

interface TextSlice {
  readonly node: Text;
  readonly start: number; // block offset of node's first unit
}

/** Text nodes of a leaf block element in offset order (embeds/generated nodes skipped). */
function collectText(root: Node): TextSlice[] {
  const out: TextSlice[] = [];
  let acc = 0;
  const visit = (node: Node): void => {
    if (node instanceof Text) {
      out.push({ node, start: acc });
      acc += node.length;
      return;
    }
    if (isGeneratedNode(node)) return;
    if (isInlineEmbed(node)) {
      acc += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return out;
}

function wrapRange(block: HTMLElement, start: number, end: number, d: Decoration, doc: Document): void {
  for (const slice of collectText(block)) {
    const nodeEnd = slice.start + slice.node.length;
    if (nodeEnd <= start || slice.start >= end || slice.node.length === 0) continue;
    let target = slice.node;
    const localStart = Math.max(0, start - slice.start);
    if (localStart > 0) target = target.splitText(localStart);
    const localEnd = Math.min(end, nodeEnd) - Math.max(start, slice.start);
    if (localEnd < target.length) target.splitText(localEnd);
    const span = doc.createElement("span");
    span.setAttribute(DECO_ID_ATTR, d.id);
    applyAttrs(span, d);
    target.replaceWith(span);
    span.appendChild(target);
  }
}

function widgetElement(w: WidgetDecoration, doc: Document): HTMLElement {
  const el = doc.createElement("span");
  el.setAttribute(DECO_ID_ATTR, w.id);
  el.setAttribute(WIDGET_ATTR, String(w.side ?? 1));
  el.setAttribute("contenteditable", "false");
  el.style.setProperty("user-select", "none");
  applyAttrs(el, w);
  const content = w.toDom?.(doc);
  if (content instanceof Node) el.appendChild(content);
  else if (w.text !== undefined) el.appendChild(doc.createTextNode(w.text));
  return el;
}

/** A DOM insertion point: before `ref` in `parent` (`ref` null = append). */
interface Point {
  readonly parent: Node;
  readonly ref: Node | null;
}

/**
 * The point right after `node`, climbed out of any decoration wrappers `node` ends
 * (widgets never nest inside another decoration's wrapper — they would inherit its look
 * and its pointer events) and past widgets already placed there (so widgets at one
 * offset keep their sorted order: side -1 before side 1).
 */
function pointAfter(node: Node): Point {
  let cur: Node = node;
  while (cur.nextSibling === null && isDecoWrapper(cur.parentNode)) cur = cur.parentNode;
  let ref: Node | null = cur.nextSibling;
  while (isWidget(ref)) ref = ref.nextSibling;
  const parent = cur.parentNode;
  return { parent: parent ?? node, ref: parent === null ? null : ref };
}

/** The point right before `node`, climbed out of decoration wrappers `node` starts. */
function pointBefore(node: Node): Point {
  let cur: Node = node;
  while (cur.previousSibling === null && isDecoWrapper(cur.parentNode)) cur = cur.parentNode;
  return { parent: cur.parentNode ?? node, ref: cur };
}

function insertWidget(block: HTMLElement, w: WidgetDecoration, doc: Document): void {
  const el = widgetElement(w, doc);
  const offset = w.at.offset;
  // One offset walk: sit right AFTER the text unit ending at `offset` (inheriting that run's
  // formatting, like typed text would), else right BEFORE the unit (text or embed) starting
  // there. Generated nodes are skipped.
  let acc = 0;
  let point: Point | null = null;
  const visit = (node: Node): void => {
    if (point !== null) return;
    if (node instanceof Text) {
      if (acc < offset && offset <= acc + node.length) {
        if (offset - acc < node.length) node.splitText(offset - acc);
        point = pointAfter(node);
      } else if (acc === offset && node.length > 0) {
        point = pointBefore(node);
      }
      acc += node.length;
      return;
    }
    if (isGeneratedNode(node)) return;
    if (isInlineEmbed(node)) {
      if (acc === offset) point = pointBefore(node);
      acc += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  block.childNodes.forEach(visit);
  if (point === null) {
    // End of content (or an empty block): after any widgets already there, before the
    // empty-line filler / list marker.
    const tail = block.querySelector(":scope > br[data-tw-empty-line], :scope > [data-tw-marker]");
    point = { parent: block, ref: tail };
  }
  const { parent, ref } = point;
  parent.insertBefore(el, ref);
}

/** Remembers which classes/attributes block decorations added, for in-place updates. */
const appliedBlockDecos = new WeakMap<HTMLElement, { classes: string[]; attrs: string[]; style: string | null }>();

/**
 * Apply a block's BLOCK decorations to its element in place (removing whatever a previous
 * call applied). Used both at render time and for container blocks whose own DOM is kept.
 */
export function applyBlockDecorations(el: HTMLElement, decos: BlockDecorations["block"]): void {
  const prev = appliedBlockDecos.get(el);
  if (prev !== undefined) {
    for (const c of prev.classes) el.classList.remove(c);
    for (const a of prev.attrs) el.removeAttribute(a);
    el.style.removeProperty("background-color");
    if (prev.style !== null) el.style.setProperty("background-color", prev.style);
    el.removeAttribute(BLOCK_DECO_ATTR);
    appliedBlockDecos.delete(el);
  }
  if (decos.length === 0) return;
  const record = { classes: [] as string[], attrs: [] as string[], style: null as string | null };
  record.style = el.style.getPropertyValue("background-color") || null;
  for (const d of decos) {
    addClasses(el, d.class, record.classes);
    for (const [name, value] of Object.entries(d.attributes ?? {})) {
      if (!isAllowedAttribute(name) || el.hasAttribute(name)) continue;
      el.setAttribute(name, value);
      record.attrs.push(name);
    }
    if (d.style?.backgroundColor !== undefined) el.style.setProperty("background-color", d.style.backgroundColor);
  }
  el.setAttribute(BLOCK_DECO_ATTR, decos.map((d) => d.id).join(" "));
  appliedBlockDecos.set(el, record);
}

/**
 * Draw `decos` into a freshly rendered block element: wrap inline ranges, insert widgets
 * (in side order), apply block decorations. Inline ranges are wrapped first; widgets are
 * then placed OUTSIDE those wrappers.
 */
export function decorateBlockElement(el: HTMLElement, decos: BlockDecorations, doc: Document): void {
  for (const seg of decos.inline) wrapRange(el, seg.start, seg.end, seg.decoration, doc);
  for (const w of decos.widgets) insertWidget(el, w, doc);
  applyBlockDecorations(el, decos.block);
}
