/**
 * Document schema detection + the explicit one-shot upgrade of the legacy inline
 * storage (schema 1: a `Y.Array` of per-run `Y.Map`s under `inlineContent`) to the
 * current storage (schema 2: ONE `Y.Text` per block — see `y-inline.ts`).
 *
 * There is NO engine-side auto-migration of a live collaborative document: two
 * peers migrating concurrently (or a peer typing into the legacy storage before
 * sync) would lose edits under Yjs key last-writer-wins. Instead the HOST runs
 * {@link upgradeDocument} once, with a single authority (a server, or one client
 * before collaboration starts). Editors never run it; they refuse to load legacy
 * storage (`LegacyDocumentError`) and halt on a legacy peer update.
 *
 * Detection is SHAPE-based and authoritative: `meta.schemaVersion` is only written
 * by `createYDoc` (a fresh local doc) and by `upgradeDocument`, and `createState`
 * may run before a provider syncs, so the marker alone can lie. The effective
 * version is `meta.schemaVersion ?? inferFromShape(doc)`.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import type { InlineItem } from "./inline-content";
import { CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY, getMetaMap, getTreeMaps } from "./yjs-doc";
import { buildYInlineText, isLegacyInlineValue, LegacyDocumentError } from "./y-inline";
import { yMapAsObject } from "./y-utils";
import { FORMATTING_SUGGESTION_ATTR, formattingSuggestionKey, type SuggestionId } from "./suggestions";

export { CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "./yjs-doc";

/** Transaction origin of `upgradeDocument`'s write — untracked by every History. */
export const UPGRADE_ORIGIN: unique symbol = Symbol("taleweaver.upgradeDocument");

export interface DocumentInspection {
  /** The effective version: `meta.schemaVersion`, else inferred from the storage shape. */
  readonly schemaVersion: number;
  /** Blocks (any tree) still holding legacy inline storage. Authoritative. */
  readonly legacyBlocks: readonly BlockId[];
}

/**
 * What a controller reports to its host (`onIncompatibleDocument`) when a peer update
 * carries legacy inline storage and the controller halts.
 */
export interface IncompatibleDocumentReport {
  /** The blocks the incompatible update wrote legacy storage into. */
  readonly legacyBlocks: readonly BlockId[];
}

export interface UpgradeReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Blocks whose inline storage was converted (empty when already current). */
  readonly upgradedBlocks: readonly BlockId[];
}

function legacyBlockIds(doc: Y.Doc): BlockId[] {
  const out: BlockId[] = [];
  for (const tree of getTreeMaps(doc)) {
    for (const [id, yBlock] of tree.entries()) {
      if (isLegacyInlineValue(yBlock.get("inlineContent"))) out.push(id as BlockId);
    }
  }
  return out;
}

/** The ids among `ids` whose block (in any tree) holds legacy inline storage. O(|ids|). */
export function legacyBlocksAmong(doc: Y.Doc, ids: Iterable<BlockId>): BlockId[] {
  const trees = getTreeMaps(doc);
  const out: BlockId[] = [];
  for (const id of ids) {
    for (const tree of trees) {
      const yBlock = tree.get(id);
      if (yBlock !== undefined && isLegacyInlineValue(yBlock.get("inlineContent"))) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}

/** Effective schema version + legacy blocks of `doc`. O(blocks). */
export function inspectDocument(doc: Y.Doc): DocumentInspection {
  const legacyBlocks = legacyBlockIds(doc);
  const stored = getMetaMap(doc).get(SCHEMA_VERSION_KEY);
  const schemaVersion =
    typeof stored === "number" ? stored : legacyBlocks.length > 0 ? 1 : CURRENT_SCHEMA_VERSION;
  return { schemaVersion, legacyBlocks };
}

/** Throw `LegacyDocumentError` if `doc` holds any legacy inline storage (load guard). */
export function assertNoLegacyStorage(doc: Y.Doc): void {
  const legacy = legacyBlockIds(doc);
  if (legacy.length > 0) throw new LegacyDocumentError(legacy);
}

/**
 * Normalize one legacy run's attrs into current storage: stored `null` values are
 * dropped (Yjs formatting treats `null` as "remove"; the read model treats an
 * absent key as unset), and the legacy single formatting-suggestion attr
 * (`formattingSuggestionId: <id>`) becomes that suggestion's own tag
 * (`formattingSuggestionId:<id>: true`). Shared by `upgradeDocument` and the JSON
 * decoder.
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

function readLegacyItems(yItems: Y.Array<unknown>, blockId: BlockId): InlineItem[] {
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

/**
 * Upgrade `doc` to the current schema, in ONE untracked transaction
 * ({@link UPGRADE_ORIGIN}): every legacy block's run array is replaced by a
 * `Y.Text` holding the same content (attrs normalized by
 * {@link normalizeLegacyAttrs}), and
 * `meta.schemaVersion` is set. Idempotent (a current doc is left untouched apart
 * from writing a missing version marker). Run it with a SINGLE authority — never
 * concurrently on several peers, never from an editor.
 */
export function upgradeDocument(doc: Y.Doc): UpgradeReport {
  const { schemaVersion: fromVersion } = inspectDocument(doc);
  const upgraded: BlockId[] = [];
  doc.transact(() => {
    for (const tree of getTreeMaps(doc)) {
      for (const [id, yBlock] of [...tree.entries()]) {
        const raw = yBlock.get("inlineContent");
        if (!isLegacyInlineValue(raw)) continue;
        const blockId = id as BlockId;
        yBlock.set("inlineContent", buildYInlineText({ items: readLegacyItems(raw, blockId) }));
        upgraded.push(blockId);
      }
    }
    const meta = getMetaMap(doc);
    if (meta.get(SCHEMA_VERSION_KEY) !== CURRENT_SCHEMA_VERSION) meta.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION);
  }, UPGRADE_ORIGIN);
  return { fromVersion, toVersion: CURRENT_SCHEMA_VERSION, upgradedBlocks: upgraded };
}
