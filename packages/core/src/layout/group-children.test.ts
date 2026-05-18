import { describe, it, expect } from "vitest";
import { groupChildren, anonymousBlockKey } from "./group-children";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";

describe("groupChildren", () => {
  it("returns empty array for an ElementBox with no children", () => {
    const parent = createElementBox("p", { display: "block" }, []);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error();
    expect(groupChildren(cascaded)).toEqual([]);
  });

  it("treats text children as inline", () => {
    const t1 = createTextBox("t1", { display: "inline" }, "hello");
    const parent = createElementBox("p", { display: "block" }, [t1]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error();
    const groups = groupChildren(cascaded);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("inline-run");
  });

  it("all-block children produce N block groups", () => {
    const c1 = createElementBox("c1", { display: "block" }, []);
    const c2 = createElementBox("c2", { display: "block" }, []);
    const parent = createElementBox("p", { display: "block" }, [c1, c2]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error();
    const groups = groupChildren(cascaded);
    expect(groups).toHaveLength(2);
    expect(groups[0].kind).toBe("block");
    expect(groups[1].kind).toBe("block");
  });

  it("mixed: block, text, text, block, text → 4 groups", () => {
    const b1 = createElementBox("b1", { display: "block" }, []);
    const t1 = createTextBox("t1", { display: "inline" }, "a");
    const t2 = createTextBox("t2", { display: "inline" }, "b");
    const b2 = createElementBox("b2", { display: "block" }, []);
    const t3 = createTextBox("t3", { display: "inline" }, "c");
    const parent = createElementBox("p", { display: "block" }, [b1, t1, t2, b2, t3]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error();
    const groups = groupChildren(cascaded);
    expect(groups.map(g => g.kind)).toEqual([
      "block", "inline-run", "block", "inline-run",
    ]);
    if (groups[1].kind === "inline-run") {
      expect(groups[1].children).toHaveLength(2);
    }
  });

  it("positionalIndex matches output index", () => {
    const b1 = createElementBox("b1", { display: "block" }, []);
    const t1 = createTextBox("t1", { display: "inline" }, "a");
    const b2 = createElementBox("b2", { display: "block" }, []);
    const parent = createElementBox("p", { display: "block" }, [b1, t1, b2]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error();
    const groups = groupChildren(cascaded);
    expect(groups.map(g => g.positionalIndex)).toEqual([0, 1, 2]);
  });
});

describe("anonymousBlockKey", () => {
  it("generates stable key", () => {
    expect(anonymousBlockKey("doc", 0)).toBe("doc/anon[0]");
    expect(anonymousBlockKey("doc/p1", 3)).toBe("doc/p1/anon[3]");
  });
});
