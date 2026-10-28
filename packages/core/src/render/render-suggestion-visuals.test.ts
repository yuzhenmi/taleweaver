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
 * Also covered below: the paragraph-break suggestion ¶ marks (block-box metadata,
 * slice 5b) and the preview SuggestionView filter (slice 5c).
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
  formattingSuggestionKey,
  splitWithSuggestion,
  markParagraphMarkDeletion,
  createTestAllocator,
  createPosition,
} from "../state";
import type { BlockId, SuggestionId, SuggestionRecord, State } from "../state";
import { applyOperation, acceptSuggestion } from "../state";
// `writeSuggestionRecordInTx` is intra-state (not re-exported from the barrel),
// imported directly to seed records — mirrors suggestion-ops.test.ts.
import { writeSuggestionRecordInTx } from "../state/suggestions";
import { getSuggestionsMap } from "../state/yjs-doc";
import { getRegistry } from "../state/registry";
import { INSERTION_TAG_KEY } from "../state/break-tags";
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
    if (node.type === "element") for (const child of node.children) walk(child);
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
        text("formatted", { italic: true, [formattingSuggestionKey(id)]: true }),
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

  it("stacked formatting suggestions composite in (createdAt, id) order; the newest author tints; a proposed removal previews; a record-less tag is ignored", () => {
    const older = "fA" as SuggestionId;
    const newer = "fB" as SuggestionId;
    const gone = "fGone" as SuggestionId;
    const state = buildDoc(
      inlineContent([
        text("stacked", {
          italic: true,
          [formattingSuggestionKey(newer)]: true,
          [formattingSuggestionKey(older)]: true,
          [formattingSuggestionKey(gone)]: true,
        }),
      ]),
      [
        { id: older, kind: "formatting", author: AUTHOR, createdAt: 1, proposedAttrs: { bold: true, fontSize: 20 } },
        { id: newer, kind: "formatting", author: "bob", createdAt: 2, proposedAttrs: { fontSize: 30, italic: undefined } },
      ],
    );
    const box = textBoxWith(render(state, reg, attrReg).root, "stacked");
    expect(box.style.fontWeight).toBe("bold"); // older's bold
    expect(box.style.fontSize).toBe(30); // newer wins the conflicting key
    expect(box.style.fontStyle).toBeUndefined(); // newer proposes removing italic
    expect(box.style.color).toBe(authorColorOf("bob"));
    expect(box.style.underline).toBe(true);
    // "final" view = the same composite, without the indicator; "original" = live.
    const final = textBoxWith(render(state, reg, attrReg, { suggestionView: "final" }).root, "stacked");
    expect([final.style.fontWeight, final.style.fontSize, final.style.underline]).toEqual(["bold", 30, undefined]);
    const original = textBoxWith(render(state, reg, attrReg, { suggestionView: "original" }).root, "stacked");
    expect([original.style.fontWeight, original.style.fontStyle]).toEqual([undefined, "italic"]);
  });

  it("a visible embed tagged by a formatting suggestion gets the same composite + indicator; its final view equals accepting it", () => {
    const id = "fEmb" as SuggestionId;
    const build = (): State =>
      buildDoc(
        inlineContent([text("x"), embed("tab", {}, { [formattingSuggestionKey(id)]: true }), text("y")]),
        [{ id, kind: "formatting", author: "bob", createdAt: 1, proposedAttrs: { bold: true } }],
      );
    const tabBox = (root: RenderNode): ElementBox => {
      let found: ElementBox | null = null;
      const walk = (n: RenderNode): void => {
        if (found !== null || n.type !== "element") return;
        const el = n;
        if (el.metadata?.embedType === "tab") found = el;
        else for (const c of el.children) walk(c);
      };
      walk(root);
      if (found === null) throw new Error("no tab box");
      return found;
    };
    const suggesting = tabBox(render(build(), reg, attrReg).root).style;
    expect([suggesting.fontWeight, suggesting.underline, suggesting.color]).toEqual(["bold", true, authorColorOf("bob")]);
    const final = tabBox(render(build(), reg, attrReg, { suggestionView: "final" }).root).style;
    const accepted = tabBox(render(acceptSuggestion(build(), id).state, reg, attrReg).root).style;
    expect(final).toEqual(accepted);
    expect(final.fontWeight).toBe("bold");
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
// Formatting marks in flow
//
// A suggested paragraph break is a KEY on its ¶'s registry entry, not an inline
// item. The ¶ is block-box METADATA on the paragraph it ends:
// `metadata.endMark = { kind, color, suggestionIds }` — no IFC token, no offset —
// on the block whose OWN ¶ is keyed; a section-end ¶ draws a
// `section-*` kind on that paragraph. Shown only while the record exists, only in the
// literal "suggesting" view.
// ─────────────────────────────────────────────────────────────────────────

/** The ElementBox rendered for block `id` (its key), or null. */
function blockBox(root: RenderNode, id: string): ElementBox | null {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (found !== null || node.type !== "element") return;
    if (node.key === id) {
      found = node;
      return;
    }
    for (const child of node.children) walk(child);
  }
  walk(root);
  return found;
}


/** doc > p("abc"), split (suggested, by AUTHOR) at offset 2 → head("ab", keyed ¶) | p("c"). */
function buildSplitDoc(id: SuggestionId): { state: State; head: BlockId } {
  const r = splitWithSuggestion(buildDoc(inlineContent([text("abc")]), []), createPosition("p" as BlockId, 2), createTestAllocator("n"), {
    id,
    author: AUTHOR,
    createdAt: 0,
  });
  return { state: r.state, head: r.newBlockId };
}

/** doc > p1("ab") | p2("c"), with ¶p1 suggested for deletion (by AUTHOR). */
function buildJoinDoc(id: SuggestionId): State {
  const base = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("ab")]) }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("c")]) }),
    ],
  });
  return markParagraphMarkDeletion(base, "p1" as BlockId, { id, author: AUTHOR, createdAt: 0 }).state;
}

/** doc > s1[a("A")] | s2[b("B")]: ¶a is the section-end item of s1. */
function twoSections(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
      buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "a", lastChildId: "a" }),
      buildBlock({ id: "a", type: "paragraph", parentId: "s1", inlineContent: inlineContent([text("A")]) }),
      buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "b", lastChildId: "b" }),
      buildBlock({ id: "b", type: "paragraph", parentId: "s2", inlineContent: inlineContent([text("B")]) }),
    ],
  });
}

describe("render — tracked ¶ metadata (endMark self-derived)", () => {
  it("a split draws an author-colored `split` endMark on the block whose OWN ¶ is inserted (the new head); no inline child, no ¶ text", () => {
    const id = "split" as SuggestionId;
    const { state, head } = buildSplitDoc(id);
    const root = render(state, reg, attrReg).root;
    expect(blockBox(root, head)?.metadata?.endMark).toEqual({ kind: "split", color: authorColorOf(AUTHOR), suggestionIds: [id] });
    expect(blockBox(root, "p")?.metadata?.endMark).toBeUndefined();
    expect(allTexts(root).join("")).toBe("abc");
  });

  it("a join draws an author-colored `join` endMark on the block whose ¶ is suggested for deletion", () => {
    const id = "join" as SuggestionId;
    const root = render(buildJoinDoc(id), reg, attrReg).root;
    expect(blockBox(root, "p1")?.metadata?.endMark).toEqual({ kind: "join", color: authorColorOf(AUTHOR), suggestionIds: [id] });
    expect(blockBox(root, "p2")?.metadata?.endMark).toBeUndefined();
    expect(allTexts(root)).not.toContain("¶");
  });

  it("a key on the first block's own ¶ is drawn on that block", () => {
    const id = "s" as SuggestionId;
    const base = buildDoc(inlineContent([text("abc")]), [{ id, kind: "insertion", author: AUTHOR, createdAt: 0 }]);
    const tagged = applyOperation(base, (doc) => {
      getRegistry(doc).get("p")?.set(INSERTION_TAG_KEY, id);
    }).state;
    expect(blockBox(render(tagged, reg, attrReg).root, "p")?.metadata?.endMark).toEqual({ kind: "split", color: authorColorOf(AUTHOR), suggestionIds: [id] });
  });

  it("a tag whose record is gone draws no mark", () => {
    const id = "orphan" as SuggestionId;
    const { state, head } = buildSplitDoc(id);
    const orphaned = applyOperation(state, (doc) => {
      getSuggestionsMap(doc).delete(id);
      return new Set([state.rootId]);
    }).state;
    expect(blockBox(render(orphaned, reg, attrReg).root, head)?.metadata?.endMark).toBeUndefined();
  });

  it("a section-end ¶ draws a `section-*` endMark on its own paragraph, only in the suggesting view", () => {
    const id = "sb" as SuggestionId;
    const keyed = markParagraphMarkDeletion(twoSections(), "a" as BlockId, { id, author: AUTHOR, createdAt: 0 }).state;
    const root = render(keyed, reg, attrReg).root;
    expect(blockBox(root, "a")?.metadata?.endMark).toEqual({ kind: "section-join", color: authorColorOf(AUTHOR), suggestionIds: [id] });
    expect(blockBox(root, "b")?.metadata?.endMark).toBeUndefined();
    expect(blockBox(render(keyed, reg, attrReg, { suggestionView: "final" }).root, "a")?.metadata?.endMark).toBeUndefined();

    const ins = "si" as SuggestionId;
    const inserted = applyOperation(twoSections(), (doc) => {
      getRegistry(doc).get("a")?.set(INSERTION_TAG_KEY, ins);
      writeSuggestionRecordInTx(doc, { id: ins, kind: "insertion", author: AUTHOR, createdAt: 0 });
    }).state;
    expect(blockBox(render(inserted, reg, attrReg).root, "a")?.metadata?.endMark).toEqual({ kind: "section-insert", color: authorColorOf(AUTHOR), suggestionIds: [ins] });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Slice 5c-iii — render preview-view projection. `render(..., {suggestionView})`
// filters resolved-away items AND suppresses the 5a/5b suggestion visuals:
//   - "final" (accept all): deletion runs GONE; insertion runs render as plain
//     text; formatting proposals applied FOR REAL (no underline).
//   - "original" (reject all): insertion runs GONE; deletion runs render as plain
//     text; formatting proposals dropped (live attrs only).
//   - neither preview view draws a boundary ¶ mark.
// ─────────────────────────────────────────────────────────────────────────

/** All TextBox.text strings in document order. */
function allTexts(root: RenderNode): string[] {
  const out: string[] = [];
  function walk(node: RenderNode): void {
    if (node.type === "text") {
      out.push(node.text);
      return;
    }
    for (const child of node.children) walk(child);
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
    if (node.type === "element") for (const child of node.children) walk(child);
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
      inlineContent([text("formatted", { italic: true, [formattingSuggestionKey(id)]: true })]),
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
      inlineContent([text("formatted", { italic: true, [formattingSuggestionKey(id)]: true })]),
      [{ id, kind: "formatting", author: AUTHOR, createdAt: 0, proposedAttrs: { bold: true } }],
    );
    const box = textBoxWith(render(state, reg, attrReg, { suggestionView: "original" }).root, "formatted");
    expect(box.style.fontWeight).toBeUndefined(); // proposal NOT applied
    expect(box.style.fontStyle).toBe("italic");
    expect(box.style.underline).toBeUndefined();
  });

  it("break tags: a SURVIVING break draws no ¶ mark in preview views", () => {
    // "final": a split SURVIVES (accepted) but shows no mark — its break is the
    // block boundary itself.
    const { state: splitState, head } = buildSplitDoc("split" as SuggestionId);
    const splitRoot = render(splitState, reg, attrReg, { suggestionView: "final" }).root;
    expect(allTexts(splitRoot).join("")).toBe("abc");
    expect(blockBox(splitRoot, head)?.metadata?.endMark).toBeUndefined();

    // Symmetric: a join SURVIVES in "original" (rejected) → no mark either.
    const joinRoot = render(buildJoinDoc("join" as SuggestionId), reg, attrReg, { suggestionView: "original" }).root;
    expect(blockBox(joinRoot, "p1")?.metadata?.endMark).toBeUndefined();
    expect(allTexts(joinRoot)).not.toContain("¶");
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
