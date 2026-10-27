import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { yMapAsObject } from "./y-utils";

// Per the y-block.ts contract: detached Y types can't be read from in Yjs ^13.6.
// Attach to a throwaway Y.Doc before reading.
function attach<T extends Y.Map<unknown>>(yMap: T): T {
  const doc = new Y.Doc();
  doc.getMap("root").set("v", yMap);
  return yMap;
}

describe("y-utils", () => {
  describe("yMapAsObject", () => {
    it("returns a plain object snapshot of a Y.Map", () => {
      const yMap = attach(new Y.Map<unknown>());
      yMap.set("a", 1);
      yMap.set("b", "two");
      expect(yMapAsObject(yMap)).toEqual({ a: 1, b: "two" });
    });

    it("returns {} for an empty Y.Map", () => {
      const yMap = attach(new Y.Map<unknown>());
      expect(yMapAsObject(yMap)).toEqual({});
    });
  });
});
