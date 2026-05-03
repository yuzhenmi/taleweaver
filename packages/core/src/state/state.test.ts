import { describe, it, expect } from "vitest";
import { createState, type State } from "./state";
import { createBlock } from "./block";
import { createPersistentMap } from "./persistent-map";
import type { BlockId } from "./block-id";

describe("createState", () => {
  it("constructs a frozen State with the given root and blocks", () => {
    const root = createBlock({ id: "doc-0" as BlockId, type: "document" });
    const blocks = createPersistentMap<BlockId, ReturnType<typeof createBlock>>([
      ["doc-0" as BlockId, root],
    ]);
    const s: State = createState({ rootId: "doc-0" as BlockId, blocks });
    expect(s.rootId).toBe("doc-0");
    expect(s.blocks.get("doc-0" as BlockId)).toBe(root);
    expect(Object.isFrozen(s)).toBe(true);
  });
});
