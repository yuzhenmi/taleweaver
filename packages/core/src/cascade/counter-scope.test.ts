import { describe, expect, it } from "vitest";

import type { CounterAction } from "../styles/style";

import {
  applyIncrements,
  applyResets,
  createCounterScope,
  resolveCounter,
  resolveCounters,
  restore,
  type CounterMarks,
  type CounterScope,
} from "./counter-scope";

/**
 * A tiny tree node for exercising the CHILD-BRACKET walk that P9a.3 will wire
 * into the real cascade. Each node carries its own `counter-reset` /
 * `counter-increment` actions and an optional content resolver invoked AFTER
 * the node's reset+increment (mirroring §12.4.2 element timing). We thread a
 * single `CounterScope` left-to-right through children and bracket only the
 * CHILDREN's resets — the node leaves its OWN resets pushed for following
 * siblings (the parent pops them via the parent's child-bracket).
 */
interface TreeNode {
  readonly resets?: readonly CounterAction[];
  readonly increments?: readonly CounterAction[];
  /** Invoked with the scope AT this node (post reset+increment) to record a resolved value. */
  readonly content?: (scope: CounterScope) => void;
  readonly children?: readonly TreeNode[];
}

/** Run the spec §2 child-bracket walk over a node, threading `scopeIn`. */
function walk(node: TreeNode, scopeIn: CounterScope): CounterScope {
  // E's OWN resets: pushed, NOT popped here (visible to following siblings).
  const { scope: afterResets } = applyResets(scopeIn, node.resets ?? []);
  const afterIncrements = applyIncrements(afterResets, node.increments ?? []);
  node.content?.(afterIncrements);

  // Bracket E's CHILDREN only.
  const childMarks = saveMarks(afterIncrements);
  let s = afterIncrements;
  for (const child of node.children ?? []) {
    s = walk(child, s);
  }
  s = restore(s, childMarks);
  return s; // E's own resets stay visible to E's siblings.
}

/** Snapshot the per-name stack lengths (the "save" used to restore children). */
function saveMarks(scope: CounterScope): CounterMarks {
  // applyResets returns marks, but for the child-bracket we need the marks of
  // the CURRENT scope (post-increment) with no resets applied. An empty
  // applyResets gives exactly that snapshot.
  return applyResets(scope, []).marks;
}

describe("counter-scope", () => {
  it("bare-following-sibling: E1{reset c}{incr c}→1, E2{incr c}→2, E3{incr c}→3 (C1 regression)", () => {
    const seen: string[] = [];
    const record = (scope: CounterScope) => seen.push(resolveCounter(scope, "c", "decimal"));
    const P: TreeNode = {
      children: [
        { resets: [{ name: "c", value: 0 }], increments: [{ name: "c", value: 1 }], content: record },
        { increments: [{ name: "c", value: 1 }], content: record },
        { increments: [{ name: "c", value: 1 }], content: record },
      ],
    };
    walk(P, createCounterScope());
    expect(seen).toEqual(["1", "2", "3"]);
  });

  it("two same-depth siblings each {reset c}{incr c} → each '1' (independent restart)", () => {
    const seen: string[] = [];
    const record = (scope: CounterScope) => seen.push(resolveCounter(scope, "c", "decimal"));
    const P: TreeNode = {
      children: [
        { resets: [{ name: "c", value: 0 }], increments: [{ name: "c", value: 1 }], content: record },
        { resets: [{ name: "c", value: 0 }], increments: [{ name: "c", value: 1 }], content: record },
      ],
    };
    walk(P, createCounterScope());
    expect(seen).toEqual(["1", "1"]);
  });

  it("nested: outer '1', inner '1', counters(c,'.') at inner = '1.1'", () => {
    let outer = "";
    let inner = "";
    let innerNested = "";
    // OL1{reset c} > [ LI{incr c}, OL2{reset c} > LI2{incr c} ]
    const tree: TreeNode = {
      resets: [{ name: "c", value: 0 }],
      children: [
        { increments: [{ name: "c", value: 1 }], content: (s) => { outer = resolveCounter(s, "c", "decimal"); } },
        {
          resets: [{ name: "c", value: 0 }],
          children: [
            {
              increments: [{ name: "c", value: 1 }],
              content: (s) => {
                inner = resolveCounter(s, "c", "decimal");
                innerNested = resolveCounters(s, "c", ".", "decimal");
              },
            },
          ],
        },
      ],
    };
    walk(tree, createCounterScope());
    expect(outer).toBe("1");
    expect(inner).toBe("1");
    expect(innerNested).toBe("1.1");
  });

  it("deeper nest: counters(c,'.') yields '1.2.1' for a 3-level structure", () => {
    let deepest = "";
    // Three reset levels stacked → counters() joins all three.
    //   L0{reset c}{incr c}=1
    //     L1{reset c}{incr c}=1 then {incr c}=2 via a following sibling (L1 value 2)
    //       L2{reset c}{incr c}=1
    // counters(c,".") at the deepest node = "1.2.1".
    const tree: TreeNode = {
      resets: [{ name: "c", value: 0 }],
      increments: [{ name: "c", value: 1 }], // L0 c = 1
      children: [
        {
          resets: [{ name: "c", value: 0 }],
          increments: [{ name: "c", value: 1 }], // L1 c = 1 (first L1 item)
        },
        {
          // second L1 item: NO reset (shares the L1 stack entry), incr → L1 c = 2
          increments: [{ name: "c", value: 1 }], // L1 c = 2
          children: [
            {
              resets: [{ name: "c", value: 0 }],
              increments: [{ name: "c", value: 1 }], // L2 c = 1
              content: (s) => { deepest = resolveCounters(s, "c", ".", "decimal"); },
            },
          ],
        },
      ],
    };
    walk(tree, createCounterScope());
    expect(deepest).toBe("1.2.1");
  });

  it("name reused across nested resets: inner reset shadows outer; outer restored after the whole subtree exits", () => {
    let innerValue = "";
    let outerAfterValue = "";
    // OUTER{reset c}{incr c}=1 > [
    //   GROUP{reset c}{incr c}=1 — a nested reset that SHADOWS outer (counters
    //     would show "1.1" here: both outer and the shadowing inner are stacked).
    // ]
    // After GROUP's whole subtree exits, OUTER's child-bracket pops GROUP's
    // reset, so a SECOND, separately-rooted resolve at OUTER's level sees the
    // outer counter again (value 1), un-shadowed.
    let innerNested = "";
    const tree: TreeNode = {
      resets: [{ name: "c", value: 0 }],
      increments: [{ name: "c", value: 1 }], // outer c = 1
      children: [
        {
          resets: [{ name: "c", value: 0 }],
          increments: [{ name: "c", value: 1 }], // GROUP shadows: inner c = 1
          content: (s) => {
            innerValue = resolveCounter(s, "c", "decimal");
            innerNested = resolveCounters(s, "c", ".", "decimal"); // both stacked
          },
        },
      ],
      // OUTER's own content (resolved BEFORE children, but here we record it
      // AFTER restoration by reading the returned scope below).
    };

    // Drive OUTER manually so we can read OUTER's scope AFTER its child-bracket
    // restores GROUP's shadow, confirming the outer value is visible again.
    const { scope: afterOuterReset } = applyResets(createCounterScope(), tree.resets ?? []);
    const outerScope = applyIncrements(afterOuterReset, tree.increments ?? []);
    const childMarks = saveMarks(outerScope);
    let cs = outerScope;
    for (const child of tree.children ?? []) {
      cs = walk(child, cs);
    }
    cs = restore(cs, childMarks);
    outerAfterValue = resolveCounter(cs, "c", "decimal");

    expect(innerValue).toBe("1"); // inner reset shadows outer
    expect(innerNested).toBe("1.1"); // counters() shows both outer + inner
    expect(outerAfterValue).toBe("1"); // outer un-shadowed after GROUP's subtree exits
  });

  it("create-on-use: resolveCounter for a never-touched name ⇒ '0'", () => {
    const scope = createCounterScope();
    expect(resolveCounter(scope, "missing", "decimal")).toBe("0");
  });

  it("create-on-use: increment-only name (no prior reset) ⇒ '1'", () => {
    const scope = applyIncrements(createCounterScope(), [{ name: "c", value: 1 }]);
    expect(resolveCounter(scope, "c", "decimal")).toBe("1");
  });

  it("create-on-use: resolveCounters for a missing name ⇒ '0' (single create-on-use 0)", () => {
    const scope = createCounterScope();
    expect(resolveCounters(scope, "missing", ".", "decimal")).toBe("0");
  });

  it("reset-before-increment on the same element: E{reset c=5}{incr c=1} ⇒ '6'", () => {
    let s = createCounterScope();
    s = applyResets(s, [{ name: "c", value: 5 }]).scope;
    s = applyIncrements(s, [{ name: "c", value: 1 }]);
    expect(resolveCounter(s, "c", "decimal")).toBe("6");
  });

  it("reset-before-increment does NOT depend on a prior outer value", () => {
    // Outer c = 99; element resets to 5 then +1 ⇒ 6 (ignores 99).
    let s = createCounterScope();
    s = applyResets(s, [{ name: "c", value: 99 }]).scope;
    s = applyResets(s, [{ name: "c", value: 5 }]).scope;
    s = applyIncrements(s, [{ name: "c", value: 1 }]);
    expect(resolveCounter(s, "c", "decimal")).toBe("6");
  });

  it("counter style: resolveCounter with lower-roman formats bare (value 4 ⇒ 'iv', no dot)", () => {
    let s = createCounterScope();
    s = applyResets(s, [{ name: "c", value: 4 }]).scope;
    expect(resolveCounter(s, "c", "lower-roman")).toBe("iv");
  });

  it("restore truncates each name's stack back to the saved length", () => {
    let s = createCounterScope();
    // Outer pushes c=1, then SAVES marks (the child-bracket save) AFTER its own
    // reset, then a descendant pushes c=2. Restoring to the saved marks pops
    // only the descendant's push, leaving the outer "1" visible.
    const { scope: s1 } = applyResets(s, [{ name: "c", value: 1 }]);
    s = s1;
    const { marks } = applyResets(s, []); // saveMarks AFTER outer's reset
    const { scope: s2 } = applyResets(s, [{ name: "c", value: 2 }]);
    expect(resolveCounters(s2, "c", ".", "decimal")).toBe("1.2");
    const restored = restore(s2, marks);
    expect(resolveCounters(restored, "c", ".", "decimal")).toBe("1");
  });

  it("restore drops a name that did NOT exist at save time (child-bracket pops descendant resets)", () => {
    // Parent has no resets: saveMarks before any "c" exists; a child pushes c.
    // Restoring to the parent's marks removes "c" entirely (back to create-on-use).
    const s0 = createCounterScope();
    const { marks } = applyResets(s0, []); // parent's child-bracket save (no "c")
    const { scope: childScope } = applyResets(s0, [{ name: "c", value: 0 }]);
    expect(resolveCounter(childScope, "c", "decimal")).toBe("0");
    const restored = restore(childScope, marks);
    expect(resolveCounter(restored, "c", "decimal")).toBe("0"); // create-on-use again
    // And it is truly gone from the stacks (not a lingering [0]).
    expect(resolveCounters(restored, "c", ".", "decimal")).toBe("0");
  });

  it("purity: applyResets/applyIncrements/restore do not mutate the input scope", () => {
    const s0 = createCounterScope();
    const { scope: s1 } = applyResets(s0, [{ name: "c", value: 0 }]);
    expect(resolveCounter(s0, "c", "decimal")).toBe("0"); // s0 still create-on-use
    const s2 = applyIncrements(s1, [{ name: "c", value: 1 }]);
    expect(resolveCounter(s1, "c", "decimal")).toBe("0"); // s1 unchanged (reset 0, no increment)
    expect(resolveCounter(s2, "c", "decimal")).toBe("1");
  });
});
