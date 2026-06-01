import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createEmptyDocument } from "./initial-state";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { createState, getBlock } from "./state";
import { STATE_INTERNAL } from "./state-internal";

describe("yjs-encoding", () => {
  it("round-trips a single-paragraph document via update bytes", () => {
    const original = createEmptyDocument();
    const update = Y.encodeStateAsUpdate(original[STATE_INTERNAL].doc);

    const restoredDoc = new Y.Doc();
    Y.applyUpdate(restoredDoc, update);
    const restored = createState({ rootId: original.rootId, doc: restoredDoc });

    const a = getBlock(original, original.rootId);
    const b = getBlock(restored, original.rootId);
    expect(b?.type).toBe(a?.type);
    expect(b?.firstChildId).toBe(a?.firstChildId);
  });

  it("round-trips a mutated document", () => {
    let state = createEmptyDocument();
    const child = getBlock(state, getBlock(state, state.rootId)!.firstChildId!)!;
    state = setBlockAttrs(state, child.id, { bold: true }).state;

    const update = Y.encodeStateAsUpdate(state[STATE_INTERNAL].doc);
    const restoredDoc = new Y.Doc();
    Y.applyUpdate(restoredDoc, update);
    const restored = createState({ rootId: state.rootId, doc: restoredDoc });

    expect(getBlock(restored, child.id)?.attrs.bold).toBe(true);
  });
});
