import { describe, it, expect } from "vitest";
import { createYDoc, getListDefsMap, runTransaction } from "./yjs-doc";
import { getListDef, writeListDefInTx, type ListDef } from "./list-defs";

const SAMPLE: ListDef = {
  levels: [
    { style: "decimal", start: 1, restart: "after-break" },
    { style: "lower-alpha", start: 1, restart: "after-break" },
  ],
};

describe("listDefs map", () => {
  it("createYDoc seeds an empty listDefs map", () => {
    const doc = createYDoc();
    expect(getListDefsMap(doc).size).toBe(0);
  });

  it("writeListDefInTx persists a def readable by getListDef", () => {
    const doc = createYDoc();
    runTransaction(doc, () => writeListDefInTx(doc, "L1", SAMPLE));
    expect(getListDef(doc, "L1")).toEqual(SAMPLE);
  });

  it("getListDef returns undefined for an unknown listId", () => {
    const doc = createYDoc();
    expect(getListDef(doc, "nope")).toBeUndefined();
  });
});
