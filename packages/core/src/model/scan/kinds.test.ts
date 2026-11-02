/**
 * The kind table (`kinds.ts`): one conformance row per kind (its category and
 * placement), and a source guard that no rule outside the table and the
 * kind-internal modules names a kind.
 */
import { describe, expect, it } from "vitest";
import { EMBED_TYPES, type InlineItem } from "../block";
import { ITEM_KINDS } from "../storage/keys";
import { CATEGORIES, type Category, type CategoryTraits, type Container, FLOW_KINDS, type FlowKind, KINDS, type KindsOf, type TerminatorKind, allowedIn, categoryOfKind, isTerminatorKind, kindOfItem, kindOfStored } from "./kinds";

// Minimal Node `fs` / `path` surface (the package typechecks without @types/node; see state/encapsulation.test.ts).
interface DirEnt {
  readonly name: string;
}
interface NodeFs {
  readdirSync(path: string, opts: { withFileTypes: true }): DirEnt[];
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodePath {
  join(...parts: string[]): string;
}
declare const __dirname: string;
declare function require(id: "fs"): NodeFs;
declare function require(id: "path"): NodePath;

const CONFORMANCE: Record<FlowKind, { category: Category; placement: readonly Container[] }> = {
  text: { category: "text", placement: ["body", "cell", "footnote", "headerFooter"] },
  para: { category: "paragraphBreak", placement: ["body", "cell", "footnote", "headerFooter"] },
  lineBreak: { category: "inlineAtom", placement: ["body", "cell", "footnote", "headerFooter"] },
  object: { category: "inlineAtom", placement: ["body", "cell", "footnote", "headerFooter"] },
  footnote: { category: "inlineAtom", placement: ["body", "cell"] },
  field: { category: "inlineAtom", placement: ["headerFooter"] },
  hr: { category: "rule", placement: ["body", "cell", "footnote", "headerFooter"] },
  marker: { category: "anchor", placement: ["body", "cell", "footnote", "headerFooter"] },
  toc: { category: "atomicBlock", placement: ["body", "cell"] },
  table: { category: "containerBlock", placement: ["body", "cell"] },
  S: { category: "sectionBreak", placement: ["body"] },
};
const CONTAINERS: readonly Container[] = ["body", "cell", "footnote", "headerFooter"];

/** Each category's traits per the spec (r7 §1, §5): the true ones listed, the rest false — a flipped trait fails its row. */
const row = (...on: (keyof CategoryTraits)[]): CategoryTraits => {
  const t = { terminator: false, blockObject: false, holdsFlows: false, zeroWidth: false, insertedAlone: false, takesItsParagraph: false, removedByJoin: false };
  for (const k of on) t[k] = true;
  return t;
};
const TRAITS: Record<Category, CategoryTraits> = {
  text: row(),
  paragraphBreak: row("terminator"),
  inlineAtom: row(),
  rule: row("insertedAlone", "takesItsParagraph"),
  anchor: row("zeroWidth"),
  atomicBlock: row("terminator", "blockObject"),
  containerBlock: row("terminator", "blockObject", "holdsFlows"),
  sectionBreak: row("terminator", "removedByJoin"),
};
const CATEGORY_NAMES: readonly Category[] = ["text", "paragraphBreak", "inlineAtom", "rule", "anchor", "atomicBlock", "containerBlock", "sectionBreak"];

describe("category table", () => {
  it.each(CATEGORY_NAMES)("%s: its traits are the spec's", (c) => {
    expect({ ...CATEGORIES[c] }).toEqual(TRAITS[c]);
  });

  it("is closed: every category has a row", () => {
    expect(Object.keys(CATEGORIES).sort()).toEqual([...CATEGORY_NAMES].sort());
  });
});

describe("kind table", () => {
  it.each(FLOW_KINDS)("%s: category, placement, storage / read mapping", (k) => {
    const want = CONFORMANCE[k];
    expect(categoryOfKind(k)).toBe(want.category);
    expect(CONTAINERS.filter((c) => allowedIn(k, c))).toEqual(want.placement);
    const { stored, embedType } = KINDS[k];
    if (stored !== null) expect(kindOfStored(stored)).toBe(k);
    if (embedType !== null) expect(kindOfItem({ kind: "embed", embedType, attrs: {}, properties: {} })).toBe(k);
    expect(isTerminatorKind(k)).toBe(CATEGORIES[want.category].terminator);
  });

  it("is closed: every stored kind but the storage-internal sub, and every read embed type, has a row", () => {
    expect(new Set(FLOW_KINDS)).toEqual(new Set(Object.keys(KINDS)));
    // The kind types derive from the table (a wrong derivation fails to typecheck here).
    const terminators: Record<TerminatorKind, true> = { para: true, toc: true, table: true, S: true };
    const breaks: Record<KindsOf<"paragraphBreak"> | KindsOf<"sectionBreak">, true> = { para: true, S: true };
    expect(Object.keys(terminators).filter((k) => FLOW_KINDS.some((f) => f === k && isTerminatorKind(f)))).toHaveLength(4);
    expect(Object.keys(breaks)).toHaveLength(2);
    for (const s of Object.values(ITEM_KINDS)) expect(kindOfStored(s) !== null || s === ITEM_KINDS.sub).toBe(true);
    for (const e of Object.values(EMBED_TYPES)) {
      const item: InlineItem = { kind: "embed", embedType: e, attrs: {}, properties: {} };
      expect(KINDS[kindOfItem(item)].embedType).toBe(e);
    }
  });
});

/**
 * Kind names compared outside the table. Every kept check is kind-INTERNAL (a rule
 * about one kind's own data, not a category rule); each entry is `file: count`.
 */
const ALLOWED: Readonly<Record<string, { readonly count: number; readonly why: string }>> = {
  "commands/helpers/fragment.ts": { count: 9, why: "each fragment kind's storage constructor (kind-internal shape)" },
  "commands/set-object-props.ts": { count: 2, why: "C12 wrap / size / kind props exist only on the generic object" },
  "commands/remove-marker.ts": { count: 1, why: "a marker's ns / id identity (kind-internal)" },
  "derive/derive-flow.ts": { count: 1, why: "footnote body ownership (X20)" },
  "model.ts": { count: 5, why: "change routing: a footnote anchor's body map (X20: its keys / flow re-derive that body, ×3) and the storage-internal sub-flow (X12) walked into (×2) — storage mapping, not category rules" },
  "history.ts": { count: 1, why: "a stored selection's discriminant `object` (StoredSelection), not a flow kind" },
  "position/model-position.ts": { count: 2, why: "the selection kinds `text` / `object` (isTextSelection / isObjectSelection), not flow kinds" },
  "derive/records.ts": { count: 1, why: "a TOC's record (type + `a:*` options; a table's record is the grid's)" },
  "document/markers.ts": { count: 4, why: "a footnote anchor's body id and a marker's ns / id (kind-internal data of the read embed)" },
  "oracle/firings.ts": { count: 2, why: "the storage-internal sub-flow (X12) is walked into: storage mapping, not a flow kind" },
  "oracle/random-command.ts": { count: 2, why: "the mark named `field` (OPTIONS' atomic mark, not the kind); C10's random target is a TOC record" },
};

const KIND_WORDS = [
  ...FLOW_KINDS,
  ...Object.values(ITEM_KINDS),
  ...Object.values(EMBED_TYPES),
  "embed",
  "table-of-contents",
];
const words = KIND_WORDS.map((w) => w.replace(/[-]/g, "\\-")).join("|");
const PATTERNS = [
  new RegExp(`(?<!typeof [\\w.]+ )[=!]==\\s*"(${words})"`, "g"),
  new RegExp(`"(${words})"\\s*[=!]==`, "g"),
  new RegExp(`case "(${words})":`, "g"),
  /[=!]==\s*(ITEM_KINDS|EMBED_TYPES)\.\w+/g,
  /[=!]==\s*BLOCK_TYPES\.(tableOfContents|table)\b/g,
  /case (ITEM_KINDS|EMBED_TYPES)\.\w+:/g,
  new RegExp(`\\.(has|includes)\\(\\s*"(${words})"`, "g"),
  /\.(has|includes)\(\s*(ITEM_KINDS|EMBED_TYPES)\.\w+/g,
];

/**
 * Walked: every model directory / file a rule lives in. EXEMPT (the storage / read
 * mapping itself, where kinds are named by definition): `scan/` (the kind table and the
 * scan of storage into tokens) and `storage/` (item constructors and stored keys).
 */
const WALKED = ["commands", "position", "update", "derive", "oracle", "mapping", "document", "history.ts", "model.ts", "plan.ts"];

describe("kind guard", () => {
  it("the rule code (all but scan/ and storage/) compares no kind name outside the allow-list", () => {
    // The patterns see set / array membership tests too, and not `typeof x === "object"`.
    const hit = (src: string): boolean => PATTERNS.some((p) => new RegExp(p).test(src));
    expect([hit('s.has("toc")'), hit("ks.includes(ITEM_KINDS.hr)"), hit('typeof v === "object"')]).toEqual([true, true, false]);
    const fs = require("fs");
    const path = require("path");
    const root = path.join(__dirname, "..");
    const found: Record<string, string[]> = {};
    const scanFile = (r: string): void => {
      if (!r.endsWith(".ts") || r.endsWith(".test.ts")) return;
      const src = fs.readFileSync(path.join(root, r), "utf8");
      const hits = PATTERNS.flatMap((p) => [...src.matchAll(p)].map((m) => m[0]));
      if (hits.length > 0) found[r] = hits;
    };
    const walk = (rel: string): void => {
      if (rel.endsWith(".ts")) return scanFile(rel);
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) walk(`${rel}/${e.name}`);
    };
    for (const p of WALKED) walk(p);
    const counts = Object.fromEntries(Object.entries(found).map(([f, h]) => [f, h.length]));
    expect(counts, JSON.stringify(found)).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.count])));
  });
});
