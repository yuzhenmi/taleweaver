/**
 * Change-tracking slice 5a — `expandInlineItems` resolves the suggestion VISUALS
 * for runs carrying one of the three inline suggestion dimensions
 * (`insertionSuggestionId` / `deletionSuggestionId` / `formattingSuggestionId`).
 *
 * Per design §5 (Render of tracked changes):
 *   - insertion run  → author color + `underline`.
 *   - deletion run   → author color + `lineThrough` (struck, still laid out).
 *   - formatting run → base style + `proposedAttrs` composited + author-color
 *     `underline` indicator (the proposal is SHOWN, not yet applied for real).
 *   - nested ins+del → author color + `underline` + `lineThrough`.
 *   - a plain run (no suggestion ids) is byte-identical to today.
 *
 * The author color comes from `authorColorOf(author)` (deterministic per author).
 * This slice does NOT touch the break-suggestion embeds (pilcrows = slice 5b) or
 * the preview SuggestionView filter (slice 5c).
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox, TextBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
  embed,
} from "../test-utils/state-builders";
import {
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
} from "../state";
import type { SuggestionId, SuggestionRecord, State } from "../state";
import { applyOperation } from "../state";
// `writeSuggestionRecordInTx` is intra-state (not re-exported from the barrel),
// imported directly to seed records — mirrors suggestion-ops.test.ts.
import { writeSuggestionRecordInTx } from "../state/suggestions";
import { authorColorOf } from "../styles";
import type { ReadonlyAttrs } from "../state";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

const AUTHOR = "alice";

/** Find the first TextBox whose text equals `t`. */
function textBoxWith(root: RenderNode, t: string): TextBox {
  let found: TextBox | null = null;
  function walk(node: RenderNode): void {
    if (found !== null) return;
    if (node.type === "text") {
      if ((node as TextBox).text === t) found = node as TextBox;
      return;
    }
    for (const child of (node as ElementBox).children) walk(child);
  }
  walk(root);
  if (found === null) throw new Error(`no TextBox with text "${t}"`);
  return found;
}

/** doc > p( [items] ), with the given suggestion records seeded in the map. */
function buildDoc(
  items: ReturnType<typeof inlineContent>,
  records: readonly SuggestionRecord[],
): State {
  let state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: items }),
    ],
  });
  for (const record of records) {
    state = applyOperation(state, (doc) => writeSuggestionRecordInTx(doc, record)).state;
  }
  return state;
}

describe("expandInlineItems — suggestion visuals (slice 5a)", () => {
  it("insertion run gets author color + underline", () => {
    const id = "ins" as SuggestionId;
    const state = buildDoc(
      inlineContent([text("inserted", { [INSERTION_SUGGESTION_ATTR]: id })]),
      [{ id, kind: "insertion", author: AUTHOR, createdAt: 0 }],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "inserted");
    expect(box.style.underline).toBe(true);
    expect(box.style.color).toBe(authorColorOf(AUTHOR));
    expect(box.style.lineThrough).toBeUndefined();
  });

  it("deletion run gets author color + lineThrough (still laid out)", () => {
    const id = "del" as SuggestionId;
    const state = buildDoc(
      inlineContent([text("deleted", { [DELETION_SUGGESTION_ATTR]: id })]),
      [{ id, kind: "deletion", author: AUTHOR, createdAt: 0 }],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "deleted");
    expect(box.style.lineThrough).toBe(true);
    expect(box.style.color).toBe(authorColorOf(AUTHOR));
    expect(box.style.underline).toBeUndefined();
  });

  it("formatting run composites proposedAttrs + author-color underline indicator, live attrs unchanged", () => {
    const id = "fmt" as SuggestionId;
    const proposedAttrs: ReadonlyAttrs = { bold: true };
    const state = buildDoc(
      // The LIVE run carries italic; the proposal is to ALSO make it bold.
      inlineContent([
        text("formatted", { italic: true, [FORMATTING_SUGGESTION_ATTR]: id }),
      ]),
      [{ id, kind: "formatting", author: AUTHOR, createdAt: 0, proposedAttrs }],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "formatted");
    // Proposed bold is SHOWN (composited as the preview).
    expect(box.style.fontWeight).toBe("bold");
    // Live italic is unchanged.
    expect(box.style.fontStyle).toBe("italic");
    // The author-color underline indicator is present.
    expect(box.style.underline).toBe(true);
    expect(box.style.color).toBe(authorColorOf(AUTHOR));
  });

  it("nested insertion+deletion run gets author color + underline + lineThrough", () => {
    const insId = "ins" as SuggestionId;
    const delId = "del" as SuggestionId;
    const state = buildDoc(
      inlineContent([
        text("nested", {
          [INSERTION_SUGGESTION_ATTR]: insId,
          [DELETION_SUGGESTION_ATTR]: delId,
        }),
      ]),
      [
        { id: insId, kind: "insertion", author: AUTHOR, createdAt: 0 },
        { id: delId, kind: "deletion", author: AUTHOR, createdAt: 0 },
      ],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "nested");
    expect(box.style.underline).toBe(true);
    expect(box.style.lineThrough).toBe(true);
    expect(box.style.color).toBe(authorColorOf(AUTHOR));
  });

  it("plain run (no suggestion ids) is byte-identical to a no-suggestion baseline", () => {
    // Baseline: same text, no records, no suggestion attrs.
    const baseline = buildDoc(inlineContent([text("plain", { bold: true })]), []);
    const baselineBox = textBoxWith(render(baseline, reg, attrReg).root, "plain");
    // The plain run must carry NO suggestion override.
    expect(baselineBox.style.underline).toBeUndefined();
    expect(baselineBox.style.lineThrough).toBeUndefined();
    // color is not set by a plain bold run (it inherits, resolved at cascade).
    expect(baselineBox.style.color).toBeUndefined();
    // The live bold is intact.
    expect(baselineBox.style.fontWeight).toBe("bold");
  });
});

describe("expandInlineItems — link passthrough (#521)", () => {
  it("carries item.attrs.link onto the render TextBox", () => {
    const state = buildDoc(
      inlineContent([text("click", { link: "https://x.com" })]),
      [],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "click");
    expect(box.type).toBe("text");
    expect(box.link).toBe("https://x.com");
  });

  it("leaves link undefined on a TextBox built from an unlinked item", () => {
    const state = buildDoc(inlineContent([text("plain")]), []);
    const box = textBoxWith(render(state, reg, attrReg).root, "plain");
    expect(box.link).toBeUndefined();
  });
});

describe("authorColorOf", () => {
  it("is deterministic per author", () => {
    expect(authorColorOf("alice")).toBe(authorColorOf("alice"));
    expect(authorColorOf("bob")).toBe(authorColorOf("bob"));
  });

  it("maps two distinct example authors to distinct colors", () => {
    expect(authorColorOf("alice")).not.toBe(authorColorOf("carol"));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Slice 5b — break-suggestion pilcrow glyphs
//
// A suggested paragraph break (the `block-split-suggestion` / `block-join-
// suggestion` embeds appended to the END of block N, carrying the owning id in
// `properties.suggestionId`) renders as a VISIBLE pilcrow (¶) instead of the
// zero-width comment-marker atom: a split is INSERTION-flavored (author color +
// underline), a join is DELETION-flavored (author color + lineThrough). Like the
// cross-reference embed, the glyph is wrapped in a SINGLE inline-block atom so it
// still emits exactly ONE IFC token (one state-model offset) regardless of glyph
// width — preserving the offset↔box 1:1 invariant the break embed relies on.
// ─────────────────────────────────────────────────────────────────────────

/** Find the first ElementBox whose metadata stamps `embedType === t`. */
function embedBoxWith(root: RenderNode, t: string): ElementBox {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (found !== null) return;
    if (node.type === "element") {
      const el = node as ElementBox;
      if (el.metadata?.embedType === t) {
        found = el;
        return;
      }
      for (const child of el.children) walk(child);
    }
  }
  walk(root);
  if (found === null) throw new Error(`no ElementBox with embedType "${t}"`);
  return found;
}

/** The single ¶ glyph TextBox a break-suggestion embed box wraps. */
function pilcrowChild(box: ElementBox): TextBox {
  expect(box.children.length).toBe(1);
  const child = box.children[0];
  if (child === undefined) throw new Error("expected one pilcrow child");
  expect(child.type).toBe("text");
  return child as TextBox;
}

/** doc > p( "abc" + the given break embed ), with one suggestion record seeded. */
function buildBreakDoc(
  embedType: string,
  id: SuggestionId,
  record: SuggestionRecord,
): State {
  return buildDoc(
    inlineContent([
      text("abc"),
      embed(embedType, { suggestionId: id }),
    ]),
    [record],
  );
}

describe("expandInlineItems — break-suggestion pilcrows (slice 5b)", () => {
  it("split embed renders a ¶ pilcrow with author color + underline (insertion-flavored)", () => {
    const id = "split" as SuggestionId;
    const state = buildBreakDoc(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, id, {
      id,
      kind: "insertion",
      author: AUTHOR,
      createdAt: 0,
    });
    const box = embedBoxWith(render(state, reg, attrReg).root, BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
    // One atomic inline-block (offset↔box 1:1 preserved), now VISIBLE.
    expect(box.style.display).toBe("inline-block");
    const glyph = pilcrowChild(box);
    expect(glyph.text).toBe("¶");
    expect(glyph.style.underline).toBe(true);
    expect(glyph.style.lineThrough).toBeUndefined();
    expect(glyph.style.color).toBe(authorColorOf(AUTHOR));
  });

  it("join embed renders a ¶ pilcrow with author color + lineThrough (deletion-flavored)", () => {
    const id = "join" as SuggestionId;
    const state = buildBreakDoc(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, id, {
      id,
      kind: "deletion",
      author: AUTHOR,
      createdAt: 0,
    });
    const box = embedBoxWith(render(state, reg, attrReg).root, BLOCK_JOIN_SUGGESTION_EMBED_TYPE);
    expect(box.style.display).toBe("inline-block");
    const glyph = pilcrowChild(box);
    expect(glyph.text).toBe("¶");
    expect(glyph.style.lineThrough).toBe(true);
    expect(glyph.style.underline).toBeUndefined();
    expect(glyph.style.color).toBe(authorColorOf(AUTHOR));
  });

  it("break embed with no resolvable record still renders a struck/added ¶ but no author color", () => {
    // A split embed whose owning record is absent (collab race / migration): the
    // decoration still marks it (the embed TYPE alone determines split=underline)
    // but the author tint falls through to the cascade (no override).
    const id = "orphan" as SuggestionId;
    const state = buildDoc(
      inlineContent([
        text("abc"),
        embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: id }),
      ]),
      [], // no record seeded
    );
    const box = embedBoxWith(render(state, reg, attrReg).root, BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
    const glyph = pilcrowChild(box);
    expect(glyph.text).toBe("¶");
    expect(glyph.style.underline).toBe(true);
    expect(glyph.style.color).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Slice 5c-iii — render preview-view projection. `render(..., {suggestionView})`
// filters resolved-away items AND suppresses the 5a/5b suggestion visuals:
//   - "final" (accept all): deletion runs + join pilcrows GONE; insertion runs
//     render as plain text; formatting proposals applied FOR REAL (no underline).
//   - "original" (reject all): insertion runs + split pilcrows GONE; deletion
//     runs render as plain text; formatting proposals dropped (live attrs only).
// ─────────────────────────────────────────────────────────────────────────

/** All TextBox.text strings in document order. */
function allTexts(root: RenderNode): string[] {
  const out: string[] = [];
  function walk(node: RenderNode): void {
    if (node.type === "text") {
      out.push((node as TextBox).text);
      return;
    }
    for (const child of (node as ElementBox).children) walk(child);
  }
  walk(root);
  return out;
}

/** First TextBox with text `t`, or null if absent. */
function maybeTextBox(root: RenderNode, t: string): TextBox | null {
  let found: TextBox | null = null;
  function walk(node: RenderNode): void {
    if (found !== null) return;
    if (node.type === "text") {
      if ((node as TextBox).text === t) found = node as TextBox;
      return;
    }
    for (const child of (node as ElementBox).children) walk(child);
  }
  walk(root);
  return found;
}

describe("render — SuggestionView preview projection (slice 5c-iii)", () => {
  it('"final" drops deletion text, renders insertion as plain (no decoration)', () => {
    const insId = "ins" as SuggestionId;
    const delId = "del" as SuggestionId;
    const state = buildDoc(
      inlineContent([
        text("keep"),
        text("INS", { [INSERTION_SUGGESTION_ATTR]: insId }),
        text("DEL", { [DELETION_SUGGESTION_ATTR]: delId }),
      ]),
      [
        { id: insId, kind: "insertion", author: AUTHOR, createdAt: 0 },
        { id: delId, kind: "deletion", author: AUTHOR, createdAt: 0 },
      ],
    );
    const root = render(state, reg, attrReg, { suggestionView: "final" }).root;
    // Deletion text is gone; insertion + plain survive.
    expect(maybeTextBox(root, "DEL")).toBeNull();
    const ins = maybeTextBox(root, "INS");
    expect(ins).not.toBeNull();
    // Insertion renders as PLAIN accepted text — no suggestion decoration.
    expect(ins?.style.underline).toBeUndefined();
    expect(ins?.style.color).toBeUndefined();
  });

  it('"original" drops insertion text, renders deletion as plain (no strikethrough)', () => {
    const insId = "ins" as SuggestionId;
    const delId = "del" as SuggestionId;
    const state = buildDoc(
      inlineContent([
        text("keep"),
        text("INS", { [INSERTION_SUGGESTION_ATTR]: insId }),
        text("DEL", { [DELETION_SUGGESTION_ATTR]: delId }),
      ]),
      [
        { id: insId, kind: "insertion", author: AUTHOR, createdAt: 0 },
        { id: delId, kind: "deletion", author: AUTHOR, createdAt: 0 },
      ],
    );
    const root = render(state, reg, attrReg, { suggestionView: "original" }).root;
    expect(maybeTextBox(root, "INS")).toBeNull();
    const del = maybeTextBox(root, "DEL");
    expect(del).not.toBeNull();
    expect(del?.style.lineThrough).toBeUndefined();
    expect(del?.style.color).toBeUndefined();
  });

  it('"final" applies a formatting proposal FOR REAL (bold), no underline indicator', () => {
    const id = "fmt" as SuggestionId;
    const state = buildDoc(
      inlineContent([text("formatted", { italic: true, [FORMATTING_SUGGESTION_ATTR]: id })]),
      [{ id, kind: "formatting", author: AUTHOR, createdAt: 0, proposedAttrs: { bold: true } }],
    );
    const box = textBoxWith(render(state, reg, attrReg, { suggestionView: "final" }).root, "formatted");
    expect(box.style.fontWeight).toBe("bold"); // proposal applied for real
    expect(box.style.fontStyle).toBe("italic"); // live attr kept
    expect(box.style.underline).toBeUndefined(); // NO suggestion indicator
    expect(box.style.color).toBeUndefined();
  });

  it('"original" drops a formatting proposal (live attrs only, no preview)', () => {
    const id = "fmt" as SuggestionId;
    const state = buildDoc(
      inlineContent([text("formatted", { italic: true, [FORMATTING_SUGGESTION_ATTR]: id })]),
      [{ id, kind: "formatting", author: AUTHOR, createdAt: 0, proposedAttrs: { bold: true } }],
    );
    const box = textBoxWith(render(state, reg, attrReg, { suggestionView: "original" }).root, "formatted");
    expect(box.style.fontWeight).toBeUndefined(); // proposal NOT applied
    expect(box.style.fontStyle).toBe("italic");
    expect(box.style.underline).toBeUndefined();
  });

  it('break embeds: a SURVIVING break renders zero-width (no ¶) in preview views', () => {
    // "final": a split SURVIVES (accepted) but shows no pilcrow — its break is the
    // block boundary itself (the structural merge is the carved 5c-structural).
    const splitId = "split" as SuggestionId;
    const splitState = buildDoc(
      inlineContent([text("a"), embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: splitId }), text("b")]),
      [{ id: splitId, kind: "insertion", author: AUTHOR, createdAt: 0 }],
    );
    const splitRoot = render(splitState, reg, attrReg, { suggestionView: "final" }).root;
    expect(allTexts(splitRoot).join("")).toBe("ab");
    expect(allTexts(splitRoot)).not.toContain("¶");
    // The embed box is PRESENT (rendered zero-width), NOT dropped — locks the
    // distinction the text-only assertions above can't (both pass if dropped).
    const splitBox = embedBoxWith(splitRoot, BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
    expect(splitBox.children).toHaveLength(0);
    expect(splitBox.style.inlineSize).toBe(0);

    // Symmetric: a join SURVIVES in "original" (rejected) → same zero-width atom.
    const joinId = "join" as SuggestionId;
    const joinState = buildDoc(
      inlineContent([text("a"), embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: joinId }), text("b")]),
      [{ id: joinId, kind: "deletion", author: AUTHOR, createdAt: 0 }],
    );
    const joinRoot = render(joinState, reg, attrReg, { suggestionView: "original" }).root;
    expect(allTexts(joinRoot)).not.toContain("¶");
    const joinBox = embedBoxWith(joinRoot, BLOCK_JOIN_SUGGESTION_EMBED_TYPE);
    expect(joinBox.children).toHaveLength(0);
  });

  it("default (no option) renders the literal suggesting view with 5a visuals intact", () => {
    const id = "ins" as SuggestionId;
    const state = buildDoc(
      inlineContent([text("inserted", { [INSERTION_SUGGESTION_ATTR]: id })]),
      [{ id, kind: "insertion", author: AUTHOR, createdAt: 0 }],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "inserted");
    expect(box.style.underline).toBe(true);
    expect(box.style.color).toBe(authorColorOf(AUTHOR));
  });
});
