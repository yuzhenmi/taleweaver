/**
 * Change-tracking slice 4c-iii: DELETE_LINE branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. DELETE_LINE is BACKWARD-only
 * (deletes from `lineStart` to the caret). In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) it SOFT-deletes — it stamps the
 * in-range runs with a `deletionSuggestionId` (the text STAYS, struck-through)
 * via `markDeletion` (the shared `deleteRangeOrSuggest` helper) instead of really
 * removing it. Because delete-line is backward-only the caret stays at the span
 * START (`lineStart`) in BOTH modes — there is no directional caret rule.
 *
 * DELETE_LINE is structurally simple — a cross-block line delete is already a
 * NO-OP in BOTH modes (line boundaries stay inside one block), so there is no
 * structural gate.
 *
 * Migrated from `packages/core/src/editor/actions/delete-line-suggesting.test.ts`
 * (Phase 0b: DELETE_LINE left core's reducer for the print backend — a DELETE_LINE
 * NavIntent → `resolveNavIntent` resolves the line span against the driver layout
 * and returns a geometry-free `DELETE_RANGE`, which core applies through the same
 * `deleteRangeOrSuggest` soft-delete path). Assertions byte-identical; the line is
 * one line under the mock measurer so `lineStart` is offset 0. Text is seeded in
 * DIRECT mode, then the line-delete runs against a SUGGESTING config.
 */
import { describe, it, expect } from "vitest";
import {
  getBlock,
  getSuggestions,
  type BlockId,
  type State,
} from "@taleweaver/core";
import { makeNavEditor, dispatch, nav, firstBlockId, type NavCtx } from "./nav-test-helpers";

/** Throwing indexed access for tests: stronger than the old undefined-deref TypeError. */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Plain text of a block (concatenation of its text-item runs). */
function getTextOf(state: State, blockId: BlockId): string {
  const block = getBlock(state, blockId);
  if (block === null || block.inlineContent === null) return "";
  return block.inlineContent.items
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/** The `deletionSuggestionId` carried by the run at character index `idx`, or
 *  `undefined` if no text run covers it / the run carries no deletion id. */
function deletionIdAt(state: State, paraId: BlockId, idx: number): unknown {
  const items = getBlock(state, paraId)?.inlineContent?.items ?? [];
  let offset = 0;
  for (const it of items) {
    if (it.kind !== "text") continue;
    if (idx >= offset && idx < offset + it.text.length) {
      return it.attrs.deletionSuggestionId;
    }
    offset += it.text.length;
  }
  return undefined;
}

/** Build a direct-mode ctx with `text` typed into the (single) body paragraph. */
function seed(text: string): NavCtx {
  let ctx = makeNavEditor({ containerWidth: 200 });
  for (const ch of text) ctx = dispatch(ctx, { type: "INSERT_TEXT", text: ch });
  return ctx;
}

/** Swap a ctx into suggesting mode (author "alice") for subsequent edits. */
function asSuggesting(ctx: NavCtx): NavCtx {
  return { ...ctx, config: { ...ctx.config, suggestingAuthor: "alice" } };
}

/** Place a collapsed caret at `offset` of `paraId`. */
function caretAt(ctx: NavCtx, paraId: BlockId, offset: number): NavCtx {
  return dispatch(ctx, {
    type: "SET_SELECTION",
    selection: { anchor: { blockId: paraId, offset }, focus: { blockId: paraId, offset } },
  });
}

/** Select `[start, end)` of `paraId`. */
function select(ctx: NavCtx, paraId: BlockId, start: number, end: number): NavCtx {
  return dispatch(ctx, {
    type: "SET_SELECTION",
    selection: { anchor: { blockId: paraId, offset: start }, focus: { blockId: paraId, offset: end } },
  });
}

describe("handleDeleteLine — suggesting mode (slice 4c-iii)", () => {
  it("line-delete: SOFT-deletes lineStart→caret (tagged, text intact, caret at line start, one deletion record)", () => {
    // "hello" fits on one line (mock measurer 8px/char, 200px container) so the
    // whole block is one line; lineStart = offset 0.
    const seeded = seed("hello");
    const paraId = firstBlockId(seeded);
    let ctx = asSuggesting(seeded);
    ctx = caretAt(ctx, paraId, 5); // caret at end

    const next = nav(ctx, { type: "DELETE_LINE" });

    // Text intact; the whole line "hello" (0..4) carries the deletion id.
    expect(getTextOf(next.editor.state, paraId)).toBe("hello");
    const suggestions = getSuggestions(next.editor.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(next.editor.state, paraId, 0)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next.editor.state, paraId, 4)).toBe(nth(suggestions, 0, "suggestion").id);
    // Caret collapses to the line START (offset 0).
    expect(next.editor.selection.anchor).toEqual(next.editor.selection.focus);
    expect(next.editor.selection.focus.blockId).toBe(paraId);
    expect(next.editor.selection.focus.offset).toBe(0);
  });

  it("is undoable: UNDO reverts a suggesting line-delete (no deletion id, no record)", () => {
    const seeded = seed("hello");
    const paraId = firstBlockId(seeded);
    let ctx = asSuggesting(seeded);
    ctx = caretAt(ctx, paraId, 5);
    const struck = nav(ctx, { type: "DELETE_LINE" });

    expect(struck.editor.history.canUndo()).toBe(true);

    const undone = dispatch(struck, { type: "UNDO" });
    expect(getTextOf(undone.editor.state, paraId)).toBe("hello");
    expect(deletionIdAt(undone.editor.state, paraId, 0)).toBeUndefined();
    expect(getSuggestions(undone.editor.state)).toHaveLength(0);
  });

  it("direct mode (regression): the SAME line-delete REMOVES the line text, caret at line start, no suggestion", () => {
    let ctx = seed("hello");
    const paraId = firstBlockId(ctx);
    ctx = caretAt(ctx, paraId, 5);

    const next = nav(ctx, { type: "DELETE_LINE" });

    expect(getTextOf(next.editor.state, paraId)).toBe("");
    expect(next.editor.selection.focus.offset).toBe(0);
    expect(getSuggestions(next.editor.state)).toHaveLength(0);
  });

  it("expanded-selection line-delete: SOFT-deletes the selection, caret at span start (text intact, struck)", () => {
    const seeded = seed("abcdef");
    const paraId = firstBlockId(seeded);
    let ctx = asSuggesting(seeded);
    ctx = select(ctx, paraId, 1, 4); // select "bcd"

    const next = nav(ctx, { type: "DELETE_LINE" });

    expect(getTextOf(next.editor.state, paraId)).toBe("abcdef");
    const suggestions = getSuggestions(next.editor.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(deletionIdAt(next.editor.state, paraId, 1)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next.editor.state, paraId, 3)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next.editor.state, paraId, 0)).toBeUndefined();
    expect(deletionIdAt(next.editor.state, paraId, 4)).toBeUndefined();
    // Caret at the selection START (offset 1 = span start).
    expect(next.editor.selection.anchor).toEqual(next.editor.selection.focus);
    expect(next.editor.selection.focus.blockId).toBe(paraId);
    expect(next.editor.selection.focus.offset).toBe(1);
  });
});
