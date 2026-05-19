import { describe, it, expect } from "vitest";
import {
  legacyPositionToNew,
  newPositionToLegacy,
  legacySelectionToNew,
  newSelectionToLegacy,
} from "./legacy-position-bridge";
import { createPosition as createLegacyPos } from "../state/position";
import { createSelection } from "../cursor/selection";
import { createPosition as createNewPos } from "../state/block-position";
import { createEmptyDocument } from "../state/initial-state";
import { createNode, createTextNode } from "../state/create-node-legacy";
import type { BlockId } from "../state/block-id";

describe("legacy-position-bridge", () => {
  describe("legacyPositionToNew", () => {
    it("empty path → blockId 'R', offset preserved", () => {
      const state = createEmptyDocument();
      const legacy = createLegacyPos([], 7);
      const result = legacyPositionToNew(state, legacy);
      expect(result.blockId).toBe("R" as BlockId);
      expect(result.offset).toBe(7);
    });

    it("single-level path [0] → blockId 'R/0', offset preserved", () => {
      const state = createEmptyDocument();
      const legacy = createLegacyPos([0], 3);
      const result = legacyPositionToNew(state, legacy);
      expect(result.blockId).toBe("R/0" as BlockId);
      expect(result.offset).toBe(3);
    });

    it("multi-level path [0,1,2] → blockId 'R/0/1/2', offset preserved", () => {
      const state = createEmptyDocument();
      const legacy = createLegacyPos([0, 1, 2], 5);
      const result = legacyPositionToNew(state, legacy);
      expect(result.blockId).toBe("R/0/1/2" as BlockId);
      expect(result.offset).toBe(5);
    });
  });

  describe("newPositionToLegacy", () => {
    function makeStateLegacy() {
      // Build a small legacy tree with enough depth to support path [0,0].
      const text = createTextNode("text-0", "hi");
      const paragraph = createNode("p-0", "paragraph", {}, [text]);
      return createNode("doc-0", "document", {}, [paragraph]);
    }

    it("blockId 'R' → empty path, offset preserved", () => {
      const stateLegacy = makeStateLegacy();
      const pos = createNewPos("R" as BlockId, 4);
      const result = newPositionToLegacy(stateLegacy, pos);
      expect(result.path).toEqual([]);
      expect(result.offset).toBe(4);
    });

    it("blockId 'R/0/0' → path [0,0], offset preserved", () => {
      const stateLegacy = makeStateLegacy();
      const pos = createNewPos("R/0/0" as BlockId, 1);
      const result = newPositionToLegacy(stateLegacy, pos);
      expect(result.path).toEqual([0, 0]);
      expect(result.offset).toBe(1);
    });

    it("non-pathToBlockId id (e.g., 'uuid-foo-bar') throws with clear error containing the id", () => {
      const stateLegacy = makeStateLegacy();
      const pos = createNewPos("uuid-foo-bar" as BlockId, 0);
      expect(() => newPositionToLegacy(stateLegacy, pos)).toThrow(
        /uuid-foo-bar/,
      );
    });

    it("path that doesn't resolve in stateLegacy throws with clear error", () => {
      const stateLegacy = makeStateLegacy(); // only has [0,0]
      const pos = createNewPos("R/0/5" as BlockId, 0);
      expect(() => newPositionToLegacy(stateLegacy, pos)).toThrow();
    });
  });

  describe("legacySelectionToNew + newSelectionToLegacy", () => {
    it("anchor + focus both translate through (legacySelectionToNew)", () => {
      const state = createEmptyDocument();
      const sel = createSelection(
        createLegacyPos([0], 1),
        createLegacyPos([0, 1], 4),
      );
      const span = legacySelectionToNew(state, sel);
      expect(span.anchor.blockId).toBe("R/0" as BlockId);
      expect(span.anchor.offset).toBe(1);
      expect(span.focus.blockId).toBe("R/0/1" as BlockId);
      expect(span.focus.offset).toBe(4);
    });

    it("round-trip for Selection: legacy → new → legacy", () => {
      const text0 = createTextNode("t-0", "abc");
      const text1 = createTextNode("t-1", "def");
      const p0 = createNode("p-0", "paragraph", {}, [text0, text1]);
      const doc = createNode("doc-0", "document", {}, [p0]);

      const sel = createSelection(
        createLegacyPos([0, 0], 1),
        createLegacyPos([0, 1], 2),
      );
      const state = createEmptyDocument();
      const span = legacySelectionToNew(state, sel);
      const back = newSelectionToLegacy(doc, span);
      expect(back.anchor.path).toEqual([0, 0]);
      expect(back.anchor.offset).toBe(1);
      expect(back.focus.path).toEqual([0, 1]);
      expect(back.focus.offset).toBe(2);
    });
  });

  describe("round-trip preservation", () => {
    it("legacy → new → legacy returns the original", () => {
      // stateLegacy with sufficient depth for path [0, 1].
      const t0 = createTextNode("t-0", "x");
      const t1 = createTextNode("t-1", "y");
      const p0 = createNode("p-0", "paragraph", {}, [t0, t1]);
      const doc = createNode("doc-0", "document", {}, [p0]);

      const state = createEmptyDocument();
      const original = createLegacyPos([0, 1], 7);
      const through = legacyPositionToNew(state, original);
      const back = newPositionToLegacy(doc, through);
      expect(back.path).toEqual([0, 1]);
      expect(back.offset).toBe(7);
    });

    it("new → legacy → new returns the original (for path-derived ids)", () => {
      const t0 = createTextNode("t-0", "x");
      const p0 = createNode("p-0", "paragraph", {}, [t0]);
      const doc = createNode("doc-0", "document", {}, [p0]);

      const state = createEmptyDocument();
      const original = createNewPos("R/0/0" as BlockId, 2);
      const through = newPositionToLegacy(doc, original);
      const back = legacyPositionToNew(state, through);
      expect(back.blockId).toBe("R/0/0" as BlockId);
      expect(back.offset).toBe(2);
    });
  });
});
