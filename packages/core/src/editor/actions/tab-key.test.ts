/**
 * `INSERT_TAB` + `SET_TAB_STOPS` editor actions (S7 of tab stops).
 *
 *  - `INSERT_TAB` splices the existing atomic `"tab"` embed at the caret (a
 *    bodyless inline-embed insert, mirroring `INSERT_CROSS_REFERENCE`). Each Tab
 *    is its OWN discrete undo step (`"command"` coalescing — Google Docs).
 *  - `SET_TAB_STOPS` writes the per-block `tabStops` attr via `mergeBlockAttrs`
 *    (preserving the block's other attrs — `textAlign`/`marginInlineStart`/…),
 *    mirroring `handleSetTextAlign`.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createPosition,
  createSpan,
} from "./test-helpers";
import type { EditorState } from "../editor-state";
import { getBlock, createHistory } from "../../state";
import type { BlockId, State } from "../../state";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { coalesceKeyOf } from "../coalesce-key";
import type { EditorAction } from "../editor-action";

// Phase 0b: core's `EditorState` is geometry-free — these state-level action
// tests build only the geometry-free fields (the handlers read no layout).
function makeEditor(state: State, selection: EditorState["selection"]): EditorState {
  return {
    state,
    selection,
    history: createHistory(state),
    lastDirtyIds: null,
    containerWidth: config.containerWidth,
    targetX: null,
  };
}

/** A doc with one paragraph "p" carrying inline content [text("ab")]. */
function paragraphDoc(attrs: Record<string, unknown> = {}): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs,
        inlineContent: inlineContent([text("ab")]),
      }),
    ],
  });
}

describe("INSERT_TAB action", () => {
  it("INSERT_TAB inserts a 'tab' embed at the caret", () => {
    const state = paragraphDoc();
    const at = createPosition("p" as BlockId, 1);
    const ed = makeEditor(state, createSpan(at, at));
    const next = reduceEditor(ed, { type: "INSERT_TAB" }, config);

    // "ab" + tab at offset 1 → [text "a", embed "tab", text "b"].
    const items = getBlock(next.state, "p" as BlockId)?.inlineContent?.items ?? [];
    expect(items.some((it) => it.kind === "embed" && it.embedType === "tab")).toBe(true);
    expect(items.filter((it) => it.kind === "text").map((it) => it.text).join("")).toBe("ab");
  });

  it("places the caret just after the inserted tab", () => {
    const state = paragraphDoc();
    const at = createPosition("p" as BlockId, 1);
    const ed = makeEditor(state, createSpan(at, at));
    const next = reduceEditor(ed, { type: "INSERT_TAB" }, config);

    // The tab occupies one position-offset unit; caret lands at offset 2.
    expect(next.selection.anchor).toEqual(createPosition("p" as BlockId, 2));
    expect(next.selection.focus).toEqual(createPosition("p" as BlockId, 2));
  });

  it("INSERT_TAB coalesces as 'command' (discrete undo)", () => {
    expect(coalesceKeyOf({ type: "INSERT_TAB" } satisfies EditorAction)).toBe("command");
  });
});

describe("SET_TAB_STOPS action", () => {
  it("sets the block's tabStops attr (via mergeBlockAttrs, preserving other attrs)", () => {
    const state = paragraphDoc({ textAlign: "center" });
    const at = createPosition("p" as BlockId, 0);
    const ed = makeEditor(state, createSpan(at, at));
    const next = reduceEditor(
      ed,
      {
        type: "SET_TAB_STOPS",
        blockId: "p" as BlockId,
        tabStops: [{ position: 72, alignment: "left", leader: "none" }],
      },
      config,
    );

    const block = getBlock(next.state, "p" as BlockId);
    expect(block?.attrs.tabStops).toEqual([{ position: 72, alignment: "left", leader: "none" }]);
    // mergeBlockAttrs preserved the other attr (setBlockAttrs would have wiped it).
    expect(block?.attrs.textAlign).toBe("center");
  });

  it("SET_TAB_STOPS coalesces as 'command'", () => {
    expect(
      coalesceKeyOf({
        type: "SET_TAB_STOPS",
        blockId: "p" as BlockId,
        tabStops: [],
      } satisfies EditorAction),
    ).toBe("command");
  });
});
