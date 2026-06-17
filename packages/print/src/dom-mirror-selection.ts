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

export function placeMirrorSelection(
  mirror: HTMLElement,
  selection: EngineSelection,
  win: Window,
): void {
  const anchor = locateOffsetInMirror(mirror, selection.anchor);
  const focus = locateOffsetInMirror(mirror, selection.focus);
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
