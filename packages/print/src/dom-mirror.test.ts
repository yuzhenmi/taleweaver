import { describe, it, expect } from "vitest";
import {
  buildAccessibilityTree,
  buildDocumentFromTree,
  createTestAllocator,
  newListId,
  type AccessibilityNode,
  type BlockId,
  type BlockNode,
  type ContainerBlockNode,
  type InlineContent,
  type InlineItem,
  type ListDef,
  type TextItem,
} from "@taleweaver/core";
import { buildDomMirror, renderedTag, resolveFieldText, resolveTreeFields } from "./dom-mirror";
import { BROKEN_CROSS_REFERENCE_TEXT } from "@taleweaver/core";

const bid = (s: string): BlockId => s as BlockId;

// ─── Declarative fixture builders (mirror html-serializer.test.ts) ───
function text(s: string): TextItem {
  return { kind: "text", text: s, attrs: {} };
}
function inline(...items: InlineItem[]): InlineContent {
  return { items };
}
function para(content: InlineContent): BlockNode {
  return { type: "paragraph", inlineContent: content };
}
function heading(level: number, content: InlineContent): BlockNode {
  return { type: "heading", attrs: { level }, inlineContent: content };
}
function listItem(listId: string, listLevel: number, content: InlineContent): BlockNode {
  return { type: "list-item", attrs: { listId, listLevel }, inlineContent: content };
}
function decimalDef(): ListDef {
  return { levels: [{ style: "decimal", start: 1, restart: "always" }] };
}

describe("buildDomMirror", () => {
  it("maps a document node to a visually-hidden div[role=document] with no children", () => {
    const node: AccessibilityNode = {
      role: "document",
      sourceBlockId: bid("d1"),
      children: [],
    };
    const el = buildDomMirror(node);
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("role")).toBe("document");
    // The host is VISUALLY hidden (clip) but must stay AT-VISIBLE: aria-hidden
    // must NOT be set, or screen readers skip the whole mirror.
    expect(el.getAttribute("aria-hidden")).toBeNull();
    expect(el.style.position).toBe("absolute");
    expect(el.children.length).toBe(0);
  });

  it("accepts an injected Document (document param)", () => {
    const node: AccessibilityNode = {
      role: "document",
      sourceBlockId: null,
      children: [],
    };
    const el = buildDomMirror(node, document);
    expect(el.tagName).toBe("DIV");
  });

  it("maps a paragraph node to a <p>", () => {
    const node: AccessibilityNode = { role: "paragraph", sourceBlockId: bid("p1"), children: [] };
    expect(buildDomMirror(node).tagName).toBe("P");
  });

  it("maps heading nodes to h1–h6 by level", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const node: AccessibilityNode = { role: "heading", sourceBlockId: bid(`h${level}`), level, children: [] };
      expect(buildDomMirror(node).tagName).toBe(`H${level}`);
    }
  });

  it("defaults heading to h1 when level is absent or out-of-range", () => {
    const noLevel: AccessibilityNode = { role: "heading", sourceBlockId: null, children: [] };
    expect(buildDomMirror(noLevel).tagName).toBe("H1");
    const badLevel: AccessibilityNode = { role: "heading", sourceBlockId: null, level: 7, children: [] };
    expect(buildDomMirror(badLevel).tagName).toBe("H1");
  });

  it("appends block children in order (document containing a heading and a paragraph)", () => {
    const doc: AccessibilityNode = {
      role: "document",
      sourceBlockId: bid("d1"),
      children: [
        { role: "heading", sourceBlockId: bid("h1"), level: 1, children: [] },
        { role: "paragraph", sourceBlockId: bid("p1"), children: [] },
      ],
    };
    const el = buildDomMirror(doc);
    const child0 = el.children[0];
    const child1 = el.children[1];
    if (child0 === undefined || child1 === undefined) throw new Error("expected two children");
    expect(child0.tagName).toBe("H1");
    expect(child1.tagName).toBe("P");
  });

  it("renders a plain text run as a <span> with data-offset attrs inside a <p>", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "hello", sourceOffsetStart: 0, sourceOffsetEnd: 5 }],
      children: [],
    };
    const p = buildDomMirror(node);
    const span = p.querySelector("span");
    expect(span?.textContent).toBe("hello");
    expect(span?.getAttribute("data-offset-start")).toBe("0");
    expect(span?.getAttribute("data-offset-end")).toBe("5");
  });

  it("nests emphasis: bold+italic → <span><strong><em>text</em></strong></span>", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "hi", sourceOffsetStart: 0, sourceOffsetEnd: 2, emphasis: ["bold", "italic"] }],
      children: [],
    };
    const p = buildDomMirror(node);
    expect(p.querySelector("strong > em")?.textContent).toBe("hi");
    expect(p.querySelector("span")?.getAttribute("data-offset-start")).toBe("0");
  });

  it("nests all four emphasis marks in fixed order: strong > em > u > s", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "all", sourceOffsetStart: 0, sourceOffsetEnd: 3, emphasis: ["bold", "italic", "underline", "strikethrough"] }],
      children: [],
    };
    expect(buildDomMirror(node).querySelector("strong > em > u > s")?.textContent).toBe("all");
  });

  it("renders multiple runs in order", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [
        { text: "foo", sourceOffsetStart: 0, sourceOffsetEnd: 3 },
        { text: "bar", sourceOffsetStart: 3, sourceOffsetEnd: 6, emphasis: ["bold"] },
      ],
      children: [],
    };
    const spans = buildDomMirror(node).querySelectorAll("span");
    expect(spans.length).toBe(2);
    const span0 = spans[0];
    const span1 = spans[1];
    if (span0 === undefined || span1 === undefined) throw new Error("expected two spans");
    expect(span0.textContent).toBe("foo");
    expect(span1.querySelector("strong")?.textContent).toBe("bar");
    expect(span1.getAttribute("data-offset-start")).toBe("3");
  });

  it("renders empty text run as an empty span", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "", sourceOffsetStart: 5, sourceOffsetEnd: 6 }],
      children: [],
    };
    const span = buildDomMirror(node).querySelector("span");
    expect(span?.textContent).toBe("");
    expect(span?.getAttribute("data-offset-start")).toBe("5");
  });

  it("renders a link run as <a href> carrying offset attrs", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "click", sourceOffsetStart: 0, sourceOffsetEnd: 5, link: "https://example.com" }],
      children: [],
    };
    const p = buildDomMirror(node);
    const a = p.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("data-offset-start")).toBe("0");
    expect(a?.textContent).toBe("click");
    expect(p.querySelector("span")).toBeNull(); // <a> is the wrapper, no extra <span>
  });

  it("does not set href on a link run with a dangerous scheme (javascript: XSS guard)", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "evil", sourceOffsetStart: 0, sourceOffsetEnd: 4, link: "javascript:alert(1)" }],
      children: [],
    };
    const a = buildDomMirror(node).querySelector("a");
    expect(a).not.toBeNull(); // wrapper still present for AT semantics
    expect(a?.hasAttribute("href")).toBe(false);
    expect(a?.textContent).toBe("evil");
  });

  it("renders an insertion suggestion run as <ins>", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "added", sourceOffsetStart: 0, sourceOffsetEnd: 5, suggestion: "insertion" }],
      children: [],
    };
    const p = buildDomMirror(node);
    expect(p.querySelector("ins")?.textContent).toBe("added");
    expect(p.querySelector("ins")?.getAttribute("data-offset-start")).toBe("0");
  });

  it("renders a deletion suggestion run as <del>", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "removed", sourceOffsetStart: 0, sourceOffsetEnd: 7, suggestion: "deletion" }],
      children: [],
    };
    expect(buildDomMirror(node).querySelector("del")?.textContent).toBe("removed");
  });

  it("renders an inComment run with data-in-comment='true' on the span wrapper", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "commented", sourceOffsetStart: 0, sourceOffsetEnd: 9, inComment: true }],
      children: [],
    };
    expect(buildDomMirror(node).querySelector("span[data-in-comment='true']")?.textContent).toBe("commented");
  });

  it("renders inComment on a link run (data-in-comment on the <a> wrapper)", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "lic", sourceOffsetStart: 0, sourceOffsetEnd: 3, link: "https://x.com", inComment: true }],
      children: [],
    };
    const a = buildDomMirror(node).querySelector("a[data-in-comment='true']");
    expect(a?.getAttribute("href")).toBe("https://x.com");
  });

  it("renders a noteref run as <a role='doc-noteref' href='#<id>'>", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "", sourceOffsetStart: 3, sourceOffsetEnd: 4, noteref: bid("fn1") }],
      children: [],
    };
    const a = buildDomMirror(node).querySelector("a[role='doc-noteref']");
    expect(a?.getAttribute("href")).toBe("#fn1");
    expect(a?.getAttribute("data-offset-start")).toBe("3");
    expect(a?.getAttribute("data-offset-end")).toBe("4");
  });

  it("noteref takes priority over link when both are set", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "", sourceOffsetStart: 0, sourceOffsetEnd: 1, noteref: bid("fn2"), link: "https://x.com" }],
      children: [],
    };
    expect(buildDomMirror(node).querySelector("a[role='doc-noteref']")?.getAttribute("role")).toBe("doc-noteref");
  });

  it("renders an imageAlt run as <span role='img' aria-label='<alt>'> with empty text", () => {
    const node: AccessibilityNode = {
      role: "paragraph", sourceBlockId: bid("p1"),
      text: [{ text: "", sourceOffsetStart: 4, sourceOffsetEnd: 5, imageAlt: "a cat" }],
      children: [],
    };
    const img = buildDomMirror(node).querySelector("span[role='img']");
    expect(img?.getAttribute("aria-label")).toBe("a cat");
    expect(img?.textContent).toBe("");
    // textContent === "" passes vacuously for an empty text node; pin the actual
    // childless contract so a stray empty text child (pre-Fix-1 behavior) fails.
    expect(img?.childNodes.length).toBe(0);
    expect(img?.getAttribute("data-offset-start")).toBe("4");
    expect(img?.getAttribute("data-offset-end")).toBe("5");
  });

  it("maps an unordered list to <ul> with <li> children", () => {
    const node: AccessibilityNode = {
      role: "list", sourceBlockId: null, listOrdered: false,
      children: [
        { role: "listitem", sourceBlockId: bid("li1"), text: [{ text: "Alpha", sourceOffsetStart: 0, sourceOffsetEnd: 5 }], children: [] },
        { role: "listitem", sourceBlockId: bid("li2"), text: [{ text: "Beta", sourceOffsetStart: 0, sourceOffsetEnd: 4 }], children: [] },
      ],
    };
    const el = buildDomMirror(node);
    expect(el.tagName).toBe("UL");
    expect(el.querySelectorAll("li").length).toBe(2);
    expect(el.querySelector("li:first-child")?.textContent).toBe("Alpha");
    expect(el.querySelector("li:last-child")?.textContent).toBe("Beta");
  });

  it("maps an ordered list to <ol>", () => {
    const node: AccessibilityNode = {
      role: "list", sourceBlockId: null, listOrdered: true,
      children: [{ role: "listitem", sourceBlockId: bid("li1"), text: [{ text: "One", sourceOffsetStart: 0, sourceOffsetEnd: 3 }], children: [] }],
    };
    expect(buildDomMirror(node).tagName).toBe("OL");
  });

  it("emits <li value=N> from an ordered item's listOrdinal so AT numbers start-at/restart lists correctly (#555)", () => {
    const node: AccessibilityNode = {
      role: "list", sourceBlockId: null, listOrdered: true,
      children: [
        { role: "listitem", sourceBlockId: bid("li1"), listOrdinal: 5, text: [{ text: "Five", sourceOffsetStart: 0, sourceOffsetEnd: 4 }], children: [] },
        { role: "listitem", sourceBlockId: bid("li2"), listOrdinal: 6, text: [{ text: "Six", sourceOffsetStart: 0, sourceOffsetEnd: 3 }], children: [] },
      ],
    };
    const ol = buildDomMirror(node);
    const items = ol.querySelectorAll("li");
    expect(items[0]?.getAttribute("value")).toBe("5");
    expect(items[1]?.getAttribute("value")).toBe("6");
  });

  it("emits NO <li value> for an item without a listOrdinal (bullet / default-numbered) (#555)", () => {
    const node: AccessibilityNode = {
      role: "list", sourceBlockId: null, listOrdered: false,
      children: [{ role: "listitem", sourceBlockId: bid("li1"), text: [{ text: "x", sourceOffsetStart: 0, sourceOffsetEnd: 1 }], children: [] }],
    };
    expect(buildDomMirror(node).querySelector("li")?.hasAttribute("value")).toBe(false);
  });

  it("defaults list to <ul> when listOrdered is absent", () => {
    const node: AccessibilityNode = {
      role: "list", sourceBlockId: null,
      children: [{ role: "listitem", sourceBlockId: bid("li1"), text: [{ text: "item", sourceOffsetStart: 0, sourceOffsetEnd: 4 }], children: [] }],
    };
    expect(buildDomMirror(node).tagName).toBe("UL");
  });

  it("renders nested lists: listitem → list (ol) → listitem", () => {
    const nested: AccessibilityNode = {
      role: "list", sourceBlockId: null, listOrdered: false,
      children: [
        {
          role: "listitem", sourceBlockId: bid("li1"),
          text: [{ text: "Parent", sourceOffsetStart: 0, sourceOffsetEnd: 6 }],
          children: [
            {
              role: "list", sourceBlockId: null, listOrdered: true,
              children: [{ role: "listitem", sourceBlockId: bid("li2"), text: [{ text: "Child", sourceOffsetStart: 0, sourceOffsetEnd: 5 }], children: [] }],
            },
          ],
        },
      ],
    };
    const el = buildDomMirror(nested);
    expect(el.tagName).toBe("UL");
    expect(el.querySelector("li > ol > li")?.textContent).toBe("Child");
  });

  it("renders a table with header and data rows", () => {
    const node: AccessibilityNode = {
      role: "table", sourceBlockId: bid("t1"),
      children: [
        {
          role: "row", sourceBlockId: bid("r1"),
          children: [
            { role: "columnheader", sourceBlockId: bid("c1"), children: [{ role: "paragraph", sourceBlockId: bid("cp1"), text: [{ text: "Name", sourceOffsetStart: 0, sourceOffsetEnd: 4 }], children: [] }] },
            { role: "columnheader", sourceBlockId: bid("c2"), children: [{ role: "paragraph", sourceBlockId: bid("cp2"), text: [{ text: "Age", sourceOffsetStart: 0, sourceOffsetEnd: 3 }], children: [] }] },
          ],
        },
        {
          role: "row", sourceBlockId: bid("r2"),
          children: [
            { role: "cell", sourceBlockId: bid("c3"), children: [{ role: "paragraph", sourceBlockId: bid("cp3"), text: [{ text: "Alice", sourceOffsetStart: 0, sourceOffsetEnd: 5 }], children: [] }] },
            { role: "cell", sourceBlockId: bid("c4"), children: [{ role: "paragraph", sourceBlockId: bid("cp4"), text: [{ text: "30", sourceOffsetStart: 0, sourceOffsetEnd: 2 }], children: [] }] },
          ],
        },
      ],
    };
    const el = buildDomMirror(node);
    expect(el.tagName).toBe("TABLE");
    expect(el.querySelectorAll("tr").length).toBe(2);
    expect(el.querySelectorAll("th").length).toBe(2);
    expect(el.querySelector("th")?.getAttribute("scope")).toBe("col");
    expect(el.querySelector("th")?.textContent).toBe("Name");
    expect(el.querySelectorAll("td").length).toBe(2);
    expect(el.querySelector("tr td")?.textContent).toBe("Alice");
  });

  it("maps a row to <tr>, cell to <td>, columnheader to <th scope=col>", () => {
    expect(buildDomMirror({ role: "row", sourceBlockId: null, children: [] }).tagName).toBe("TR");
    expect(buildDomMirror({ role: "cell", sourceBlockId: null, children: [] }).tagName).toBe("TD");
    const th = buildDomMirror({ role: "columnheader", sourceBlockId: null, children: [] });
    expect(th.tagName).toBe("TH");
    expect(th.getAttribute("scope")).toBe("col");
  });

  it("maps img to <span role=img aria-label=name>", () => {
    const el = buildDomMirror({ role: "img", sourceBlockId: bid("img1"), name: "A cat", children: [] });
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("A cat");
  });

  it("sets aria-label to '' when name is '' (decorative image)", () => {
    expect(buildDomMirror({ role: "img", sourceBlockId: bid("img2"), name: "", children: [] }).getAttribute("aria-label")).toBe("");
  });

  it("sets aria-label to '' when name is absent (img v1 default)", () => {
    expect(buildDomMirror({ role: "img", sourceBlockId: bid("img3"), children: [] }).getAttribute("aria-label")).toBe("");
  });

  it("maps separator to <hr>", () => {
    expect(buildDomMirror({ role: "separator", sourceBlockId: null, children: [] }).tagName).toBe("HR");
  });

  it("maps navigation to <nav> with an aria-label from the node name (named landmark)", () => {
    const el = buildDomMirror({ role: "navigation", sourceBlockId: bid("toc"), name: "Table of contents", children: [] });
    expect(el.tagName).toBe("NAV");
    expect(el.getAttribute("aria-label")).toBe("Table of contents");
  });

  it("omits aria-label on a navigation landmark with no name (no empty label)", () => {
    const el = buildDomMirror({ role: "navigation", sourceBlockId: null, children: [] });
    expect(el.tagName).toBe("NAV");
    expect(el.hasAttribute("aria-label")).toBe(false);
  });

  it("maps banner to <header>", () => {
    expect(buildDomMirror({ role: "banner", sourceBlockId: null, children: [] }).tagName).toBe("HEADER");
  });

  it("maps contentinfo to <footer>", () => {
    expect(buildDomMirror({ role: "contentinfo", sourceBlockId: null, children: [] }).tagName).toBe("FOOTER");
  });

  it("maps doc-footnote to <section role=doc-footnote id=<sourceBlockId>>", () => {
    const el = buildDomMirror({ role: "doc-footnote", sourceBlockId: bid("fn1"), children: [] });
    expect(el.tagName).toBe("SECTION");
    expect(el.getAttribute("role")).toBe("doc-footnote");
    expect(el.id).toBe("fn1");
  });

  it("doc-footnote with null sourceBlockId has no id attribute", () => {
    expect(buildDomMirror({ role: "doc-footnote", sourceBlockId: null, children: [] }).id).toBe("");
  });

  it("noteref href resolves to the doc-footnote id (round-trip check)", () => {
    const docNode: AccessibilityNode = {
      role: "document", sourceBlockId: bid("d1"),
      children: [
        { role: "paragraph", sourceBlockId: bid("p1"), text: [{ text: "", sourceOffsetStart: 3, sourceOffsetEnd: 4, noteref: bid("fn1") }], children: [] },
        { role: "doc-footnote", sourceBlockId: bid("fn1"),
          children: [{ role: "paragraph", sourceBlockId: bid("fp1"), text: [{ text: "Footnote text.", sourceOffsetStart: 0, sourceOffsetEnd: 14 }], children: [] }] },
      ],
    };
    const mirror = buildDomMirror(docNode);
    const noterefA = mirror.querySelector("a[role='doc-noteref']");
    const footnoteSection = mirror.querySelector("section[role='doc-footnote']");
    expect(noterefA?.getAttribute("href")).toBe("#fn1");
    expect(footnoteSection?.id).toBe("fn1");
    expect(noterefA?.getAttribute("href")).toBe("#" + footnoteSection?.id);
  });

  it("stamps data-block-id on every element whose node has a sourceBlockId", () => {
    const tree: AccessibilityNode = {
      role: "paragraph",
      sourceBlockId: bid("p1"),
      children: [],
      text: [{ text: "hi", sourceOffsetStart: 0, sourceOffsetEnd: 2 }],
    };
    const el = buildDomMirror(tree, document);
    expect(el.getAttribute("data-block-id")).toBe("p1");
  });

  it("omits data-block-id on synthetic nodes (sourceBlockId === null)", () => {
    const tree: AccessibilityNode = {
      role: "list",
      sourceBlockId: null,
      listOrdered: true,
      children: [],
    };
    const el = buildDomMirror(tree, document);
    expect(el.hasAttribute("data-block-id")).toBe(false);
  });

  it("doc-footnote carries BOTH id and data-block-id (intentional dual attr)", () => {
    const tree: AccessibilityNode = {
      role: "doc-footnote",
      sourceBlockId: bid("fn1"),
      children: [],
    };
    const el = buildDomMirror(tree, document);
    expect(el.id).toBe("fn1");
    expect(el.getAttribute("data-block-id")).toBe("fn1");
  });

  it("is exported from the print barrel", async () => {
    const mod = await import("./index");
    expect(typeof mod.buildDomMirror).toBe("function");
  });
});

describe("buildDomMirror — integration with buildAccessibilityTree", () => {
  it("builds a semantic mirror from a real State accessibility tree", () => {
    const listId = newListId();
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        heading(2, inline(text("Introduction"))),
        para(inline(text("Hello world."))),
        listItem(listId, 0, inline(text("First"))),
        listItem(listId, 0, inline(text("Second"))),
      ],
    };
    const state = buildDocumentFromTree(
      root,
      { [listId]: decimalDef() },
      createTestAllocator("int"),
    );

    const tree = buildAccessibilityTree(state);
    const mirror = buildDomMirror(tree);

    expect(mirror.getAttribute("role")).toBe("document");
    expect(mirror.style.position).toBe("absolute"); // visually hidden
    expect(mirror.querySelector("h2")?.textContent).toBe("Introduction");
    expect(mirror.querySelector("p")?.textContent).toBe("Hello world.");

    // The decimal-def list classifies ordered → <ol>.
    expect(mirror.querySelector("ol")).toBeTruthy();

    // Two list-items → two <li> under ONE list element, in order.
    const lis = mirror.querySelectorAll("li");
    expect(lis.length).toBe(2);
    const li0 = lis[0];
    const li1 = lis[1];
    if (li0 === undefined || li1 === undefined) throw new Error("expected two list items");
    expect(li0.textContent).toBe("First");
    expect(li1.textContent).toBe("Second");
  });
});

describe("renderedTag (single source of truth for the reconciler's tag-match)", () => {
  const cases: AccessibilityNode[] = [
    { role: "document", sourceBlockId: null, children: [] },
    { role: "paragraph", sourceBlockId: bid("p"), children: [] },
    { role: "list", sourceBlockId: null, listOrdered: true, children: [] },
    { role: "list", sourceBlockId: null, listOrdered: false, children: [] },
    { role: "listitem", sourceBlockId: bid("li"), children: [] },
    { role: "table", sourceBlockId: bid("t"), children: [] },
    { role: "row", sourceBlockId: bid("r"), children: [] },
    { role: "cell", sourceBlockId: bid("c"), children: [] },
    { role: "columnheader", sourceBlockId: bid("ch"), children: [] },
    { role: "heading", sourceBlockId: bid("h2"), level: 2, children: [] },
    { role: "heading", sourceBlockId: bid("h5"), level: 5, children: [] },
    { role: "heading", sourceBlockId: bid("hx"), children: [] }, // no level → h1
    { role: "img", sourceBlockId: bid("im"), name: "x", children: [] },
    { role: "separator", sourceBlockId: bid("s"), children: [] },
    { role: "navigation", sourceBlockId: null, children: [] },
    { role: "banner", sourceBlockId: bid("b"), children: [] },
    { role: "contentinfo", sourceBlockId: bid("f"), children: [] },
    { role: "doc-footnote", sourceBlockId: bid("fn"), children: [] },
  ];
  for (const node of cases) {
    it(`renderedTag matches the built tag for ${node.role}/${node.level ?? ""}/${node.listOrdered ?? ""}`, () => {
      expect(renderedTag(node)).toBe(buildDomMirror(node, document).tagName.toLowerCase());
    });
  }
});

describe("resolveFieldText", () => {
  const pageCount = { text: "", sourceOffsetStart: 0, sourceOffsetEnd: 1, fieldKind: "page-count", fieldKey: "b/inline/1" } as const;
  const xref = { text: "", sourceOffsetStart: 0, sourceOffsetEnd: 1, fieldKind: "cross-ref-page", fieldKey: "b/inline/2" } as const;
  const pageNum = { text: "", sourceOffsetStart: 0, sourceOffsetEnd: 1, fieldKind: "page-number", fieldKey: "b/inline/3" } as const;
  const plain = { text: "hi", sourceOffsetStart: 0, sourceOffsetEnd: 2 } as const;

  it("fills a field run's text from resolvedFields.get(fieldKey)", () => {
    expect(resolveFieldText(pageCount, new Map([["b/inline/1", "3"]]))).toBe("3");
  });
  it("keeps the placeholder when the key is absent (page-number / non-virtual path)", () => {
    expect(resolveFieldText(pageNum, new Map([["b/inline/1", "3"]]))).toBe("");
    expect(resolveFieldText(pageCount, undefined)).toBe("");
  });
  it("maps a '' cross-ref-page value to BROKEN_CROSS_REFERENCE_TEXT", () => {
    expect(resolveFieldText(xref, new Map([["b/inline/2", ""]]))).toBe(BROKEN_CROSS_REFERENCE_TEXT);
  });
  it("does NOT substitute broken-ref text for a non-cross-ref '' value", () => {
    expect(resolveFieldText(pageCount, new Map([["b/inline/1", ""]]))).toBe("");
  });
  it("returns a non-field run's text unchanged", () => {
    expect(resolveFieldText(plain, new Map([["b/inline/1", "3"]]))).toBe("hi");
  });
});

describe("resolveTreeFields", () => {
  it("rewrites field-run text throughout the tree (incl. a DEEPLY-nested field run), leaving non-field runs intact", () => {
    // document → list → paragraph-with-field-run: the field run sits two levels
    // deep, proving the children recursion (not just document→paragraph).
    const tree: AccessibilityNode = {
      role: "document", sourceBlockId: null, children: [
        { role: "list", sourceBlockId: null, children: [
          { role: "paragraph", sourceBlockId: bid("b"), children: [], text: [
            { text: "Page ", sourceOffsetStart: 0, sourceOffsetEnd: 5 },
            { text: "", sourceOffsetStart: 5, sourceOffsetEnd: 6, fieldKind: "page-count", fieldKey: "b/inline/1" },
          ] },
        ] },
      ],
    };
    const out = resolveTreeFields(tree, new Map([["b/inline/1", "3"]]));
    const runs = out.children[0]?.children[0]?.text ?? [];
    expect(runs[0]?.text).toBe("Page ");
    expect(runs[1]?.text).toBe("3");
  });

  it("returns unchanged nodes BY REFERENCE when no field run resolves (no wasted copy)", () => {
    const tree: AccessibilityNode = {
      role: "document", sourceBlockId: null, children: [
        { role: "paragraph", sourceBlockId: bid("b"), children: [], text: [
          { text: "no fields here", sourceOffsetStart: 0, sourceOffsetEnd: 14 },
        ] },
      ],
    };
    // A field run whose key is absent from the map does not resolve → the whole
    // subtree (and the root) is returned by reference, not deep-copied.
    expect(resolveTreeFields(tree, new Map([["x/inline/9", "7"]]))).toBe(tree);
  });
});
