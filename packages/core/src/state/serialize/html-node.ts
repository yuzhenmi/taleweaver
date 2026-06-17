/**
 * The DOM-free HTML-node seam for `taleweaver-html` DECODE.
 *
 * `@taleweaver/core` is headless / separately-publishable — it may NOT assume a
 * DOM (`DOMParser`) or any HTML-parsing library. So `decodeHtml` PARSES via an
 * INJECTED {@link HtmlParser} and walks this CORE-DEFINED abstract node — NOT
 * the DOM `Document`/`Element`/`Text` types. A browser host adapts a DOM `Node`
 * to {@link HtmlNode}; a server host adapts a parse5/jsdom node. Core references
 * NO DOM lib type, keeping its emitted `.d.ts` DOM-free.
 *
 * The interface covers EXACTLY the surface the decode walk uses today — no more.
 */

/**
 * A minimal, DOM-free view of a parsed HTML node — the contract `decodeHtml`
 * walks. A browser host adapts a DOM `Node` to this; a server host adapts a
 * parse5/jsdom node. Core references NO DOM lib type.
 */
export interface HtmlNode {
  /** Discriminator replacing `instanceof Text` / `instanceof Element` checks. */
  readonly kind: "element" | "text" | "other";
  /** UPPERCASE tag name for elements (e.g. "P", "STRONG"); "" for non-elements. */
  readonly tagName: string;
  /** Element attribute by name, or null. (`""`-safe; non-elements return null.) */
  getAttribute(name: string): string | null;
  /** Element children (elements ONLY) — mirrors DOM `.children`. */
  readonly children: readonly HtmlNode[];
  /** ALL child nodes incl. text — mirrors DOM `.childNodes`. */
  readonly childNodes: readonly HtmlNode[];
  /**
   * RAW character data of a TEXT node (kind "text") — mirrors DOM Text `.data`,
   * un-normalized, un-concatenated. "" for non-text nodes. This is what the
   * decode walk consumes (`node.data`), NOT element `textContent`.
   */
  readonly data: string;
  /**
   * The inline CSS properties the decode reads: `textAlign` (block alignment) and
   * `width` (a `<col>`'s column width, e.g. `"25%"`, for table decode). Returns the
   * element's inline `el.style[prop]` for an HTMLElement, else null. The host adapter
   * hard-codes these two cases cast-free — the seam stays narrow (no general CSS
   * surface) so core's `.d.ts` references no DOM type.
   */
  getStyleProperty(prop: "textAlign" | "width"): string | null;
}

/**
 * Injected HTML parser: parse a full HTML string and return the BODY as an
 * `HtmlNode` (kind "element", tagName "BODY"). The host owns the actual parse.
 */
export type HtmlParser = (html: string) => HtmlNode;
