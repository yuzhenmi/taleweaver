/**
 * The browser `HtmlParser` adapter for `@taleweaver/core`'s `taleweaver-html`
 * DECODE. Core is DOM-free and walks an abstract {@link HtmlNode}; this host
 * (a DOM environment) parses the string with the browser-native `DOMParser` and
 * wraps each DOM `Node` as an `HtmlNode`. Pass `browserHtmlParser` into
 * `createHtmlDocumentSerializer({ allocator, parseHtml })` (or directly to
 * `decodeHtml`).
 *
 * Cast-free: `instanceof Element`/`HTMLElement`/`Text` narrow the DOM `Node`;
 * `getStyleProperty` only ever receives the literals `"textAlign"` / `"width"` (the
 * interface param type), read directly off the inline `style`.
 */
import type { HtmlNode, HtmlParser } from "@taleweaver/core";

/** Wrap a DOM `Node` as a DOM-free {@link HtmlNode} (children resolved lazily). */
function domToHtmlNode(node: Node): HtmlNode {
  const el = node instanceof Element ? node : null;
  const htmlEl = node instanceof HTMLElement ? node : null;
  const text = node instanceof Text ? node : null;
  return {
    kind: el !== null ? "element" : text !== null ? "text" : "other",
    tagName: el !== null ? el.tagName.toUpperCase() : "",
    getAttribute: (name) => el?.getAttribute(name) ?? null,
    get children() {
      return el !== null ? Array.from(el.children, domToHtmlNode) : [];
    },
    get childNodes() {
      return Array.from(node.childNodes, domToHtmlNode);
    },
    data: text !== null ? text.data : "",
    getStyleProperty: (prop) => {
      if (htmlEl === null) return null;
      if (prop === "textAlign") return htmlEl.style.textAlign || null;
      if (prop === "width") return htmlEl.style.width || null;
      return null;
    },
  };
}

/**
 * Parse a full HTML string with the browser-native `DOMParser` and return its
 * `<body>` as an {@link HtmlNode} (the contract `decodeHtml` walks).
 */
export const browserHtmlParser: HtmlParser = (html) =>
  domToHtmlNode(new DOMParser().parseFromString(html, "text/html").body);
