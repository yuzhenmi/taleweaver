import {
  asBlockId,
  getBlock,
  type EditorState,
  type ComponentRegistry,
  type AttrRegistry,
  type BlockId,
} from "@taleweaver/core";
import { renderDocumentToDom } from "../dom-view/render-to-dom";
import {
  createDigitalSelectionBridge,
  type DigitalSelectionBridge,
} from "./digital-selection-bridge";

export interface DigitalReconciler {
  mount(container: HTMLElement, initial: EditorState): void;
  reconcile(prev: EditorState | null, next: EditorState, isComposing: boolean): void;
  /**
   * The selection bridge this reconciler owns (created on `mount`, cleared on `destroy`), or null
   * before mount. The controller reuses it for `domToPosition` / `readDomSelection` so there is ONE
   * bridge wired to the authoritative `blockElMap` (no redundant second bridge).
   */
  getBridge(): DigitalSelectionBridge | null;
  destroy(): void;
}

export function createDigitalReconciler(
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  doc: Document,
): DigitalReconciler {
  let container: HTMLElement | null = null;
  let bridge: DigitalSelectionBridge | null = null;
  const blockElMap = new Map<BlockId, HTMLElement>();

  function indexBlocks(scope: ParentNode): void {
    blockElMap.clear();
    scope.querySelectorAll("[data-block-id]").forEach((el) => {
      if (el instanceof HTMLElement) {
        const id = el.getAttribute("data-block-id");
        if (id !== null) blockElMap.set(asBlockId(id), el);
      }
    });
  }

  /**
   * The SINGLE source of truth for digital rendering. BOTH the full rebuild and the incremental
   * key-index build go through here so their output can never diverge: stamping options — and any
   * future render mode such as `suggestionView` (tracked-changes vs clean) — stay in lockstep by
   * construction. (Hand-rolling render→cascade→renderNodeToDom in one path and `renderDocumentToDom`
   * in the other would silently drift the moment a render mode is added to only one.)
   */
  function renderDoc(state: EditorState["state"]): HTMLElement {
    return renderDocumentToDom(state, componentRegistry, attrRegistry, doc, {
      stampBlockIds: true,
    });
  }

  function fullRebuild(state: EditorState["state"]): void {
    if (container === null) return;
    container.replaceChildren(renderDoc(state));
    indexBlocks(container);
  }

  function mount(c: HTMLElement, initial: EditorState): void {
    container = c;
    const win = doc.defaultView ?? window;
    // Thread the authoritative `blockElMap` into the bridge so `positionToDom` resolves blocks via
    // an O(1) map lookup instead of an O(n) `querySelectorAll` scan per keystroke (I1).
    bridge = createDigitalSelectionBridge(c, win, (blockId) => blockElMap.get(blockId) ?? null);
    fullRebuild(initial.state);
    bridge.positionToDom(initial.selection);
  }

  function buildKeyIndex(state: EditorState["state"]): Map<BlockId, HTMLElement> {
    // ONE render this cycle (spec F7), via the SAME `renderDoc` path as `fullRebuild` so the
    // incremental output is byte-identical to a full rebuild.
    const root = renderDoc(state);
    const index = new Map<BlockId, HTMLElement>();
    // TRAP: `querySelectorAll` matches DESCENDANTS only, so it EXCLUDES `root` itself. The document
    // root carries `data-block-id` (it is a stamped block, and is dirty on structural edits like
    // split/undo), so it must be indexed explicitly before scanning its descendants — otherwise an
    // edit whose dirty set includes the root finds no key-index entry for it.
    const rootId = root.getAttribute("data-block-id");
    if (rootId !== null) index.set(asBlockId(rootId), root);
    root.querySelectorAll("[data-block-id]").forEach((el) => {
      if (el instanceof HTMLElement) {
        const id = el.getAttribute("data-block-id");
        if (id !== null) index.set(asBlockId(id), el);
      }
    });
    return index;
  }

  /**
   * True iff some block ANCESTOR of `el` (a freshly-rendered keyIndex element) carries a
   * `data-block-id` that is itself in `dirty`. Such a descendant must NOT be replaced on its
   * own: its dirty ancestor's parent-replace already re-materializes it from the SAME render,
   * and a standalone `replaceWith` would steal the node out of the ancestor's not-yet-inserted
   * subtree (corrupting the parent-replace). Only the TOP-MOST dirty block in each ancestor
   * chain is replaced. This completes the parent-replace rule (spec F7 / Task 4.3) for the
   * universal split/undo case where the document root is dirty alongside its edited children.
   */
  function hasDirtyBlockAncestor(el: HTMLElement, dirty: ReadonlySet<BlockId>): boolean {
    let parent: HTMLElement | null =
      el.parentElement instanceof HTMLElement ? el.parentElement : null;
    while (parent !== null) {
      const id = parent.getAttribute("data-block-id");
      if (id !== null && dirty.has(asBlockId(id))) return true;
      parent = parent.parentElement instanceof HTMLElement ? parent.parentElement : null;
    }
    return false;
  }

  function composingBlockEl(isComposing: boolean): HTMLElement | null {
    if (!isComposing || container === null) return null;
    const win = doc.defaultView ?? window;
    const focusNode = win.getSelection()?.focusNode ?? null;
    if (focusNode === null || !container.contains(focusNode)) return null;
    // The NEAREST (innermost) block ancestor of the caret — the block actually being composed.
    // Walking up from focusNode (not iterating blockElMap) avoids matching an outer container
    // block (e.g. the document root, which also `contains` the focusNode).
    let cur: Node | null = focusNode;
    while (cur !== null) {
      if (cur instanceof HTMLElement && cur.hasAttribute("data-block-id")) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  /**
   * Try to insert a freshly-rendered block element into the live DOM at the position derived from
   * the block's `parentId` / `prevSiblingId` in the NEXT state (a new sibling whose parent the
   * state layer did not mark dirty — a mid-document split, or a RUN of pasted paragraphs). Placed
   * as the parent's first child when there is no prev-sibling, else AFTER the prev-sibling's live
   * element. Returns `true` when placed (or genuinely unresolvable → drop), `false` when its anchor
   * (parent or prev-sibling) is not yet in the live DOM — the caller retries to a fixpoint so a
   * contiguous run of new siblings lands in order regardless of dirty-set iteration order.
   */
  function tryInsertBlockEl(blockId: BlockId, newEl: HTMLElement, state: EditorState["state"]): boolean {
    const block = getBlock(state, blockId);
    if (block === null) return true; // not in next.state (cannot happen for a keyIndex block) → drop
    const parentEl = block.parentId !== null ? blockElMap.get(block.parentId) : null;
    if (parentEl === undefined || parentEl === null) return false; // parent not placed yet → defer
    if (block.prevSiblingId === null) {
      parentEl.insertBefore(newEl, parentEl.firstChild);
      blockElMap.set(blockId, newEl);
      return true;
    }
    const prevEl = blockElMap.get(block.prevSiblingId);
    if (prevEl !== undefined && prevEl.parentNode === parentEl) {
      parentEl.insertBefore(newEl, prevEl.nextSibling);
      blockElMap.set(blockId, newEl);
      return true;
    }
    return false; // prev-sibling not placed yet → defer
  }

  function reconcile(prev: EditorState | null, next: EditorState, isComposing: boolean): void {
    if (container === null || bridge === null) return;
    const dirty = next.lastDirtyIds;
    if (dirty === null) {
      // Full rebuild path: selection-only no-op vs real state change.
      if (prev !== null && prev.state === next.state) {
        bridge.positionToDom(next.selection); // selection-only: no DOM rebuild
        return;
      }
      fullRebuild(next.state);
      bridge.positionToDom(next.selection);
      return;
    }
    // Incremental: build the key index from ONE render this cycle, replace dirty blocks.
    const composedEl = composingBlockEl(isComposing);
    const keyIndex = buildKeyIndex(next.state);
    // A structural delta (a dirty ancestor's parent-replace materialized fresh descendant
    // elements, or a dirty block with no old/new counterpart) leaves `blockElMap` stale for the
    // affected descendants. Track it so we re-index only when needed (pure per-block replaces —
    // the common typing case — stay O(dirty), never re-scanning the whole DOM).
    let structuralDelta = false;
    // New sibling blocks (no dirty ancestor to materialize them) are collected and placed AFTER
    // the replace/remove pass, at a fixpoint — so a contiguous RUN of them (multi-line paste)
    // lands in order whatever the dirty-set iteration order.
    let toInsert: BlockId[] = [];
    for (const blockId of dirty) {
      const oldEl = blockElMap.get(blockId);
      const newEl = keyIndex.get(blockId);
      if (oldEl !== undefined && newEl !== undefined) {
        // Only replace the TOP-MOST dirty block per ancestor chain: if a dirty ancestor will
        // re-render this block as part of its own parent-replace, skip it here. Replacing a
        // descendant standalone would steal `newEl` out of its dirty ancestor's not-yet-inserted
        // subtree, corrupting the ancestor's replacement (the split/undo case where the document
        // root is dirty alongside its edited children).
        if (hasDirtyBlockAncestor(newEl, dirty)) {
          structuralDelta = true;
          continue;
        }
        if (composedEl !== null && composedEl === oldEl) continue; // IME guard
        oldEl.replaceWith(newEl);
        blockElMap.set(blockId, newEl);
        continue;
      }
      // Structural sibling delta: a NEW block (no old element) or a REMOVED block (no new
      // element) whose PARENT is not itself dirty — so no ancestor parent-replace will
      // materialize/drop it. This is the mid-document Enter (split) / Backspace (merge) / pasted
      // run case: `split-block`/merge/insert only dirty the parent when the FIRST/LAST child
      // changes, so a structural change between two existing siblings leaves the parent clean and
      // the new block(s) would never reach the DOM. Collect inserts (placed at a fixpoint below);
      // detach removes inline (order-independent). (A new/removed block that DOES have a dirty
      // ancestor is realized by that ancestor's wholesale replace — defer to it.)
      structuralDelta = true;
      if (oldEl === undefined && newEl !== undefined) {
        if (!hasDirtyBlockAncestor(newEl, dirty)) toInsert.push(blockId);
      } else if (oldEl !== undefined && newEl === undefined) {
        if (!hasDirtyBlockAncestor(oldEl, dirty)) oldEl.remove();
      }
    }
    // Place collected new siblings in dependency order: repeatedly sweep, inserting any whose
    // anchor (parent + prev-sibling) is now live and deferring the rest, until no more can be
    // placed. A run's head anchors on an existing block; each subsequent block anchors on the
    // just-placed one. A block placed (or unresolvable in next.state) is dropped from the queue.
    while (toInsert.length > 0) {
      const deferred: BlockId[] = [];
      for (const blockId of toInsert) {
        const newEl = keyIndex.get(blockId);
        if (newEl !== undefined && !tryInsertBlockEl(blockId, newEl, next.state)) {
          deferred.push(blockId); // anchor not live yet — retry next sweep
        }
      }
      if (deferred.length === toInsert.length) {
        // No progress: a block whose anchor never resolves (pathological compound delta) — fall
        // back to a safe full rebuild rather than leave the DOM desynced from state.
        fullRebuild(next.state);
        bridge.positionToDom(next.selection);
        return;
      }
      toInsert = deferred;
    }
    // After a structural delta, re-index from the live DOM so `blockElMap` tracks ancestor-replaced
    // descendants AND the just-inserted siblings' subtrees (and drops removed blocks). Pure
    // replaces skip this.
    if (structuralDelta) indexBlocks(container);
    bridge.positionToDom(next.selection);
  }

  function getBridge(): DigitalSelectionBridge | null {
    return bridge;
  }

  function destroy(): void {
    container = null;
    bridge = null;
    blockElMap.clear();
  }

  return { mount, reconcile, getBridge, destroy };
}
