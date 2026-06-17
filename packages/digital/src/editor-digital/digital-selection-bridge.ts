import {
  createPosition,
  createSpan,
  type Position,
  type Span,
  type Selection,
  type BlockId,
  asBlockId,
} from "@taleweaver/core";

export interface DigitalSelectionBridge {
  readonly root: HTMLElement;
  domToPosition(node: Node, nodeOffset: number): Position | null;
  readDomSelection(): Span | null;
  positionToDom(selection: Selection): void;
}

/** True iff `el` is a recognized inline-embed atom (1 unit, no descent). */
function isInlineEmbed(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.hasAttribute("data-inline-embed");
}

/**
 * True iff `node` is the empty-line filler `<br>` the renderer appends to an EMPTY line-hosting
 * block (render-to-dom `fillEmptyLineHost`). It carries ZERO content offsets — `measure` already
 * returns 0 for it — but the caret must sit BEFORE it (`(block, 0)`), never after, which would
 * render on a phantom second line.
 */
function isEmptyLineFiller(node: Node): boolean {
  return node instanceof HTMLElement && node.tagName === "BR" && node.hasAttribute("data-tw-empty-line");
}

/**
 * True iff `node` is a GENERATED list marker — the `<span data-tw-marker>` the renderer places in a
 * list-item's gutter (render-to-dom `renderListMarker`). It mirrors the paginated marker box:
 * generated content with ZERO cursor stops. Despite carrying marker TEXT ("•"/"1."), it contributes
 * NO content offsets and is never a caret target, so every offset walk skips it.
 */
function isListMarker(node: Node): boolean {
  return node instanceof HTMLElement && node.hasAttribute("data-tw-marker");
}

/** The nearest ancestor element carrying `data-block-id`, or null. */
function enclosingBlockElement(node: Node): HTMLElement | null {
  let cur: Node | null = node instanceof Text ? node.parentNode : node;
  while (cur !== null) {
    if (cur instanceof HTMLElement && cur.hasAttribute("data-block-id")) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/** Total UTF-16 units a subtree contributes (text length; embed = 1; container = sum). */
function measure(node: Node): number {
  if (node instanceof Text) return node.length;
  if (isInlineEmbed(node)) return 1;
  if (isListMarker(node)) return 0; // generated marker: zero content units
  let total = 0;
  node.childNodes.forEach((child) => {
    total += measure(child);
  });
  return total;
}

/**
 * Walk `block`'s inline content in document order, accumulating UTF-16 units, until reaching
 * `target` (a node at `targetOffset`). Returns the absolute offset, or null if `target` is not
 * found under `block`. Embed-aware: a text node adds its `.length`, a `data-inline-embed` atom
 * adds 1 (no descent), a run-wrapper recurses.
 */
function accumulateToNode(block: HTMLElement, target: Node, targetOffset: number): number | null {
  let acc = 0;
  let found: number | null = null;

  const visit = (node: Node): void => {
    if (found !== null) return;
    if (isListMarker(node)) return; // generated marker: contributes 0, never a caret target
    if (node === target) {
      // target is this node — add its local offset, clamped to its own contribution.
      if (node instanceof Text) {
        found = acc + Math.min(targetOffset, node.length);
      } else if (isInlineEmbed(node)) {
        found = acc + Math.min(targetOffset, 1);
      } else {
        // target is a container element (block OR run-wrapper) addressed by child index →
        // sum the units contributed by children before targetOffset.
        let local = 0;
        const kids = node.childNodes;
        for (let i = 0; i < targetOffset && i < kids.length; i++) {
          const kid = kids.item(i);
          if (kid !== null) local += measure(kid);
        }
        found = acc + local;
      }
      return;
    }
    if (node instanceof Text) {
      acc += node.length;
      return;
    }
    if (isInlineEmbed(node)) {
      acc += 1;
      return;
    }
    // container (block or run-wrapper) that is NOT the target: recurse into its children.
    node.childNodes.forEach((child) => visit(child));
  };

  // Start at `block` itself so a caret addressed AT the block element (parent, childIndex) —
  // the common browser representation for a caret on an embed boundary — is handled by the
  // container branch above; otherwise we recurse into its children.
  visit(block);
  return found;
}

interface DomPoint {
  readonly node: Node;
  readonly offset: number;
}

/**
 * Locate the DOM point for an absolute `offset` within `block`'s inline content (embed-aware:
 * a text node consumes `.length`, an embed atom consumes 1 and yields a point in the PARENT
 * before/after the atom). Falls back to `(block, childCount)` for an offset past the end.
 */
function locateOffset(block: HTMLElement, offset: number): DomPoint {
  let remaining = offset;
  let result: DomPoint | null = null;

  const visit = (node: Node, parent: Node, indexInParent: number): boolean => {
    if (result !== null) return true;
    if (isListMarker(node)) return false; // generated marker: not content, skip
    if (node instanceof Text) {
      if (remaining <= node.length) {
        result = { node, offset: remaining };
        return true;
      }
      remaining -= node.length;
      return false;
    }
    if (isInlineEmbed(node)) {
      if (remaining === 0) {
        result = { node: parent, offset: indexInParent }; // point BEFORE the atom
        return true;
      }
      if (remaining === 1) {
        result = { node: parent, offset: indexInParent + 1 }; // point AFTER the atom
        return true;
      }
      remaining -= 1;
      return false;
    }
    // run-wrapper: recurse over its children
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids.item(i);
      if (kid !== null && visit(kid, node, i)) return true;
    }
    return false;
  };

  const top = block.childNodes;
  for (let i = 0; i < top.length; i++) {
    const kid = top.item(i);
    if (kid !== null && visit(kid, block, i)) break;
  }
  if (result !== null) return result;
  // An EMPTY line-hosting block carries a filler <br> (render-to-dom) for its line box; the caret
  // belongs BEFORE it at (block, 0) — landing after it would render on a phantom second line. An
  // empty LIST item also carries a generated marker span, so the filler-only check ignores markers.
  const contentKids = Array.from(block.childNodes).filter((n) => !isListMarker(n));
  if (contentKids.length === 1 && contentKids[0] !== undefined && isEmptyLineFiller(contentKids[0])) {
    return { node: block, offset: 0 };
  }
  // offset past the end, or empty block → end of the block's children.
  return { node: block, offset: block.childNodes.length };
}

/** Resolve the block element for a `BlockId`, or null. Injected by the reconciler (its `blockElMap`). */
export type BlockElementLookup = (blockId: BlockId) => HTMLElement | null;

export function createDigitalSelectionBridge(
  root: HTMLElement,
  win: Window,
  blockElementLookup?: BlockElementLookup,
): DigitalSelectionBridge {
  function domToPosition(node: Node, nodeOffset: number): Position | null {
    const block = enclosingBlockElement(node);
    if (block === null) return null;
    const rawId = block.getAttribute("data-block-id");
    if (rawId === null) return null;
    const blockId: BlockId = asBlockId(rawId);
    const offset = accumulateToNode(block, node, nodeOffset);
    if (offset === null) return null;
    return createPosition(blockId, offset);
  }

  function readDomSelection(): Span | null {
    const sel = win.getSelection();
    if (sel === null || sel.anchorNode === null || sel.focusNode === null) return null;
    if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
    const anchor = domToPosition(sel.anchorNode, sel.anchorOffset);
    const focus = domToPosition(sel.focusNode, sel.focusOffset);
    if (anchor === null || focus === null) return null;
    return createSpan(anchor, focus);
  }

  /**
   * Resolve the block element for `blockId`. Prefers the injected `blockElementLookup` (the
   * reconciler's `blockElMap`, O(1)) so `positionToDom` stays O(1)/keystroke; falls back to an
   * O(n) `[data-block-id]` scan of `root` only for a standalone bridge with no lookup (tests).
   */
  function blockElementFor(blockId: BlockId): HTMLElement | null {
    if (blockElementLookup !== undefined) return blockElementLookup(blockId);
    const nodes = root.querySelectorAll("[data-block-id]");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes.item(i);
      if (el instanceof HTMLElement && el.getAttribute("data-block-id") === blockId) return el;
    }
    return null;
  }

  function positionToDom(selection: Selection): void {
    const anchorBlock = blockElementFor(selection.anchor.blockId);
    const focusBlock = blockElementFor(selection.focus.blockId);
    if (anchorBlock === null || focusBlock === null) return; // transient during full rebuild
    const a = locateOffset(anchorBlock, selection.anchor.offset);
    const f = locateOffset(focusBlock, selection.focus.offset);
    const sel = win.getSelection();
    if (sel === null) return;
    sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  }

  return { root, domToPosition, readDomSelection, positionToDom };
}
