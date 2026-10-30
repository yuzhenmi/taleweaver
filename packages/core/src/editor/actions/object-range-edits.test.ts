/**
 * Range edits touching an OBJECT block — a horizontal line (atomic leaf) or a table.
 * Google Docs / Word: a range covers an object whole or not at all; an endpoint on
 * one is `(objectId, 0)` (an endpoint inside a table, with the other outside, is
 * lifted to the table by the reducer's selection post-pass). Direct mode removes
 * every covered object with the text; suggesting mode strikes the text and leaves
 * the covered objects in place.
 *
 * Doc: "abcd" | <object> | "efgh"; the table is 1×1 with "xy" in its cell. A FRESH
 * document per case (edits mutate the Y.Doc in place).
 */
import { describe, it, expect } from "vitest";
import { getBlock, getChildIds, createPosition, createSpan, asBlockId, encodeFragmentClip, extractFragment, isFormattingSuggestionKey, INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR } from "../../state";
import type { BlockId, Selection, State } from "../../state";
import type { EditorAction } from "../editor-action";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { createEditorStateFromState } from "../editor-state";
import type { EditorState } from "../editor-state";
import { config, reduceEditor, bodyBlockIds } from "./test-helpers";

type Kind = "hr" | "table";
const id = (s: string): BlockId => asBlockId(s);
const at = (b: string, o: number) => createPosition(id(b), o);

/**
 * "abcd" | <objects> | "efgh". The first object is `obj`, a later one `obj2`, …; a
 * table's cell paragraph is `cp` (`cp2`, …).
 */
function doc(...kinds: Kind[]): State {
  const ids = ["p0", ...kinds.map((_, i) => (i === 0 ? "obj" : `obj${i + 1}`)), "p1"];
  const sib = (i: number) => ({ prevSiblingId: ids[i - 1] ?? null, nextSiblingId: ids[i + 1] ?? null });
  const objects = kinds.flatMap((kind, k) => {
    const oid = ids[k + 1] ?? "";
    const suffix = k === 0 ? "" : `${k + 1}`;
    if (kind === "hr") return [buildBlock({ id: oid, type: "horizontal-line", parentId: "doc", ...sib(k + 1) })];
    return [
      buildBlock({ id: oid, type: "table", parentId: "doc", ...sib(k + 1), firstChildId: `r${suffix}`, lastChildId: `r${suffix}`, attrs: { columnWidths: [1] } }),
      buildBlock({ id: `r${suffix}`, type: "table-row", parentId: oid, firstChildId: `c${suffix}`, lastChildId: `c${suffix}` }),
      buildBlock({ id: `c${suffix}`, type: "table-cell", parentId: `r${suffix}`, firstChildId: `cp${suffix}`, lastChildId: `cp${suffix}` }),
      buildBlock({ id: `cp${suffix}`, type: "paragraph", parentId: `c${suffix}`, inlineContent: inlineContent([text("xy")]) }),
    ];
  });
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p1" }),
      buildBlock({ id: "p0", type: "paragraph", parentId: "doc", ...sib(0), inlineContent: inlineContent([text("abcd")]) }),
      ...objects,
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", ...sib(ids.length - 1), inlineContent: inlineContent([text("efgh")]) }),
    ],
  });
}

/** A text block's runs: ~struck~, +inserted+, *bold* (^ = a formatting suggestion). */
function runs(state: State, blockId: BlockId): string {
  const items = getBlock(state, blockId)?.inlineContent?.items ?? [];
  return items
    .map((it) => {
      if (it.kind !== "text") return "□";
      let t = it.text;
      if (it.attrs.bold === true) t = `*${t}*`;
      if (Object.keys(it.attrs).some(isFormattingSuggestionKey)) t = `^${t}`;
      if (it.attrs[INSERTION_SUGGESTION_ATTR] !== undefined) t = `+${t}+`;
      if (it.attrs[DELETION_SUGGESTION_ATTR] !== undefined) t = `~${t}~`;
      return t;
    })
    .join("");
}

/** The body: `"text"` per paragraph, `[hr]` / `[table "cell"]` per object. */
function show(state: State): string {
  return bodyBlockIds(state)
    .map((b) => {
      const block = getBlock(state, b);
      if (block?.inlineContent) return `"${runs(state, b)}"`;
      if (block?.type !== "table") return "[hr]";
      const cells = getChildIds(state, b).flatMap((r) => getChildIds(state, r)).flatMap((c) => getChildIds(state, c));
      return `[table ${cells.map((p) => `"${runs(state, p)}"`).join(" ")}]`;
    })
    .join(" | ");
}

/** The caret as `"<its block's text>"@offset` — it must be collapsed, on a live text block. */
function caret(editor: EditorState): string {
  const { anchor, focus } = editor.selection;
  if (anchor.blockId !== focus.blockId || anchor.offset !== focus.offset) return `range ${anchor.blockId}:${anchor.offset}→${focus.blockId}:${focus.offset}`;
  const block = getBlock(editor.state, focus.blockId);
  if (block?.inlineContent == null) return `INVALID ${focus.blockId}:${focus.offset}`;
  return `"${runs(editor.state, focus.blockId)}"@${focus.offset}`;
}

/** The three ranges: across the object, starting on / in it, ending on / in it. */
function range(kind: Kind, where: "across" | "from" | "to"): Selection {
  const inObj = kind === "hr" ? at("obj", 0) : at("cp", 1);
  if (where === "across") return createSpan(at("p0", 1), at("p1", 2));
  return where === "from" ? createSpan(inObj, at("p1", 2)) : createSpan(at("p0", 1), inObj);
}

/** A rich-paste clip holding one paragraph `t`. */
function clipOf(t: string): string {
  const src = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text(t)]) }),
    ],
  });
  return encodeFragmentClip(extractFragment(src, createSpan(at("p", 0), at("p", t.length))));
}

const ACTIONS: Record<string, EditorAction> = {
  DEL: { type: "DELETE_BACKWARD" },
  TYPE: { type: "INSERT_TEXT", text: "X" },
  PASTE: { type: "PASTE", text: "X" },
  ENTER: { type: "SPLIT_NODE" },
  BOLD: { type: "TOGGLE_STYLE", style: "bold" },
  RICH: { type: "PASTE", clip: clipOf("X") },
};

/** `action` over `selection` (set through SET_SELECTION) in `state`: the resulting body + caret. */
function run(state: State, selection: Selection, mode: "direct" | "suggest", action: string): string {
  const cfg = mode === "direct" ? config : { ...config, suggestingAuthor: "alice" };
  const start = createEditorStateFromState(state, createSpan(at("p0", 0), at("p0", 0)), cfg);
  const selected = reduceEditor(start, { type: "SET_SELECTION", selection });
  const act = ACTIONS[action];
  if (act === undefined) throw new Error(action);
  const next = reduceEditor(selected, act);
  return `${show(next.state)}  ${caret(next)}`;
}

// prettier-ignore
const EXPECTED: Record<string, string> = {
  "hr direct across DEL": '"agh"  "agh"@1',
  "hr direct across TYPE": '"aXgh"  "aXgh"@2',
  "hr direct across PASTE": '"aXgh"  "aXgh"@2',
  "hr direct across ENTER": '"a" | "gh"  "gh"@0',
  "hr direct across BOLD": '"a*bcd*" | [hr] | "*ef*gh"  range p0:1→p1:2',
  "hr direct from DEL": '"abcd" | "gh"  "gh"@0',
  "hr direct from TYPE": '"abcd" | "Xgh"  "Xgh"@1',
  "hr direct from PASTE": '"abcd" | "Xgh"  "Xgh"@1',
  "hr direct from ENTER": '"abcd" | "" | "gh"  "gh"@0',
  "hr direct from BOLD": '"abcd" | [hr] | "*ef*gh"  range obj:0→p1:2',
  "hr direct to DEL": '"a" | "efgh"  "a"@1',
  "hr direct to TYPE": '"aX" | "efgh"  "aX"@2',
  "hr direct to PASTE": '"aX" | "efgh"  "aX"@2',
  "hr direct to ENTER": '"a" | "" | "efgh"  ""@0',
  "hr direct to BOLD": '"a*bcd*" | [hr] | "efgh"  range p0:1→obj:0',
  "hr suggest across DEL": '"a~bcd~" | [hr] | "~ef~gh"  "a~bcd~"@1',
  "hr suggest across TYPE": '"a+X+~bcd~" | [hr] | "~ef~gh"  "a+X+~bcd~"@2',
  "hr suggest across PASTE": '"a+X+~bcd~" | [hr] | "~ef~gh"  "a+X+~bcd~"@2',
  "hr suggest across ENTER": '"a~bcd~" | [hr] | "~ef~" | "gh"  "gh"@0',
  "hr suggest across BOLD": '"a^bcd" | [hr] | "^efgh"  range p0:1→p1:2',
  "hr suggest from DEL": '"abcd" | [hr] | "~ef~gh"  "~ef~gh"@0',
  "hr suggest from TYPE": '"abcd" | [hr] | "+X+~ef~gh"  "+X+~ef~gh"@1',
  "hr suggest from PASTE": '"abcd" | [hr] | "+X+~ef~gh"  "+X+~ef~gh"@1',
  "hr suggest from ENTER": '"abcd" | [hr] | "~ef~" | "gh"  "gh"@0',
  "hr suggest from BOLD": '"abcd" | [hr] | "^efgh"  range obj:0→p1:2',
  "hr suggest to DEL": '"a~bcd~" | [hr] | "efgh"  "a~bcd~"@1',
  "hr suggest to TYPE": '"a+X+~bcd~" | [hr] | "efgh"  "a+X+~bcd~"@2',
  "hr suggest to PASTE": '"a+X+~bcd~" | [hr] | "efgh"  "a+X+~bcd~"@2',
  "hr suggest to ENTER": '"a~bcd~" | "" | [hr] | "efgh"  ""@0',
  "hr suggest to BOLD": '"a^bcd" | [hr] | "efgh"  range p0:1→obj:0',
  "table direct across DEL": '"agh"  "agh"@1',
  "table direct across TYPE": '"aXgh"  "aXgh"@2',
  "table direct across PASTE": '"aXgh"  "aXgh"@2',
  "table direct across ENTER": '"a" | "gh"  "gh"@0',
  "table direct across BOLD": '"a*bcd*" | [table "*xy*"] | "*ef*gh"  range p0:1→p1:2',
  "table direct from DEL": '"abcd" | "gh"  "gh"@0',
  "table direct from TYPE": '"abcd" | "Xgh"  "Xgh"@1',
  "table direct from PASTE": '"abcd" | "Xgh"  "Xgh"@1',
  "table direct from ENTER": '"abcd" | "" | "gh"  "gh"@0',
  "table direct from BOLD": '"abcd" | [table "*xy*"] | "*ef*gh"  range obj:0→p1:2',
  "table direct to DEL": '"a" | "efgh"  "a"@1',
  "table direct to TYPE": '"aX" | "efgh"  "aX"@2',
  "table direct to PASTE": '"aX" | "efgh"  "aX"@2',
  "table direct to ENTER": '"a" | "" | "efgh"  ""@0',
  "table direct to BOLD": '"a*bcd*" | [table "*xy*"] | "efgh"  range p0:1→obj:0',
  "table suggest across DEL": '"a~bcd~" | [table "~xy~"] | "~ef~gh"  "a~bcd~"@1',
  "table suggest across TYPE": '"a+X+~bcd~" | [table "~xy~"] | "~ef~gh"  "a+X+~bcd~"@2',
  "table suggest across PASTE": '"a+X+~bcd~" | [table "~xy~"] | "~ef~gh"  "a+X+~bcd~"@2',
  "table suggest across ENTER": '"a~bcd~" | [table "~xy~"] | "~ef~" | "gh"  "gh"@0',
  "table suggest across BOLD": '"a^bcd" | [table "^xy"] | "^efgh"  range p0:1→p1:2',
  "table suggest from DEL": '"abcd" | [table "~xy~"] | "~ef~gh"  "~ef~gh"@0',
  "table suggest from TYPE": '"abcd" | [table "~xy~"] | "+X+~ef~gh"  "+X+~ef~gh"@1',
  "table suggest from PASTE": '"abcd" | [table "~xy~"] | "+X+~ef~gh"  "+X+~ef~gh"@1',
  "table suggest from ENTER": '"abcd" | [table "~xy~"] | "~ef~" | "gh"  "gh"@0',
  "table suggest from BOLD": '"abcd" | [table "^xy"] | "^efgh"  range obj:0→p1:2',
  "table suggest to DEL": '"a~bcd~" | [table "~xy~"] | "efgh"  "a~bcd~"@1',
  "table suggest to TYPE": '"a+X+~bcd~" | [table "~xy~"] | "efgh"  "a+X+~bcd~"@2',
  "table suggest to PASTE": '"a+X+~bcd~" | [table "~xy~"] | "efgh"  "a+X+~bcd~"@2',
  "table suggest to ENTER": '"a~bcd~" | "" | [table "~xy~"] | "efgh"  ""@0',
  "table suggest to BOLD": '"a^bcd" | [table "^xy"] | "efgh"  range p0:1→obj:0',
  "hr direct across RICH": '"aXgh"  "aXgh"@2',
  "hr direct from RICH": '"abcd" | "Xgh"  "Xgh"@1',
  "hr direct to RICH": '"aX" | "efgh"  "aX"@2',
  "hr suggest across RICH": '"a+X+~bcd~" | [hr] | "~ef~gh"  "a+X+~bcd~"@2',
  "hr suggest from RICH": '"abcd" | [hr] | "+X+~ef~gh"  "+X+~ef~gh"@1',
  "hr suggest to RICH": '"a+X+~bcd~" | [hr] | "efgh"  "a+X+~bcd~"@2',
  "table direct across RICH": '"aXgh"  "aXgh"@2',
  "table direct from RICH": '"abcd" | "Xgh"  "Xgh"@1',
  "table direct to RICH": '"aX" | "efgh"  "aX"@2',
  "table suggest across RICH": '"a+X+~bcd~" | [table "~xy~"] | "~ef~gh"  "a+X+~bcd~"@2',
  "table suggest from RICH": '"abcd" | [table "~xy~"] | "+X+~ef~gh"  "+X+~ef~gh"@1',
  "table suggest to RICH": '"a+X+~bcd~" | [table "~xy~"] | "efgh"  "a+X+~bcd~"@2',
};

describe("range edits touching an object (horizontal line / table)", () => {
  for (const kind of ["hr", "table"] as const)
    for (const mode of ["direct", "suggest"] as const)
      for (const where of ["across", "from", "to"] as const)
        for (const action of Object.keys(ACTIONS)) {
          const key = `${kind} ${mode} ${where} ${action}`;
          it(key, () => {
            expect(run(doc(kind), range(kind, where), mode, action)).toBe(EXPECTED[key]);
          });
        }

  it("a cross-block type-over / rich paste (no object) leaves the caret in the surviving block", () => {
    expect(run(doc(), createSpan(at("p0", 1), at("p1", 2)), "direct", "TYPE")).toBe('"aXgh"  "aXgh"@2');
    expect(run(doc(), createSpan(at("p0", 1), at("p1", 2)), "direct", "RICH")).toBe('"aXgh"  "aXgh"@2');
  });

  it("two object endpoints (in a table → on a rule): both go; the caret lands in the text after them", () => {
    // (Invariant I: an empty paragraph follows the table.)
    const sel = createSpan(at("cp", 1), at("obj2", 0));
    expect(run(doc("table", "hr"), sel, "direct", "DEL")).toBe('"abcd" | "efgh"  "efgh"@0');
    expect(run(doc("table", "hr"), sel, "direct", "TYPE")).toBe('"abcd" | "Xefgh"  "Xefgh"@1');
    expect(run(doc("table", "hr"), sel, "suggest", "DEL")).toBe('"abcd" | [table "~xy~"] | "" | [hr] | "efgh"  ""@0');
  });
});
