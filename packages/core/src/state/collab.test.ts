import { describe, it, expect } from "vitest";
import { subscribeForeignChanges } from "./collab";
import { applyOperation } from "./document";
import { getYBlock, runWithTransactionOrigin } from "./yjs-doc";
import { asBlockId, type BlockId } from "./block-id";
import { buildDocument, buildBlock, inlineContent, text } from "../test-utils/document-builders";
import { legacyInline } from "../test-utils/legacy-fixture";
import { DOCUMENT_INTERNAL } from "./document-internal";
import * as Y from "yjs";

/** A one-paragraph doc whose body block "p" we can mutate to drive transactions. */
function makeDocument() {
  return buildDocument({
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
function editBlockP(document: ReturnType<typeof makeDocument>, origin: unknown): void {
  applyOperation(
    document,
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
    const document = makeDocument();
    const seen: BlockId[] = [];
    const unsub = subscribeForeignChanges(document, "self", (ids) => seen.push(...ids), noLegacy);

    editBlockP(document, "peerB"); // foreign origin

    expect(seen).toContain(asBlockId("p"));
    unsub();
  });

  it("does NOT fire for a SELF-origin transaction (the host's own edit)", () => {
    const document = makeDocument();
    let calls = 0;
    const unsub = subscribeForeignChanges(document, "self", () => {
      calls += 1;
    }, noLegacy);

    editBlockP(document, "self"); // self origin — applyOperation already handled it

    expect(calls).toBe(0);
    unsub();
  });

  it("stops firing after unsubscribe", () => {
    const document = makeDocument();
    let calls = 0;
    const unsub = subscribeForeignChanges(document, "self", () => {
      calls += 1;
    }, noLegacy);
    unsub();

    editBlockP(document, "peerB");

    expect(calls).toBe(0);
  });

  // E4: runWithTransactionOrigin tags every transaction inside its scope with the
  // ambient origin (no explicit origin arg on the op needed) — the mechanism a
  // collab host uses to stamp all of one dispatch's edits with its peer origin.
  it("ambient origin (runWithTransactionOrigin) is treated as SELF by the matching observer", () => {
    const document = makeDocument();
    let calls = 0;
    const unsub = subscribeForeignChanges(document, "peerA", () => {
      calls += 1;
    }, noLegacy);

    runWithTransactionOrigin("peerA", () => {
      applyOperation(document, (doc) => {
        getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading");
      });
    });

    expect(calls).toBe(0); // peerA's own ambient-tagged edit is filtered out
    unsub();
  });

  it("ambient origin is FOREIGN to a different peer's observer", () => {
    const document = makeDocument();
    const seen: BlockId[] = [];
    const unsub = subscribeForeignChanges(document, "peerB", (ids) => seen.push(...ids), noLegacy);

    runWithTransactionOrigin("peerA", () => {
      applyOperation(document, (doc) => {
        getYBlock(doc, asBlockId("p"), "collab-test").set("type", "heading");
      });
    });

    expect(seen).toContain(asBlockId("p")); // peerA's edit is foreign to peerB
    unsub();
  });
});

describe("subscribeForeignChanges — legacy storage halts the subscription until compatible", () => {
  it("a peer write into the FROZEN legacy roots halts once (sticky) with the touched block and its legacy text", () => {
    const document = makeDocument();
    const doc = document[DOCUMENT_INTERNAL].doc;
    const events: string[] = [];
    const unsub = subscribeForeignChanges(
      document,
      "self",
      (ids) => events.push(`change:${[...ids].join(",")}`),
      (report) => events.push(`incompatible:${report.reason}:${report.legacyBlocks.join(",")}:${JSON.stringify(report.legacyText)}`),
      () => events.push("compatible"),
    );
    // An old (schema-2) client writes block "p" into its legacy `blocks` root.
    doc.transact(() => {
      const legacy = new Y.Map<unknown>();
      legacy.set("inlineContent", legacyInline([text("old")]));
      doc.getMap<Y.Map<unknown>>("blocks").set("p", legacy);
    }, "peer");
    editBlockP(document, "peer"); // halted: withheld, no second report
    expect(events).toEqual(['incompatible:legacy-write:p:{"p":"old"}']);
    unsub();
  });

  it("startHalted on a document already compatible at subscribe: onCompatible on a microtask, changes reported", async () => {
    const document = makeDocument();
    const events: string[] = [];
    const unsub = subscribeForeignChanges(
      document,
      "self",
      () => events.push("change"),
      () => events.push("incompatible"),
      () => events.push("compatible"),
      { startHalted: true },
    );
    editBlockP(document, "peer"); // inspected at subscribe: no legacy block, not halted
    expect(events).toEqual(["change"]);
    await Promise.resolve();
    expect(events).toEqual(["change", "compatible"]);
    unsub();
  });
});
