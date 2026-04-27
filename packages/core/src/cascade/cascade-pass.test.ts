import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
import { cascadePass } from "./cascade-pass";

describe("cascadePass", () => {
  it("produces a tree where every node carries computedStyle", () => {
    const tree = createElementBox("root", { display: "block" }, [
      createElementBox("p", {}, [
        createTextBox("t", {}, "hello"),
      ]),
    ]);

    const cascaded = cascadePass(tree);

    // Root
    if (cascaded.type !== "element") throw new Error("expected element");
    expect(cascaded.computedStyle).toBeDefined();
    expect(cascaded.computedStyle?.display).toBe("block");

    // Inner element (no display specified → initial 'inline')
    const p = cascaded.children[0];
    if (p.type !== "element") throw new Error("expected element");
    expect(p.computedStyle?.display).toBe("inline");

    // Text leaf
    const t = p.children[0];
    if (t.type !== "text") throw new Error("expected text");
    expect(t.computedStyle).toBeDefined();
  });

  it("propagates inheritable properties down", () => {
    const tree = createElementBox("root", { color: "red", fontSize: 24 }, [
      createElementBox("p", {}, [
        createTextBox("t", {}, "hello"),
      ]),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = cascaded.children[0];
    if (p.type !== "element") throw new Error("?");
    const t = p.children[0];
    if (t.type !== "text") throw new Error("?");

    expect(t.computedStyle?.color).toBe("red");
    expect(t.computedStyle?.fontSize).toBe(24);
  });

  it("does NOT propagate non-inheritable properties", () => {
    const tree = createElementBox("root", { marginTop: 50 }, [
      createElementBox("p", {}, []),
    ]);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    const p = cascaded.children[0];
    if (p.type !== "element") throw new Error("?");
    expect(p.computedStyle?.marginTop).toBe(0);  // initial, not inherited
  });

  it("flattens em values using own fontSize", () => {
    const tree = createElementBox("root", {
      fontSize: 20,
      marginTop: { unit: "em", value: 0.5 },
    }, []);

    const cascaded = cascadePass(tree);
    if (cascaded.type !== "element") throw new Error("?");
    expect(cascaded.computedStyle?.marginTop).toBe(10);  // 20 * 0.5
  });
});
