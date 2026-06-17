import type { AccessibilityNode, AccessibilityTextRun } from "@taleweaver/core";
import { buildDomMirror, buildRunElement, renderedTag } from "./dom-mirror";

const US = "\x1f"; // unit separator (between fields)
const RS = "\x1e"; // record separator (between runs)

/**
 * Sibling-matching key. Block nodes use their globally-unique, edit-stable
 * `sourceBlockId`; synthetic container nodes (document/list/landmark — no Selection
 * anchor) use role + a per-sibling-list ordinal. `ordinals` is a fresh Map per
 * sibling list (the caller creates one and reuses it across that list's nodes).
 */
export function reconcileKey(node: AccessibilityNode, ordinals: Map<string, number>): string {
  if (node.sourceBlockId !== null) return node.sourceBlockId;
  const n = ordinals.get(node.role) ?? 0;
  ordinals.set(node.role, n + 1);
  return "#" + node.role + ":" + n;
}

/**
 * Cheap string fingerprint of a node's OWN rendered surface (NOT descendants —
 * those are reconciled recursively). Two nodes with equal fingerprints render
 * byte-identical own-content, so the reconciler can skip rebuilding their run
 * children. Covers every field `buildElement`/`buildRunElement` render per node.
 */
export function selfFingerprint(node: AccessibilityNode): string {
  const runs =
    node.text === undefined
      ? ""
      : node.text
          .map((r) =>
            [
              r.text,
              r.sourceOffsetStart,
              r.sourceOffsetEnd,
              r.emphasis === undefined ? "" : r.emphasis.join(","),
              r.link ?? "",
              r.suggestion ?? "",
              r.inComment === true ? "1" : "",
              r.noteref ?? "",
            ].join(US),
          )
          .join(RS);
  return [
    node.role,
    node.level ?? "",
    node.listOrdered === undefined ? "" : String(node.listOrdered),
    // #555: include the listitem ordinal so a renumber (start/restart change)
    // re-fingerprints and rebuilds the `<li value=N>` rather than reusing a stale one.
    node.listOrdinal ?? "",
    node.name ?? "",
    node.sourceBlockId ?? "",
    runs,
  ].join(US);
}

export type NodeElMap = Map<AccessibilityNode, HTMLElement>;

/** Top-level entry: reconcile `parentEl`'s reconciled children from `prior` to
 *  `next`, mutating in place. Returns the fresh node->el map (every node in `next`).
 *  First call passes prior=null, priorMap=null → every child is freshly built. */
export function reconcileMirror(
  parentEl: HTMLElement,
  prior: readonly AccessibilityNode[] | null,
  next: readonly AccessibilityNode[],
  priorMap: NodeElMap | null,
  doc: Document,
): NodeElMap {
  const out: NodeElMap = new Map();
  reconcileChildren(parentEl, prior, next, priorMap, out, doc);
  return out;
}

/** Build a fresh subtree for `node` AND record every node->el pair into `out`. */
function materialize(node: AccessibilityNode, doc: Document, out: NodeElMap): HTMLElement {
  const el = buildDomMirror(node, doc);
  recordSubtree(node, el, out);
  return el;
}

/** Walk node + its freshly-built el in lockstep, recording each node->el. The el's
 *  reconciled (block) children are its element children WITHOUT data-offset-start
 *  (those are run wrappers, not AccessibilityNodes); they map 1:1 to node.children. */
function recordSubtree(node: AccessibilityNode, el: HTMLElement, out: NodeElMap): void {
  out.set(node, el);
  const blockEls: HTMLElement[] = [];
  for (const c of Array.from(el.children)) {
    if (c instanceof HTMLElement && !c.hasAttribute("data-offset-start")) blockEls.push(c);
  }
  for (let i = 0; i < node.children.length; i++) {
    const childNode = node.children[i];
    const childEl = blockEls[i];
    if (childNode !== undefined && childEl !== undefined) recordSubtree(childNode, childEl, out);
  }
}

/** The first reconciled (block) child slot in `parentEl`: the first child that is
 *  NOT a run wrapper (run wrappers carry data-offset-start and are managed by
 *  rebuildRunChildren). Block children are placed at/after this slot. */
function firstBlockChildSlot(parentEl: HTMLElement): ChildNode | null {
  for (const c of Array.from(parentEl.childNodes)) {
    if (!(c instanceof HTMLElement) || !c.hasAttribute("data-offset-start")) return c;
  }
  return null;
}

function reconcileChildren(
  parentEl: HTMLElement,
  oldChildren: readonly AccessibilityNode[] | null,
  newChildren: readonly AccessibilityNode[],
  priorMap: NodeElMap | null,
  out: NodeElMap,
  doc: Document,
): void {
  const oldByKey = new Map<string, AccessibilityNode>();
  if (oldChildren !== null) {
    const oord = new Map<string, number>();
    for (const c of oldChildren) oldByKey.set(reconcileKey(c, oord), c);
  }
  let ref: ChildNode | null = firstBlockChildSlot(parentEl);
  const nord = new Map<string, number>();
  for (const nc of newChildren) {
    const k = reconcileKey(nc, nord);
    const oldNode = oldByKey.get(k);
    let el: HTMLElement;
    if (
      oldNode !== undefined &&
      priorMap !== null &&
      renderedTag(oldNode) === renderedTag(nc) &&
      priorMap.get(oldNode) !== undefined
    ) {
      // key + tag match → REUSE the element (preserves DOM identity / AT focus).
      const oldEl = priorMap.get(oldNode);
      el = oldEl === undefined ? materialize(nc, doc, out) : reconcileNode(oldEl, oldNode, nc, priorMap, out, doc);
      oldByKey.delete(k); // matched — do not delete its element below
    } else {
      // no match (insert / tag change / role change) → fresh build.
      el = materialize(nc, doc, out);
      // NOTE: if a same-key oldNode exists with a DIFFERENT tag, it stays in oldByKey
      // and its element is removed below — i.e. the tag change is a replace.
    }
    // place `el` at the current slot; insertBefore is a no-op when already in place.
    if (ref !== el) parentEl.insertBefore(el, ref);
    ref = el.nextSibling;
  }
  // remove leftover old elements (deleted blocks, or the old element of a tag change).
  for (const leftover of oldByKey.values()) {
    const e = priorMap === null ? undefined : priorMap.get(leftover);
    if (e !== undefined && e.parentNode === parentEl) e.remove();
  }
}

/** Reconcile a matched (same key + same rendered tag) node in place: rebuild its
 *  run children only if its own surface changed, then recurse into block children.
 *  The element identity is preserved (the load-bearing AT-focus anchor). */
function reconcileNode(
  el: HTMLElement,
  oldNode: AccessibilityNode,
  newNode: AccessibilityNode,
  priorMap: NodeElMap | null,
  out: NodeElMap,
  doc: Document,
): HTMLElement {
  if (selfFingerprint(oldNode) !== selfFingerprint(newNode)) {
    syncElementAttrs(el, newNode);
    rebuildRunChildren(el, newNode.text ?? [], doc);
  }
  reconcileChildren(el, oldNode.children, newNode.children, priorMap, out, doc);
  out.set(newNode, el);
  return el;
}

/**
 * Re-apply element-level attributes that `buildElement` (dom-mirror.ts) derives
 * from MUTABLE node data and that `rebuildRunChildren` does not touch (run wrappers
 * only). Must stay in lockstep with `buildElement`: any role whose element carries
 * a node-data-derived attribute that can change WITHOUT changing the rendered tag or
 * the sourceBlockId key must be patched here (otherwise a reused element keeps a
 * stale attr). `img` and `navigation` qualify — both derive `aria-label` from
 * `node.name`; `listitem` qualifies on `value` (#555, derived from the mutable
 * `listOrdinal` — a renumber changes it without changing the tag or the key).
 * (Other tag-derived attrs like list ol/ul and heading level are handled by the
 * renderedTag reuse gate; `doc-footnote`'s id is the sourceBlockId key, stable
 * across a reuse.)
 */
function syncElementAttrs(el: HTMLElement, node: AccessibilityNode): void {
  if (node.role === "img") {
    // Decorative-image convention: always write (empty name → empty label).
    el.setAttribute("aria-label", node.name ?? "");
  } else if (node.role === "navigation") {
    // Landmark convention: a name yields a label, no/empty name yields NO label
    // (an empty aria-label on a landmark is worse than none). Mirrors buildElement.
    if (node.name !== undefined && node.name !== "") {
      el.setAttribute("aria-label", node.name);
    } else {
      el.removeAttribute("aria-label");
    }
  } else if (node.role === "listitem") {
    // #555: a renumber (start/restart change) updates the ordinal on a reused
    // <li>. Removing covers ordered→unordered (ordinal disappears). Mirrors buildElement.
    if (node.listOrdinal !== undefined) {
      el.setAttribute("value", String(node.listOrdinal));
    } else {
      el.removeAttribute("value");
    }
  }
}

/** Replace `el`'s run-wrapper children (the leading data-offset-start children)
 *  with freshly-built ones, leaving any block children untouched. */
function rebuildRunChildren(el: HTMLElement, runs: readonly AccessibilityTextRun[], doc: Document): void {
  for (const c of Array.from(el.children)) {
    if (c instanceof HTMLElement && c.hasAttribute("data-offset-start")) c.remove();
  }
  const anchor = firstBlockChildSlot(el);
  for (const r of runs) {
    el.insertBefore(buildRunElement(r, doc), anchor);
  }
}
