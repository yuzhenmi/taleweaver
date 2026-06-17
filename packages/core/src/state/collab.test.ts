import { describe, it, expect } from "vitest";
import { subscribeForeignChanges } from "./collab";
import { applyOperation } from "./state";
import { getYBlock, runWithTransactionOrigin } from "./yjs-doc";
import { asBlockId, type BlockId } from "./block-id";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";

/** A one-paragraph doc whose body block "p" we can mutate to drive transactions. */
function makeState() {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("hi")]),
      }),
    ],
  });
}

/** Mutate block "p" inside a transaction tagged with `origin` (simulates a peer). */
function editBlockP(state: ReturnType<typeof makeState>, origin: unknown): void {
  applyOperation(
    state,
    (doc) => {
      // getYBlock throws if "p" is missing — the fixture guarantees it exists.
      getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading");
    },
    { origin },
  );
}

describe("subscribeForeignChanges (collab seam)", () => {
  it("fires with the dirtied block ids for a FOREIGN-origin transaction", () => {
    const state = makeState();
    const seen: BlockId[] = [];
    const unsub = subscribeForeignChanges(state, "self", (ids) => seen.push(...ids));

    editBlockP(state, "peerB"); // foreign origin

    expect(seen).toContain(asBlockId("p"));
    unsub();
  });

  it("does NOT fire for a SELF-origin transaction (the host's own edit)", () => {
    const state = makeState();
    let calls = 0;
    const unsub = subscribeForeignChanges(state, "self", () => {
      calls += 1;
    });

    editBlockP(state, "self"); // self origin — applyOperation already handled it

    expect(calls).toBe(0);
    unsub();
  });

  it("stops firing after unsubscribe", () => {
    const state = makeState();
    let calls = 0;
    const unsub = subscribeForeignChanges(state, "self", () => {
      calls += 1;
    });
    unsub();

    editBlockP(state, "peerB");

    expect(calls).toBe(0);
  });

  // E4: runWithTransactionOrigin tags every transaction inside its scope with the
  // ambient origin (no explicit origin arg on the op needed) — the mechanism a
  // collab host uses to stamp all of one dispatch's edits with its peer origin.
  it("ambient origin (runWithTransactionOrigin) is treated as SELF by the matching observer", () => {
    const state = makeState();
    let calls = 0;
    const unsub = subscribeForeignChanges(state, "peerA", () => {
      calls += 1;
    });

    runWithTransactionOrigin("peerA", () => {
      applyOperation(state, (doc) => {
        getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading");
      });
    });

    expect(calls).toBe(0); // peerA's own ambient-tagged edit is filtered out
    unsub();
  });

  it("ambient origin is FOREIGN to a different peer's observer", () => {
    const state = makeState();
    const seen: BlockId[] = [];
    const unsub = subscribeForeignChanges(state, "peerB", (ids) => seen.push(...ids));

    runWithTransactionOrigin("peerA", () => {
      applyOperation(state, (doc) => {
        getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading");
      });
    });

    expect(seen).toContain(asBlockId("p")); // peerA's edit is foreign to peerB
    unsub();
  });
});
