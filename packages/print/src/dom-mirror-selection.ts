import type { BlockId, Position, Span, Selection as EngineSelection } from "@taleweaver/core";

/** The run wrapper element that holds a text node: nearest ancestor with data-offset-start. */
function enclosingRun(node: Node): HTMLElement | null {
  let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  while (el !== null && el instanceof HTMLElement) {
    if (el.hasAttribute("data-offset-start")) return el;
    el = el.parentNode;
  }
  return null;
}

/** Nearest ancestor (inclusive) carrying data-block-id. */
function enclosingBlockId(el: HTMLElement): BlockId | null {
  let cur: HTMLElement | null = el;
  while (cur !== null) {
    const id = cur.getAttribute("data-block-id");
    if (id !== null) return id as BlockId;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Map a browser-Selection endpoint (DOM node + offset within it) to an engine
 * Position. Returns null when the point is not inside a mirrored run.
 */
export function positionFromMirrorNode(node: Node, nodeOffset: number): Position | null {
  const run = enclosingRun(node);
  if (run === null) return null;
  const blockId = enclosingBlockId(run);
  if (blockId === null) return null;
  const startAttr = run.getAttribute("data-offset-start");
  const endAttr = run.getAttribute("data-offset-end");
  if (startAttr === null || endAttr === null) return null;
  const runStart = Number(startAttr);
  const runEnd = Number(endAttr);
  // When the endpoint is the run element itself (not its text node), nodeOffset is a
  // child index; clamp to the run's own length so we never exceed runEnd.
  const within =
    node.nodeType === Node.TEXT_NODE
      ? Math.min(nodeOffset, runEnd - runStart)
      : 0;
  return { blockId, offset: runStart + within };
}

/** Descend the run wrapper (through emphasis nesting like <strong>/<em>) to the first leaf text node. */
function findLeafText(el: HTMLElement): Text | null {
  let cur: Node | null = el.firstChild;
  while (cur !== null) {
    if (cur.nodeType === Node.TEXT_NODE) return cur as Text;
    if (cur instanceof HTMLElement) {
      const found = findLeafText(cur);
      if (found !== null) return found;
    }
    cur = cur.nextSibling;
  }
  return null;
}

/**
 * Inverse: find the text node + in-node offset for an engine Position, by scanning
 * the mirror for the run whose [runStart, runEnd] contains pos.offset under the
 * matching data-block-id. Returns null when no run covers the position.
 */
export function locateOffsetInMirror(
  mirror: HTMLElement,
  pos: Position,
): { node: Text; nodeOffset: number } | null {
  const runs = Array.from(mirror.querySelectorAll<HTMLElement>("[data-offset-start]"));
  let best: { node: Text; nodeOffset: number } | null = null;
  for (const run of runs) {
    if (enclosingBlockId(run) !== pos.blockId) continue;
    const runStart = Number(run.getAttribute("data-offset-start"));
    const runEnd = Number(run.getAttribute("data-offset-end"));
    if (pos.offset < runStart || pos.offset > runEnd) continue;
    const text = findLeafText(run);
    if (text === null) continue;
    const candidate = { node: text, nodeOffset: pos.offset - runStart };
    // Prefer the run that contains the offset strictly inside; a boundary offset
    // (offset === runEnd) is also valid but a later run with offset === runStart is
    // the canonical home, so keep scanning and let the strict-interior or
    // run-start match win.
    if (pos.offset < runEnd) return candidate;
    best = candidate;
  }
  return best;
}

/** A DOM boundary point (a text node + offset, or an element + child index). */
interface MirrorPoint {
  readonly node: Node;
  readonly nodeOffset: number;
}

/** The mirror element of block `blockId` (it carries `data-block-id`), or null. */
function blockElement(mirror: HTMLElement, blockId: BlockId): HTMLElement | null {
  for (const el of Array.from(mirror.querySelectorAll<HTMLElement>("[data-block-id]"))) {
    if (el.getAttribute("data-block-id") === blockId) return el;
  }
  return null;
}

/**
 * Does `el` mirror an OBJECT block (an image, rule, table of contents or table —
 * covered whole by a range; core `isObjectBlock`)? Reads the role vocabulary
 * `buildElement` (dom-mirror.ts) gives those blocks.
 */
function isObjectElement(el: HTMLElement): boolean {
  return el.tagName === "HR" || el.tagName === "TABLE" || el.tagName === "NAV" || el.getAttribute("role") === "img";
}

/**
 * The DOM point for an endpoint whose block has no text run. On an object block
 * (`(objectId, 0)`, covered whole) it is the boundary before the object's element
 * when the range runs on past it (`other` follows it), else the boundary after it —
 * so the DOM range covers the whole element. On an empty text block it is the
 * block's own start.
 */
function runlessPoint(el: HTMLElement, other: Node): MirrorPoint | null {
  if (!isObjectElement(el)) return { node: el, nodeOffset: 0 };
  const parent = el.parentNode;
  if (parent === null) return null;
  const index = Array.prototype.indexOf.call(parent.childNodes, el);
  const otherFollows = (el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return { node: parent, nodeOffset: otherFollows ? index : index + 1 };
}

export function placeMirrorSelection(
  mirror: HTMLElement,
  selection: EngineSelection,
  win: Window,
): void {
  let anchor: MirrorPoint | null = locateOffsetInMirror(mirror, selection.anchor);
  let focus: MirrorPoint | null = locateOffsetInMirror(mirror, selection.focus);
  // An endpoint without a text run (an object block, an empty paragraph): place
  // it by its block element. A collapsed selection there stays unmapped (an
  // object selection paints on the canvas only).
  if (selection.anchor.blockId !== selection.focus.blockId) {
    const anchorEl = anchor === null ? blockElement(mirror, selection.anchor.blockId) : null;
    const focusEl = focus === null ? blockElement(mirror, selection.focus.blockId) : null;
    const anchorOther = focus?.node ?? focusEl;
    const focusOther = anchorEl ?? anchor?.node ?? null;
    if (anchorEl !== null && anchorOther !== null) anchor = runlessPoint(anchorEl, anchorOther);
    if (focusEl !== null && focusOther !== null) focus = runlessPoint(focusEl, focusOther);
  }
  if (anchor === null || focus === null) return;
  const browser = win.getSelection();
  if (browser === null) return;
  browser.removeAllRanges();
  // setBaseAndExtent preserves anchor/focus direction; fall back to a forward range
  // when the runtime lacks it (older jsdom). Direction matters for shift-select parity.
  if (typeof browser.setBaseAndExtent === "function") {
    browser.setBaseAndExtent(anchor.node, anchor.nodeOffset, focus.node, focus.nodeOffset);
  } else {
    const range = win.document.createRange();
    range.setStart(anchor.node, anchor.nodeOffset);
    range.setEnd(focus.node, focus.nodeOffset);
    browser.addRange(range);
  }
}

export function readMirrorSelection(mirror: HTMLElement, win: Window): Span | null {
  const browser = win.getSelection();
  if (browser === null || browser.anchorNode === null || browser.focusNode === null) {
    return null;
  }
  // Only read selections that live inside the mirror.
  if (!mirror.contains(browser.anchorNode) || !mirror.contains(browser.focusNode)) {
    return null;
  }
  const anchor = positionFromMirrorNode(browser.anchorNode, browser.anchorOffset);
  const focus = positionFromMirrorNode(browser.focusNode, browser.focusOffset);
  if (anchor === null || focus === null) return null;
  return { anchor, focus };
}
