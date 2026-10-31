import { describe, it, expect } from "vitest";
import { planReplaceMatches, replaceAllMatches, applyReplaceAllPlan, type ReplaceAllPlan } from "./replace-matches";
import { getBlock, getEmbedContent } from "../document";
import { buildBlock, buildDocument, text, embed, inlineContent } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";
import type { TextMatch } from "../find-matches";

const bid = (s: string) => s as BlockId;

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** doc > [p(...)] single-paragraph fixture. */
function oneParagraph(items: Parameters<typeof inlineContent>[0]) {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent(items) }),
    ],
  });
}

function itemsOf(document: ReturnType<typeof oneParagraph>, id: string) {
  return getBlock(document, bid(id))?.inlineContent?.items;
}

/** Block `id`'s items after applying `plan` (the plan is offset writes, not content). */
function appliedItems(document: ReturnType<typeof oneParagraph>, plan: ReplaceAllPlan, id = "p") {
  return itemsOf(applyReplaceAllPlan(document, plan).document, id);
}

describe("planReplaceMatches — pure planner", () => {
  it("replaces a single match in one block", () => {
    const document = oneParagraph([text("hello world")]);
    // "world" is at [6, 11).
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 6, end: 11 }];
    const plan = planReplaceMatches(document, matches, "earth");

    expect(plan.blockWrites).toHaveLength(1);
    expect(nth(plan.blockWrites, 0, "write").blockId).toBe(bid("p"));
    expect(nth(plan.blockWrites, 0, "write").kind).toBe("block");
    expect(appliedItems(document, plan)).toEqual([
      { kind: "text", text: "hello earth", attrs: {} },
    ]);
    expect(plan.embedContentIdsToDelete.size).toBe(0);
  });

  it("LOAD-BEARING: replaces TWO matches in the SAME block (a naive left-to-right loop would clobber)", () => {
    // "ab cd ab" — two occurrences of "ab" at [0,2) and [6,8). Replace each with "XYZW".
    // A naive single-block loop that splices left-to-right against the SAME items
    // would invalidate the second match's offsets after the first splice shifts
    // everything. Right-to-left per-block keeps every earlier offset valid.
    const document = oneParagraph([text("ab cd ab")]);
    const matches: TextMatch[] = [
      { blockId: bid("p"), start: 0, end: 2 },
      { blockId: bid("p"), start: 6, end: 8 },
    ];
    const plan = planReplaceMatches(document, matches, "XYZW");

    expect(plan.blockWrites).toHaveLength(1);
    // Both occurrences replaced: "XYZW cd XYZW".
    expect(appliedItems(document, plan)).toEqual([
      { kind: "text", text: "XYZW cd XYZW", attrs: {} },
    ]);
  });

  it("replaces matches across multiple blocks (one blockWrite per block)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("foo bar")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("bar baz")]) }),
      ],
    });
    // "bar" in p1 at [4,7); "bar" in p2 at [0,3).
    const matches: TextMatch[] = [
      { blockId: bid("p1"), start: 4, end: 7 },
      { blockId: bid("p2"), start: 0, end: 3 },
    ];
    const plan = planReplaceMatches(document, matches, "QUX");

    expect(plan.blockWrites).toHaveLength(2);
    expect(appliedItems(document, plan, "p1")).toEqual([{ kind: "text", text: "foo QUX", attrs: {} }]);
    expect(appliedItems(document, plan, "p2")).toEqual([{ kind: "text", text: "QUX baz", attrs: {} }]);
  });

  it("empty replacement deletes the matched range", () => {
    const document = oneParagraph([text("hello world")]);
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 5, end: 11 }]; // " world"
    const plan = planReplaceMatches(document, matches, "");

    expect(appliedItems(document, plan)).toEqual([{ kind: "text", text: "hello", attrs: {} }]);
  });

  it("replacement inherits the formatting of the run containing match.start", () => {
    // [text("foo ", {bold}), text("bar", {italic})] — replace "bar" [4,7) with "qux".
    // The match starts at offset 4, which is the leading edge of the italic run →
    // the replacement takes {italic}.
    const document = oneParagraph([text("foo ", { bold: true }), text("bar", { italic: true })]);
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 4, end: 7 }];
    const plan = planReplaceMatches(document, matches, "qux");

    expect(appliedItems(document, plan)).toEqual([
      { kind: "text", text: "foo ", attrs: { bold: true } },
      { kind: "text", text: "qux", attrs: { italic: true } },
    ]);
  });

  it("replaces a match that spans a RUN BOUNDARY mid-word (delete + insert across the boundary)", () => {
    // [text("ab", {bold}), text("cd", {italic})] — offsets a=0,b=1,c=2,d=3.
    // Replace [1, 3) ("b" + "c", spanning the bold→italic boundary) with "XY".
    // attrs come from the run at offset 1 (inside the bold "ab" run) → bold.
    // The two-split spliceRun yields prefix "a"{bold} + replacement "XY"{bold} +
    // suffix "d"{italic}; normalization then merges the same-attrs "a"+"XY"
    // into "aXY"{bold}, while the DISTINCT italic "d" stays its own run — that
    // surviving boundary is what makes the cross-boundary splice observable.
    const document = oneParagraph([text("ab", { bold: true }), text("cd", { italic: true })]);
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 1, end: 3 }];
    const plan = planReplaceMatches(document, matches, "XY");

    expect(appliedItems(document, plan)).toEqual([
      { kind: "text", text: "aXY", attrs: { bold: true } },
      { kind: "text", text: "d", attrs: { italic: true } },
    ]);
  });

  it("normalization merges adjacent same-attrs runs after replace", () => {
    // [text("aXa")] — replace the middle "X" [1,2) with "" → "aa", a single merged run.
    const document = oneParagraph([text("aXa")]);
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 1, end: 2 }];
    const plan = planReplaceMatches(document, matches, "");
    expect(appliedItems(document, plan)).toEqual([{ kind: "text", text: "aa", attrs: {} }]);
  });

  it("collects embed-content subtree ids when a removed slice drops a contentBlockId embed", () => {
    // [text("ab"), embed(footnote-anchor → fnBody), text("cd")] — offsets: a=0,b=1,
    // embed=2, c=3, d=4. Remove [1, 3) which drops "b" + the embed.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            embed("footnote-anchor", { contentBlockId: "fnBody" }),
            text("cd"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fnBody", type: "footnote-body", parentId: null, inlineContent: inlineContent([text("note")]) }),
      ],
    });
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 1, end: 3 }];
    const plan = planReplaceMatches(document, matches, "");

    expect(plan.embedContentIdsToDelete.has(bid("fnBody"))).toBe(true);
    // Surviving inline content: "a" + "cd" → merged "acd".
    expect(appliedItems(document, plan)).toEqual([{ kind: "text", text: "acd", attrs: {} }]);
  });

  it("attrs fall back to {} when the match starts exactly on an embed item", () => {
    // [text("ab"), embed(anchor → fnBody), text("cd")] — offsets a=0,b=1,
    // embed=2, c=3, d=4. A match starting AT the embed offset (2) makes
    // findItemAtOffset return the embed, whose attrs aren't a text run's →
    // the replacement falls back to {} (the documented total-planner path).
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab", { bold: true }),
            embed("footnote-anchor", { contentBlockId: "fnBody" }),
            text("cd", { italic: true }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fnBody", type: "footnote-body", parentId: null, inlineContent: inlineContent([text("note")]) }),
      ],
    });
    // Replace [2, 4) — drops the embed + "c" — with "Z". start (2) lands on the embed.
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 2, end: 4 }];
    const plan = planReplaceMatches(document, matches, "Z");

    // The replacement text item carries {} (NOT the bold/italic neighbours).
    expect(nth(plan.blockWrites, 0, "write").replacements[0]?.attrs).toEqual({});
    const replacementItem = appliedItems(document, plan)?.find((it) => it.kind === "text" && it.text === "Z");
    expect(replacementItem?.attrs).toEqual({});
  });

  it("collects an embed in the EARLIER match's range when a LATER match is spliced first (right-to-left invariant)", () => {
    // [text("ab"), embed(anchor → fnBody), text("cd ef")] — offsets:
    // a=0,b=1,embed=2,c=3,d=4,space=5,e=6,f=7. TWO matches:
    //   match A (earlier, [1,3)) drops "b" + the embed (carries contentBlockId).
    //   match B (later, [6,8)) drops "ef".
    // The planner iterates RIGHT-TO-LEFT: it splices B first (mutating `items`),
    // THEN processes A second. The embed lives in A's range — collection must
    // still find it after B's splice shifted nothing below offset 3. This pins
    // the right-to-left offset invariant for the embed-collection path.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            embed("footnote-anchor", { contentBlockId: "fnBody" }),
            text("cd ef"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fnBody", type: "footnote-body", parentId: null, inlineContent: inlineContent([text("note")]) }),
      ],
    });
    const matches: TextMatch[] = [
      { blockId: bid("p"), start: 1, end: 3 }, // earlier — drops the embed
      { blockId: bid("p"), start: 6, end: 8 }, // later — processed FIRST
    ];
    const plan = planReplaceMatches(document, matches, "");

    // The embed in the earlier range is collected despite the later splice
    // running first.
    expect(plan.embedContentIdsToDelete.has(bid("fnBody"))).toBe(true);
    // Surviving content: "a" + "cd " (the embed + "b" gone, "ef" gone) → "acd ".
    expect(appliedItems(document, plan)).toEqual([{ kind: "text", text: "acd ", attrs: {} }]);
  });

  it("asserts matches within a block are ascending and non-overlapping", () => {
    const document = oneParagraph([text("aaaa")]);
    // Descending / overlapping order violates the findMatches contract.
    const matches: TextMatch[] = [
      { blockId: bid("p"), start: 2, end: 4 },
      { blockId: bid("p"), start: 0, end: 3 },
    ];
    expect(() => planReplaceMatches(document, matches, "X")).toThrow();
  });

  it("empty matches → empty plan", () => {
    const document = oneParagraph([text("hello")]);
    const plan = planReplaceMatches(document, [], "x");
    expect(plan.blockWrites).toHaveLength(0);
    expect(plan.embedContentIdsToDelete.size).toBe(0);
  });
});

describe("replaceAllMatches — applier (one transaction)", () => {
  it("applies all blockWrites + cascade-deletes embeds in ONE operation", () => {
    const document = oneParagraph([text("ab cd ab")]);
    const matches: TextMatch[] = [
      { blockId: bid("p"), start: 0, end: 2 },
      { blockId: bid("p"), start: 6, end: 8 },
    ];
    const result = replaceAllMatches(document, matches, "XYZW");
    expect(itemsOf(result.document, "p")).toEqual([{ kind: "text", text: "XYZW cd XYZW", attrs: {} }]);
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });

  it("cascade-deletes the embed body when a match removes a footnote anchor", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("ab"),
            embed("footnote-anchor", { contentBlockId: "fnBody" }),
            text("cd"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fnBody", type: "footnote-body", parentId: null, inlineContent: inlineContent([text("note")]) }),
      ],
    });
    const matches: TextMatch[] = [{ blockId: bid("p"), start: 1, end: 3 }];
    const result = replaceAllMatches(document, matches, "");

    // Body deleted (no orphan invariant would otherwise throw inside applyOperation).
    expect(getEmbedContent(result.document, bid("fnBody"))).toBeNull();
    expect(itemsOf(result.document, "p")).toEqual([{ kind: "text", text: "acd", attrs: {} }]);
  });

  it("empty matches → no-op (same state reference)", () => {
    const document = oneParagraph([text("hello")]);
    const result = replaceAllMatches(document, [], "x");
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});
