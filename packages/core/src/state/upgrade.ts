/**
 * Document schema detection + the explicit one-shot upgrade to the current
 * storage (schema 3: block registry + flows of pieces with mark items — see
 * `registry.ts` / `y-flow.ts`). Earlier schemas kept a pointer tree of block maps in
 * the `blocks` / `embedContents` / `templateContents` roots, with inline content as
 * a run array (schema 1) or one `Y.Text` per block (schema 2).
 *
 * There is NO engine-side auto-migration of a live collaborative document. The
 * HOST runs {@link upgradeDocument} once, with a single authority. Editors refuse
 * to load an older schema (`LegacyDocumentError`) or a newer one
 * (`IncompatibleDocumentError`).
 *
 * The legacy roots are FROZEN by default — never written, overwritten or deleted —
 * so a legacy peer's later write stays DETECTABLE: any transaction touching a type
 * under a legacy root halts every editor (`compatibilityGate`), and the report
 * carries the touched legacy blocks and their current text. It is surfaced, not
 * merged. `clearLegacy: true` is an explicit host opt-in asserting that no legacy
 * peer is connected: the legacy roots are cleared (a legacy write after that lands
 * in a deleted type and is garbage-collected silently — hence the assertion).
 */
import type { BlockKindResolver } from "./block-kinds";
import { withInferringResolver } from "./storage-shapes";
import * as Y from "yjs";
import type { Block } from "./block";
import type { ReadonlyAttrs } from "./attrs";
import { markAttrsOfRun, requireAttrRegistry, type InclusiveKey } from "./mark-attrs";
import type { BlockId } from "./block-id";
import { asBlockId, productionAllocator } from "./block-id";
import type { InlineItem } from "./inline-content";
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, LEGACY_TREE_ROOTS, getMetaMap } from "./yjs-doc";
import { inlineItemsFromYText, isLegacyInlineValue, LegacyDocumentError } from "./y-inline";
import { yMapAsObject } from "./y-utils";
import { FORMATTING_SUGGESTION_ATTR, formattingSuggestionKey, type SuggestionId } from "./suggestions";
import { getRegistry, type TreeKind } from "./registry";
import { writeRoot, shapeOfNode, type TreeNode } from "./flow-ops";
import { treesOf } from "./build-state-from-blocks";
import type { BreakSuggestion } from "./break-tags";
import { LEGACY_BREAK_JOIN_EMBED_TYPE, LEGACY_BREAK_SPLIT_EMBED_TYPE } from "./legacy-break-embeds";
import { CROSS_REFERENCE_EMBED_TYPE } from "./ops/insert-cross-reference";
import { BOOKMARK_START_EMBED_TYPE, BOOKMARK_END_EMBED_TYPE } from "./bookmarks";

export { CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "./yjs-doc";

/** Transaction origin of `upgradeDocument`'s write — untracked by every History. */
export const UPGRADE_ORIGIN: unique symbol = Symbol("taleweaver.upgradeDocument");

/** Thrown when a document was written by a NEWER engine (or another Yjs instance). */
export class IncompatibleDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleDocumentError";
  }
}

export interface DocumentInspection {
  /** The effective version: `meta.schemaVersion`, else inferred from the storage shape. */
  readonly schemaVersion: number;
  /** Blocks still stored in the legacy roots of a not-yet-upgraded document. */
  readonly legacyBlocks: readonly BlockId[];
}

/**
 * What a controller reports to its host (`onIncompatibleDocument`) when it halts:
 * a legacy peer wrote into the frozen legacy roots (the touched blocks and their
 * CURRENT legacy text — surfaced, not merged), a peer upgraded past this engine's
 * schema, or a second Yjs instance decoded updates into the doc.
 */
export interface IncompatibleDocumentReport {
  readonly reason: "legacy-write" | "legacy-schema" | "newer-schema" | "second-yjs-instance";
  /** The legacy blocks involved (empty for the other reasons). */
  readonly legacyBlocks: readonly BlockId[];
  /** Current legacy text of each touched legacy block (`legacy-write` only). */
  readonly legacyText: Readonly<Record<string, string>>;
}

export interface UpgradeReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Blocks converted into the registry (empty when already current). */
  readonly upgradedBlocks: readonly BlockId[];
  /**
   * Pending break suggestions whose legacy embed named no boundary (no next text
   * sibling — end of a container, or an object next) or repeated a kind already
   * tagged at that boundary: dropped, their records left rangeless (hidden).
   */
  readonly orphanedBreakSuggestions: readonly SuggestionId[];
  /** Legacy block types the resolver does not register, stored by an inferred shape. */
  readonly unregisteredTypes: readonly string[];
  /**
   * Cross-reference fields re-anchored to bookmarks: the host block of each
   * field `rewritten` to `{ bookmarkId }`, and of each `broken` one (its target did not
   * resolve to a text block — it stores no bookmark and renders broken).
   */
  readonly crossReferences: { readonly rewritten: readonly BlockId[]; readonly broken: readonly BlockId[] };
}

export interface UpgradeOptions {
  /**
   * Storage-shape authority (the component registry). A legacy type the host no
   * longer registers is not an error here: its shape is inferred from the legacy
   * entry (inline content → text, children → container, else atomic) and the type is
   * listed in `UpgradeReport.unregisteredTypes`.
   */
  readonly resolver: BlockKindResolver;
  /**
   * The host asserts no legacy peer is connected: the legacy roots are cleared.
   * Default (false): they stay FROZEN so legacy writes remain detectable.
   */
  readonly clearLegacy?: boolean;
}

/** A schema-2 block's ¶ character props: its last text run's inclusive attrs (an empty block: none). */
function lastRunMarkAttrs(b: Block, isInclusive: InclusiveKey): ReadonlyAttrs | undefined {
  const items = b.inlineContent?.items;
  if (items === undefined) return undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it !== undefined && it.kind === "text") return markAttrsOfRun(it.attrs, isInclusive);
  }
  return undefined;
}

function legacyRoot(doc: Y.Doc, name: (typeof LEGACY_TREE_ROOTS)[number]): Y.Map<Y.Map<unknown>> {
  return doc.getMap(name) as Y.Map<Y.Map<unknown>>;
}

/** True iff `t` is one of the legacy roots (without instantiating missing ones). */
function isLegacyRootType(doc: Y.Doc, t: unknown): boolean {
  for (const name of LEGACY_TREE_ROOTS) {
    if (doc.share.get(name) === t) return true;
  }
  return false;
}

function legacyIds(doc: Y.Doc): BlockId[] {
  const out: BlockId[] = [];
  for (const name of LEGACY_TREE_ROOTS) {
    if (!doc.share.has(name)) continue;
    for (const id of legacyRoot(doc, name).keys()) out.push(asBlockId(id));
  }
  return out;
}

function inferVersion(doc: Y.Doc): number {
  if (doc.share.has("registry") && getRegistry(doc).size > 0) return CURRENT_SCHEMA_VERSION;
  let any = false;
  for (const name of LEGACY_TREE_ROOTS) {
    if (!doc.share.has(name)) continue;
    for (const b of legacyRoot(doc, name).values()) {
      any = true;
      if (isLegacyInlineValue(b.get("inlineContent"))) return 1;
    }
  }
  return any ? 2 : CURRENT_SCHEMA_VERSION;
}

/** Effective schema version + legacy blocks of `doc`. O(blocks) only for a legacy doc. */
export function inspectDocument(doc: Y.Doc): DocumentInspection {
  const stored = getMetaMap(doc).get(SCHEMA_VERSION_KEY);
  const schemaVersion = typeof stored === "number" ? stored : inferVersion(doc);
  return { schemaVersion, legacyBlocks: schemaVersion < CURRENT_SCHEMA_VERSION ? legacyIds(doc) : [] };
}

/** Load guard: throw for an older (`LegacyDocumentError`) or newer schema. */
export function assertNoLegacyStorage(doc: Y.Doc): void {
  const { schemaVersion, legacyBlocks } = inspectDocument(doc);
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new IncompatibleDocumentError(
      `document schema ${schemaVersion} is newer than this engine's ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (schemaVersion < CURRENT_SCHEMA_VERSION) throw new LegacyDocumentError(legacyBlocks);
}

/**
 * Normalize one legacy run's attrs: stored `null` values are dropped, and the
 * legacy single formatting-suggestion attr (`formattingSuggestionId: <id>`) becomes
 * that suggestion's own tag (`formattingSuggestionId:<id>: true`). Shared by
 * `upgradeDocument` and the JSON decoder.
 */
export function normalizeLegacyAttrs(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === FORMATTING_SUGGESTION_ATTR) {
      if (typeof value === "string" && value.length > 0) out[formattingSuggestionKey(value as SuggestionId)] = true;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function readLegacyRuns(yItems: Y.Array<unknown>, blockId: string): InlineItem[] {
  const items: InlineItem[] = [];
  yItems.forEach((raw, i) => {
    if (!(raw instanceof Y.Map)) throw new Error(`upgradeDocument: block "${blockId}" item ${i} is not a Y.Map`);
    const yItem = raw as Y.Map<unknown>;
    const yAttrs = yItem.get("attrs");
    const attrs = normalizeLegacyAttrs(yAttrs instanceof Y.Map ? yMapAsObject(yAttrs as Y.Map<unknown>) : {});
    if (yItem.get("kind") === "text") {
      const yText = yItem.get("text");
      items.push({ kind: "text", text: yText instanceof Y.Text ? yText.toString() : "", attrs });
      return;
    }
    const embedType = yItem.get("embedType");
    const yProps = yItem.get("properties");
    if (typeof embedType !== "string") throw new Error(`upgradeDocument: block "${blockId}" embed ${i} has no embedType`);
    items.push({
      kind: "embed",
      embedType,
      attrs,
      properties: yProps instanceof Y.Map ? yMapAsObject(yProps as Y.Map<unknown>) : {},
    });
  });
  return items;
}

/** A legacy block's inline items (schema 1 run array or schema 2 `Y.Text`), or null. */
function legacyInline(raw: unknown, id: string): InlineItem[] | null {
  if (raw instanceof Y.Text) {
    return inlineItemsFromYText(raw).map((it) => (it.kind === "text" ? { ...it, attrs: normalizeLegacyAttrs(it.attrs) } : it));
  }
  if (isLegacyInlineValue(raw)) return readLegacyRuns(raw, id);
  return null;
}

/** Read a legacy root map into pointer Blocks. */
function readLegacyTree(map: Y.Map<Y.Map<unknown>>): Block[] {
  const idOrNull = (v: unknown): BlockId | null => (typeof v === "string" ? asBlockId(v) : null);
  const out: Block[] = [];
  for (const [id, b] of map.entries()) {
    const attrs = b.get("attrs");
    const items = legacyInline(b.get("inlineContent"), id);
    out.push({
      id: asBlockId(id),
      type: typeof b.get("type") === "string" ? String(b.get("type")) : "paragraph",
      attrs: attrs instanceof Y.Map ? yMapAsObject(attrs as Y.Map<unknown>) : {},
      parentId: idOrNull(b.get("parentId")),
      prevSiblingId: idOrNull(b.get("prevSiblingId")),
      nextSiblingId: idOrNull(b.get("nextSiblingId")),
      firstChildId: idOrNull(b.get("firstChildId")),
      lastChildId: idOrNull(b.get("lastChildId")),
      inlineContent: items === null ? null : { items },
    });
  }
  return out;
}

/**
 * Schema ≤ 2 stored a pending paragraph-break suggestion as a zero-width embed in
 * block N's content. Anywhere in N (schema 2 had no caret clamp before a trailing
 * embed, so mid-content embeds are reachable), it names the N|N+1 break — N's own ¶
 * (end marks): each embed is dropped and its id keyed on N's entry
 * (`insertionSuggestionId` for a split, `deletionSuggestionId` for a join — both when
 * both kinds are present). The legacy Enter-at-0 shape (a split embed alone in an
 * empty N) is the same rule: the inserted ¶ is the empty paragraph's own. The first id
 * of a kind wins; the rest, and every embed whose N has no next TEXT sibling (its ¶
 * is not a removable break), go to `orphaned`.
 */
export function convertBreakSuggestions(blocks: readonly Block[], orphaned: SuggestionId[]): Block[] {
  const byId = new Map<BlockId, Block>();
  for (const b of blocks) byId.set(b.id, b);
  const tags = new Map<BlockId, { insertionId?: SuggestionId; deletionId?: SuggestionId }>();
  const stripped = new Map<BlockId, Block>();
  for (const b of blocks) {
    const items = b.inlineContent?.items;
    if (items === undefined) continue;
    const found: { kind: "insertionId" | "deletionId"; id: SuggestionId }[] = [];
    const kept = items.filter((it) => {
      if (it.kind !== "embed" || (it.embedType !== LEGACY_BREAK_SPLIT_EMBED_TYPE && it.embedType !== LEGACY_BREAK_JOIN_EMBED_TYPE)) return true;
      const sid = it.properties.suggestionId;
      if (typeof sid === "string") {
        found.push({ kind: it.embedType === LEGACY_BREAK_SPLIT_EMBED_TYPE ? "insertionId" : "deletionId", id: sid as SuggestionId });
      }
      return false;
    });
    if (kept.length === items.length) continue;
    stripped.set(b.id, { ...b, inlineContent: { items: kept } });
    const next = b.nextSiblingId === null ? undefined : byId.get(b.nextSiblingId);
    if (next === undefined || next.inlineContent === null) {
      for (const f of found) orphaned.push(f.id);
      continue;
    }
    const t = tags.get(b.id) ?? {};
    for (const f of found) {
      if (t[f.kind] === undefined) t[f.kind] = f.id;
      else orphaned.push(f.id);
    }
    tags.set(b.id, t);
  }
  if (stripped.size === 0) return [...blocks];
  return blocks.map((b0) => {
    const b = stripped.get(b0.id) ?? b0;
    const t = tags.get(b.id);
    if (t === undefined) return b;
    const bs: BreakSuggestion = Object.freeze({ ...t });
    return { ...b, breakSuggestion: bs };
  });
}

/** Current legacy text of a legacy block (for the halt report). */
export function legacyTextOf(doc: Y.Doc, id: string): string | null {
  for (const name of LEGACY_TREE_ROOTS) {
    if (!doc.share.has(name)) continue;
    const b = legacyRoot(doc, name).get(id);
    if (b === undefined) continue;
    const items = legacyInline(b.get("inlineContent"), id);
    return items === null ? "" : items.map((i) => (i.kind === "text" ? i.text : "￼")).join("");
  }
  return null;
}

/**
 * The legacy blocks a transaction touched (any type under a legacy root), or an
 * empty list. O(changed).
 */
export function legacyBlocksTouched(doc: Y.Doc, tx: Y.Transaction): BlockId[] {
  const out = new Set<string>();
  const visit = (t: Y.AbstractType<unknown>, key: string | null): void => {
    if (isLegacyRootType(doc, t)) {
      if (key !== null) out.add(key);
      return;
    }
    let cur: Y.AbstractType<unknown> = t;
    for (;;) {
      const it = cur._item;
      if (it === null) return;
      const up = it.parent;
      if (!(up instanceof Y.AbstractType)) return;
      if (isLegacyRootType(doc, up)) {
        if (it.parentSub !== null) out.add(it.parentSub);
        return;
      }
      cur = up;
    }
  };
  for (const [t, keys] of tx.changed) {
    const type = t as unknown as Y.AbstractType<unknown>;
    if (isLegacyRootType(doc, type)) for (const k of keys) visit(type, k);
    else visit(type, null);
  }
  return [...out].map(asBlockId);
}

/** Meta keys of the frozen legacy roots' baseline (written by `upgradeDocument`). */
const LEGACY_BASELINE_SV = "legacyBaselineSv";
const LEGACY_BASELINE_DELETED = "legacyBaselineDeleted";

/**
 * Visit every item under the legacy roots (incl. overwritten map values and
 * tombstones) with the legacy block (top-level key) it belongs to.
 */
function forEachLegacyItem(doc: Y.Doc, visit: (item: Y.Item, blockId: string) => void): void {
  const walk = (t: Y.AbstractType<unknown>, blockId: string): void => {
    const each = (it: Y.Item): void => {
      visit(it, blockId);
      if (it.content instanceof Y.ContentType) walk(it.content.type, blockId);
    };
    for (let it = t._start; it !== null; it = it.right) each(it);
    for (const head of t._map.values()) for (let it: Y.Item | null = head; it !== null; it = it.left) each(it);
  };
  for (const name of LEGACY_TREE_ROOTS) {
    const root = doc.share.get(name);
    if (root === undefined) continue;
    for (const [key, head] of root._map) {
      for (let it: Y.Item | null = head; it !== null; it = it.left) {
        visit(it, key);
        if (it.content instanceof Y.ContentType) walk(it.content.type, key);
      }
    }
  }
}

/** Deleted length per legacy block (only ever grows: deleted items never revive). */
function legacyDeletedLengths(doc: Y.Doc): Record<string, number> {
  const out: Record<string, number> = {};
  forEachLegacyItem(doc, (it, id) => {
    if (it.deleted) out[id] = (out[id] ?? 0) + it.length;
  });
  return out;
}

/**
 * Legacy writes already SURFACED on this doc (in memory, never synced): once a halt
 * reported them, the host decides what to do and may resume by replacing the
 * document over the same Y.Doc — a later gate's start check then looks only past
 * this point (a newer legacy write is still found).
 */
const surfaced = new WeakMap<Y.Doc, { readonly sv: Map<number, number>; readonly deleted: Record<string, number> }>();

/** Mark every legacy write present now as surfaced (called when a halt reports them). */
export function markLegacySurfaced(doc: Y.Doc): void {
  surfaced.set(doc, { sv: Y.decodeStateVector(Y.encodeStateVector(doc)), deleted: legacyDeletedLengths(doc) });
}

/** Record the frozen legacy roots' baseline (state vector + deleted lengths) at upgrade time. */
function writeLegacyBaseline(doc: Y.Doc): void {
  const meta = getMetaMap(doc);
  meta.set(LEGACY_BASELINE_SV, Y.encodeStateVector(doc));
  meta.set(LEGACY_BASELINE_DELETED, legacyDeletedLengths(doc));
}

/**
 * The legacy blocks written since the upgrade froze the legacy roots — including
 * writes that landed while no compatibility gate was watching (between the upgrade /
 * `createState` and a backend subscribing). An item under a legacy root past the
 * baseline state vector is a legacy insert; a block's deleted length past its baseline
 * is a legacy delete. A document never upgraded (created at schema 3) has an empty
 * baseline: any legacy item is a legacy write. O(legacy content).
 */
export function legacyWritesSinceUpgrade(doc: Y.Doc): BlockId[] {
  const meta = getMetaMap(doc);
  const rawSv = meta.get(LEGACY_BASELINE_SV);
  const rawDel: unknown = meta.get(LEGACY_BASELINE_DELETED);
  const seen = surfaced.get(doc);
  const sv = seen?.sv ?? (rawSv instanceof Uint8Array ? Y.decodeStateVector(rawSv) : new Map<number, number>());
  const baseDeleted: Readonly<Record<string, unknown>> =
    seen?.deleted ?? (typeof rawDel === "object" && rawDel !== null ? (rawDel as Record<string, unknown>) : {});
  const written = new Set<string>();
  const deleted = legacyDeletedLengths(doc);
  forEachLegacyItem(doc, (it, id) => {
    if (it.id.clock + it.length > (sv.get(it.id.client) ?? 0)) written.add(id);
  });
  for (const [id, n] of Object.entries(deleted)) {
    const base = baseDeleted[id];
    if (n > (typeof base === "number" ? base : 0)) written.add(id);
  }
  return [...written].map(asBlockId);
}

/**
 * Schema-2 cross-reference fields store `targetId` (a block id); schema 3 targets a
 * bookmark (Word's `_Ref`). Each field whose target is a main-tree text block
 * gets `{ bookmarkId }` — one bookmark per target, its markers written around the
 * target's text; any other field keeps no target and renders broken.
 */
function crossReferencesToBookmarks(
  trees: readonly [TreeKind, Block[]][],
  report: { rewritten: BlockId[]; broken: BlockId[] },
): [TreeKind, Block[]][] {
  const main = new Map<BlockId, Block>();
  for (const [kind, blocks] of trees) if (kind === "block") for (const b of blocks) main.set(b.id, b);
  const bookmarkOf = new Map<BlockId, string>();
  const fields = trees.map(([kind, blocks]): [TreeKind, Block[]] => [
    kind,
    blocks.map((b) => {
      if (b.inlineContent === null || !b.inlineContent.items.some((it) => it.kind === "embed" && it.embedType === CROSS_REFERENCE_EMBED_TYPE)) return b;
      const items = b.inlineContent.items.map((it): InlineItem => {
        if (it.kind !== "embed" || it.embedType !== CROSS_REFERENCE_EMBED_TYPE) return it;
        const { targetId, ...rest } = it.properties;
        const target = typeof targetId === "string" ? main.get(asBlockId(targetId)) : undefined;
        if (target === undefined || target.inlineContent === null) {
          report.broken.push(b.id);
          return { ...it, properties: rest };
        }
        const bookmarkId = bookmarkOf.get(target.id) ?? productionAllocator.allocate();
        bookmarkOf.set(target.id, bookmarkId);
        report.rewritten.push(b.id);
        return { ...it, properties: { ...rest, bookmarkId } };
      });
      return { ...b, inlineContent: { items } };
    }),
  ]);
  if (bookmarkOf.size === 0) return fields;
  const marker = (embedType: string, bookmarkId: string): InlineItem => ({ kind: "embed", embedType, attrs: {}, properties: { bookmarkId } });
  return fields.map(([kind, blocks]): [TreeKind, Block[]] => [
    kind,
    blocks.map((b) => {
      const id = kind === "block" ? bookmarkOf.get(b.id) : undefined;
      if (id === undefined || b.inlineContent === null) return b;
      return { ...b, inlineContent: { items: [marker(BOOKMARK_START_EMBED_TYPE, id), ...b.inlineContent.items, marker(BOOKMARK_END_EMBED_TYPE, id)] } };
    }),
  ]);
}

/** The body page keys a schema-2 section-less document stored on its root. */
const ROOT_PAGE_KEYS = ["headerBlockId", "footerBlockId", "columnCount", "columnGap", "columnRule"] as const;

/**
 * A schema-2 root's page keys (header / footer links, whole-doc columns) leave the
 * root, which schema 3 never reads for them. A section-less root's keys move onto the
 * final section, which schema 3 always has (Word: the body's sectPr belongs to the
 * final section). A sectioned root's keys go onto every section lacking that key (the
 * root value was every such section's inherited one; a section's own value wins). The
 * root keeps every other attr. A root with no page keys is returned unchanged.
 */
function pageKeysOntoSections(doc: Y.Doc, root: TreeNode): TreeNode {
  const moved: Record<string, unknown> = {};
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root.attrs)) {
    if ((ROOT_PAGE_KEYS as readonly string[]).includes(k)) moved[k] = v;
    else kept[k] = v;
  }
  if (Object.keys(moved).length === 0) return root;
  if (root.children.some((c) => shapeOfNode(doc, c) === "section")) {
    const children = root.children.map((c) => (shapeOfNode(doc, c) === "section" ? { ...c, attrs: { ...moved, ...c.attrs } } : c));
    return { ...root, attrs: kept, children };
  }
  const section: TreeNode = { id: productionAllocator.allocate(), type: "section", attrs: moved, inlineContent: null, children: root.children };
  return { ...root, attrs: kept, children: [section] };
}

/**
 * Upgrade `doc` (schema 1 or 2) to schema 3 in ONE untracked transaction
 * ({@link UPGRADE_ORIGIN}): every tree is re-written into the registry + flows
 * (content re-minted, chunked at `PIECE_SOFT_MAX`; tables as grid entries; sections
 * as marks; each pending paragraph-break suggestion becomes a suggestion key on the
 * ¶ it names — see {@link convertBreakSuggestions}) and
 * `meta.schemaVersion = 3`. The legacy roots stay FROZEN unless
 * `options.clearLegacy`. Idempotent (a current doc only gains a missing marker).
 * Run it with a SINGLE authority — never concurrently, never from an editor.
 *
 * Each paragraph's ¶ character props (`markAttrs`) are its last run's INCLUSIVE
 * formatting keys, judged by the attr registry bound to `doc` ({@link bindAttrRegistry}
 * — an editor adopting the doc binds it; a host upgrading first binds it itself). With
 * none bound it THROWS before writing anything: the upgrade is one-shot, so ¶ props it
 * could not judge would be lost for good. A current doc needs no bound registry.
 */
export function upgradeDocument(doc: Y.Doc, options: UpgradeOptions): UpgradeReport {
  const { schemaVersion: fromVersion } = inspectDocument(doc);
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new IncompatibleDocumentError(`document schema ${fromVersion} is newer than this engine's ${CURRENT_SCHEMA_VERSION}`);
  }
  const upgraded: BlockId[] = [];
  const orphaned: SuggestionId[] = [];
  const unregistered = new Set<string>();
  const crossReferences = { rewritten: [] as BlockId[], broken: [] as BlockId[] };
  // Only a pre-current doc is rewritten (and needs the registry to judge ¶ props).
  const registry = fromVersion < CURRENT_SCHEMA_VERSION ? requireAttrRegistry(doc) : null;
  withInferringResolver(doc, options.resolver, (t) => unregistered.add(t), () => doc.transact(() => {
    const meta = getMetaMap(doc);
    if (registry !== null) {
      const isInclusive: InclusiveKey = (k) => registry.isInclusive(k);
      const rootRaw = meta.get("rootId");
      const rootId = typeof rootRaw === "string" ? asBlockId(rootRaw) : null;
      const trees: [TreeKind, (typeof LEGACY_TREE_ROOTS)[number]][] = [
        ["block", "blocks"],
        ["embedContent", "embedContents"],
        ["templateContent", "templateContents"],
      ];
      const read = trees
        .filter(([, name]) => doc.share.has(name))
        .map(([kind, name]): [TreeKind, Block[]] => [kind, convertBreakSuggestions(readLegacyTree(legacyRoot(doc, name)), orphaned)]);
      const converted = crossReferencesToBookmarks(read, crossReferences);
      for (const [kind, blocks] of converted) {
        for (const b of blocks) upgraded.push(b.id);
        const markAttrs = (b: Block): ReadonlyAttrs | undefined => lastRunMarkAttrs(b, isInclusive);
        const roots = treesOf(blocks, kind === "block" ? rootId : null, markAttrs);
        for (const r of roots) writeRoot(doc, r.id === rootId ? pageKeysOntoSections(doc, r) : r, kind);
      }
      if (options.clearLegacy === true) {
        for (const name of LEGACY_TREE_ROOTS) {
          if (!doc.share.has(name)) continue;
          const m = legacyRoot(doc, name);
          for (const k of [...m.keys()]) m.delete(k);
        }
      }
      writeLegacyBaseline(doc);
    }
    if (meta.get(SCHEMA_VERSION_KEY) !== CURRENT_SCHEMA_VERSION) meta.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
  }, UPGRADE_ORIGIN));
  return {
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    upgradedBlocks: upgraded,
    orphanedBreakSuggestions: orphaned,
    unregisteredTypes: [...unregistered],
    crossReferences,
  };
}
