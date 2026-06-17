import { describe, it, expect } from "vitest";
import type { AccessibilityNode, AccessibilityTextRun, BlockId } from "@taleweaver/core";
import { reconcileKey, selfFingerprint, reconcileMirror, type NodeElMap } from "./dom-mirror-cache";
import { buildDomMirror } from "./dom-mirror";

const bid = (s: string): BlockId => s as BlockId;
function run(text: string, start: number, extra: Partial<AccessibilityTextRun> = {}): AccessibilityTextRun {
  return { text, sourceOffsetStart: start, sourceOffsetEnd: start + text.length, ...extra };
}
function para(id: string, text: string): AccessibilityNode {
  return { role: "paragraph", sourceBlockId: bid(id), children: [], text: [run(text, 0)] };
}
function heading(id: string, level: number, text: string): AccessibilityNode {
  return { role: "heading", sourceBlockId: bid(id), level, children: [], text: [run(text, 0)] };
}
function docTree(...children: AccessibilityNode[]): AccessibilityNode {
  return { role: "document", sourceBlockId: null, children };
}

describe("dom-mirror-cache keys + fingerprint", () => {
  it("keys a block node by its sourceBlockId", () => {
    expect(reconcileKey(para("p1", "x"), new Map())).toBe("p1");
  });
  it("keys synthetic nodes by role + per-call ordinal", () => {
    const ord = new Map<string, number>();
    const list1: AccessibilityNode = { role: "list", sourceBlockId: null, children: [] };
    const list2: AccessibilityNode = { role: "list", sourceBlockId: null, children: [] };
    expect(reconcileKey(list1, ord)).toBe("#list:0");
    expect(reconcileKey(list2, ord)).toBe("#list:1");
  });
  it("fingerprint differs when run text changes, same when unchanged", () => {
    expect(selfFingerprint(para("p1", "hello"))).toBe(selfFingerprint(para("p1", "hello")));
    expect(selfFingerprint(para("p1", "hello"))).not.toBe(selfFingerprint(para("p1", "help")));
  });
  it("fingerprint captures every rendered run field (emphasis/link/suggestion/inComment/noteref)", () => {
    const base = para("p1", "x");
    const withBold: AccessibilityNode = { ...base, text: [run("x", 0, { emphasis: ["bold"] })] };
    const withLink: AccessibilityNode = { ...base, text: [run("x", 0, { link: "https://a" })] };
    const withSug: AccessibilityNode = { ...base, text: [run("x", 0, { suggestion: "insertion" })] };
    const withCmt: AccessibilityNode = { ...base, text: [run("x", 0, { inComment: true })] };
    const withRef: AccessibilityNode = { ...base, text: [run("x", 0, { noteref: bid("fn0") })] };
    const fps = [base, withBold, withLink, withSug, withCmt, withRef].map(selfFingerprint);
    expect(new Set(fps).size).toBe(fps.length); // all distinct

    // page-field run: the fingerprint MUST change when resolved text changes ("" → "3"),
    // because that is exactly how a page-count update re-syncs a reused mirror node.
    const fieldRun = run("", 5, { fieldKind: "page-count", fieldKey: "b/inline/1" });
    const withField: AccessibilityNode = { ...base, text: [run("Page ", 0), fieldRun] };
    const withFieldResolved: AccessibilityNode = { ...base, text: [run("Page ", 0), { ...fieldRun, text: "3" }] };
    expect(selfFingerprint(withField)).not.toBe(selfFingerprint(withFieldResolved));
  });
  it("fingerprint mirrors the DOM's inComment handling (only `=== true` renders an attr)", () => {
    const base = para("p1", "x");
    const t: AccessibilityNode = { ...base, text: [run("x", 0, { inComment: true })] };
    const f: AccessibilityNode = { ...base, text: [run("x", 0, { inComment: false })] };
    expect(selfFingerprint(t)).not.toBe(selfFingerprint(base));   // true ≠ undefined
    expect(selfFingerprint(t)).not.toBe(selfFingerprint(f));      // true ≠ false
    expect(selfFingerprint(f)).toBe(selfFingerprint(base));       // false ≡ undefined (matches DOM)
  });
  it("fingerprint captures level + listOrdered + name", () => {
    expect(selfFingerprint(heading("h", 2, "x"))).not.toBe(selfFingerprint(heading("h", 3, "x")));
    const ol: AccessibilityNode = { role: "list", sourceBlockId: null, listOrdered: true, children: [] };
    const ul: AccessibilityNode = { role: "list", sourceBlockId: null, listOrdered: false, children: [] };
    expect(selfFingerprint(ol)).not.toBe(selfFingerprint(ul));
    const img1: AccessibilityNode = { role: "img", sourceBlockId: bid("i"), name: "cat", children: [] };
    const img2: AccessibilityNode = { role: "img", sourceBlockId: bid("i"), name: "dog", children: [] };
    expect(selfFingerprint(img1)).not.toBe(selfFingerprint(img2));
    // #555: a listitem ordinal change (renumber) must re-fingerprint so the cached
    // `<li value=N>` rebuilds rather than going stale.
    const li5: AccessibilityNode = { role: "listitem", sourceBlockId: bid("li"), listOrdinal: 5, children: [] };
    const li3: AccessibilityNode = { role: "listitem", sourceBlockId: bid("li"), listOrdinal: 3, children: [] };
    expect(selfFingerprint(li5)).not.toBe(selfFingerprint(li3));
  });
});

/** Mount tree T0 into a host div via reconcile (prior=null), then reconcile T0->T1,
 *  and return the host so the test can compare it to a from-scratch build of T1. */
function reconcileInto(host: HTMLElement, prior: AccessibilityNode | null, priorMap: NodeElMap | null, next: AccessibilityNode): NodeElMap {
  return reconcileMirror(host, prior === null ? null : prior.children, next.children, priorMap, document);
}
/** The oracle: the host's children must equal a fresh buildDomMirror(next)'s children. */
function assertEquivalent(host: HTMLElement, next: AccessibilityNode): void {
  const fresh = buildDomMirror(next, document);
  // compare child-by-child (host IS the unwrapped document root, like syncTree)
  expect(host.innerHTML).toBe(fresh.innerHTML);
}

describe("dom-mirror-cache reconcile equivalence oracle", () => {
  const scenarios: Array<{ name: string; t0: AccessibilityNode; t1: AccessibilityNode }> = [
    { name: "type in a paragraph", t0: docTree(para("a", "hello"), para("b", "world")), t1: docTree(para("a", "hellp"), para("b", "world")) },
    { name: "insert a block", t0: docTree(para("a", "x")), t1: docTree(para("a", "x"), para("c", "new")) },
    { name: "delete a block", t0: docTree(para("a", "x"), para("b", "y")), t1: docTree(para("a", "x")) },
    { name: "reorder blocks", t0: docTree(para("a", "x"), para("b", "y")), t1: docTree(para("b", "y"), para("a", "x")) },
    { name: "adjacent swap", t0: docTree(para("a", "1"), para("b", "2"), para("c", "3")), t1: docTree(para("a", "1"), para("c", "3"), para("b", "2")) },
    { name: "split (Enter)", t0: docTree(para("a", "helloworld")), t1: docTree(para("a", "hello"), para("a2", "world")) },
    { name: "merge (Backspace)", t0: docTree(para("a", "hello"), para("a2", "world")), t1: docTree(para("a", "helloworld")) },
    { name: "heading level change (tag swap)", t0: docTree(heading("h", 2, "Title")), t1: docTree(heading("h", 3, "Title")) },
    { name: "role change in place (p->heading, same id)", t0: docTree(para("a", "T")), t1: docTree(heading("a", 1, "T")) },
    { name: "list regroup (add item)", t0: docTree({ role: "list", sourceBlockId: null, listOrdered: false, children: [{ role: "listitem", sourceBlockId: bid("li1"), children: [], text: [run("one", 0)] }] }),
      t1: docTree({ role: "list", sourceBlockId: null, listOrdered: false, children: [{ role: "listitem", sourceBlockId: bid("li1"), children: [], text: [run("one", 0)] }, { role: "listitem", sourceBlockId: bid("li2"), children: [], text: [run("two", 0)] }] }) },
    { name: "edit text of a list-item that also has a nested-list child",
      t0: docTree({ role: "list", sourceBlockId: null, listOrdered: false, children: [
        { role: "listitem", sourceBlockId: bid("li1"), text: [run("item text", 0)], children: [
          { role: "list", sourceBlockId: null, listOrdered: false, children: [
            { role: "listitem", sourceBlockId: bid("li1a"), children: [], text: [run("nested", 0)] },
          ] },
        ] },
      ] }),
      t1: docTree({ role: "list", sourceBlockId: null, listOrdered: false, children: [
        { role: "listitem", sourceBlockId: bid("li1"), text: [run("item text edited", 0)], children: [
          { role: "list", sourceBlockId: null, listOrdered: false, children: [
            { role: "listitem", sourceBlockId: bid("li1a"), children: [], text: [run("nested", 0)] },
          ] },
        ] },
      ] }) },
    { name: "suggestion insert", t0: docTree(para("a", "x")), t1: docTree({ role: "paragraph", sourceBlockId: bid("a"), children: [], text: [run("x", 0, { suggestion: "insertion" })] }) },
    { name: "empty -> nonempty", t0: docTree(), t1: docTree(para("a", "x")) },
    { name: "nonempty -> empty", t0: docTree(para("a", "x")), t1: docTree() },
    { name: "img alt-text (name) change in place",
      t0: docTree({ role: "img", sourceBlockId: bid("i1"), name: "cat", children: [] }),
      t1: docTree({ role: "img", sourceBlockId: bid("i1"), name: "dog", children: [] }) },
    { name: "navigation landmark name change in place (reused nav must re-sync aria-label)",
      t0: docTree({ role: "navigation", sourceBlockId: bid("nav1"), name: "Contents", children: [] }),
      t1: docTree({ role: "navigation", sourceBlockId: bid("nav1"), name: "Table of contents", children: [] }) },
    { name: "navigation landmark name removed in place (reused nav must drop aria-label)",
      t0: docTree({ role: "navigation", sourceBlockId: bid("nav1"), name: "Contents", children: [] }),
      t1: docTree({ role: "navigation", sourceBlockId: bid("nav1"), children: [] }) },
    { name: "listitem ordinal change in place — renumber (reused <li> must re-sync value) #555",
      t0: docTree({ role: "list", sourceBlockId: null, listOrdered: true, children: [{ role: "listitem", sourceBlockId: bid("li1"), listOrdinal: 5, children: [], text: [run("x", 0)] }] }),
      t1: docTree({ role: "list", sourceBlockId: null, listOrdered: true, children: [{ role: "listitem", sourceBlockId: bid("li1"), listOrdinal: 3, children: [], text: [run("x", 0)] }] }) },
    { name: "listitem ordinal removed in place — ordered→unordered (reused <li> must drop value) #555",
      t0: docTree({ role: "list", sourceBlockId: null, listOrdered: true, children: [{ role: "listitem", sourceBlockId: bid("li1"), listOrdinal: 5, children: [], text: [run("x", 0)] }] }),
      t1: docTree({ role: "list", sourceBlockId: null, listOrdered: true, children: [{ role: "listitem", sourceBlockId: bid("li1"), children: [], text: [run("x", 0)] }] }) },
  ];
  for (const s of scenarios) {
    it(`reconciled DOM equals a fresh build: ${s.name}`, () => {
      const host = document.createElement("div");
      const map0 = reconcileInto(host, null, null, s.t0);
      assertEquivalent(host, s.t0); // initial build is correct
      reconcileInto(host, s.t0, map0, s.t1);
      assertEquivalent(host, s.t1); // incremental result equals from-scratch
    });
  }

  it("role change in place builds a FRESH element (old <p> not reused)", () => {
    const host = document.createElement("div");
    const t0 = docTree(para("a", "T"));
    const map0 = reconcileMirror(host, null, t0.children, null, document);
    const oldEl = host.querySelector('[data-block-id="a"]');
    expect(oldEl?.tagName.toLowerCase()).toBe("p");
    const t1 = docTree(heading("a", 1, "T"));
    reconcileMirror(host, t0.children, t1.children, map0, document);
    const newEl = host.querySelector('[data-block-id="a"]');
    expect(newEl?.tagName.toLowerCase()).toBe("h1");
    expect(newEl).not.toBe(oldEl); // fresh element, not an in-place patch
  });
});

describe("dom-mirror-cache identity + perf properties", () => {
  it("preserves the DOM element of a block that was typed in (identity survives)", () => {
    const host = document.createElement("div");
    const t0 = docTree(para("a", "hello"), para("b", "world"));
    const map0 = reconcileMirror(host, null, t0.children, null, document);
    const elA = host.querySelector('[data-block-id="a"]');
    const elB = host.querySelector('[data-block-id="b"]');
    const t1 = docTree(para("a", "hellp"), para("b", "world")); // only A's text changed
    reconcileMirror(host, t0.children, t1.children, map0, document);
    // A reused (same node object), only its runs rebuilt:
    expect(host.querySelector('[data-block-id="a"]')).toBe(elA);
    // B fully untouched (same node):
    expect(host.querySelector('[data-block-id="b"]')).toBe(elB);
  });

  it("does NOT mutate an untouched sibling block (zero mutations on B when editing A)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const t0 = docTree(para("a", "hello"), para("b", "world"));
    const map0 = reconcileMirror(host, null, t0.children, null, document);
    const elB = host.querySelector('[data-block-id="b"]') as HTMLElement;
    let bMutations = 0;
    const obs = new MutationObserver((records) => { bMutations += records.length; });
    obs.observe(elB, { childList: true, subtree: true, characterData: true, attributes: true });
    const t1 = docTree(para("a", "hellp"), para("b", "world"));
    reconcileMirror(host, t0.children, t1.children, map0, document);
    // MutationObserver callbacks fire as a microtask AFTER this synchronous body, so
    // `bMutations` is still 0 here — takeRecords() drains the queued records synchronously
    // and we must COUNT them (not discard) or the assertion would pass vacuously.
    const pending = obs.takeRecords();
    obs.disconnect();
    expect(bMutations + pending.length).toBe(0);
    host.remove();
  });

  it("the browser Selection in block B survives an edit to a different block A", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const t0 = docTree(para("a", "hello"), para("b", "world"));
    const map0 = reconcileMirror(host, null, t0.children, null, document);
    const bRun = host.querySelector('[data-block-id="b"] [data-offset-start]') as HTMLElement;
    const bText = bRun.firstChild as Text;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.setStart(bText, 2);
    range.collapse(true);
    sel?.addRange(range);
    const t1 = docTree(para("a", "hellp"), para("b", "world")); // edit A only
    reconcileMirror(host, t0.children, t1.children, map0, document);
    const after = window.getSelection();
    expect(after?.anchorNode).toBe(bText);            // same Text node — survived
    expect(host.contains(after?.anchorNode ?? null)).toBe(true);
    host.remove();
  });

  it("a single-block edit mutates O(changed), not O(document) — mutation count bounded", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const blocks0 = Array.from({ length: 200 }, (_, i) => para("p" + i, "line " + i));
    const t0 = docTree(...blocks0);
    const map0 = reconcileMirror(host, null, t0.children, null, document);
    let total = 0;
    const obs = new MutationObserver((records) => { total += records.length; });
    obs.observe(host, { childList: true, subtree: true, characterData: true, attributes: true });
    const blocks1 = blocks0.map((b, i) => (i === 100 ? para("p100", "edited") : b));
    const t1 = docTree(...blocks1);
    reconcileMirror(host, t0.children, t1.children, map0, document);
    // Count synchronously via takeRecords() (the callback fires as a later microtask, so
    // `total` is still 0 here). `total + pending.length` is robust to either timing.
    const pending = obs.takeRecords();
    obs.disconnect();
    // Editing ONE paragraph touches only that block's run children — a small constant,
    // NOT proportional to the 200 blocks. Assert a tight bound (NOT a wall-clock number).
    expect(total + pending.length).toBeLessThanOrEqual(4);
    host.remove();
  });
});
