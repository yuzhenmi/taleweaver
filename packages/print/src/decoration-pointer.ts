import type { Decoration } from "@taleweaver/core";

/**
 * A pointer event on a decoration drawn by the print backend. Same shape as
 * digital's `DecorationPointerEvent`, so a host handles both backends with one
 * handler.
 */
export interface PrintDecorationPointerEvent {
  readonly type: "enter" | "leave" | "click";
  /** The live decoration (positions mapped to the current document); for `leave`
   *  after the decoration was removed, the decoration as last seen. */
  readonly decoration: Decoration;
  /** Viewport rect of the fragment under the pointer (for `leave`, the last one
   *  seen; for block decorations, the block box; for widgets, the overlay). */
  readonly rect: DOMRect;
  /** Viewport rects of every on-screen fragment of the decoration. */
  readonly rects: readonly DOMRect[];
  readonly originalEvent: MouseEvent;
}

/** A decoration under the pointer, with the viewport rect of the fragment hit. */
export interface DecorationHit {
  readonly decoration: Decoration;
  readonly rect: DOMRect;
}

/** Where the pointer is: enough to re-hit-test after the document or set changes. */
export interface PointerProbe {
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
}

export interface DecorationPointerSource {
  /** Decoration id → the decoration + fragment under the pointer. */
  under(probe: PointerProbe): Map<string, DecorationHit>;
  /** Every on-screen fragment of `decoration` (empty when none resolves). */
  rectsOf(decoration: Decoration): DOMRect[];
}

/**
 * Hover / click tracking over painted decorations: diff the decorations under the
 * pointer to emit `enter` / `leave`, and report every decoration under a click.
 * Overlapping decorations all report. `sync()` re-hit-tests the resting pointer
 * after a document / decoration change, so a decoration removed or reflowed out
 * from under it still gets its `leave` (reported with the decoration as last seen).
 */
export function createDecorationPointer(
  container: HTMLElement,
  source: DecorationPointerSource,
  emit: (event: PrintDecorationPointerEvent) => void,
): { sync(): void; destroy(): void } {
  let hovered = new Map<string, DecorationHit>();
  let last: PointerProbe | null = null;

  function fire(type: PrintDecorationPointerEvent["type"], hit: DecorationHit, e: MouseEvent): void {
    const rects = source.rectsOf(hit.decoration);
    emit({ type, decoration: hit.decoration, rect: hit.rect, rects: rects.length > 0 ? rects : [hit.rect], originalEvent: e });
  }

  function update(next: Map<string, DecorationHit>, e: MouseEvent): void {
    for (const [id, hit] of hovered) if (!next.has(id)) fire("leave", hit, e);
    for (const [id, hit] of next) if (!hovered.has(id)) fire("enter", hit, e);
    hovered = next;
  }

  const probe = (e: MouseEvent): PointerProbe => ({ clientX: e.clientX, clientY: e.clientY, target: e.target });
  const onMove = (e: MouseEvent): void => {
    last = probe(e);
    update(source.under(last), e);
  };
  const onLeave = (e: MouseEvent): void => {
    last = null;
    update(new Map(), e);
  };
  const onClick = (e: MouseEvent): void => {
    for (const hit of source.under(probe(e)).values()) fire("click", hit, e);
  };

  container.addEventListener("mousemove", onMove);
  container.addEventListener("mouseleave", onLeave);
  container.addEventListener("click", onClick);
  return {
    sync() {
      if (last === null) return;
      // Re-derive what is under the resting pointer NOW: a canvas may have been
      // recycled to another page or a widget element rebuilt since the last move,
      // so the stored target can be stale. Fall back to it only when the engine
      // cannot hit-test (`elementFromPoint` unavailable / null).
      const doc = container.ownerDocument;
      const hitEl = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(last.clientX, last.clientY) : null;
      if (hitEl !== null) last = { clientX: last.clientX, clientY: last.clientY, target: hitEl };
      const e = new MouseEvent("mousemove", { clientX: last.clientX, clientY: last.clientY });
      update(source.under(last), e);
    },
    destroy() {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("click", onClick);
      hovered = new Map();
      last = null;
    },
  };
}
