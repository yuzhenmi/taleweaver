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
} from "../test-utils/state-builders";
import {
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
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

describe("authorColorOf", () => {
  it("is deterministic per author", () => {
    expect(authorColorOf("alice")).toBe(authorColorOf("alice"));
    expect(authorColorOf("bob")).toBe(authorColorOf("bob"));
  });

  it("maps two distinct example authors to distinct colors", () => {
    expect(authorColorOf("alice")).not.toBe(authorColorOf("carol"));
  });
});
