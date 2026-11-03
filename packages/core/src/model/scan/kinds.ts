/**
 * The CLOSED list of flow item kinds, each mapped to its CATEGORY, and the
 * categories' behaviour traits. Every command / position / read rule asks a
 * category trait, never a kind name: two kinds of one category behave identically
 * everywhere. The only per-kind data is the storage / read mapping (`stored`,
 * `embedType`) and `placement` (the containers a command may put the kind in).
 *
 * Categories (r7 §1, §5 — the C-rules are phrased per category):
 *   - `text`: characters; a caret stop per grapheme (R15);
 *   - `paragraphBreak` (¶): ends a paragraph and holds its attrs (R1);
 *   - `inlineAtom`: one read unit with a caret stop either side; Backspace / Delete
 *     take it as one character (C4); takes run formatting (images, line breaks,
 *     footnote anchors, fields);
 *   - `rule` (`[hr]`): an inline atom inserted in a paragraph of its own (C13); Backspace /
 *     Delete from the NEIGHBOURING paragraph take that whole paragraph (C4r); from inside
 *     it (or over a selection) the `[hr]` is one character like any other (G5);
 *   - `anchor`: one read unit of zero width; caret steps and Backspace / Delete step
 *     over it (markers);
 *   - `atomicBlock` (TOC): a block object the caret cannot enter; Backspace / Delete
 *     beside it delete it (C6);
 *   - `containerBlock` (table): a block object holding containers (its cells, inline in
 *     its flow as a bracket of marks); the caret goes inside, so Backspace / Delete beside
 *     it never delete it (C5, its C8 mirror);
 *   - `sectionBreak` (`[S]`): ends a section (R4); Backspace / Delete beside it join the
 *     paragraphs around it and it goes with the join (C7, C8).
 * Both block categories are BLOCK OBJECTS: followed by a ¶-paragraph (W2), placed by
 * C14, taken whole by a range (C9), deleted by id (C10). C5 and C6 are the only rules
 * that tell them apart — the spec's distinction (Word keeps a table on Backspace;
 * GDocs deletes a TOC), hence two categories.
 *
 * Containers: the body (root flow), a table cell, a footnote body, a header / footer
 * body. The storage-internal `sub` (a sub-flow, X12) is not a flow kind: no command sees it.
 */
import { EMBED_TYPES, type InlineItem, type TextItem } from "../block";
import { ITEM_KINDS } from "../storage/keys";

export type Category = "text" | "paragraphBreak" | "inlineAtom" | "rule" | "anchor" | "atomicBlock" | "containerBlock" | "sectionBreak";
export type Container = "body" | "cell" | "footnote" | "headerFooter";

/** A category's behaviour. */
export interface CategoryTraits {
  /** Ends a run of inline content (a scan terminator). */
  readonly terminator: boolean;
  /** A block object (W2, C9, C10, C14). */
  readonly blockObject: boolean;
  /** Holds containers (cells): the caret enters it (C5); else a block object is atomic (C6). */
  readonly holdsFlows: boolean;
  /** Read units of zero width that the caret and Backspace / Delete step over. */
  readonly zeroWidth: boolean;
  /** Inserted in a paragraph of its own (C13; `commands/helpers/insert-item.ts` dispatches on it). */
  readonly insertedAlone: boolean;
  /** In a paragraph of its own, Backspace / Delete from the neighbouring paragraph take that whole paragraph (C4r). */
  readonly takesItsParagraph: boolean;
  /** Removed when the paragraphs around it join: Backspace / Delete beside it join across it (C7, C8). */
  readonly removedByJoin: boolean;
}

const NO_TRAITS = { terminator: false, blockObject: false, holdsFlows: false, zeroWidth: false, insertedAlone: false, takesItsParagraph: false, removedByJoin: false } as const;
/** Literal-typed, so the kind types below derive from the table. */
const traits = <T extends Partial<CategoryTraits>>(t: T): Readonly<Omit<typeof NO_TRAITS, keyof T> & T> => Object.freeze({ ...NO_TRAITS, ...t });

export const CATEGORIES = {
  text: traits({}),
  paragraphBreak: traits({ terminator: true }),
  inlineAtom: traits({}),
  rule: traits({ insertedAlone: true, takesItsParagraph: true }),
  anchor: traits({ zeroWidth: true }),
  atomicBlock: traits({ terminator: true, blockObject: true }),
  containerBlock: traits({ terminator: true, blockObject: true, holdsFlows: true }),
  sectionBreak: traits({ terminator: true, removedByJoin: true }),
} as const satisfies Readonly<Record<Category, CategoryTraits>>;

export interface KindDef {
  readonly category: Category;
  /** The stored `k` of its item map (null: text is Y.Text characters). */
  readonly stored: string | null;
  /** The read model's `embedType` (inline kinds other than text), else null. */
  readonly embedType: string | null;
  readonly placement: ReadonlySet<Container>;
}

const ANYWHERE: ReadonlySet<Container> = new Set<Container>(["body", "cell", "footnote", "headerFooter"]);
/** The body and its table cells (today's main tree). */
const MAIN: ReadonlySet<Container> = new Set<Container>(["body", "cell"]);

const kind = <C extends Category>(category: C, stored: string | null, embedType: string | null, placement: ReadonlySet<Container>): Readonly<KindDef & { category: C }> =>
  Object.freeze({ category, stored, embedType, placement });

/**
 * Every flow kind. Placement is today's (schema 3): rules anywhere text goes; footnotes,
 * TOCs and tables in the main tree (no table in a header / footer / footnote); `[S]` in
 * the body only; page fields in headers / footers only (`insert-page-field-at-caret.ts`).
 */
export const KINDS = {
  text: kind("text", null, null, ANYWHERE),
  para: kind("paragraphBreak", ITEM_KINDS.para, null, ANYWHERE),
  lineBreak: kind("inlineAtom", ITEM_KINDS.lineBreak, EMBED_TYPES.lineBreak, ANYWHERE),
  object: kind("inlineAtom", ITEM_KINDS.object, EMBED_TYPES.object, ANYWHERE),
  footnote: kind("inlineAtom", ITEM_KINDS.footnote, EMBED_TYPES.footnoteAnchor, MAIN),
  field: kind("inlineAtom", ITEM_KINDS.field, EMBED_TYPES.field, new Set<Container>(["headerFooter"])),
  hr: kind("rule", ITEM_KINDS.hr, EMBED_TYPES.horizontalLine, ANYWHERE),
  marker: kind("anchor", ITEM_KINDS.marker, EMBED_TYPES.marker, ANYWHERE),
  toc: kind("atomicBlock", ITEM_KINDS.toc, null, MAIN),
  table: kind("containerBlock", ITEM_KINDS.table, null, MAIN),
  S: kind("sectionBreak", ITEM_KINDS.sectionBreak, null, new Set<Container>(["body"])),
} as const satisfies Record<string, KindDef>;

export type FlowKind = keyof typeof KINDS;
/** The kinds of category `C` (derived from the table: a new kind of a category joins them). */
export type KindsOf<C extends Category> = { [K in FlowKind]: (typeof KINDS)[K]["category"] extends C ? K : never }[FlowKind];
/** The kinds whose category is a terminator (scan tokens other than runs). */
export type TerminatorKind = { [K in FlowKind]: (typeof CATEGORIES)[(typeof KINDS)[K]["category"]]["terminator"] extends true ? K : never }[FlowKind];

const isFlowKind = (k: string): k is FlowKind => k in KINDS;
export const FLOW_KINDS: readonly FlowKind[] = Object.keys(KINDS).filter(isFlowKind);
/** A table's other marks (`⟨r⟩`, `⟨c⟩`, `⟧`) are storage-internal marks of the `table` kind: every rule sees a containerBlock beside them (§1 of the tables design). */
const TABLE_MARKS: readonly string[] = [ITEM_KINDS.row, ITEM_KINDS.cell, ITEM_KINDS.tableEnd];
const BY_STORED = new Map<string, FlowKind>([
  ...FLOW_KINDS.flatMap((k) => (KINDS[k].stored === null ? [] : [[KINDS[k].stored, k] as const])),
  ...TABLE_MARKS.map((m) => [m, "table"] as const),
]);
const BY_EMBED = new Map<string, FlowKind>(FLOW_KINDS.flatMap((k) => (KINDS[k].embedType === null ? [] : [[KINDS[k].embedType, k] as const])));

/** A token / neighbour kind: a flow kind, a content run, or the flow end. */
type KindLike = FlowKind | "run" | "end" | null | undefined;
const categoryName = (k: KindLike): Category | undefined => (k === undefined || k === null || k === "run" || k === "end" ? undefined : KINDS[k].category);
const categoryOf = (k: KindLike): CategoryTraits | undefined => {
  const c = categoryName(k);
  return c === undefined ? undefined : CATEGORIES[c];
};

/** The flow kind of a stored item map's `k`, or null (unknown, or the storage-internal `sub`). */
export const kindOfStored = (k: string): FlowKind | null => BY_STORED.get(k) ?? null;

/** The flow kind of a read inline item (an unknown embed type reads as an object, the generic inline atom). */
export const kindOfItem = (i: InlineItem): FlowKind => (i.kind === "text" ? "text" : (BY_EMBED.get(i.embedType) ?? "object"));
const itemTraits = (i: InlineItem | undefined): CategoryTraits | undefined => (i === undefined ? undefined : CATEGORIES[KINDS[kindOfItem(i)].category]);

export const isText = (i: InlineItem | undefined): i is TextItem => i !== undefined && i.kind === "text";

export const isTerminatorKind = (k: FlowKind): k is TerminatorKind => CATEGORIES[KINDS[k].category].terminator;

/** (The guards narrow to the category's kinds, derived from the table.) */
export const isParagraphBreak = (k: KindLike): k is KindsOf<"paragraphBreak"> => categoryName(k) === "paragraphBreak";
export const isSectionBreak = (k: KindLike): k is KindsOf<"sectionBreak"> => categoryName(k) === "sectionBreak";
export const isBlockObject = (k: KindLike): boolean => categoryOf(k)?.blockObject === true;
/** A block object or `[S]`: a range takes it whole (C9); it follows a ¶ or the flow start (W1, A2). */
export const isStructural = (k: KindLike): boolean => isBlockObject(k) || isSectionBreak(k);
/** A block object the caret cannot enter: Backspace / Delete beside it delete it (C6). */
export const isAtomicBlockObject = (k: KindLike): boolean => isBlockObject(k) && categoryOf(k)?.holdsFlows === false;
export const holdsFlows = (k: KindLike): boolean => categoryOf(k)?.holdsFlows === true;
/** Zero-width: caret steps and Backspace / Delete step over it. */
export const isZeroWidth = (i: InlineItem | undefined): boolean => itemTraits(i)?.zeroWidth === true;
/** An item whose paragraph of its own goes with it on a neighbour's Backspace / Delete (C4r). */
export const takesItsParagraph = (i: InlineItem | undefined): boolean => itemTraits(i)?.takesItsParagraph === true;
/** A terminator that goes when the paragraphs around it join (C7, C8). */
export const isRemovedByJoin = (k: KindLike): boolean => categoryOf(k)?.removedByJoin === true;

/** The category of `k` (for the conformance / permutation tests). */
export const categoryOfKind = (k: FlowKind): Category => KINDS[k].category;

export const allowedIn = (k: FlowKind, c: Container): boolean => KINDS[k].placement.has(c);
