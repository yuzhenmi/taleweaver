/**
 * Pure `encodeHtml(state)` unit tests (node env — NO DOM). ENCODE is
 * platform-agnostic (no parser), so its coverage lives in core; the round-trip /
 * decode coverage stays in a jsdom host (`@taleweaver/print`'s
 * `html-serializer.test.ts`) where a real `DOMParser` backs `browserHtmlParser`.
 *
 * These tests lock the representative encode mappings (block types, inline
 * formats, lists, embeds, link sanitization) and the dev-warn prefix
 * (`[@taleweaver/core]`) emitted when a content-bearing embed is dropped.
 */
import { TEST_RESOLVER } from "../../test-utils/document-builders";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildDocumentFromTree,
  createTestAllocator,
  encodeHtml,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  type Document,
  type BlockNode,
  type ContainerBlockNode,
  type InlineItem,
  type ListDef,
} from "../../index";

function buildDocument(
  children: BlockNode[],
  listDefs: Record<string, ListDef> = {},
): Document {
  const root: ContainerBlockNode = { type: "document", children };
  return buildDocumentFromTree(root, listDefs, createTestAllocator("enc"), TEST_RESOLVER);
}

function text(s: string, attrs: Record<string, unknown> = {}): InlineItem {
  return { kind: "text", text: s, attrs };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encodeHtml — pure encode mappings", () => {
  it("encodes paragraphs and headings", () => {
    const html = encodeHtml(
      buildDocument([
        { type: "heading", attrs: { level: 2 }, inlineContent: { items: [text("Title")] } },
        { type: "paragraph", inlineContent: { items: [text("Body")] } },
      ]),
    );
    expect(html).toBe("<body><h2>Title</h2><p>Body</p></body>");
  });

  it("encodes a horizontal line", () => {
    const html = encodeHtml(
      buildDocument([{ type: "horizontal-line", inlineContent: { items: [] } }]),
    );
    // Invariant I: a paragraph always follows an object, so the
    // flow's mandatory final ¶ encodes as an empty paragraph (Word emits one too).
    expect(html).toBe("<body><hr><p></p></body>");
  });

  it("escapes HTML-significant text characters", () => {
    const html = encodeHtml(
      buildDocument([{ type: "paragraph", inlineContent: { items: [text(`a & b < c > "d"`)] } }]),
    );
    expect(html).toBe(`<body><p>a &amp; b &lt; c &gt; &quot;d&quot;</p></body>`);
  });

  it("wraps inline marks innermost→outermost (link outermost)", () => {
    const html = encodeHtml(
      buildDocument([
        {
          type: "paragraph",
          inlineContent: {
            items: [
              text("x", {
                bold: true,
                italic: true,
                underline: true,
                strikethrough: true,
                link: "https://example.com",
              }),
            ],
          },
        },
      ]),
    );
    expect(html).toBe(
      `<body><p><a href="https://example.com"><strong><em><u><s>x</s></u></em></strong></a></p></body>`,
    );
  });

  it("drops the <a> wrapper for a dangerous-scheme link (keeps the text)", () => {
    const html = encodeHtml(
      buildDocument([
        {
          type: "paragraph",
          inlineContent: { items: [text("click", { link: "javascript:alert(1)" })] },
        },
      ]),
    );
    expect(html).toBe("<body><p>click</p></body>");
  });

  it("encodes a consecutive list run into a single <ul>", () => {
    const listId = "L1";
    const html = encodeHtml(
      buildDocument(
        [
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("a")] } },
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("b")] } },
        ],
        { [listId]: { levels: [{ style: "disc", start: 1, restart: "always" }] } },
      ),
    );
    expect(html).toBe("<body><ul><li>a</li><li>b</li></ul></body>");
  });

  it("encodes a plain decimal ordered list with NO start/value (the natural 1,2,… sequence)", () => {
    const listId = "L1";
    const html = encodeHtml(
      buildDocument(
        [
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("a")] } },
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("b")] } },
        ],
        { [listId]: { levels: [{ style: "decimal", start: 1, restart: "after-break" }] } },
      ),
    );
    expect(html).toBe("<body><ol><li>a</li><li>b</li></ol></body>");
  });

  it("emits <ol start=N> when an ordered list's level starts at N≠1 (#552)", () => {
    const listId = "L1";
    const html = encodeHtml(
      buildDocument(
        [
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("a")] } },
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("b")] } },
        ],
        { [listId]: { levels: [{ style: "decimal", start: 5, restart: "after-break" }] } },
      ),
    );
    // start=5 sets the first <li> to 5; the second continues to 6 naturally (no per-item value).
    expect(html).toBe(`<body><ol start="5"><li>a</li><li>b</li></ol></body>`);
  });

  it("emits <ol start=N> on a NESTED ordered-list level (#552)", () => {
    // Exercises the deepest-open `start` path: the nested <ol> opens from inside
    // the going-deeper loop, so only it (not the level-0 <ol>) carries the start.
    const listId = "L1";
    const html = encodeHtml(
      buildDocument(
        [
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("a")] } },
          { type: "list-item", attrs: { listId, listLevel: 1 }, inlineContent: { items: [text("b")] } },
          { type: "list-item", attrs: { listId, listLevel: 1 }, inlineContent: { items: [text("c")] } },
        ],
        {
          [listId]: {
            levels: [
              { style: "decimal", start: 1, restart: "after-break" },
              { style: "decimal", start: 3, restart: "after-break" },
            ],
          },
        },
      ),
    );
    // nested <ol> starts at 3; c continues to 4 naturally (no per-item value).
    expect(html).toBe(`<body><ol><li>a<ol start="3"><li>b</li><li>c</li></ol></li></ol></body>`);
  });

  it("emits <li value=N> for a mid-list counter restart/override (#552)", () => {
    const listId = "L1";
    const html = encodeHtml(
      buildDocument(
        [
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("a")] } },
          {
            type: "list-item",
            attrs: { listId, listLevel: 0, listCounterOverride: 5 },
            inlineContent: { items: [text("b")] },
          },
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("c")] } },
        ],
        { [listId]: { levels: [{ style: "decimal", start: 1, restart: "after-break" }] } },
      ),
    );
    // a=1 (natural), b overrides to 5 (breaks the sequence → explicit value), c continues to 6.
    expect(html).toBe(
      `<body><ol><li>a</li><li value="5">b</li><li>c</li></ol></body>`,
    );
  });

  it("does NOT emit start/value on an unordered (<ul>) list even if numbering resolves values", () => {
    const listId = "L1";
    const html = encodeHtml(
      buildDocument(
        [
          { type: "list-item", attrs: { listId, listLevel: 0 }, inlineContent: { items: [text("a")] } },
          {
            type: "list-item",
            attrs: { listId, listLevel: 0, listCounterOverride: 9 },
            inlineContent: { items: [text("b")] },
          },
        ],
        { [listId]: { levels: [{ style: "disc", start: 3, restart: "after-break" }] } },
      ),
    );
    expect(html).toBe("<body><ul><li>a</li><li>b</li></ul></body>");
  });
});

describe("encodeHtml — dev-warn on dropped content-bearing embed", () => {
  it("emits a `[@taleweaver/core]`-prefixed warning when a footnote anchor is dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const document = buildDocument([
      {
        type: "paragraph",
        inlineContent: {
          items: [
            text("before "),
            {
              kind: "embed",
              embedType: FOOTNOTE_ANCHOR_EMBED_TYPE,
              attrs: {},
              properties: {},
            },
            text(" after"),
          ],
        },
      },
    ]);

    const html = encodeHtml(document);
    // The anchor is omitted from the HTML (encode is lossy for it).
    expect(html).not.toContain(FOOTNOTE_ANCHOR_EMBED_TYPE);
    expect(html).toBe("<body><p>before  after</p></body>");

    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain("[@taleweaver/core]");
    expect(msg).toContain(FOOTNOTE_ANCHOR_EMBED_TYPE);
    expect(msg).toContain("taleweaver-binary");
  });
});

describe("encodeHtml — bookmarks + cross-references (Word's HTML)", () => {
  const mk = (embedType: string, properties: Record<string, unknown>): InlineItem => ({ kind: "embed", embedType, attrs: {}, properties });
  it("a bookmark start → a point anchor; a cross-reference → an internal link carrying its value", () => {
    const html = encodeHtml(
      buildDocument([
        { type: "paragraph", inlineContent: { items: [mk("bookmark-start", { bookmarkId: "b1" }), text("Intro"), mk("bookmark-end", { bookmarkId: "b1" })] } },
        { type: "paragraph", inlineContent: { items: [text("see "), mk("cross-reference", { bookmarkId: "b1", refMode: "text" }), mk("cross-reference", { bookmarkId: "gone", refMode: "text" })] } },
      ]),
    );
    expect(html).toBe('<body><p><a id="b1"></a>Intro</p><p>see <a href="#b1">Intro</a><a href="#gone">Error! Reference source not found.</a></p></body>');
  });

  it("only a bookmark's LIVE start emits its anchor (no duplicate HTML ids; a broken bookmark emits none)", () => {
    const html = encodeHtml(
      buildDocument([
        { type: "paragraph", inlineContent: { items: [mk("bookmark-start", { bookmarkId: "lone" }), text("x")] } },
        {
          type: "paragraph",
          inlineContent: {
            items: [
              mk("bookmark-start", { bookmarkId: "b1" }),
              text("Intro"),
              mk("bookmark-end", { bookmarkId: "b1" }),
              mk("bookmark-start", { bookmarkId: "b1" }),
              text("y"),
              mk("bookmark-end", { bookmarkId: "b1" }),
            ],
          },
        },
      ]),
    );
    expect(html).toBe('<body><p>x</p><p><a id="b1"></a>Introy</p></body>');
  });
});
