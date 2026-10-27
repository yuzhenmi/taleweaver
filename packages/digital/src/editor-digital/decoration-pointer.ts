import { asBlockId, type BlockId, type Decoration, type DecorationSet } from "@taleweaver/core";
import { DECO_ID_ATTR, BLOCK_DECO_ATTR } from "../dom-view/decorate-dom";

export interface DecorationPointerEvent {
  readonly type: "enter" | "leave" | "click";
  /** The live decoration (positions mapped to the current document). */
  readonly decoration: Decoration;
  /** Viewport rect of the decoration's DOM fragment under the pointer (for `leave`, its
   *  last known fragment; for block decorations, the block). */
  readonly rect: DOMRect;
  /** Viewport rects of every DOM fragment of the decoration (multi-line / multi-block). */
  readonly rects: readonly DOMRect[];
  readonly originalEvent: MouseEvent;
}

/**
 * Delegated hover/click tracking over decorated DOM. The decorations under the pointer are
 * every `data-tw-deco` wrapper/widget and every `data-tw-block-deco` block (the target's
 * block and its ancestor blocks, e.g. a flagged table cell) between the event target and
 * the container — so overlapping decorations all report.
 */
export function createDecorationPointer(
  container: HTMLElement,
  current: () => DecorationSet,
  emit: (event: DecorationPointerEvent) => void,
  blockElement: (blockId: BlockId) => HTMLElement | null,
): { sync(): void; destroy(): void } {
  /** Hovered decoration id → the element it was entered through + the decoration as last seen
   *  (so `leave` still reports after the host removed or replaced it). */
  let hovered = new Map<string, { el: HTMLElement; readonly decoration: Decoration }>();

  function idsUnder(target: EventTarget | null): Map<string, HTMLElement> {
    const out = new Map<string, HTMLElement>();
    let el: Element | null = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    while (el !== null && el !== container) {
      if (el instanceof HTMLElement) {
        const id = el.getAttribute(DECO_ID_ATTR);
        if (id !== null && !out.has(id)) out.set(id, el);
        const blockIds = el.getAttribute(BLOCK_DECO_ATTR);
        if (blockIds !== null) for (const b of blockIds.split(" ")) if (b !== "" && !out.has(b)) out.set(b, el);
      }
      el = el.parentElement;
    }
    return out;
  }

  /**
   * The live decoration `id`, found through the block `el` sits in (O(decorations in that
   * block) — this runs on every edit while something is hovered). Falls back to a scan of
   * the whole set only when `el` is no longer in the document.
   */
  function lookup(id: string, el: HTMLElement): Decoration | undefined {
    const set = current();
    let block: Element | null = container.contains(el) ? el : null;
    while (block !== null && block !== container && !block.hasAttribute("data-block-id")) block = block.parentElement;
    if (block === null || block === container) return set.decorations.find((d) => d.id === id);
    const blockId = block.getAttribute("data-block-id");
    if (blockId === null) return set.decorations.find((d) => d.id === id);
    const b = set.forBlock(asBlockId(blockId));
    return (
      b.inline.find((s) => s.decoration.id === id)?.decoration ??
      b.widgets.find((w) => w.id === id) ??
      b.block.find((k) => k.id === id) ??
      // A block decoration of an ANCESTOR block (pointer resolution walks up to the container).
      (block.parentElement !== null ? lookup(id, block.parentElement) : undefined)
    );
  }

  function rectsOf(id: string, fallback: HTMLElement): DOMRect[] {
    const out: DOMRect[] = [];
    container.querySelectorAll(`[${DECO_ID_ATTR}]`).forEach((el) => {
      if (el.getAttribute(DECO_ID_ATTR) === id) for (const r of Array.from(el.getClientRects())) out.push(r);
    });
    return out.length > 0 ? out : [fallback.getBoundingClientRect()];
  }

  /** The block id an element (possibly detached by a re-render) was drawn in. */
  function blockIdOf(el: Element): BlockId | null {
    const id = el.closest("[data-block-id]")?.getAttribute("data-block-id") ?? null;
    return id !== null ? asBlockId(id) : null;
  }

  /** The element to measure: `el` while it is still in the document, else the current
   *  fragment of the same decoration inside its (re-rendered) block — found through the
   *  reconciler's block index, never by scanning the whole document. */
  function live(id: string, el: HTMLElement): HTMLElement {
    if (container.contains(el)) return el;
    const blockId = blockIdOf(el);
    const block = blockId !== null ? blockElement(blockId) : null;
    if (block === null) return el;
    if ((block.getAttribute(BLOCK_DECO_ATTR) ?? "").split(" ").includes(id)) return block;
    for (const c of Array.from(block.querySelectorAll(`[${DECO_ID_ATTR}]`))) {
      if (c instanceof HTMLElement && c.getAttribute(DECO_ID_ATTR) === id) return c;
    }
    return el;
  }

  function emitFor(type: DecorationPointerEvent["type"], id: string, el: HTMLElement, decoration: Decoration, e: MouseEvent): void {
    const target = live(id, el);
    emit({ type, decoration, rect: target.getBoundingClientRect(), rects: rectsOf(id, target), originalEvent: e });
  }

  function update(under: Map<string, HTMLElement>, e: MouseEvent): void {
    const next = new Map<string, { el: HTMLElement; decoration: Decoration }>();
    for (const [id, el] of under) {
      const decoration = lookup(id, el);
      if (decoration !== undefined) next.set(id, { el, decoration });
    }
    for (const [id, h] of hovered) if (!next.has(id)) emitFor("leave", id, h.el, h.decoration, e);
    for (const [id, h] of next) if (!hovered.has(id)) emitFor("enter", id, h.el, h.decoration, e);
    hovered = next;
  }

  /** Drop hover state for decorations that no longer exist (host replaced the set). */
  function sync(): void {
    if (hovered.size === 0) return;
    const e = new MouseEvent("mouseleave");
    for (const [id, h] of hovered) {
      const el = live(id, h.el);
      if (lookup(id, el) === undefined) {
        hovered.delete(id);
        emitFor("leave", id, el, h.decoration, e);
      } else {
        h.el = el; // re-anchor on the re-rendered element so later syncs stay O(1)
      }
    }
  }

  const onMove = (e: MouseEvent): void => update(idsUnder(e.target), e);
  const onLeave = (e: MouseEvent): void => update(new Map(), e);
  const onClick = (e: MouseEvent): void => {
    for (const [id, el] of idsUnder(e.target)) {
      const decoration = lookup(id, el);
      if (decoration !== undefined) emitFor("click", id, el, decoration, e);
    }
  };

  container.addEventListener("mouseover", onMove);
  container.addEventListener("mouseleave", onLeave);
  container.addEventListener("click", onClick);
  return {
    sync,
    destroy() {
      container.removeEventListener("mouseover", onMove);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("click", onClick);
      hovered = new Map();
    },
  };
}
