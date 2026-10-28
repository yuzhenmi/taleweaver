import { END_ANCHOR_ATTR } from "./render-to-dom";

/**
 * Clip the generated ¶ glyphs (a tracked ¶ / "Section Break" label, the selected-¶
 * indicator) of a paragraph inside a table cell at the cell's border box (clipped
 * as the ¶ glyph is). The glyph hangs past the content like Word's
 * ¶ and is absolutely positioned, so nothing else stops it at the cell edge; its box is
 * shrunk instead — `max-inline-size: max(0, cellInlineEnd − anchorInlineStart)` +
 * `overflow: clip` — so hit-testing, `suggestionRects` and the selected look all see the
 * clipped box.
 *
 * Measured only when layout is clean: in a `ResizeObserver` (border-box) callback on each
 * mounted block element hosting a glyph inside a `<td>` (`observe` fires an initial
 * callback; the cell edge also moves when a sibling cell, the table or the viewport
 * resizes), and after a web-font load (`document.fonts` `loadingdone` re-observes them).
 * The glyph is absolutely positioned, so writing its size never resizes the block: no
 * observer loop, no forced synchronous layout on the edit path.
 */
export interface CellClip {
  /** Observe `blockEl` if it hosts a generated glyph inside a table cell. */
  watch(blockEl: HTMLElement): void;
  disconnect(): void;
}

export function createCellClip(
  doc: Document,
  /** The block element currently mounted for a block id (a stale element is dropped). */
  isMounted: (blockEl: HTMLElement) => boolean,
): CellClip {
  const win = doc.defaultView;
  const RO = win?.ResizeObserver;
  if (win === null || RO === undefined) return { watch: () => undefined, disconnect: () => undefined }; // no layout (e.g. jsdom)
  const observed = new Set<HTMLElement>();
  const ro = new RO((entries) => {
    for (const { target } of entries) {
      if (!(target instanceof HTMLElement)) continue;
      if (!isMounted(target)) {
        ro.unobserve(target);
        observed.delete(target);
        continue;
      }
      for (const anchor of anchorsOf(target)) clipGlyph(anchor, win);
    }
  });
  const remeasure = (): void => {
    for (const el of observed) {
      ro.unobserve(el);
      ro.observe(el, { box: "border-box" });
    }
  };
  doc.fonts?.addEventListener("loadingdone", remeasure);
  return {
    watch(blockEl) {
      if (blockEl.closest("td") === null || anchorsOf(blockEl).length === 0) return;
      observed.add(blockEl);
      ro.observe(blockEl, { box: "border-box" }); // (re-)observing fires the measuring callback
    },
    disconnect() {
      ro.disconnect();
      observed.clear();
      doc.fonts?.removeEventListener("loadingdone", remeasure);
    },
  };
}

function anchorsOf(blockEl: HTMLElement): HTMLElement[] {
  return Array.from(blockEl.querySelectorAll(`:scope > [${END_ANCHOR_ATTR}]`)).filter((a): a is HTMLElement => a instanceof HTMLElement);
}

/** Write the glyph's clip from the anchor's and its cell's border-box rects (layout is clean here). */
export function clipGlyph(anchor: HTMLElement, win: Window): void {
  const glyph = anchor.firstElementChild;
  const cell = anchor.closest("td");
  if (!(glyph instanceof HTMLElement) || cell === null) return;
  const a = anchor.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  const style = win.getComputedStyle(glyph);
  const vertical = style.writingMode.startsWith("vertical");
  const rtl = style.direction === "rtl";
  // Along the glyph's inline axis: x (LTR rightwards, RTL leftwards) or y (vertical:
  // downwards, RTL upwards).
  const room = vertical ? (rtl ? a.bottom - c.top : c.bottom - a.top) : rtl ? a.right - c.left : c.right - a.left;
  glyph.style.setProperty("max-inline-size", `${Math.max(0, room)}px`);
  glyph.style.setProperty("overflow", "clip");
}
