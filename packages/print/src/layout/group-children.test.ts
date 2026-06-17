import { describe, it, expect } from "vitest";
import { groupChildren, anonymousBlockKey } from "./group-children";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
    expect(nth(groups, 0, "group").kind).toBe("inline-run");
  });

  it("all-block children produce N block groups", () => {
    const c1 = createElementBox("c1", { display: "block" }, []);
    const c2 = createElementBox("c2", { display: "block" }, []);
    const parent = createElementBox("p", { display: "block" }, [c1, c2]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error();
    const groups = groupChildren(cascaded);
    expect(groups).toHaveLength(2);
    expect(nth(groups, 0, "group").kind).toBe("block");
    expect(nth(groups, 1, "group").kind).toBe("block");
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
    const group1 = nth(groups, 1, "group");
    if (group1.kind === "inline-run") {
      expect(group1.children).toHaveLength(2);
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

describe("groupChildren — display: contents flatten (P1.C.1a)", () => {
  it("splices a contents element's children in place (same groups as hoisted)", () => {
    const para = (k: string) => createElementBox(k, { display: "block" }, [createTextBox(`${k}t`, { display: "inline" }, "x")]);
    const withWrapper = createElementBox("doc", { display: "block" }, [
      para("p1"),
      createElementBox("sec", { display: "contents" }, [para("a"), para("b")]),
      para("p2"),
    ]);
    const hoisted = createElementBox("doc", { display: "block" }, [para("p1"), para("a"), para("b"), para("p2")]);
    const cw = cascadePass(withWrapper);
    const ch = cascadePass(hoisted);
    if (cw.type !== "element" || ch.type !== "element") throw new Error();
    expect(groupChildren(cw)).toEqual(groupChildren(ch));
    // The contents element is not itself a group.
    expect(groupChildren(cw).some((g) => g.kind === "block" && g.child.key === "sec")).toBe(false);
  });

  it("flattens nested contents recursively; empty contents contributes nothing", () => {
    const para = (k: string) => createElementBox(k, { display: "block" }, [createTextBox(`${k}t`, { display: "inline" }, "x")]);
    const nested = createElementBox("doc", { display: "block" }, [
      createElementBox("outer", { display: "contents" }, [
        createElementBox("inner", { display: "contents" }, [para("x")]),
        createElementBox("empty", { display: "contents" }, []),
      ]),
    ]);
    const hoisted = createElementBox("doc", { display: "block" }, [para("x")]);
    const cn = cascadePass(nested);
    const ch = cascadePass(hoisted);
    if (cn.type !== "element" || ch.type !== "element") throw new Error();
    expect(groupChildren(cn)).toEqual(groupChildren(ch));
  });
});
