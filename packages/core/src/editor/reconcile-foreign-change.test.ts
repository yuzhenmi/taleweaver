/**
 * P1 (live-collab): `reconcileForeignChange(editorState, dirtyIds)` is the
 * editor-level seam that applies a PEER's edit to the local `EditorState`.
 *
 * The collab flow: a remote peer mutates the shared `Y.Doc`; the local
 * `subscribeForeignChanges` observer fires with the foreign dirty block ids;
 * the host calls `reconcileForeignChange` to mint a new `EditorState` whose
 * snapshot cache is invalidated for those blocks (so reads pick up the live
 * Y.Doc mutation) while every unchanged block stays reference-equal, and whose
 * `lastDirtyIds` drives the print backend's incremental relayout. Selection and
 * history pass through untouched (foreign edits aren't in local undo history;
 * selection rebasing is the deferred rough edge).
 */
import { describe, it, expect } from "vitest";
import { reconcileForeignChange } from "./reconcile-foreign-change";
import { createEditorStateFromState, clearTransientViewState, type EditorState } from "./editor-state";
import { config } from "./actions/test-helpers";
import { applyOperation, getBlock, createPosition, createSpan } from "../state";
import { subscribeForeignChanges } from "../state";
import { getYBlock } from "../state/yjs-doc";
import { asBlockId, type BlockId } from "../state/block-id";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

/** A two-paragraph doc: "p1" (the peer mutates it) and "p2" (untouched sibling). */
function makeState() {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("one")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p1",
        inlineContent: inlineContent([text("two")]),
      }),
    ],
  });
}

function collapsedAtP1Start() {
  const pos = createPosition(asBlockId("p1"), 0);
  return createSpan(pos, pos);
}

describe("reconcileForeignChange (live-collab P1)", () => {
  it("applies a foreign block edit so the new state reads the live Y.Doc mutation", () => {
    const state = makeState();
    const editor = createEditorStateFromState(state, collapsedAtP1Start(), config);

    // Warm the local cache: the stale snapshot of p1 is "paragraph".
    expect(getBlock(editor.state, asBlockId("p1"))?.type).toBe("paragraph");

    // Capture the foreign dirty ids exactly as the host would (via the observer).
    const dirty: BlockId[] = [];
    const unsub = subscribeForeignChanges(editor.state, "self", (ids) =>
      dirty.push(...ids),
    );
    applyOperation(
      editor.state,
      (doc) => {
        getYBlock(doc, asBlockId("p1"), "collab-test").set("type", "heading");
      },
      { origin: "peerA" },
    );
    unsub();
    const dirtyIds = new Set(dirty);
    expect(dirtyIds.has(asBlockId("p1"))).toBe(true);

    const reconciled = reconcileForeignChange(editor, dirtyIds);

    // Stale local state still reads the pre-edit snapshot; reconciled reads live.
    expect(getBlock(editor.state, asBlockId("p1"))?.type).toBe("paragraph");
    expect(getBlock(reconciled.state, asBlockId("p1"))?.type).toBe("heading");
  });

  it("keeps an untouched sibling block reference-equal (structural sharing)", () => {
    const state = makeState();
    const editor = createEditorStateFromState(state, collapsedAtP1Start(), config);

    // Warm p2's snapshot in the local cache.
    const p2Before = getBlock(editor.state, asBlockId("p2"));
    expect(p2Before?.type).toBe("paragraph");

    applyOperation(
      editor.state,
      (doc) => {
        getYBlock(doc, asBlockId("p1"), "collab-test").set("type", "heading");
      },
      { origin: "peerA" },
    );

    const reconciled = reconcileForeignChange(editor, new Set([asBlockId("p1")]));

    // p2 was not in dirtyIds → falls through the overlay to the same snapshot object.
    expect(getBlock(reconciled.state, asBlockId("p2"))).toBe(p2Before);
  });

  it("sets lastDirtyIds to the foreign set and passes selection + history through", () => {
    const state = makeState();
    const editor = createEditorStateFromState(state, collapsedAtP1Start(), config);
    const dirtyIds = new Set([asBlockId("p1")]);

    const reconciled = reconcileForeignChange(editor, dirtyIds);

    expect(reconciled.lastDirtyIds).toBe(dirtyIds);
    expect(reconciled.selection).toBe(editor.selection);
    expect(reconciled.history).toBe(editor.history);
    expect(reconciled.containerWidth).toBe(editor.containerWidth);
  });

  it("clears the stale line-nav goal column + bidi affinities like any document mutation", () => {
    const state = makeState();
    const editor = createEditorStateFromState(state, collapsedAtP1Start(), config);
    // Seed the view fields a prior vertical-nav / bidi-boundary caret would leave;
    // a foreign edit invalidates all three (resolved against the pre-edit structure).
    // Typed annotation narrows the affinity literals to CaretAffinity — no cast.
    const navigated: EditorState = {
      ...editor,
      targetX: 42,
      caretAffinity: "after",
      anchorAffinity: "before",
    };

    const reconciled = reconcileForeignChange(navigated, new Set([asBlockId("p1")]));

    expect(reconciled.targetX).toBeNull();
    expect(reconciled.caretAffinity).toBeUndefined();
    expect(reconciled.anchorAffinity).toBeUndefined();
  });
});

describe("clearTransientViewState (shared stale-on-mutation home)", () => {
  it("clears targetX + bidi affinities, leaving other fields intact", () => {
    const state = makeState();
    const base = createEditorStateFromState(state, collapsedAtP1Start(), config);
    const dirty: EditorState = {
      ...base,
      targetX: 42,
      caretAffinity: "after",
      anchorAffinity: "before",
    };

    const cleared = clearTransientViewState(dirty);

    expect(cleared.targetX).toBeNull();
    expect(cleared.caretAffinity).toBeUndefined();
    expect(cleared.anchorAffinity).toBeUndefined();
    expect(cleared.selection).toBe(dirty.selection);
    expect(cleared.state).toBe(dirty.state);
  });

  it("returns the SAME reference when nothing is stale (allocation guard)", () => {
    const state = makeState();
    const base = createEditorStateFromState(state, collapsedAtP1Start(), config);
    // A fresh editor has targetX null + both affinities undefined already.
    expect(clearTransientViewState(base)).toBe(base);
  });
});
