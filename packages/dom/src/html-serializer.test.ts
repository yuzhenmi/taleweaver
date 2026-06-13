/**
 * Slice 2 of the human-friendly serializer (spec
 * `docs/superpowers/specs/2026-06-08-human-friendly-serializer-design.md` §4–§5):
 * the `taleweaver-html` `DocumentSerializer<string>`.
 *
 * Runs under jsdom (the dom workspace test env) so the decoder's `DOMParser` is
 * present. Fixtures are built via the core barrel — `buildDocumentFromTree`
 * (Slice 1, now public) lowers a declarative `BlockNode` tree to a `State`.
 *
 * Round-trip fidelity is SEMANTIC, not id-level: decode mints fresh block ids
 * (the binary serializer owns id-preserving interchange), so every assertion
 * compares STRUCTURE / TYPES / ATTRS / TEXT / MARK-SETS, never block ids.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createTestAllocator,
  buildDocumentFromTree,
  getBlock,
  newListId,
  classifyListDef,
  getListDefsForState,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
  type State,
  type BlockId,
  type ContainerBlockNode,
  type BlockNode,
  type ListDef,
  type InlineContent,
  type InlineItem,
  type TextItem,
  type ReadonlyAttrs,
} from "@taleweaver/core";
import {
  HTML_FORMAT,
  createHtmlDocumentSerializer,
} from "./html-serializer";

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders (declarative BlockNode trees → State).
// ─────────────────────────────────────────────────────────────────────────

function text(s: string, attrs: ReadonlyAttrs = {}): TextItem {
  return { kind: "text", text: s, attrs };
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
function discDef(): ListDef {
  return { levels: [{ style: "disc", start: 1, restart: "always" }] };
}
function cell(children: BlockNode[], attrs: ReadonlyAttrs = {}): ContainerBlockNode {
  return { type: "table-cell", attrs, children };
}
function tableRow(cells: ContainerBlockNode[]): ContainerBlockNode {
  return { type: "table-row", children: cells };
}
function table(rows: ContainerBlockNode[], attrs: ReadonlyAttrs = {}): ContainerBlockNode {
  return { type: "table", attrs, children: rows };
}

function build(
  children: BlockNode[],
  listDefs: Record<string, ListDef> = {},
): State {
  const root: ContainerBlockNode = { type: "document", children };
  return buildDocumentFromTree(root, listDefs, createTestAllocator("fx"));
}

// ─────────────────────────────────────────────────────────────────────────
// Semantic readers over a State (compare by content, never by id).
// ─────────────────────────────────────────────────────────────────────────

interface SemBlock {
  type: string;
  attrs: ReadonlyAttrs;
  /** Per-text-item: [text, sorted active mark keys]. Embeds: [embedType, []]. */
  inline: Array<[string, string[]]>;
}

const MARK_KEYS = ["bold", "italic", "underline", "strikethrough", "link"];

function markSet(attrs: ReadonlyAttrs): string[] {
  return MARK_KEYS.filter((k) => attrs[k] !== undefined && attrs[k] !== false).sort();
}

/** Walk the main tree in document order, returning the FLAT leaf sequence. */
function readLeaves(state: State): SemBlock[] {
  const out: SemBlock[] = [];
  const root = getBlock(state, state.rootId);
  if (root === null) return out;
  const visit = (id: BlockId): void => {
    const block = getBlock(state, id);
    if (block === null) return;
    if (block.inlineContent !== null) {
      const inlineParts: Array<[string, string[]]> = [];
      for (const item of block.inlineContent.items) {
        if (item.kind === "text") {
          inlineParts.push([item.text, markSet(item.attrs)]);
        } else {
          inlineParts.push([item.embedType, []]);
        }
      }
      out.push({ type: block.type, attrs: block.attrs, inline: inlineParts });
    } else {
      let childId = block.firstChildId;
      while (childId !== null) {
        const child = getBlock(state, childId);
        if (child === null) break;
        visit(childId);
        childId = child.nextSiblingId;
      }
    }
  };
  visit(state.rootId);
  return out;
}

function roundTrip(state: State): State {
  const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("dec") });
  return ser.decode(ser.encode(state));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createHtmlDocumentSerializer", () => {
  it("exposes the taleweaver-html format id", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("d") });
    expect(ser.format).toBe(HTML_FORMAT);
    expect(HTML_FORMAT).toBe("taleweaver-html");
  });

  // §5 acceptance — the semantic round-trip property over the supported subset.
  it("semantically round-trips headings, paragraphs, nested lists, marks, image, hard-break", () => {
    const olId = newListId();
    const ulId = newListId();
    const state = build(
      [
        heading(1, inline(text("Chapter One"))),
        para(inline(text("Once "), text("upon", { italic: true }), text(" a time."))),
        listItem(olId, 0, inline(text("first"))),
        listItem(olId, 1, inline(text("nested"))),
        listItem(olId, 0, inline(text("second"))),
        para(inline(text("see "), text("here", { link: "https://x.test" }))),
        listItem(ulId, 0, inline(text("bullet"))),
        { type: "image", attrs: { src: "pic.png", width: 200, height: 100 }, inlineContent: inline() },
        para(inline(text("line"), { kind: "embed", embedType: "hard-break", attrs: {}, properties: {} }, text("break"))),
      ],
      { [olId]: decimalDef(), [ulId]: discDef() },
    );

    const before = readLeaves(state);
    const after = readLeaves(roundTrip(state));

    // Same doc-order sequence of block types.
    expect(after.map((b) => b.type)).toEqual(before.map((b) => b.type));

    // Heading level preserved.
    const h = after.find((b) => b.type === "heading");
    expect(h?.attrs.level).toBe(1);

    // List grouping shape: listLevel sequence + ordered/unordered classification.
    const listItems = after.filter((b) => b.type === "list-item");
    expect(listItems.map((b) => b.attrs.listLevel)).toEqual([0, 1, 0, 0]);
    // The first three share ONE listId (the ordered list); the fourth is the bullet list.
    const defs = getListDefsForState(roundTrip(state));
    // Re-derive from a single decode so ids line up:
    const dec = createHtmlDocumentSerializer({ allocator: createTestAllocator("once") });
    const decoded = dec.decode(dec.encode(state));
    const decItems = readLeaves(decoded).filter((b) => b.type === "list-item");
    const olDecId = decItems[0].attrs.listId;
    expect(decItems[1].attrs.listId).toBe(olDecId);
    expect(decItems[2].attrs.listId).toBe(olDecId);
    const ulDecId = decItems[3].attrs.listId;
    expect(ulDecId).not.toBe(olDecId);
    const decDefs = getListDefsForState(decoded);
    const olDef = decDefs.get(typeof olDecId === "string" ? olDecId : "");
    const ulDef = decDefs.get(typeof ulDecId === "string" ? ulDecId : "");
    expect(olDef).toBeDefined();
    expect(ulDef).toBeDefined();
    if (olDef) expect(classifyListDef(olDef)).toBe("ordered");
    if (ulDef) expect(classifyListDef(ulDef)).toBe("unordered");
    expect(defs.size).toBeGreaterThanOrEqual(2);

    // Image attrs.
    const img = after.find((b) => b.type === "image");
    expect(img?.attrs.src).toBe("pic.png");
    expect(img?.attrs.width).toBe(200);
    expect(img?.attrs.height).toBe(100);

    // Inline marks: the italic run survives as a {italic} run.
    const onceUpon = before.find((b) => b.inline.some(([t]) => t === "upon"));
    const onceUponAfter = after.find((b) => b.inline.some(([t]) => t === "upon"));
    expect(onceUponAfter).toBeDefined();
    const uponMarks = onceUponAfter?.inline.find(([t]) => t === "upon")?.[1];
    expect(uponMarks).toEqual(["italic"]);
    expect(onceUpon).toBeDefined();

    // Link mark carries its URL payload.
    const decLinkPara = readLeaves(decoded).find((b) => b.inline.some(([t]) => t === "here"));
    expect(decLinkPara).toBeDefined();

    // Hard-break survives as an embed item.
    const brBlock = after.find((b) => b.inline.some(([t]) => t === "hard-break"));
    expect(brBlock).toBeDefined();
  });

  // §5 — authored fairytale fragment decodes to the expected block sequence + text.
  it("decodes an authored HTML fragment to the expected block-type sequence + text", () => {
    const html =
      "<h1>The Brave Tailor</h1>" +
      "<p>Once there was a <strong>brave</strong> little tailor.</p>" +
      "<p>He set out into the world.</p>";
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("frag") });
    const leaves = readLeaves(ser.decode(html));
    expect(leaves.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(leaves[0].attrs.level).toBe(1);
    expect(leaves[0].inline.map(([t]) => t).join("")).toBe("The Brave Tailor");
    expect(leaves[1].inline.map(([t]) => t).join("")).toBe("Once there was a brave little tailor.");
    const braveRun = leaves[1].inline.find(([t]) => t === "brave");
    expect(braveRun?.[1]).toEqual(["bold"]);
    expect(leaves[2].inline.map(([t]) => t).join("")).toBe("He set out into the world.");
  });

  // §5 — coverage-lock for REALISTIC multi-section content (mirrors the
  // example app's seeded fairytale, Slice 3): an <h1> title + two <h2>
  // section heads + several <p> + a <ul> + an <ol>, with bold/italic/link
  // marks and a <br> hard-break, decodes to the expected block sequence.
  // Locks the serializer's handling of a real document end to end (the
  // fragment is INLINE — the dom package must not depend on examples).
  it("decodes a realistic multi-section fairytale fragment end to end", () => {
    const html =
      "<h1>The Lantern-Keeper's Daughter</h1>" +
      "<p>There stood a <strong>lighthouse</strong> no taller than a barn.</p>" +
      "<p>Each night the lamp burned a little <em>dimmer</em>.</p>" +
      "<h2>The Three Gifts of the Tide</h2>" +
      "<p>The sea left three gifts on the shingle:</p>" +
      "<ul>" +
      "<li>a brass key, <em>warm to the touch</em>;</li>" +
      "<li>a bottle with a single word inside it;</li>" +
      "<li>and a lantern that held no flame.</li>" +
      "</ul>" +
      "<p>She turned it once.<br>Nothing.<br>She turned it twice.</p>" +
      "<h2>What the Light Remembered</h2>" +
      "<p>Instead it <strong><em>remembered</em></strong> every ship.</p>" +
      "<ol>" +
      "<li>watch the water until it trusts you;</li>" +
      "<li>mend what others would throw away;</li>" +
      "<li>and never let a borrowed light forget.</li>" +
      "</ol>" +
      "<p>The <a href=\"https://example.com/keepers-log\">keepers' log</a> waits.</p>";

    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("fairy") });
    const leaves = readLeaves(ser.decode(html));

    // The full doc-order block-type sequence.
    expect(leaves.map((b) => b.type)).toEqual([
      "heading",      // h1 title
      "paragraph",
      "paragraph",
      "heading",      // h2
      "paragraph",
      "list-item", "list-item", "list-item",  // ul
      "paragraph",    // hard-breaks
      "heading",      // h2
      "paragraph",
      "list-item", "list-item", "list-item",  // ol
      "paragraph",    // link
    ]);

    // Heading levels: h1 then the two h2s.
    const headings = leaves.filter((b) => b.type === "heading");
    expect(headings.map((b) => b.attrs.level)).toEqual([1, 2, 2]);

    // List-items carry listLevel 0 and group into TWO distinct lists
    // (the <ul> and the <ol>), each with its own listId shared by its items.
    const items = leaves.filter((b) => b.type === "list-item");
    expect(items.map((b) => b.attrs.listLevel)).toEqual([0, 0, 0, 0, 0, 0]);
    const ulId = items[0].attrs.listId;
    expect(items[1].attrs.listId).toBe(ulId);
    expect(items[2].attrs.listId).toBe(ulId);
    const olId = items[3].attrs.listId;
    expect(items[4].attrs.listId).toBe(olId);
    expect(items[5].attrs.listId).toBe(olId);
    expect(olId).not.toBe(ulId);

    // The <ul> classifies unordered and the <ol> ordered.
    const decoded = ser.decode(html);
    const decItems = readLeaves(decoded).filter((b) => b.type === "list-item");
    const decUlId = decItems[0].attrs.listId;
    const decOlId = decItems[3].attrs.listId;
    const defs = getListDefsForState(decoded);
    const ulDef = defs.get(typeof decUlId === "string" ? decUlId : "");
    const olDef = defs.get(typeof decOlId === "string" ? decOlId : "");
    expect(ulDef).toBeDefined();
    expect(olDef).toBeDefined();
    if (ulDef) expect(classifyListDef(ulDef)).toBe("unordered");
    if (olDef) expect(classifyListDef(olDef)).toBe("ordered");

    // A paragraph carries a bold+italic mark set (the nested <strong><em>).
    const remembered = leaves.find((b) =>
      b.inline.some(([t]) => t === "remembered"),
    );
    expect(remembered).toBeDefined();
    expect(remembered?.inline.find(([t]) => t === "remembered")?.[1]).toEqual([
      "bold",
      "italic",
    ]);

    // A paragraph carries a link mark whose URL payload survives decode.
    const logBlock = leaves.find((b) =>
      b.inline.some(([t]) => t === "keepers' log"),
    );
    expect(logBlock?.inline.find(([t]) => t === "keepers' log")?.[1]).toEqual([
      "link",
    ]);
    // The link is the document's last block; assert the href round-tripped (the
    // SemBlock mark-set drops the URL, so read the raw TextItem).
    const decRoot = getBlock(decoded, decoded.rootId);
    const linkPara = getBlock(decoded, decRoot?.lastChildId ?? decoded.rootId);
    const linkItem = linkPara?.inlineContent?.items.find(
      (i): i is TextItem => i.kind === "text" && i.attrs.link !== undefined,
    );
    expect(linkItem?.text).toBe("keepers' log");
    expect(linkItem?.attrs.link).toBe("https://example.com/keepers-log");

    // A paragraph preserves the <br> hard-break embeds.
    const breakPara = leaves.find((b) =>
      b.inline.some(([t]) => t === "hard-break"),
    );
    expect(breakPara).toBeDefined();
    expect(
      breakPara?.inline.filter(([t]) => t === "hard-break").length,
    ).toBe(2);
  });

  // §5 / M1 — order-independent mark accumulation.
  it("accumulates marks order-independently (<strong><em> ≡ <em><strong>)", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("oi") });
    const a = readLeaves(ser.decode("<p><strong><em>x</em></strong></p>"));
    const b = readLeaves(ser.decode("<p><em><strong>x</strong></em></p>"));
    expect(a[0].inline).toEqual([["x", ["bold", "italic"]]]);
    expect(b[0].inline).toEqual([["x", ["bold", "italic"]]]);
  });

  // §5 / M2 — <a href> round-trips the URL into attrs.link.
  it("round-trips <a href> into attrs.link", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("a") });
    const html = '<p>visit <a href="https://example.test/page">my site</a> now</p>';
    const decoded = ser.decode(html);
    const block = getBlock(decoded, getMainFirstLeaf(decoded));
    const linkItem = block?.inlineContent?.items.find(
      (i): i is TextItem => i.kind === "text" && i.attrs.link !== undefined,
    );
    expect(linkItem?.text).toBe("my site");
    expect(linkItem?.attrs.link).toBe("https://example.test/page");

    // And the URL survives a full re-encode round-trip.
    const re = ser.decode(ser.encode(decoded));
    const reBlock = getBlock(re, getMainFirstLeaf(re));
    const reLink = reBlock?.inlineContent?.items.find(
      (i): i is TextItem => i.kind === "text" && i.attrs.link !== undefined,
    );
    expect(reLink?.attrs.link).toBe("https://example.test/page");
  });

  // §5 / C2 — arbitrarily-nested lists round-trip levels (one listId across levels).
  it("round-trips a 2-level nested list to listLevels 0 and 1 sharing one listId", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("nest") });
    const html = "<ul><li>outer<ul><li>inner</li></ul></li></ul>";
    const decoded = ser.decode(html);
    const items = readLeaves(decoded).filter((b) => b.type === "list-item");
    expect(items.length).toBe(2);
    expect(items[0].attrs.listLevel).toBe(0);
    expect(items[1].attrs.listLevel).toBe(1);
    expect(items[0].attrs.listId).toBe(items[1].attrs.listId);
    // Both texts present.
    const texts = items.map((b) => b.inline.map(([t]) => t).join(""));
    expect(texts).toContain("outer");
    expect(texts).toContain("inner");
  });

  // §4 — inline MARKS inside an <li> are preserved (regression: walkList used to
  // descend into the mark element and drop the mark).
  it("preserves inline marks inside a list item", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("limk") });
    const decoded = ser.decode("<ul><li><strong>bold</strong> rest</li></ul>");
    const items = readLeaves(decoded).filter((b) => b.type === "list-item");
    expect(items.length).toBe(1);
    expect(items[0].inline).toContainEqual(["bold", ["bold"]]);
    expect(items[0].inline).toContainEqual([" rest", []]);
  });

  // §4 — a <br> inside an <li> becomes a hard-break embed (same regression).
  it("preserves a hard-break inside a list item", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("libr") });
    const decoded = ser.decode("<ol><li>a<br>b</li></ol>");
    const items = readLeaves(decoded).filter((b) => b.type === "list-item");
    expect(items.length).toBe(1);
    expect(items[0].inline).toEqual([["a", []], ["hard-break", []], ["b", []]]);
  });

  // §4 / §5 — unsupported elements ignored but recursed into.
  it("ignores unsupported wrappers but keeps their inline text", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("u") });
    const html = "<p>hello <span>brave</span> world</p><div>aside text</div>";
    const leaves = readLeaves(ser.decode(html));
    // The <span>'s text survives inside the paragraph.
    const p = leaves.find((b) => b.type === "paragraph");
    expect(p?.inline.map(([t]) => t).join("")).toBe("hello brave world");
    // The unknown <div> block is dropped (its content is not promoted to a block).
    expect(leaves.filter((b) => b.type === "paragraph").length).toBe(1);
  });

  // §4 / §5 — empty / whitespace HTML → single empty-paragraph doc (no throw).
  it("decodes empty or whitespace HTML to a single empty-paragraph doc", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("e") });
    for (const html of ["", "   \n  ", "<div></div>", "<!-- comment -->"]) {
      const leaves = readLeaves(ser.decode(html));
      expect(leaves.length).toBe(1);
      expect(leaves[0].type).toBe("paragraph");
      expect(leaves[0].inline).toEqual([]);
    }
  });

  // §5 / I1 — lossiness contract: footnote-anchor is dropped + dev-warns.
  it("drops a footnote-anchor embed on encode and dev-warns (I1)", () => {
    const prev = readNodeEnv();
    setNodeEnv("development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = build([
        para(inline(
          text("body "),
          { kind: "embed", embedType: FOOTNOTE_ANCHOR_EMBED_TYPE, attrs: {}, properties: {} },
          text(" more"),
        )),
      ]);
      const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("fn") });
      const html = ser.encode(state);
      // (a) The anchor is omitted from the HTML.
      expect(html).not.toContain(FOOTNOTE_ANCHOR_EMBED_TYPE);
      // (b) A dev-mode warning fired, naming the dropped type + the binary escape.
      expect(warn).toHaveBeenCalled();
      const msg = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(msg).toContain(FOOTNOTE_ANCHOR_EMBED_TYPE);
      expect(msg).toContain("taleweaver-binary");
      // (c) The decoded doc lacks the anchor.
      const decoded = ser.decode(html);
      const leaves = readLeaves(decoded);
      const hasAnchor = leaves.some((b) =>
        b.inline.some(([t]) => t === FOOTNOTE_ANCHOR_EMBED_TYPE),
      );
      expect(hasAnchor).toBe(false);
    } finally {
      setNodeEnv(prev);
    }
  });

  // §4 / §5 / I4 — non-consecutive same-listId runs encode as TWO lists,
  // decode to two distinct listIds.
  it("encodes non-consecutive same-listId runs as two lists → two distinct ids (I4)", () => {
    const shared = newListId();
    const state = build(
      [
        listItem(shared, 0, inline(text("a"))),
        para(inline(text("interlude"))),
        listItem(shared, 0, inline(text("b"))),
      ],
      { [shared]: decimalDef() },
    );
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("i4") });
    const html = ser.encode(state);
    // Two separate <ol> elements in the output.
    expect((html.match(/<ol>/g) ?? []).length).toBe(2);
    const decoded = ser.decode(html);
    const items = readLeaves(decoded).filter((b) => b.type === "list-item");
    expect(items.length).toBe(2);
    expect(items[0].attrs.listId).not.toBe(items[1].attrs.listId);
  });

  // §4 — HTML escaping on encode.
  it("HTML-escapes special characters in text on encode", () => {
    const state = build([para(inline(text('a < b & c > d "q"')))]);
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("esc") });
    const html = ser.encode(state);
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&gt;");
    // And it round-trips back to the literal text.
    const leaves = readLeaves(ser.decode(html));
    expect(leaves[0].inline.map(([t]) => t).join("")).toBe('a < b & c > d "q"');
  });

  // §4 — decode accepts alt tags (<b>/<i>/<del>).
  it("decodes alt mark tags <b>/<i>/<del> equivalently", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("alt") });
    const leaves = readLeaves(ser.decode("<p><b>x</b><i>y</i><del>z</del></p>"));
    const marksOf = (t: string) => leaves[0].inline.find(([tt]) => tt === t)?.[1];
    expect(marksOf("x")).toEqual(["bold"]);
    expect(marksOf("y")).toEqual(["italic"]);
    expect(marksOf("z")).toEqual(["strikethrough"]);
  });

  // §4 — <hr> round-trips to a horizontal-line block.
  it("round-trips <hr> to a horizontal-line block", () => {
    const state = build([
      para(inline(text("above"))),
      { type: "horizontal-line", inlineContent: inline() },
      para(inline(text("below"))),
    ]);
    const after = readLeaves(roundTrip(state));
    expect(after.map((b) => b.type)).toEqual(["paragraph", "horizontal-line", "paragraph"]);
  });

  // M2 — a dangerous URL scheme must NOT survive into the exported <a href>
  // (where a downstream consumer could open it and run script). The wrapper is
  // dropped; the link TEXT is preserved. Mirrors the Cmd/Ctrl-click allowlist.
  it("drops the <a> wrapper for a javascript: link on encode (keeps the text)", () => {
    const state = build([para(inline(text("click "), text("here", { link: "javascript:alert(1)" })))]);
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("xss") });
    const html = ser.encode(state);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("here"); // the link text still renders
  });

  it("keeps the <a> wrapper for a safe https link AND a relative link on encode", () => {
    const state = build([
      para(inline(text("a", { link: "https://ok.test/x" }))),
      para(inline(text("b", { link: "/relative/path" }))),
    ]);
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("safe") });
    const html = ser.encode(state);
    expect(html).toContain('<a href="https://ok.test/x">a</a>');
    expect(html).toContain('<a href="/relative/path">b</a>');
  });

  // #470: tables were silently dropped on encode (a container block hit
  // encodeLeaf's default → ""). They now serialize to <table>/<tr>/<td>.
  it("encodes a table (was silently dropped) — <table>/<tr>/<td> with cell text", () => {
    const state = build([
      table([
        tableRow([cell([para(inline(text("A")))]), cell([para(inline(text("B")))])]),
        tableRow([cell([para(inline(text("C")))]), cell([para(inline(text("D")))])]),
      ]),
    ]);
    const html = createHtmlDocumentSerializer({ allocator: createTestAllocator("t") }).encode(state);
    expect(html).toContain("<table>");
    expect(html).toContain("</table>");
    expect(html).toContain("<tr><td><p>A</p></td><td><p>B</p></td></tr>");
    expect(html).toContain("<tr><td><p>C</p></td><td><p>D</p></td></tr>");
  });

  it("emits a <colgroup> with per-column widths from columnWidths", () => {
    const state = build([
      table(
        [tableRow([cell([para(inline(text("X")))]), cell([para(inline(text("Y")))])])],
        { columnWidths: [0.25, 0.75] },
      ),
    ]);
    const html = createHtmlDocumentSerializer({ allocator: createTestAllocator("cw") }).encode(state);
    expect(html).toContain("<colgroup>");
    expect(html).toContain('<col style="width:25%">');
    expect(html).toContain('<col style="width:75%">');
  });

  it("emits rowspan/colspan only for a cell whose span attr is > 1", () => {
    const state = build([
      table([
        tableRow([
          cell([para(inline(text("S")))], { rowSpan: 2, colSpan: 3 }),
          cell([para(inline(text("T")))]),
        ]),
      ]),
    ]);
    const html = createHtmlDocumentSerializer({ allocator: createTestAllocator("sp") }).encode(state);
    expect(html).toContain('<td rowspan="2" colspan="3"><p>S</p></td>');
    expect(html).toContain("<td><p>T</p></td>"); // omitted span → no attrs
  });

  it("encodes an empty cell as <td></td> (common in pasted tables)", () => {
    const state = build([
      table([tableRow([cell([para(inline())]), cell([para(inline(text("Z")))])])]),
    ]);
    const html = createHtmlDocumentSerializer({ allocator: createTestAllocator("ec") }).encode(state);
    expect(html).toContain("<td><p></p></td><td><p>Z</p></td>");
  });

  it("recursively encodes block content inside a cell (a nested list)", () => {
    const lid = "L1";
    const state = build(
      [
        table([
          tableRow([
            cell([listItem(lid, 0, inline(text("one"))), listItem(lid, 0, inline(text("two")))]),
          ]),
        ]),
      ],
      { [lid]: discDef() },
    );
    const html = createHtmlDocumentSerializer({ allocator: createTestAllocator("nl") }).encode(state);
    expect(html).toContain("<td><ul><li>one</li><li>two</li></ul></td>");
  });
});

// First leaf of the main tree (helper for link assertions).
function getMainFirstLeaf(state: State): BlockId {
  const root = getBlock(state, state.rootId);
  let id = root?.firstChildId ?? null;
  while (id !== null) {
    const b = getBlock(state, id);
    if (b === null) break;
    if (b.inlineContent !== null) return id;
    id = b.firstChildId;
  }
  // Fallback to root (never expected in these fixtures).
  return state.rootId;
}

// NODE_ENV helpers (typed globalThis read/write — mirrors the dom dev-gate).
function readNodeEnv(): string | undefined {
  const g = globalThis as { process?: { env?: { NODE_ENV?: string } } };
  return g.process?.env?.NODE_ENV;
}
function setNodeEnv(value: string | undefined): void {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  if (g.process?.env !== undefined) {
    g.process.env.NODE_ENV = value;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// html-decode hardening (serialization audit F1/F2)
// ─────────────────────────────────────────────────────────────────────────

describe("html-decode hardening", () => {
  // F1: a list-level JUMP (0 → 2) encodes to <ol><li>a<ol><ol><li>b… — the inner
  // <ol> is a DIRECT child of the outer nested <ol> (no intervening <li>). decode
  // must recurse a directly-nested list, else the deeper item is silently dropped.
  it("round-trips a list-level jump (0 → 2) without dropping the deeper item (F1)", () => {
    const s = build(
      [listItem("L", 0, inline(text("a"))), listItem("L", 2, inline(text("b")))],
      { L: decimalDef() },
    );
    const items = readLeaves(roundTrip(s)).filter((b) => b.type === "list-item");
    expect(items.map((b) => b.attrs.listLevel)).toEqual([0, 2]);
    expect(items.map((b) => b.inline[0]?.[0])).toEqual(["a", "b"]);
  });

  it("decode recovers items from a directly-nested <ul><ul> (no intervening <li>) (F1)", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("nest") });
    const decoded = ser.decode("<body><ul><li>a<ul><ul><li>b</li></ul></ul></li></ul></body>");
    const items = readLeaves(decoded).filter((b) => b.type === "list-item");
    expect(items.map((b) => b.inline[0]?.[0])).toEqual(["a", "b"]);
    expect(items.map((b) => b.attrs.listLevel)).toEqual([0, 2]);
  });

  // F2: decode is the untrusted-input trust boundary; sanitize dangerous URL
  // schemes symmetrically with the #466 export fix (isExportSafeLinkUrl).
  it("decode drops a dangerous-scheme <a href> but keeps the link text (F2)", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("xss-a") });
    const decoded = ser.decode('<body><p><a href="javascript:alert(1)">x</a></p></body>');
    const p = readLeaves(decoded).find((b) => b.type === "paragraph");
    expect(p?.inline).toEqual([["x", []]]); // text survives, no `link` mark
  });

  it("decode drops a dangerous-scheme <img src> (F2)", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("xss-i") });
    const decoded = ser.decode('<body><img src="javascript:alert(1)"></body>');
    const img = readLeaves(decoded).find((b) => b.type === "image");
    expect(img?.attrs.src).toBe("");
  });

  it("decode KEEPS safe http(s) <a href> and <img src> (F2 precision)", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("safe") });
    const decoded = ser.decode(
      '<body><p><a href="https://ok.test">x</a></p><img src="https://ok.test/i.png"></body>',
    );
    const leaves = readLeaves(decoded);
    expect(leaves.find((b) => b.type === "paragraph")?.inline).toEqual([["x", ["link"]]]);
    expect(leaves.find((b) => b.type === "image")?.attrs.src).toBe("https://ok.test/i.png");
  });

  // Inheritable block attrs (lang / hyphens / text-align) — a wrapper's lang/
  // hyphens cascade to descendant blocks so authored HTML can opt a whole region
  // into auto-hyphenation without repeating attrs on every paragraph. (Auto-
  // hyphenation Slice 5: the example app authors `<div lang="en" hyphens="auto">`.)
  it("decode inherits lang/hyphens/text-align from a wrapping element to descendant blocks", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("inh") });
    const decoded = ser.decode(
      '<body><div lang="en" hyphens="auto" style="text-align: justify">' +
        "<p>first</p><h2>head</h2><ul><li>item</li></ul></div></body>",
    );
    const leaves = readLeaves(decoded);
    const p = leaves.find((b) => b.type === "paragraph");
    expect(p?.attrs.language ?? p?.attrs.lang).toBe("en");
    expect(p?.attrs.hyphens).toBe("auto");
    expect(p?.attrs.textAlign).toBe("justify");
    // Heading keeps its own `level` AND inherits the wrapper attrs.
    const h = leaves.find((b) => b.type === "heading");
    expect(h?.attrs.level).toBe(2);
    expect(h?.attrs.hyphens).toBe("auto");
    // List item inherits too (alongside listId/listLevel).
    const li = leaves.find((b) => b.type === "list-item");
    expect(li?.attrs.lang).toBe("en");
    expect(li?.attrs.hyphens).toBe("auto");
  });

  it("decode lets a child element's own lang override the inherited one; invalid hyphens is ignored", () => {
    const ser = createHtmlDocumentSerializer({ allocator: createTestAllocator("ovr") });
    const decoded = ser.decode(
      '<body><div lang="en" hyphens="auto">' +
        '<p lang="de" hyphens="sometimes">x</p><p>y</p></div></body>',
    );
    const ps = readLeaves(decoded).filter((b) => b.type === "paragraph");
    // First paragraph: own lang wins; invalid `hyphens` keyword ignored → inherited "auto".
    expect(ps[0]?.attrs.lang).toBe("de");
    expect(ps[0]?.attrs.hyphens).toBe("auto");
    // Second paragraph: pure inheritance.
    expect(ps[1]?.attrs.lang).toBe("en");
    expect(ps[1]?.attrs.hyphens).toBe("auto");
  });
});
