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
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildDocumentFromTree,
  createTestAllocator,
  encodeHtml,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  type State,
  type BlockNode,
  type ContainerBlockNode,
  type InlineItem,
  type ListDef,
} from "../../index";

function buildState(
  children: BlockNode[],
  listDefs: Record<string, ListDef> = {},
): State {
  const root: ContainerBlockNode = { type: "document", children };
  return buildDocumentFromTree(root, listDefs, createTestAllocator("enc"));
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
      buildState([
        { type: "heading", attrs: { level: 2 }, inlineContent: { items: [text("Title")] } },
        { type: "paragraph", inlineContent: { items: [text("Body")] } },
      ]),
    );
    expect(html).toBe("<body><h2>Title</h2><p>Body</p></body>");
  });

  it("encodes a horizontal line", () => {
    const html = encodeHtml(
      buildState([{ type: "horizontal-line", inlineContent: { items: [] } }]),
    );
    expect(html).toBe("<body><hr></body>");
  });

  it("escapes HTML-significant text characters", () => {
    const html = encodeHtml(
      buildState([{ type: "paragraph", inlineContent: { items: [text(`a & b < c > "d"`)] } }]),
    );
    expect(html).toBe(`<body><p>a &amp; b &lt; c &gt; &quot;d&quot;</p></body>`);
  });

  it("wraps inline marks innermost→outermost (link outermost)", () => {
    const html = encodeHtml(
      buildState([
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
      buildState([
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
      buildState(
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
      buildState(
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
      buildState(
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
      buildState(
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
      buildState(
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
      buildState(
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
    const state = buildState([
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

    const html = encodeHtml(state);
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
