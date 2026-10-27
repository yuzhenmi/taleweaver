import { describe, it, expect } from "vitest";
import { subscribeForeignChanges } from "./collab";
import { applyOperation } from "./state";
import { getYBlock, runWithTransactionOrigin } from "./yjs-doc";
import { asBlockId, type BlockId } from "./block-id";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { legacyInline } from "../test-utils/legacy-fixture";
import { STATE_INTERNAL } from "./state-internal";
import * as Y from "yjs";

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

const noLegacy = (): void => {
  throw new Error("unexpected legacy storage");
};

describe("subscribeForeignChanges (collab seam)", () => {
  it("fires with the dirtied block ids for a FOREIGN-origin transaction", () => {
    const state = makeState();
    const seen: BlockId[] = [];
    const unsub = subscribeForeignChanges(state, "self", (ids) => seen.push(...ids), noLegacy);

    editBlockP(state, "peerB"); // foreign origin

    expect(seen).toContain(asBlockId("p"));
    unsub();
  });

  it("does NOT fire for a SELF-origin transaction (the host's own edit)", () => {
    const state = makeState();
    let calls = 0;
    const unsub = subscribeForeignChanges(state, "self", () => {
      calls += 1;
    }, noLegacy);

    editBlockP(state, "self"); // self origin — applyOperation already handled it

    expect(calls).toBe(0);
    unsub();
  });

  it("stops firing after unsubscribe", () => {
    const state = makeState();
    let calls = 0;
    const unsub = subscribeForeignChanges(state, "self", () => {
      calls += 1;
    }, noLegacy);
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
    }, noLegacy);

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
    const unsub = subscribeForeignChanges(state, "peerB", (ids) => seen.push(...ids), noLegacy);

    runWithTransactionOrigin("peerA", () => {
      applyOperation(state, (doc) => {
        getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading");
      });
    });

    expect(seen).toContain(asBlockId("p")); // peerA's edit is foreign to peerB
    unsub();
  });
});

describe("subscribeForeignChanges — legacy storage halts the subscription until compatible", () => {
  it("reports legacy once, withholds changes while halted, then calls onCompatible once the document is upgraded", () => {
    const state = makeState();
    const doc = state[STATE_INTERNAL].doc;
    const events: string[] = [];
    const unsub = subscribeForeignChanges(
      state,
      "self",
      (ids) => events.push(`change:${[...ids].join(",")}`),
      (ids) => events.push(`incompatible:${ids.join(",")}`),
      () => events.push("compatible"),
    );
    const setInline = (value: unknown): void => {
      doc.transact(() => getYBlock(doc, asBlockId("p"), "collab-test").set("inlineContent", value), "peer");
    };
    setInline(legacyInline([text("old")]));
    doc.transact(() => getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading"), "peer"); // still legacy: withheld, no second report
    const upgraded = new Y.Text();
    upgraded.insert(0, "new");
    setInline(upgraded); // the document is compatible again
    editBlockP(state, "peer"); // reported normally
    expect(events).toEqual(["incompatible:p", "compatible", "change:p"]);
    unsub();
  });

  it("startHalted on a document already compatible at subscribe: onCompatible on a microtask, changes reported", async () => {
    const state = makeState();
    const events: string[] = [];
    const unsub = subscribeForeignChanges(
      state,
      "self",
      () => events.push("change"),
      () => events.push("incompatible"),
      () => events.push("compatible"),
      { startHalted: true },
    );
    editBlockP(state, "peer"); // inspected at subscribe: no legacy block, not halted
    expect(events).toEqual(["change"]);
    await Promise.resolve();
    expect(events).toEqual(["change", "compatible"]);
    unsub();
  });
});
