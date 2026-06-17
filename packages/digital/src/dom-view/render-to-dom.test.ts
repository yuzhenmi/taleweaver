import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { TextBox, ElementBox, ComputedStyle } from "@taleweaver/core";
import { renderNodeToDom } from "./render-to-dom";

function textBox(text: string, cs = INITIAL_COMPUTED_STYLE, link?: string): TextBox {
  return { type: "text", key: "t", style: {}, text, computedStyle: cs, ...(link !== undefined ? { link } : {}) };
}

function el(opts: {
  display?: ComputedStyle["display"];
  metadata?: ElementBox["metadata"];
  children?: ElementBox["children"];
  csOverrides?: Partial<ComputedStyle>;
}): ElementBox {
  return {
    type: "element", key: "e", style: {},
    computedStyle: { ...INITIAL_COMPUTED_STYLE, ...(opts.display !== undefined ? { display: opts.display } : {}), ...opts.csOverrides },
    ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
    children: opts.children ?? [],
  };
}

describe("renderNodeToDom — TextBox", () => {
  it("emits a plain text node for an unstyled run", () => {
    const node = renderNodeToDom(textBox("hello"), document);
    expect(node?.textContent).toBe("hello");
  });

  it("HTML-escapes text content (no injection)", () => {
    const host = document.createElement("div");
    const node = renderNodeToDom(textBox("<b>x</b>"), document);
    if (node) host.appendChild(node);
    expect(host.innerHTML).not.toContain("<b>");
    expect(host.textContent).toBe("<b>x</b>");
  });

  it("wraps bold in <strong>, italic in <em> (strong outermost)", () => {
    const node = renderNodeToDom(textBox("hi", { ...INITIAL_COMPUTED_STYLE, fontWeight: "bold", fontStyle: "italic" }), document);
    if (!(node instanceof HTMLElement)) throw new Error("expected element");
    expect(node.tagName).toBe("STRONG");
    expect(node.querySelector("em")).not.toBeNull();
    expect(node.textContent).toBe("hi");
  });

  it("wraps a link in <a href> and sanitizes a dangerous scheme", () => {
    const ok = renderNodeToDom(textBox("site", INITIAL_COMPUTED_STYLE, "https://example.com"), document);
    if (!(ok instanceof HTMLAnchorElement)) throw new Error("expected anchor");
    expect(ok.getAttribute("href")).toBe("https://example.com");

    const bad = renderNodeToDom(textBox("x", INITIAL_COMPUTED_STYLE, "javascript:alert(1)"), document);
    expect(bad instanceof HTMLAnchorElement).toBe(false);
    expect(bad?.textContent).toBe("x");
  });
});

describe("renderNodeToDom — ElementBox", () => {
  it("maps headingLevel metadata to <h_>", () => {
    const node = renderNodeToDom(el({ display: "block", metadata: { headingLevel: 2 } }), document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.tagName).toBe("H2");
  });

  it("maps horizontalLine metadata to <hr>", () => {
    const node = renderNodeToDom(el({ display: "block", metadata: { horizontalLine: true } }), document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.tagName).toBe("HR");
  });

  it("maps image metadata to <img src width height alt>", () => {
    const node = renderNodeToDom(el({ display: "block", metadata: { image: { src: "/a.png", width: 10, height: 20, alt: "cat" } } }), document);
    if (!(node instanceof HTMLImageElement)) throw new Error("img");
    expect(node.getAttribute("src")).toBe("/a.png");
    expect(node.getAttribute("alt")).toBe("cat");
    expect(node.getAttribute("width")).toBe("10");
    expect(node.getAttribute("height")).toBe("20");
  });

  it("unwraps a display:contents section (emits children only)", () => {
    const child = el({ display: "block" });
    const node = renderNodeToDom(el({ display: "contents", metadata: { blockType: "section" }, children: [child] }), document);
    const host = document.createElement("main");
    if (node) host.appendChild(node);
    expect(host.children).toHaveLength(1);
    expect(host.children[0]?.tagName).toBe("DIV");
  });

  it("maps a generic block to <div> with non-default inline style", () => {
    const node = renderNodeToDom(el({ display: "block", csOverrides: { color: "red" } }), document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.tagName).toBe("DIV");
    expect(node.getAttribute("style")).toContain("color: red");
  });

  it("skips display:none", () => {
    expect(renderNodeToDom(el({ display: "none" }), document)).toBeNull();
  });

  it("maps a bare list-item to <li> (grouping is a later task)", () => {
    const node = renderNodeToDom(el({ display: "list-item" }), document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.tagName).toBe("LI");
  });

  it("recurses children (paragraph wrapping a text run)", () => {
    const text: TextBox = { type: "text", key: "t", style: {}, text: "hi", computedStyle: INITIAL_COMPUTED_STYLE };
    const node = renderNodeToDom(el({ display: "block", children: [text] }), document);
    expect(node?.textContent).toBe("hi");
  });

  it("pads an EMPTY block (empty line) with a filler <br> so it has a visible line box", () => {
    // An empty paragraph renders as <div></div>, which a browser gives no line box → zero
    // height → the blank line is invisible and the caret can't land in it. A marked filler
    // <br> restores the line box (the digital analog of the canvas path's empty-line strut).
    const node = renderNodeToDom(el({ display: "block" }), document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const br = node.querySelector("br");
    if (!(br instanceof HTMLElement)) throw new Error("expected filler <br>");
    expect(br.hasAttribute("data-tw-empty-line")).toBe(true);
  });

  it("pads an empty heading and an empty list-item too", () => {
    const h = renderNodeToDom(el({ display: "block", metadata: { headingLevel: 2 } }), document);
    if (!(h instanceof HTMLElement)) throw new Error("h");
    expect(h.querySelector("br[data-tw-empty-line]")).not.toBeNull();
    const li = renderNodeToDom(el({ display: "list-item" }), document);
    if (!(li instanceof HTMLElement)) throw new Error("li");
    expect(li.querySelector("br[data-tw-empty-line]")).not.toBeNull();
  });

  it("does NOT pad a non-empty block, nor a structural container (table/row)", () => {
    const text: TextBox = { type: "text", key: "t", style: {}, text: "hi", computedStyle: INITIAL_COMPUTED_STYLE };
    const filled = renderNodeToDom(el({ display: "block", children: [text] }), document);
    if (!(filled instanceof HTMLElement)) throw new Error("filled");
    expect(filled.querySelector("br")).toBeNull();
    const table = renderNodeToDom(el({ display: "table" }), document);
    if (!(table instanceof HTMLElement)) throw new Error("table");
    expect(table.querySelector("br")).toBeNull();
    const row = renderNodeToDom(el({ display: "table-row" }), document);
    if (!(row instanceof HTMLElement)) throw new Error("row");
    expect(row.querySelector("br")).toBeNull();
  });

  it("pads a block whose only child is an EMPTY styled span (the real empty-paragraph render)", () => {
    // An empty paragraph renders as <div><span style="…"></span></div> (the span carries the
    // cascaded white-space) — still no line box. The filler replaces the empty span.
    const emptyStyledRun: TextBox = { type: "text", key: "t", style: {}, text: "", computedStyle: { ...INITIAL_COMPUTED_STYLE, whiteSpace: "break-spaces" } };
    const node = renderNodeToDom(el({ display: "block", children: [emptyStyledRun] }), document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.querySelector("br[data-tw-empty-line]")).not.toBeNull();
    expect(node.querySelector("span")).toBeNull(); // the empty styled span was dropped
    expect(node.childNodes).toHaveLength(1); // exactly the filler → bridge "filler-only" check stays trivial
  });

  it("does NOT pad (or wipe) a CONTAINER block that wraps a nested block (data-block-id child)", () => {
    // A table-cell wrapping an empty paragraph: textContent is "" but it is NOT an empty line — its
    // real block child must survive (the inner empty paragraph gets the filler instead).
    const innerEmptyPara = el({ display: "block" }); // an empty leaf paragraph
    const cell = renderNodeToDom(el({ display: "table-cell", children: [innerEmptyPara] }), document, true);
    if (!(cell instanceof HTMLElement)) throw new Error("cell");
    expect(cell.querySelector("[data-block-id]")).not.toBeNull(); // the nested block was NOT wiped
    expect(cell.querySelector(":scope > br")).toBeNull(); // the cell itself is not padded
    expect(cell.querySelector("[data-block-id] > br[data-tw-empty-line]")).not.toBeNull(); // inner para is
  });

  it("does NOT pad a block whose only content is an inline embed (replaced box)", () => {
    const embed = el({ display: "inline-block", metadata: { embedType: "footnote-anchor" } });
    const node = renderNodeToDom(el({ display: "block", children: [embed] }), document, true);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.querySelector("br")).toBeNull();
  });
});

function listItem(text: string, list: { level: number; listId: string; ordered: boolean }, marker?: string): ElementBox {
  const t: TextBox = { type: "text", key: `t-${text}`, style: {}, text, computedStyle: INITIAL_COMPUTED_STYLE };
  return { type: "element", key: `li-${text}`, style: {},
    computedStyle: { ...INITIAL_COMPUTED_STYLE, display: "list-item", ...(marker !== undefined ? { markerText: marker } : {}) },
    metadata: { list }, children: [t] };
}

describe("renderNodeToDom — list grouping", () => {
  it("groups consecutive bullet items under one <ul>", () => {
    const root = el({ display: "block", children: [
      listItem("a", { level: 0, listId: "L1", ordered: false }),
      listItem("b", { level: 0, listId: "L1", ordered: false }),
    ] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const uls = node.querySelectorAll("ul");
    expect(uls).toHaveLength(1);
    expect(uls[0]?.querySelectorAll("li")).toHaveLength(2);
  });

  it("uses <ol> for ordered items", () => {
    const root = el({ display: "block", children: [listItem("1", { level: 0, listId: "L1", ordered: true })] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.querySelector("ol")).not.toBeNull();
    expect(node.querySelector("ul")).toBeNull();
  });

  it("renders the engine markerText (NOT a native <li value>); ordinal/format come from markerText", () => {
    // The engine resolves the marker string (start-at/restart already baked in, e.g. "5." / "6.")
    // and digital renders it explicitly — it does NOT lean on the browser's native <ol> numbering.
    const root = el({ display: "block", children: [
      listItem("e", { level: 0, listId: "L1", ordered: true }, "5."),
      listItem("f", { level: 0, listId: "L1", ordered: true }, "6."),
    ] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const markers = node.querySelectorAll("li > [data-tw-marker]");
    expect(markers[0]?.textContent).toBe("5.");
    expect(markers[1]?.textContent).toBe("6.");
    // No reliance on native numbering — the <li> carries no `value` attribute.
    expect(node.querySelector("li")?.hasAttribute("value")).toBe(false);
  });

  it("an EMPTY list-item's marker is pinned to the item top, not the filler's next line (user bug)", () => {
    // Empty list-item: a <br data-tw-empty-line> filler is inserted, and the
    // absolutely-positioned marker is appended AFTER it (marker-last keeps the
    // marker glyph out of the emptiness check). Without an explicit block-start the
    // marker would fall to its STATIC position — the line after the <br> — so the
    // bullet showed on the next line until content was typed. It must be pinned to
    // the item's top.
    const root = el({ display: "block", children: [listItem("", { level: 0, listId: "L1", ordered: false }, "•")] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const li = node.querySelector("li");
    expect(li?.querySelector("br[data-tw-empty-line]")).not.toBeNull(); // filler still present
    const marker = li?.querySelector("[data-tw-marker]");
    if (!(marker instanceof HTMLElement)) throw new Error("marker");
    expect(marker.getAttribute("style")).toContain("inset-block-start: 0");
  });

  it("renders the bullet glyph from markerText and resets native list furniture (the user bug)", () => {
    const root = el({ display: "block", children: [listItem("a", { level: 0, listId: "L1", ordered: false }, "•")] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const ul = node.querySelector("ul");
    // Native list furniture reset → engine owns the indent + marker; robust to host CSS.
    expect(ul?.getAttribute("style")).toContain("list-style: none");
    expect(ul?.getAttribute("style")).toContain("padding: 0");
    const marker = node.querySelector("li > [data-tw-marker]");
    expect(marker?.textContent).toBe("•");
    // The marker is generated content: not editable, so the caret/offset machinery skips it.
    expect(marker?.getAttribute("contenteditable")).toBe("false");
  });

  it("nests a deeper level inside the current item's list", () => {
    const root = el({ display: "block", children: [
      listItem("a", { level: 0, listId: "L1", ordered: false }),
      listItem("a.1", { level: 1, listId: "L1", ordered: false }),
      listItem("b", { level: 0, listId: "L1", ordered: false }),
    ] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const topUl = node.querySelector("ul");
    expect(topUl?.querySelector("ul")).not.toBeNull();
    expect(node.querySelectorAll("li")).toHaveLength(3);
  });

  it("starts a SEPARATE list when listId changes at the same level (#425)", () => {
    const root = el({ display: "block", children: [
      listItem("a", { level: 0, listId: "L1", ordered: true }),
      listItem("b", { level: 0, listId: "L2", ordered: true }),
    ] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    expect(node.querySelectorAll("ol")).toHaveLength(2);
  });

  it("ends the list run at a non-list child (plain block after a list)", () => {
    const root = el({ display: "block", children: [
      listItem("a", { level: 0, listId: "L1", ordered: false }),
      el({ display: "block", csOverrides: { color: "red" } }),
      listItem("b", { level: 0, listId: "L1", ordered: false }),
    ] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    // two separate <ul>s (the plain block breaks the run), one <div> between
    expect(node.querySelectorAll("ul")).toHaveLength(2);
    expect(node.querySelectorAll(":scope > div")).toHaveLength(1);
  });

  it("applies the list-item's cascaded block style to its <li>, and renders the engine's lower-alpha marker", () => {
    const t: TextBox = { type: "text", key: "t", style: {}, text: "x", computedStyle: INITIAL_COMPUTED_STYLE };
    const item: ElementBox = {
      type: "element", key: "li-x", style: {},
      // The numbering service resolved this item's marker to "c." (lower-alpha, ordinal 3); the
      // browser's native list-style-type is irrelevant (suppressed by the `list-style: none` reset).
      computedStyle: { ...INITIAL_COMPUTED_STYLE, display: "list-item", textAlign: "center", markerText: "c." },
      metadata: { list: { level: 0, listId: "L1", ordered: true } },
      children: [t],
    };
    const root = el({ display: "block", children: [item] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    const li = node.querySelector("li");
    if (!(li instanceof HTMLElement)) throw new Error("li");
    expect(li.getAttribute("style")).toContain("text-align: center");
    // The document's list FORMAT reaches the view through the engine-rendered markerText, NOT the
    // browser's native list-style-type (which the reset suppresses).
    expect(li.querySelector("[data-tw-marker]")?.textContent).toBe("c.");
  });

  it("nests a non-contiguous level jump under the deepest open item, not at root (Finding 2)", () => {
    const root = el({ display: "block", children: [
      listItem("a", { level: 0, listId: "L1", ordered: false }),
      listItem("a.deep", { level: 2, listId: "L1", ordered: false }),
    ] });
    const node = renderNodeToDom(root, document);
    if (!(node instanceof HTMLElement)) throw new Error("element");
    // the deeper list must be nested inside the top <ul> (not a second root-level sibling)
    expect(node.querySelectorAll(":scope > ul")).toHaveLength(1);
    const topUl = node.querySelector("ul");
    expect(topUl?.querySelector("ul")).not.toBeNull();
    expect(node.querySelectorAll("li")).toHaveLength(2);
  });
});

describe("renderNodeToDom — data-block-id stamping (digital, 2a)", () => {
  it("stamps data-block-id on a block-level div when stamp=true", () => {
    const box = el({ display: "block" });
    const node = renderNodeToDom(box, document, true);
    if (!(node instanceof HTMLElement)) throw new Error("expected element");
    expect(node.getAttribute("data-block-id")).toBe("e"); // el() keys every box "e"
  });

  it("does NOT stamp data-block-id when stamp is omitted (read-only/print default)", () => {
    const node = renderNodeToDom(el({ display: "block" }), document);
    if (!(node instanceof HTMLElement)) throw new Error("expected element");
    expect(node.hasAttribute("data-block-id")).toBe(false);
  });

  it("stamps a heading and a list-item block element", () => {
    const h = renderNodeToDom(el({ display: "block", metadata: { headingLevel: 2 } }), document, true);
    if (!(h instanceof HTMLElement)) throw new Error("h");
    expect(h.getAttribute("data-block-id")).toBe("e");
    const liParent = el({ display: "block", children: [el({ display: "list-item", metadata: { list: { level: 0, listId: "L1", ordered: false } } })] });
    const ul = renderNodeToDom(liParent, document, true);
    if (!(ul instanceof HTMLElement)) throw new Error("ul-parent");
    const li = ul.querySelector("li");
    if (!(li instanceof HTMLElement)) throw new Error("li");
    expect(li.getAttribute("data-block-id")).toBe("e");
  });

  it("does NOT stamp the inner display:block box of an inline-image embed (F6 — composite key)", () => {
    // Mirror render-core's inline-image shape (render-core.ts ~597-637): an OUTER
    // inline-block embed box (embedType present) wrapping an INNER display:block image box
    // whose key is the COMPOSITE `${blockId}/inline/${i}/0`. A naive display proxy would stamp
    // data-block-id on the inner block box and corrupt every offset in that block. With F6
    // option (a) (stamp forced false under any inline ancestor), NEITHER the outer embed NOR
    // the inner image box gets data-block-id.
    const blockWithInlineImage = el({
      display: "block",
      children: [
        el({
          display: "inline-block",
          metadata: { embedType: "inline-image" },
          children: [el({ display: "block", metadata: { image: { src: "x", width: 4, height: 4, alt: "" } } })],
        }),
      ],
    });
    const div = renderNodeToDom(blockWithInlineImage, document, true);
    if (!(div instanceof HTMLElement)) throw new Error("block div");
    // The block itself is stamped…
    expect(div.getAttribute("data-block-id")).toBe("e");
    // …but NOTHING inside the inline-image embed is stamped with data-block-id.
    // (querySelectorAll searches DESCENDANTS only — the outer block `div` is the query
    // root and is excluded; the inline-embed span + inner image box are the descendants,
    // and neither must carry data-block-id, so the descendant count is 0.)
    expect(div.querySelectorAll("[data-block-id]").length).toBe(0); // only the block div carries it, nothing inside the embed
    const img = div.querySelector("img");
    if (!(img instanceof HTMLElement)) throw new Error("inner img");
    expect(img.hasAttribute("data-block-id")).toBe(false);
  });
});

describe("renderNodeToDom — data-inline-embed stamping (digital, 2a)", () => {
  it("stamps data-inline-embed on an inline-embed box (embedType present) and NOT data-block-id", () => {
    const embed = el({ display: "inline-block", metadata: { embedType: "footnote-anchor", contentBlockId: "fn1" } });
    const node = renderNodeToDom(embed, document, true);
    if (!(node instanceof HTMLElement)) throw new Error("embed");
    expect(node.hasAttribute("data-inline-embed")).toBe(true);
    expect(node.hasAttribute("data-block-id")).toBe(false);
  });

  it("does NOT stamp data-inline-embed on a plain inline-block (no embedType)", () => {
    const node = renderNodeToDom(el({ display: "inline-block" }), document, true);
    if (!(node instanceof HTMLElement)) throw new Error("span");
    expect(node.hasAttribute("data-inline-embed")).toBe(false);
  });
});
