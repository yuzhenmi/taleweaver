import type { DecorationAttrs, WidgetDecoration } from "@taleweaver/core";

/**
 * DOM overlay for WIDGET decorations on the canvas backend. A canvas
 * cannot host DOM inline, so each widget is an absolutely-positioned element in an
 * overlay layer inside the controller's container, placed at the caret rect of its
 * position. Widgets occupy ZERO document offsets: they are not in the document,
 * the caret / hit-test never see them, and copy never includes them (they are
 * `user-select: none` and live outside the focus host). They do NOT reflow text —
 * a widget overlays the text after its anchor.
 */

/** Attribute on every widget element: the decoration's id (same name digital uses). */
export const DECO_ID_ATTR = "data-tw-deco";
/** Attribute marking a widget element. */
export const WIDGET_ATTR = "data-tw-widget";

/** Container-local placement of a widget: the caret rect of its anchor. */
export interface WidgetPlacement {
  readonly left: number;
  readonly top: number;
  readonly height: number;
}

/** One drawn instance of a widget. A widget in a header/footer body has one
 *  instance per page showing that body, hence the separate `key`. */
export interface PlacedWidget {
  readonly key: string;
  readonly widget: WidgetDecoration;
  readonly placement: WidgetPlacement;
}

export interface WidgetOverlay {
  /**
   * Draw exactly `placed` (re-using each element whose look is unchanged) at its
   * placement; instances not listed (anchor off-screen, widget removed) are removed.
   */
  sync(placed: readonly PlacedWidget[]): void;
  /** The widget instance element containing `target`, if any. */
  widgetAt(target: EventTarget | null): { readonly widget: WidgetDecoration; readonly el: HTMLElement } | null;
  /** Every live element drawing widget `id` (one per visible instance). */
  elements(id: string): HTMLElement[];
  destroy(): void;
}

/**
 * Host attributes are applied verbatim EXCEPT names the engine owns (`data-tw-*`
 * markers, block/embed stamps, editability, class/style) and inline event
 * handlers — the same reserved set digital's `decorate-dom` filters.
 */
export function isReservedAttribute(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.startsWith("data-tw-") ||
    n === "data-block-id" ||
    n === "data-inline-embed" ||
    n === "contenteditable" ||
    n === "class" ||
    n === "style" ||
    n.startsWith("on")
  );
}

/** CSS for a decoration's engine visual (`DecorationStyle`) — mirrors digital. */
export function decorationStyleCss(attrs: DecorationAttrs): string {
  const parts: string[] = [];
  const bg = attrs.style?.backgroundColor;
  if (bg !== undefined) parts.push(`background-color: ${bg}`);
  const u = attrs.style?.underline;
  if (u !== undefined) {
    parts.push("text-decoration-line: underline");
    parts.push(`text-decoration-style: ${u.style ?? "solid"}`);
    if (u.color !== undefined) parts.push(`text-decoration-color: ${u.color}`);
    parts.push("text-decoration-skip-ink: none");
  }
  return parts.join("; ");
}

function recordEqual(a: Readonly<Record<string, string>> | undefined, b: Readonly<Record<string, string>> | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** Whether two widgets render the same element (position is applied separately). */
function sameWidgetLook(a: WidgetDecoration, b: WidgetDecoration): boolean {
  return (
    a === b ||
    (a.text === b.text &&
      a.toDom === b.toDom &&
      a.class === b.class &&
      (a.side ?? 1) === (b.side ?? 1) &&
      a.style?.backgroundColor === b.style?.backgroundColor &&
      a.style?.underline?.color === b.style?.underline?.color &&
      a.style?.underline?.style === b.style?.underline?.style &&
      (a.style?.underline === undefined) === (b.style?.underline === undefined) &&
      recordEqual(a.attributes, b.attributes))
  );
}

function buildWidget(w: WidgetDecoration, doc: Document): HTMLElement {
  const el = doc.createElement("span");
  el.setAttribute(DECO_ID_ATTR, w.id);
  el.setAttribute(WIDGET_ATTR, "");
  el.setAttribute("contenteditable", "false");
  const css = decorationStyleCss(w);
  el.setAttribute(
    "style",
    `position: absolute; white-space: pre; user-select: none; pointer-events: auto${css !== "" ? `; ${css}` : ""}`,
  );
  if (w.class !== undefined) for (const c of w.class.split(/\s+/)) if (c !== "") el.classList.add(c);
  for (const [name, value] of Object.entries(w.attributes ?? {})) {
    if (!isReservedAttribute(name)) el.setAttribute(name, value);
  }
  const content = w.toDom?.(doc);
  if (content instanceof Node) el.appendChild(content);
  else if (w.text !== undefined) el.appendChild(doc.createTextNode(w.text));
  return el;
}

export function createWidgetOverlay(container: HTMLElement): WidgetOverlay {
  const doc = container.ownerDocument;
  const layer = doc.createElement("div");
  layer.setAttribute("data-tw-widget-layer", "");
  layer.style.position = "absolute";
  layer.style.left = "0";
  layer.style.top = "0";
  layer.style.width = "0";
  layer.style.height = "0";
  layer.style.overflow = "visible";
  layer.style.pointerEvents = "none";
  layer.style.zIndex = "1";
  container.appendChild(layer);
  const live = new Map<string, { widget: WidgetDecoration; el: HTMLElement }>();
  const byElement = new WeakMap<HTMLElement, WidgetDecoration>();

  return {
    sync(placed) {
      const seen = new Set<string>();
      for (const { key, widget: w, placement: p } of placed) {
        seen.add(key);
        const prev = live.get(key);
        let el: HTMLElement;
        if (prev === undefined || !sameWidgetLook(prev.widget, w)) {
          el = buildWidget(w, doc);
          if (prev !== undefined) prev.el.replaceWith(el);
          else layer.appendChild(el);
        } else {
          el = prev.el;
        }
        live.set(key, { widget: w, el });
        byElement.set(el, w);
        const s = el.style;
        s.left = `${p.left}px`;
        s.top = `${p.top}px`;
        s.height = `${p.height}px`;
        s.lineHeight = `${p.height}px`;
        // side -1: the widget sits BEFORE its anchor — its end edge at the caret.
        s.transform = (w.side ?? 1) === -1 ? "translateX(-100%)" : "";
      }
      for (const [key, entry] of live) {
        if (!seen.has(key)) {
          entry.el.remove();
          live.delete(key);
        }
      }
    },
    widgetAt(target) {
      let el: Element | null = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      while (el !== null && el !== layer) {
        if (el instanceof HTMLElement && el.hasAttribute(WIDGET_ATTR)) {
          const widget = byElement.get(el);
          if (widget !== undefined && el.isConnected) return { widget, el };
        }
        el = el.parentElement;
      }
      return null;
    },
    elements(id) {
      const out: HTMLElement[] = [];
      for (const { widget, el } of live.values()) if (widget.id === id) out.push(el);
      return out;
    },
    destroy() {
      layer.remove();
      live.clear();
    },
  };
}
