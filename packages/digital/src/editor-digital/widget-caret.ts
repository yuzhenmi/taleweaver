import { isWidget, DECO_ID_ATTR } from "../dom-view/decorate-dom";

/**
 * Decoration widgets are `contenteditable=false` and carry zero document offsets, but the
 * browser still gives the caret a stop on each side of one — both map to the same model
 * position, so an arrow press would be "dead". Before the browser's default arrow move,
 * hop the DOM caret over any widgets directly in the direction of travel; the default
 * move then advances one real character.
 */
export function hopWidgets(selection: Selection, direction: "forward" | "backward", extend: boolean): void {
  const node = selection.focusNode;
  if (node === null) return;
  const forward = direction === "forward";
  let neighbor = adjacent(node, selection.focusOffset, forward);
  if (!isWidget(neighbor)) return;
  let last: Node = neighbor;
  for (let n: Node | null = neighbor; isWidget(n); n = forward ? n.nextSibling : n.previousSibling) last = n;
  neighbor = last;
  const parent = neighbor.parentNode;
  if (parent === null) return;
  const index = Array.prototype.indexOf.call(parent.childNodes, neighbor) + (forward ? 1 : 0);
  if (extend) selection.extend(parent, index);
  else selection.collapse(parent, index);
}

/** The node directly beside DOM point (node, offset) in the given direction, climbing out
 *  of decoration wrappers the point sits at the edge of. */
function adjacent(node: Node, offset: number, forward: boolean): Node | null {
  let cur: Node;
  if (node instanceof Text) {
    if (forward ? offset < node.length : offset > 0) return null;
    cur = node;
  } else {
    const child = node.childNodes.item(forward ? offset : offset - 1);
    return child;
  }
  while (
    (forward ? cur.nextSibling : cur.previousSibling) === null &&
    cur.parentNode instanceof HTMLElement &&
    cur.parentNode.hasAttribute(DECO_ID_ATTR)
  ) {
    cur = cur.parentNode;
  }
  return forward ? cur.nextSibling : cur.previousSibling;
}
