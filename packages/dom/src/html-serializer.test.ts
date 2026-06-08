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
