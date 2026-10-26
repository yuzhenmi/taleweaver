/**
 * Unit tests for `decodeHtml` — whitespace collapsing and basic structure.
 * Runs in plain Node (no DOM). A minimal recursive-descent `testParser` builds
 * `HtmlNode` objects from the small well-formed HTML strings used in these tests
 * without importing any DOM or HTML-parsing library, keeping `@taleweaver/core`
 * DOM-free.
 */
import { describe, it, expect } from "vitest";
import { decodeHtml, createTestAllocator, resolveBlock } from "../../index";
import type { HtmlNode, HtmlParser, State } from "../../index";
import type { BlockId } from "../../index";

// ---------------------------------------------------------------------------
// Minimal DOM-free HTML parser for test use
// ---------------------------------------------------------------------------

/**
 * A minimal `HtmlNode` implementation backed by a plain-object tree. Supports
 * the exact surface `decodeHtml` uses: `kind`, `tagName`, `getAttribute`,
 * `children`, `childNodes`, `data`, `getStyleProperty`.
 *
 * The parser is intentionally small (covers only well-formed test HTML), NOT a
 * general-purpose parser.
 */
class TestNode implements HtmlNode {
  readonly kind: "element" | "text" | "other";
  readonly tagName: string;
  private readonly _attrs: Map<string, string>;
  private readonly _children: TestNode[];
  private readonly _childNodes: TestNode[];
  readonly data: string;
  private readonly _style: Map<string, string>;

  constructor(
    kind: "element" | "text" | "other",
    tagName: string,
    attrs: Map<string, string>,
    childNodes: TestNode[],
    data: string,
    style: Map<string, string>,
  ) {
    this.kind = kind;
    this.tagName = tagName;
    this._attrs = attrs;
    this._childNodes = childNodes;
    this._children = childNodes.filter((n) => n.kind === "element");
    this.data = data;
    this._style = style;
  }

  getAttribute(name: string): string | null {
    return this._attrs.get(name.toLowerCase()) ?? null;
  }

  get children(): readonly HtmlNode[] {
    return this._children;
  }

  get childNodes(): readonly HtmlNode[] {
    return this._childNodes;
  }

  getStyleProperty(prop: "textAlign" | "width"): string | null {
    const cssProp = prop === "textAlign" ? "text-align" : "width";
    return this._style.get(cssProp) ?? null;
  }
}

/** Parse an inline `style` attribute string into a property map. */
function parseStyle(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (prop !== "" && val !== "") m.set(prop, val);
  }
  return m;
}

/**
 * Parse a tag's attribute string (the part after the tag name) into a Map.
 * Handles `key="value"`, `key='value'`, and bare `key`.
 */
function parseAttrs(raw: string): { attrs: Map<string, string>; style: Map<string, string> } {
  const attrs = new Map<string, string>();
  const re = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = (m[1] ?? "").toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs.set(key, val);
  }
  const styleRaw = attrs.get("style") ?? "";
  return { attrs, style: parseStyle(styleRaw) };
}

/** Void HTML elements that never have children. */
const VOID_TAGS = new Set(["BR", "HR", "IMG", "COL", "INPUT", "META", "LINK"]);

interface ParseResult {
  node: TestNode;
  end: number; // index AFTER the last consumed character
}

/**
 * Parse a single node (element or text) starting at `pos` in `html`.
 * Returns null if there is nothing more to parse (end of input or closing tag).
 */
function parseNode(html: string, pos: number): ParseResult | null {
  if (pos >= html.length) return null;

  if (html[pos] === "<") {
    // Closing tag or comment — signal caller to stop child parsing
    if (html[pos + 1] === "/" || html.slice(pos, pos + 4) === "<!--") return null;

    // Opening tag
    const gtIdx = html.indexOf(">", pos + 1);
    if (gtIdx < 0) return null;
    const tagContent = html.slice(pos + 1, gtIdx); // e.g. 'p class="foo"' or 'br/'
    const selfClose = tagContent.endsWith("/");
    const tagBody = selfClose ? tagContent.slice(0, -1).trim() : tagContent;
    const spaceIdx = tagBody.search(/\s/);
    const tagName =
      spaceIdx < 0 ? tagBody.toUpperCase() : tagBody.slice(0, spaceIdx).toUpperCase();
    const attrRaw = spaceIdx < 0 ? "" : tagBody.slice(spaceIdx + 1);
    const { attrs, style } = parseAttrs(attrRaw);

    let end = gtIdx + 1;
    const childNodes: TestNode[] = [];

    if (!selfClose && !VOID_TAGS.has(tagName)) {
      // Parse children until the matching closing tag
      let cur = end;
      while (cur < html.length) {
        // Check for closing tag
        const closingMatch = new RegExp(`^</${tagName}\\s*>`, "i").exec(html.slice(cur));
        if (closingMatch !== null) {
          cur += closingMatch[0].length;
          break;
        }
        const child = parseNode(html, cur);
        if (child === null) break;
        childNodes.push(child.node);
        cur = child.end;
      }
      end = cur;
    }

    return {
      node: new TestNode("element", tagName, attrs, childNodes, "", style),
      end,
    };
  } else {
    // Text node — consume until next '<'
    const ltIdx = html.indexOf("<", pos);
    const raw = ltIdx < 0 ? html.slice(pos) : html.slice(pos, ltIdx);
    if (raw === "") return null;
    // Decode minimal HTML entities
    const decoded = raw
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, " ");
    return {
      node: new TestNode("text", "", new Map(), [], decoded, new Map()),
      end: ltIdx < 0 ? html.length : ltIdx,
    };
  }
}

/**
 * Minimal DOM-free HTML parser implementing `HtmlParser`. Returns a synthetic
 * BODY node whose `childNodes` are the parsed top-level children.
 *
 * Handles: `<body>…</body>`, `<html><body>…</body></html>`, and bare fragments.
 */
export const testParser: HtmlParser = (html: string): HtmlNode => {
  // Find body content
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const inner: string = bodyMatch !== null ? (bodyMatch[1] ?? html) : html;

  const childNodes: TestNode[] = [];
  let pos = 0;
  while (pos < inner.length) {
    const r = parseNode(inner, pos);
    if (r === null) {
      // Skip to next '<' or end
      const next = inner.indexOf("<", pos);
      if (next < 0 || next === pos) break;
      pos = next;
      continue;
    }
    childNodes.push(r.node);
    pos = r.end;
  }

  return new TestNode("element", "BODY", new Map(), childNodes, "", new Map());
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Return ordered top-level block ids from the document root. */
function topLevelBlocks(state: State): BlockId[] {
  const root = resolveBlock(state, state.rootId)?.block;
  if (root === undefined) return [];
  const ids: BlockId[] = [];
  let id: BlockId | null = root.firstChildId ?? null;
  while (id !== null) {
    ids.push(id);
    id = resolveBlock(state, id)?.block.nextSiblingId ?? null;
  }
  return ids;
}

/** Concatenate the text of all inline text items in a block. */
function blockPlainText(state: State, id: BlockId): string {
  return (
    resolveBlock(state, id)
      ?.block.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : ""))
      .join("") ?? ""
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decodeHtml — CSS white-space:normal collapsing (G1)", () => {
  it("collapses inter-tag whitespace/newlines from real-world HTML (G1)", () => {
    const html = "<body><p>Hello\n    world</p>\n  <p>  second  </p></body>";
    const state = decodeHtml(html, createTestAllocator("ws"), testParser);
    const paras = topLevelBlocks(state);
    expect(paras.length).toBe(2); // whitespace-only inter-block text node dropped
    expect(blockPlainText(state, paras[0]!)).toBe("Hello world"); // internal run collapsed to single space
    expect(blockPlainText(state, paras[1]!)).toBe("second"); // leading/trailing trimmed at block edge
  });

  it("preserves a single significant space between inline marks", () => {
    const html = "<body><p><strong>bold</strong> <em>italic</em></p></body>";
    const state = decodeHtml(html, createTestAllocator("ws2"), testParser);
    expect(blockPlainText(state, topLevelBlocks(state)[0]!)).toBe("bold italic");
  });
});
