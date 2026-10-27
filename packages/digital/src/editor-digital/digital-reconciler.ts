import {
  asBlockId,
  getBlock,
  changedDecorationBlocks,
  EMPTY_DECORATION_SET,
  type EditorState,
  type ComponentRegistry,
  type AttrRegistry,
  type BlockId,
  type DecorationSet,
  type ElementBox,
  type RenderNode,
  type State,
} from "@taleweaver/core";
import {
  renderBlockToDom,
  renderListRunToDom,
  renderStyled,
  styledRootToDom,
  listMetaOf,
  type StyledTree,
} from "../dom-view/render-to-dom";
import { computedStyleToInlineStyle } from "../dom-view/computed-style-to-css";
import { applyBlockDecorations } from "../dom-view/decorate-dom";
import {
  createDigitalSelectionBridge,
  type DigitalSelectionBridge,
} from "./digital-selection-bridge";

export interface DigitalReconciler {
  mount(container: HTMLElement, initial: EditorState, decorations?: DecorationSet): void;
  /**
   * Bring the DOM in line with `next` (and `decorations`). Incremental whenever `next`
   * carries `lastDirtyIds`: render + cascade reuse unchanged subtrees by reference, and only
   * DOM units whose styled node changed — or whose decorations changed — are rebuilt.
   * `prev` is accepted for API symmetry; the reconciler diffs against what it last rendered.
   */
  reconcile(prev: EditorState | null, next: EditorState, isComposing: boolean, decorations?: DecorationSet): void;
  /**
   * The selection bridge this reconciler owns (created on `mount`, cleared on `destroy`), or null
   * before mount. The controller reuses it for `domToPosition` / `readDomSelection` so there is ONE
   * bridge wired to the authoritative `blockElMap` (no redundant second bridge).
   */
  getBridge(): DigitalSelectionBridge | null;
  /** True when some block's DOM was left stale under an IME composition (see `reconcile`). */
  hasPending(): boolean;
  /** The live element rendered for `blockId` (O(1)), or null. */
  blockElement(blockId: BlockId): HTMLElement | null;
  destroy(): void;
}

interface Rendered extends StyledTree {
  readonly state: State;
  readonly decorations: DecorationSet;
}

/**
 * A DOM unit: what one entry in a container's styled child list materializes as among the
 * container element's children. A block → its own element; a run of consecutive list-items →
 * ONE top-level `<ul>/<ol>` (nested levels live inside it); an unwrapped section /
 * `display:contents` box contributes its children's units directly.
 */
type Unit =
  | { readonly kind: "block"; readonly key: string; readonly node: ElementBox }
  | { readonly kind: "list"; readonly key: string; readonly items: readonly ElementBox[] };

function isUnwrapped(node: ElementBox): boolean {
  return node.metadata?.blockType === "section" || node.computedStyle?.display === "contents";
}

/** Group a styled child list into DOM units — exactly as render-to-dom's `appendChildren`. */
function unitsOf(children: readonly RenderNode[]): Unit[] {
  const out: Unit[] = [];
  let run: ElementBox[] | null = null;
  const flush = (): void => {
    if (run !== null && run[0] !== undefined) out.push({ kind: "list", key: `list:${run[0].key}`, items: run });
    run = null;
  };
  const visit = (nodes: readonly RenderNode[]): void => {
    for (const n of nodes) {
      if (n.type !== "element") continue;
      const meta = listMetaOf(n);
      if (meta !== undefined) {
        // A level-0 item of a DIFFERENT list opens a new top-level <ul>/<ol>, i.e. a new
        // unit (a run's root list is its first item's).
        const root = run?.[0] !== undefined ? listMetaOf(run[0]) : undefined;
        if (root !== undefined && meta.level === 0 && meta.listId !== root.listId) flush();
        (run ??= []).push(n);
        continue;
      }
      flush();
      if (isUnwrapped(n)) {
        visit(n.children);
        flush(); // appendChildren's list stack is local to each child list: a run never spans out of a section
      } else if ((n.computedStyle?.display ?? "block") !== "none") out.push({ kind: "block", key: n.key, node: n });
    }
  };
  visit(children);
  flush();
  return out;
}

/** What determines a container element's OWN DOM (tag + attributes), excluding children. */
function shellOf(node: ElementBox): string {
  const cs = node.computedStyle;
  return JSON.stringify([cs?.display, node.metadata ?? null, cs !== undefined ? computedStyleToInlineStyle(cs) : ""]);
}

function sameListMeta(x: ElementBox, y: ElementBox): boolean {
  const mx = listMetaOf(x);
  const my = listMetaOf(y);
  return mx?.level === my?.level && mx?.listId === my?.listId && mx?.ordered === my?.ordered;
}

function sameListStructure(a: readonly ElementBox[], b: readonly ElementBox[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.key !== y.key || !sameListMeta(x, y)) return false;
  }
  return true;
}

export function createDigitalReconciler(
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  doc: Document,
): DigitalReconciler {
  let container: HTMLElement | null = null;
  let bridge: DigitalSelectionBridge | null = null;
  let rendered: Rendered | null = null;
  const blockElMap = new Map<BlockId, HTMLElement>();
  /**
   * Block keys whose DOM an IME composition kept from being rebuilt; each is rebuilt
   * WHOLESALE (its element re-rendered from the current styled node) on the first cycle
   * that is not blocked by a composition. A container is deferred this way when a
   * structural change among its children (a removed unit, a restructured list run) touched
   * the composed block, so no stale element survives the composition.
   */
  const pending = new Set<string>();

  function indexSubtree(el: Element): void {
    const id = el.getAttribute("data-block-id");
    if (id !== null && el instanceof HTMLElement) blockElMap.set(asBlockId(id), el);
    el.querySelectorAll("[data-block-id]").forEach((child) => {
      const cid = child.getAttribute("data-block-id");
      if (cid !== null && child instanceof HTMLElement) blockElMap.set(asBlockId(cid), child);
    });
  }

  function unindexSubtree(el: Element): void {
    const drop = (e: Element): void => {
      const id = e.getAttribute("data-block-id");
      // Only drop the entry if it still points at THIS element (a replacement may already
      // have re-registered the key).
      if (id !== null && blockElMap.get(asBlockId(id)) === e) blockElMap.delete(asBlockId(id));
    };
    drop(el);
    el.querySelectorAll("[data-block-id]").forEach(drop);
  }

  function fullRebuild(state: State, decorations: DecorationSet): void {
    if (container === null) return;
    const tree = renderStyled(state, componentRegistry, attrRegistry);
    const root = styledRootToDom(tree.cascaded, doc, true, decorations);
    container.replaceChildren(root);
    blockElMap.clear();
    indexSubtree(root);
    pending.clear();
    rendered = { ...tree, state, decorations };
  }

  function mount(c: HTMLElement, initial: EditorState, decorations: DecorationSet = EMPTY_DECORATION_SET): void {
    container = c;
    const win = doc.defaultView ?? window;
    // Thread the authoritative `blockElMap` into the bridge so `positionToDom` resolves blocks via
    // an O(1) map lookup instead of an O(n) `querySelectorAll` scan per keystroke.
    bridge = createDigitalSelectionBridge(c, win, (blockId) => blockElMap.get(blockId) ?? null);
    fullRebuild(initial.state, decorations);
    bridge.positionToDom(initial.selection);
  }

  function composingBlockEl(isComposing: boolean): HTMLElement | null {
    if (!isComposing || container === null) return null;
    const win = doc.defaultView ?? window;
    const focusNode = win.getSelection()?.focusNode ?? null;
    if (focusNode === null || !container.contains(focusNode)) return null;
    // The NEAREST (innermost) block ancestor of the caret — the block actually being composed.
    let cur: Node | null = focusNode;
    while (cur !== null) {
      if (cur instanceof HTMLElement && cur.hasAttribute("data-block-id")) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  /**
   * One incremental patch cycle against the last rendered tree. Returns false when the root
   * itself had to be rebuilt from scratch (the caller's bookkeeping is then already done).
   */
  function patch(next: State, prev: Rendered, cascaded: RenderNode, decorations: DecorationSet, isComposing: boolean): boolean {
    if (container === null) return false;
    // `rebuild`: IME-deferred keys (wholesale). `redecorate`: blocks whose drawn
    // decorations changed (a leaf re-renders; a container re-applies block decorations).
    const rebuild = new Set<string>(pending);
    pending.clear();
    const redecorate = new Set<string>();
    for (const id of changedDecorationBlocks(prev.decorations, decorations)) redecorate.add(id);
    // The identity walk descends through unchanged nodes only on the path to a forced key.
    const forcePath = new Set<string>();
    for (const key of [...rebuild, ...redecorate]) {
      let id: BlockId | null = asBlockId(key);
      let guard = 0;
      while (id !== null && !forcePath.has(id) && guard++ < 10_000) {
        forcePath.add(id);
        id = getBlock(next, id)?.parentId ?? null;
      }
    }
    const composed = composingBlockEl(isComposing);
    const holdsComposition = (el: Element): boolean => composed !== null && (el === composed || el.contains(composed));
    const isLeaf = (key: string): boolean => getBlock(next, asBlockId(key))?.inlineContent != null;
    let rootRebuilt = false;

    /** Swap `oldEl` for `fresh` (re-indexing both subtrees). */
    function swap(oldEl: HTMLElement, fresh: HTMLElement): HTMLElement {
      unindexSubtree(oldEl);
      oldEl.replaceWith(fresh);
      indexSubtree(fresh);
      return fresh;
    }

    /** Replace `oldEl` with a fresh render of `node`; returns the element now in the DOM. */
    function replaceBlock(oldEl: HTMLElement, node: ElementBox): HTMLElement {
      if (holdsComposition(oldEl)) {
        pending.add(node.key); // IME guard: never rebuild under an active composition
        return oldEl;
      }
      const fresh = renderBlockToDom(node, doc, decorations);
      if (fresh === null) return oldEl;
      // A list-item's nested sub-lists are owned by the run, not the item: carry them over.
      if (listMetaOf(node) !== undefined) {
        for (const child of Array.from(oldEl.children)) {
          if (child.tagName === "UL" || child.tagName === "OL") fresh.appendChild(child);
        }
      }
      return swap(oldEl, fresh);
    }

    function patchBlock(oldNode: ElementBox, newNode: ElementBox, el: HTMLElement): HTMLElement {
      const key = newNode.key;
      if (oldNode === newNode && !forcePath.has(key)) return el;
      if (rebuild.has(key)) {
        if (key === next.rootId && !holdsComposition(el)) {
          rootRebuilt = true;
          fullRebuild(next, decorations);
          return el;
        }
        return replaceBlock(el, newNode);
      }
      if (isLeaf(key)) return oldNode === newNode && !redecorate.has(key) ? el : replaceBlock(el, newNode);
      if (shellOf(oldNode) !== shellOf(newNode)) return replaceBlock(el, newNode);
      if (redecorate.has(key)) applyBlockDecorations(el, decorations.forBlock(asBlockId(key)).block);
      patchChildren(el, key, oldNode.children, newNode.children);
      return el;
    }

    /**
     * Fast path: same child keys in the same order, and every child that needs work is a
     * plain block or a list-item whose list placement is unchanged — patch those in place
     * without grouping units. Cost: one reference comparison per child. Returns false when
     * the general unit diff is required.
     */
    function patchChildrenInPlace(oldChildren: readonly RenderNode[], newChildren: readonly RenderNode[]): boolean {
      if (oldChildren.length !== newChildren.length) return false;
      for (let i = 0; i < newChildren.length; i++) {
        const o = oldChildren[i];
        const n = newChildren[i];
        if (o === undefined || n === undefined || o.key !== n.key) return false;
        if (o === n && !forcePath.has(n.key)) continue;
        if (o.type !== "element" || n.type !== "element" || isUnwrapped(o) || isUnwrapped(n)) return false;
        if ((listMetaOf(o) !== undefined || listMetaOf(n) !== undefined) && !sameListMeta(o, n)) return false;
        const hidden = (x: ElementBox): boolean => listMetaOf(x) === undefined && (x.computedStyle?.display ?? "block") === "none";
        if (hidden(o) || hidden(n)) return false;
        // Every child we patch must already have its element (a block can lack one, e.g.
        // when a host component rendered it hidden); otherwise take the general diff.
        if (!blockElMap.has(asBlockId(n.key))) return false;
      }
      for (let i = 0; i < newChildren.length; i++) {
        const o = oldChildren[i];
        const n = newChildren[i];
        if (o === undefined || n === undefined || o.type !== "element" || n.type !== "element") continue;
        if (o === n && !forcePath.has(n.key)) continue;
        const el = blockElMap.get(asBlockId(n.key));
        if (el === undefined) continue;
        if (listMetaOf(n) !== undefined) {
          if (o !== n || redecorate.has(n.key) || rebuild.has(n.key)) replaceBlock(el, n);
        } else patchBlock(o, n, el);
      }
      return true;
    }

    function unitElement(unit: Unit, parentEl: HTMLElement): HTMLElement | null {
      const firstKey = unit.kind === "block" ? unit.key : unit.items[0]?.key;
      if (firstKey === undefined) return null;
      let el: HTMLElement | null = blockElMap.get(asBlockId(firstKey)) ?? null;
      if (unit.kind === "list") {
        while (el !== null && el.parentElement !== parentEl) el = el.parentElement;
      }
      return el !== null && el.parentElement === parentEl ? el : null;
    }

    function renderUnit(unit: Unit): HTMLElement | null {
      return unit.kind === "block" ? renderBlockToDom(unit.node, doc, decorations) : renderListRunToDom(unit.items, doc, decorations);
    }

    /** Patch an existing unit in place; null when its structure changed (re-render it). */
    function patchUnit(oldUnit: Unit, newUnit: Unit, el: HTMLElement): HTMLElement | null {
      if (oldUnit.kind === "block" && newUnit.kind === "block") {
        if (oldUnit.node.key !== newUnit.node.key) return null;
        return patchBlock(oldUnit.node, newUnit.node, el);
      }
      if (oldUnit.kind === "list" && newUnit.kind === "list" && sameListStructure(oldUnit.items, newUnit.items)) {
        newUnit.items.forEach((item, i) => {
          const old = oldUnit.items[i];
          if (old === undefined) return;
          if (old === item && !redecorate.has(item.key) && !rebuild.has(item.key)) return;
          const liEl = blockElMap.get(asBlockId(item.key));
          if (liEl !== undefined) replaceBlock(liEl, item);
        });
        return el;
      }
      return null;
    }

    function patchChildren(parentEl: HTMLElement, parentKey: string, oldChildren: readonly RenderNode[], newChildren: readonly RenderNode[]): void {
      if (patchChildrenInPlace(oldChildren, newChildren)) return;
      const oldUnits = unitsOf(oldChildren);
      const newUnits = unitsOf(newChildren);
      const oldByKey = new Map<string, Unit>();
      // Resolve every old unit's element BEFORE patching: a re-render below may re-register a
      // key (e.g. a paragraph toggled into a list-item) and would hide the old element.
      const oldEls = new Map<string, HTMLElement | null>();
      for (const u of oldUnits) {
        oldByKey.set(u.key, u);
        oldEls.set(u.key, unitElement(u, parentEl));
      }
      // A structural change that would rebuild/remove the composed block's unit is deferred:
      // the whole container is rebuilt once the composition ends.
      const deferContainer = (): void => {
        pending.add(parentKey);
      };
      const targets: HTMLElement[] = [];
      for (const nu of newUnits) {
        const ou = oldByKey.get(nu.key);
        oldByKey.delete(nu.key);
        const existing = ou !== undefined ? (oldEls.get(ou.key) ?? null) : null;
        let el: HTMLElement | null = null;
        if (ou !== undefined && existing !== null) {
          el = patchUnit(ou, nu, existing);
          if (el === null) {
            if (holdsComposition(existing)) {
              deferContainer();
              el = existing;
            } else {
              const fresh = renderUnit(nu);
              el = fresh !== null ? swap(existing, fresh) : existing;
            }
          }
        } else {
          el = renderUnit(nu);
          if (el !== null) indexSubtree(el);
        }
        if (el !== null) targets.push(el);
      }
      for (const ou of oldByKey.values()) {
        const el = oldEls.get(ou.key) ?? null;
        if (el === null) continue;
        if (holdsComposition(el)) {
          deferContainer();
          targets.push(el);
          continue;
        }
        unindexSubtree(el);
        el.remove();
      }
      // Put the unit elements in order.
      let cursor: ChildNode | null = parentEl.firstChild;
      for (const el of targets) {
        if (cursor === el) {
          cursor = el.nextSibling;
          continue;
        }
        parentEl.insertBefore(el, cursor);
      }
    }

    const rootEl = container.firstElementChild;
    if (!(rootEl instanceof HTMLElement) || prev.cascaded.type !== "element" || cascaded.type !== "element") {
      fullRebuild(next, decorations);
      return false;
    }
    patchBlock(prev.cascaded, cascaded, rootEl);
    return !rootRebuilt;
  }

  function reconcile(
    _prev: EditorState | null,
    next: EditorState,
    isComposing: boolean,
    decorations: DecorationSet = rendered?.decorations ?? EMPTY_DECORATION_SET,
  ): void {
    if (container === null || bridge === null) return;
    const prev = rendered;
    // Never write the DOM selection while an IME composition is active: it would cancel
    // or corrupt the composition. The controller re-projects it on compositionend.
    const projectSelection = (): void => {
      if (!isComposing) bridge?.positionToDom(next.selection);
    };
    if (prev === null) {
      fullRebuild(next.state, decorations);
      projectSelection();
      return;
    }
    const dirty = next.lastDirtyIds;
    const stateChanged = prev.state !== next.state;
    if (stateChanged && dirty === null) {
      // Unknown change set (document replaced): rebuild everything.
      fullRebuild(next.state, decorations);
      projectSelection();
      return;
    }
    if (!stateChanged && decorations === prev.decorations && pending.size === 0) {
      projectSelection(); // selection-only: no DOM work
      return;
    }
    const tree: StyledTree =
      stateChanged && dirty !== null
        ? renderStyled(next.state, componentRegistry, attrRegistry, undefined, { prev, prevState: prev.state, dirtyIds: dirty })
        : prev;
    if (patch(next.state, prev, tree.cascaded, decorations, isComposing)) {
      rendered = { out: tree.out, cascaded: tree.cascaded, state: next.state, decorations };
    }
    projectSelection();
  }

  function getBridge(): DigitalSelectionBridge | null {
    return bridge;
  }

  function destroy(): void {
    container = null;
    bridge = null;
    rendered = null;
    blockElMap.clear();
    pending.clear();
  }

  return {
    mount,
    reconcile,
    getBridge,
    hasPending: () => pending.size > 0,
    blockElement: (blockId) => blockElMap.get(blockId) ?? null,
    destroy,
  };
}
