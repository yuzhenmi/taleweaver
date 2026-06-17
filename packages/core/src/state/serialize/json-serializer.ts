import type { ReadonlyAttrs } from "../attrs";
import type { Block } from "../block";
import type { BlockId, IdAllocator } from "../block-id";
import type { BlockKind, BlockKindResolver } from "../block-kinds";
import type { InlineContent, InlineItem } from "../inline-content";
import type { State } from "../state";
import { getBlock, getEmbedContent, getTemplateContent } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { getEmbedContentsMap, getTemplateContentsMap } from "../yjs-doc";
import { getListDefsForState, type ListDef, type ListLevelConfig } from "../list-defs";
import { getComments, type CommentRecord, type CommentReply } from "../comments";
import {
  getSuggestions,
  type SuggestionRecord,
  type SuggestionKind,
} from "../suggestions";
import { isCounterStyle } from "../../styles/format-counter";
import type { CounterRestart } from "../../numbering/types";
import { buildStateFromBlocks } from "../build-state-from-blocks";
import type { DocumentSerializer } from "./document-serializer";
import { MalformedDocumentError } from "./document-serializer";

/**
 * Stable format id for the v1 human-friendly JSON serializer. A readable,
 * hand-authorable document format that is LOSSLESS for everything EXCEPT tables
 * (the binary serializer is the lossless escape for table-bearing documents).
 * A future format change ships a NEW id — old JSON is never reinterpreted under
 * a different meaning.
 */
export const JSON_FORMAT = "taleweaver-json";

/** Wire schema version. Bumped only on a breaking schema change (new format id is preferred). */
const JSON_VERSION = 1;

/**
 * Block types this serializer refuses (tables). EXACT set — NOT a `startsWith`
 * prefix match — so `table-of-contents` (an atomic leaf, NOT a table) passes
 * through and round-trips. Tables carry grid/span geometry the flat JSON tree
 * cannot represent losslessly; the binary serializer is the lossless path.
 */
const TABLE_TYPES: ReadonlySet<string> = new Set([
  "table",
  "table-row",
  "table-cell",
]);

/**
 * A single block on the wire — a NESTED tree node. Parent/sibling/child pointers
 * are DERIVED from nesting + array order on decode (not stored). `id` is OPTIONAL
 * (present → preserved verbatim; absent → minted on decode). The kind-driven
 * rule decides which of `content` / `children` appears:
 *   - container          → `children` (ALWAYS, even `[]`); NO `content`.
 *   - inline-bearing-leaf → `content`  (ALWAYS, even `[]`); NO `children`.
 *   - atomic-leaf         → NEITHER.
 * This is the ONLY way to distinguish an empty paragraph (`{items:[]}`) from an
 * empty container or atomic leaf (both `inlineContent: null`) — decode
 * reconstructs `inlineContent` from KIND, never from the presence of `content`.
 */
export interface JsonNode {
  readonly id?: string;
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: JsonInlineItem[];
  readonly children?: JsonNode[];
}

/** A wire inline item: a styled text run OR an embed marker. `attrs`/`props` omitted when empty. */
export type JsonInlineItem = JsonTextItem | JsonEmbedItem;

/** Wire form of a `TextItem`. */
export interface JsonTextItem {
  readonly text: string;
  readonly attrs?: Record<string, unknown>;
}

/** Wire form of an `EmbedItem`. `embed` is the embedType discriminant. */
export interface JsonEmbedItem {
  readonly embed: string;
  readonly attrs?: Record<string, unknown>;
  readonly props?: Record<string, unknown>;
}

/** The top-level wire envelope. Side-tables are omitted when empty. */
export interface JsonDocument {
  readonly format: string;
  readonly version: number;
  readonly root: JsonNode;
  readonly embedContents?: JsonNode[];
  readonly templateContents?: JsonNode[];
  readonly listDefs?: Record<string, ListDef>;
  readonly comments?: Record<string, BareCommentRecord>;
  readonly suggestions?: Record<string, BareSuggestionRecord>;
}

/** A `CommentRecord` minus its `id` (the id is the map key). */
type BareCommentRecord = Omit<CommentRecord, "id">;
/** A `SuggestionRecord` minus its `id` (the id is the map key). */
type BareSuggestionRecord = Omit<SuggestionRecord, "id">;

/**
 * Construct the JSON document serializer. `allocator` mints ids for id-less
 * (hand-authored) nodes on decode; `blockKindResolver` (typically the component
 * registry) classifies each block type's KIND — the load-bearing input that
 * drives the children/content emission rule and the decode-side reconstruction
 * of `inlineContent`.
 *
 * Dependencies are injected at construction (a factory closing over them), per
 * the `DocumentSerializer` contract. This serializer is HOST-registered (it
 * needs the host-supplied `blockKindResolver`), NOT default-registered — see
 * `createDefaultSerializerRegistry`.
 */
export function createJsonDocumentSerializer(deps: {
  allocator: IdAllocator;
  blockKindResolver: BlockKindResolver;
}): DocumentSerializer<string> {
  const { allocator, blockKindResolver } = deps;

  return {
    format: JSON_FORMAT,

    encode(state: State): string {
      const doc: JsonDocument = encodeDocument(state, blockKindResolver);
      return JSON.stringify(doc, null, 2);
    },

    decode(source: string): State {
      return decodeDocument(source, allocator, blockKindResolver);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Encode: State → JsonDocument
// ─────────────────────────────────────────────────────────────────────────

function encodeDocument(
  state: State,
  resolver: BlockKindResolver,
): JsonDocument {
  const root = encodeNode(
    state,
    state.rootId,
    (s, id) => getBlock(s, id),
    resolver,
  );

  const embedRoots = encodeForestRoots(
    state,
    [...getEmbedContentsMap(state[STATE_INTERNAL].doc).keys()] as BlockId[],
    (s, id) => getEmbedContent(s, id),
    resolver,
  );
  const templateRoots = encodeForestRoots(
    state,
    [...getTemplateContentsMap(state[STATE_INTERNAL].doc).keys()] as BlockId[],
    (s, id) => getTemplateContent(s, id),
    resolver,
  );

  const out: {
    format: string;
    version: number;
    root: JsonNode;
    embedContents?: JsonNode[];
    templateContents?: JsonNode[];
    listDefs?: Record<string, ListDef>;
    comments?: Record<string, BareCommentRecord>;
    suggestions?: Record<string, BareSuggestionRecord>;
  } = { format: JSON_FORMAT, version: JSON_VERSION, root };

  if (embedRoots.length > 0) out.embedContents = embedRoots;
  if (templateRoots.length > 0) out.templateContents = templateRoots;

  const listDefs = encodeListDefs(state);
  if (listDefs !== undefined) out.listDefs = listDefs;
  const comments = encodeComments(state);
  if (comments !== undefined) out.comments = comments;
  const suggestions = encodeSuggestions(state);
  if (suggestions !== undefined) out.suggestions = suggestions;

  return out;
}

/**
 * Encode the ROOTS of one block forest (embedContents / templateContents).
 * Roots are identified by `parentId === null`; their descendants are nested via
 * the recursive node walk. Children are NOT enumerated as roots. Roots are
 * emitted in the underlying map's key order (deterministic).
 */
function encodeForestRoots(
  state: State,
  ids: ReadonlyArray<BlockId>,
  read: (s: State, id: BlockId) => Block | null,
  resolver: BlockKindResolver,
): JsonNode[] {
  const roots: JsonNode[] = [];
  for (const id of ids) {
    const block = read(state, id);
    if (block !== null && block.parentId === null) {
      roots.push(encodeNode(state, id, read, resolver));
    }
  }
  return roots;
}

/**
 * Encode one block (and, recursively, its children) into a `JsonNode`. Resolves
 * the block's KIND via `resolver` and emits `children` (container) / `content`
 * (inline-bearing-leaf) / neither (atomic-leaf) accordingly. Throws on a table
 * type (the lossless escape is the binary serializer).
 */
function encodeNode(
  state: State,
  id: BlockId,
  read: (s: State, id: BlockId) => Block | null,
  resolver: BlockKindResolver,
): JsonNode {
  const block = read(state, id);
  if (block === null) {
    throw new Error(`json-serializer: block "${id}" not found during encode`);
  }
  if (TABLE_TYPES.has(block.type)) {
    throw new Error(
      `json-serializer: cannot encode table block (type "${block.type}") — ` +
        `tables are not representable in taleweaver-json; use the binary serializer ` +
        `(taleweaver-binary) for lossless serialization of table-bearing documents.`,
    );
  }

  const kind = resolveKind(resolver, block.type);
  const node: {
    id: string;
    type: string;
    attrs?: Record<string, unknown>;
    content?: JsonInlineItem[];
    children?: JsonNode[];
  } = { id: block.id, type: block.type };

  if (Object.keys(block.attrs).length > 0) {
    node.attrs = { ...block.attrs };
  }

  switch (kind) {
    case "container":
      node.children = encodeChildren(state, block, read, resolver);
      break;
    case "inline-bearing-leaf":
      node.content = encodeInlineContent(block.inlineContent);
      break;
    case "atomic-leaf":
      // Neither content nor children.
      break;
    default: {
      const exhaustive: never = kind;
      throw new Error(`json-serializer: unhandled BlockKind ${String(exhaustive)}`);
    }
  }

  return node;
}

/** Walk a container's `firstChildId` → `nextSiblingId` chain, encoding each child. */
function encodeChildren(
  state: State,
  parent: Block,
  read: (s: State, id: BlockId) => Block | null,
  resolver: BlockKindResolver,
): JsonNode[] {
  const out: JsonNode[] = [];
  let childId = parent.firstChildId;
  while (childId !== null) {
    out.push(encodeNode(state, childId, read, resolver));
    const child = read(state, childId);
    if (child === null) break;
    childId = child.nextSiblingId;
  }
  return out;
}

/** Map a leaf's `InlineContent` (possibly null on a malformed inline-bearing leaf) to wire items. */
function encodeInlineContent(content: InlineContent | null): JsonInlineItem[] {
  if (content === null) return [];
  return content.items.map(encodeInlineItem);
}

function encodeInlineItem(item: InlineItem): JsonInlineItem {
  if (item.kind === "text") {
    const out: { text: string; attrs?: Record<string, unknown> } = {
      text: item.text,
    };
    if (Object.keys(item.attrs).length > 0) out.attrs = { ...item.attrs };
    return out;
  }
  const out: {
    embed: string;
    attrs?: Record<string, unknown>;
    props?: Record<string, unknown>;
  } = { embed: item.embedType };
  if (Object.keys(item.attrs).length > 0) out.attrs = { ...item.attrs };
  if (Object.keys(item.properties).length > 0) out.props = { ...item.properties };
  return out;
}

function encodeListDefs(state: State): Record<string, ListDef> | undefined {
  const defs = getListDefsForState(state);
  if (defs.size === 0) return undefined;
  const out: Record<string, ListDef> = {};
  for (const listId of [...defs.keys()].sort()) {
    const def = defs.get(listId);
    if (def !== undefined) out[listId] = def;
  }
  return out;
}

/**
 * Encode comment records to bare `CommentRecord` shapes keyed by id — STRIPPING
 * the derived `range`/`orphaned` fields `getComments` adds. The range is
 * reconstructed on decode from the round-tripped `comment-start`/`comment-end`
 * marker embeds in inline content, so it is NEVER serialized.
 */
function encodeComments(
  state: State,
): Record<string, BareCommentRecord> | undefined {
  const comments = getComments(state);
  if (comments.length === 0) return undefined;
  const out: Record<string, BareCommentRecord> = {};
  // Stable order: sort by id.
  const sorted = [...comments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of sorted) {
    out[c.id] = {
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
      replies: c.replies.map((r) => ({ ...r })),
      resolved: c.resolved,
    };
  }
  return out;
}

/**
 * Encode suggestion records to bare `SuggestionRecord` shapes keyed by id —
 * STRIPPING the derived `range`/`orphaned` fields `getSuggestions` adds (the
 * range is reconstructed on decode from the suggestion-id-tagged inline items).
 */
function encodeSuggestions(
  state: State,
): Record<string, BareSuggestionRecord> | undefined {
  const suggestions = getSuggestions(state);
  if (suggestions.length === 0) return undefined;
  const out: Record<string, BareSuggestionRecord> = {};
  const sorted = [...suggestions].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const s of sorted) {
    const bare: { kind: SuggestionRecord["kind"]; author: string; createdAt: number; proposedAttrs?: Readonly<Record<string, unknown>> } = {
      kind: s.kind,
      author: s.author,
      createdAt: s.createdAt,
    };
    if (s.proposedAttrs !== undefined) bare.proposedAttrs = { ...s.proposedAttrs };
    out[s.id] = bare;
  }
  return out;
}

function resolveKind(resolver: BlockKindResolver, type: string): BlockKind {
  const kind = resolver.getBlockKind(type);
  if (kind === null) {
    throw new Error(
      `json-serializer: block type "${type}" is not registered (no BlockKind)`,
    );
  }
  return kind;
}

// ─────────────────────────────────────────────────────────────────────────
// Decode: JSON string → State
// ─────────────────────────────────────────────────────────────────────────

function decodeDocument(
  source: string,
  allocator: IdAllocator,
  resolver: BlockKindResolver,
): State {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new MalformedDocumentError(JSON_FORMAT);
  }
  if (!isRecord(parsed)) throw new MalformedDocumentError(JSON_FORMAT);
  if (parsed.format !== JSON_FORMAT) throw new MalformedDocumentError(JSON_FORMAT);
  if (parsed.version !== JSON_VERSION) throw new MalformedDocumentError(JSON_FORMAT);
  if (!isRecord(parsed.root)) throw new MalformedDocumentError(JSON_FORMAT);

  // Flatten each nested tree into flat id-bearing block records.
  const blocks: Block[] = [];
  const rootId = flattenNode(parsed.root, null, blocks, allocator, resolver).id;

  const embedContents: Block[] = [];
  for (const node of toNodeArray(parsed.embedContents)) {
    flattenNode(node, null, embedContents, allocator, resolver);
  }
  const templateContents: Block[] = [];
  for (const node of toNodeArray(parsed.templateContents)) {
    flattenNode(node, null, templateContents, allocator, resolver);
  }

  return buildStateFromBlocks({
    rootId,
    blocks,
    embedContents: embedContents.length > 0 ? embedContents : undefined,
    templateContents: templateContents.length > 0 ? templateContents : undefined,
    listDefs: decodeListDefs(parsed.listDefs),
    comments: decodeComments(parsed.comments),
    suggestions: decodeSuggestions(parsed.suggestions),
  });
}

/** The id + flat-array slot of a freshly-flattened node, for sibling-link patching. */
interface FlattenedRef {
  readonly id: BlockId;
  readonly index: number;
}

/**
 * Flatten one nested `JsonNode` subtree into `out` (in document order: each node
 * pushed before its children, so the root precedes its descendants). Returns the
 * (possibly minted) id of `node` and its slot index in `out`. Derives `parentId`
 * / sibling links / child links from nesting + array order; reconstructs
 * `inlineContent` from the block's KIND (NOT the presence of `content`). Throws
 * `MalformedDocumentError` on a structurally-invalid node or a table type.
 */
function flattenNode(
  raw: unknown,
  parentId: BlockId | null,
  out: Block[],
  allocator: IdAllocator,
  resolver: BlockKindResolver,
): FlattenedRef {
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  const type = raw.type;
  if (typeof type !== "string") throw new MalformedDocumentError(JSON_FORMAT);
  if (TABLE_TYPES.has(type)) throw new MalformedDocumentError(JSON_FORMAT);

  const id =
    typeof raw.id === "string" ? (raw.id as BlockId) : allocator.allocate();
  const attrs = decodeAttrs(raw.attrs);
  const kind = resolveKind(resolver, type);
  const inlineContent = decodeInlineContent(kind, raw.content);

  // Push self FIRST (document order), with child/sibling links patched in below.
  const selfIndex = out.length;
  out.push(
    Object.freeze({
      id,
      type,
      attrs,
      parentId,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent,
    }) as Block,
  );

  let firstChildId: BlockId | null = null;
  let lastChildId: BlockId | null = null;

  if (kind === "container") {
    const childRefs: FlattenedRef[] = [];
    for (const child of toNodeArray(raw.children)) {
      childRefs.push(flattenNode(child, id, out, allocator, resolver));
    }
    // Patch sibling links into the already-pushed child records (O(1) per child
    // via the captured slot index — no array scan). `.entries()` yields each
    // dense ref directly (no `childRefs[i]` re-index); prev/next neighbours are
    // looked up positionally and N2-guarded (in-bounds by the i>0 / i<len-1
    // conditions, but the index access still widens to `… | undefined`).
    for (const [i, ref] of childRefs.entries()) {
      const slot = out[ref.index];
      const prev = i > 0 ? childRefs[i - 1] : undefined;
      const next = i < childRefs.length - 1 ? childRefs[i + 1] : undefined;
      if (slot === undefined || (i > 0 && prev === undefined) || (i < childRefs.length - 1 && next === undefined)) {
        throw new Error(
          `flattenNode: child-link patch out of range (i=${i}, index=${ref.index}, out.length=${out.length})`,
        );
      }
      out[ref.index] = Object.freeze({
        ...slot,
        prevSiblingId: prev?.id ?? null,
        nextSiblingId: next?.id ?? null,
      }) as Block;
    }
    const firstRef = childRefs[0];
    const lastRef = childRefs[childRefs.length - 1];
    if (firstRef !== undefined && lastRef !== undefined) {
      firstChildId = firstRef.id;
      lastChildId = lastRef.id;
    }
  }

  if (firstChildId !== null || lastChildId !== null) {
    out[selfIndex] = Object.freeze({
      ...out[selfIndex],
      firstChildId,
      lastChildId,
    }) as Block;
  }

  return { id, index: selfIndex };
}

/**
 * Reconstruct a block's `inlineContent` from its KIND (NOT from the presence of
 * the `content` key — that is the whole point of the kind-driven schema):
 *   - container / atomic-leaf → `null` (no inline content slot).
 *   - inline-bearing-leaf     → `{ items }` (empty `[]` when `content` absent).
 */
function decodeInlineContent(
  kind: BlockKind,
  rawContent: unknown,
): InlineContent | null {
  if (kind !== "inline-bearing-leaf") return null;
  const items: InlineItem[] = [];
  for (const rawItem of toItemArray(rawContent)) {
    items.push(decodeInlineItem(rawItem));
  }
  return Object.freeze({ items: Object.freeze(items) });
}

function decodeInlineItem(raw: unknown): InlineItem {
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  if (typeof raw.text === "string") {
    return Object.freeze({
      kind: "text",
      text: raw.text,
      attrs: decodeAttrs(raw.attrs),
    });
  }
  if (typeof raw.embed === "string") {
    return Object.freeze({
      kind: "embed",
      embedType: raw.embed,
      attrs: decodeAttrs(raw.attrs),
      properties: decodeProps(raw.props),
    });
  }
  throw new MalformedDocumentError(JSON_FORMAT);
}

function decodeAttrs(raw: unknown): ReadonlyAttrs {
  if (raw === undefined) return Object.freeze({});
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  return Object.freeze({ ...raw });
}

function decodeProps(raw: unknown): Readonly<Record<string, unknown>> {
  if (raw === undefined) return Object.freeze({});
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  return Object.freeze({ ...raw });
}

/**
 * Decode + VALIDATE the `listDefs` side-table. This is an INGRESS surface
 * (hand-authored JSON), so every record is validated field-by-field and a
 * mismatch throws `MalformedDocumentError` — a malformed def must NOT crash raw
 * in `writeListDefInTx` (`def.levels.map`) nor slip a corrupt level into State.
 * Each `ListDef` is reconstructed from validated named fields (no blind cast).
 */
function decodeListDefs(raw: unknown): Record<string, ListDef> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  const out: Record<string, ListDef> = {};
  for (const [id, def] of Object.entries(raw)) {
    out[id] = decodeListDef(def);
  }
  return out;
}

function decodeListDef(raw: unknown): ListDef {
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  if (!Array.isArray(raw.levels)) throw new MalformedDocumentError(JSON_FORMAT);
  const levels: ListLevelConfig[] = raw.levels.map(decodeListLevel);
  return { levels };
}

function decodeListLevel(raw: unknown): ListLevelConfig {
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  if (!isCounterStyle(raw.style)) throw new MalformedDocumentError(JSON_FORMAT);
  if (typeof raw.start !== "number") throw new MalformedDocumentError(JSON_FORMAT);
  if (!isCounterRestart(raw.restart)) throw new MalformedDocumentError(JSON_FORMAT);
  return { style: raw.style, start: raw.start, restart: raw.restart };
}

const COUNTER_RESTARTS: ReadonlySet<string> = new Set<CounterRestart>([
  "always",
  "never",
  "after-break",
]);

function isCounterRestart(value: unknown): value is CounterRestart {
  return typeof value === "string" && COUNTER_RESTARTS.has(value);
}

/**
 * Decode + VALIDATE the `comments` side-table. INGRESS surface: a malformed
 * record (missing `replies`, non-boolean `resolved`, a malformed reply) must
 * throw `MalformedDocumentError` rather than crash raw in
 * `writeCommentRecordInTx` (`record.replies.map`). Each record is built from
 * validated named fields ONLY (id from the map key — a stray `id`/`range`/
 * `orphaned` in the JSON cannot ride along; no `...rec` spread).
 */
function decodeComments(raw: unknown): CommentRecord[] | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  const out: CommentRecord[] = [];
  for (const [id, rec] of Object.entries(raw)) {
    if (!isRecord(rec)) throw new MalformedDocumentError(JSON_FORMAT);
    if (typeof rec.author !== "string") throw new MalformedDocumentError(JSON_FORMAT);
    if (typeof rec.body !== "string") throw new MalformedDocumentError(JSON_FORMAT);
    if (typeof rec.createdAt !== "number") throw new MalformedDocumentError(JSON_FORMAT);
    if (typeof rec.resolved !== "boolean") throw new MalformedDocumentError(JSON_FORMAT);
    if (!Array.isArray(rec.replies)) throw new MalformedDocumentError(JSON_FORMAT);
    const replies: CommentReply[] = rec.replies.map(decodeCommentReply);
    // Map key is authoritative for the id; build from validated named fields only.
    out.push({
      id: id as CommentRecord["id"],
      author: rec.author,
      body: rec.body,
      createdAt: rec.createdAt,
      replies,
      resolved: rec.resolved,
    });
  }
  return out;
}

function decodeCommentReply(raw: unknown): CommentReply {
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  if (typeof raw.id !== "string") throw new MalformedDocumentError(JSON_FORMAT);
  if (typeof raw.author !== "string") throw new MalformedDocumentError(JSON_FORMAT);
  if (typeof raw.body !== "string") throw new MalformedDocumentError(JSON_FORMAT);
  if (typeof raw.createdAt !== "number") throw new MalformedDocumentError(JSON_FORMAT);
  return { id: raw.id, author: raw.author, body: raw.body, createdAt: raw.createdAt };
}

const SUGGESTION_KINDS: ReadonlySet<string> = new Set<SuggestionKind>([
  "insertion",
  "deletion",
  "formatting",
]);

function isSuggestionKind(value: unknown): value is SuggestionKind {
  return typeof value === "string" && SUGGESTION_KINDS.has(value);
}

/**
 * Decode + VALIDATE the `suggestions` side-table. INGRESS surface: an invalid
 * `kind` (not in the {@link SuggestionKind} union), a missing `author`, or a
 * non-object `proposedAttrs` must throw `MalformedDocumentError` rather than be
 * silently accepted corrupt into State. Each record is built from validated
 * named fields ONLY (id from the map key; no `...rec` spread).
 */
function decodeSuggestions(raw: unknown): SuggestionRecord[] | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  const out: SuggestionRecord[] = [];
  for (const [id, rec] of Object.entries(raw)) {
    if (!isRecord(rec)) throw new MalformedDocumentError(JSON_FORMAT);
    if (!isSuggestionKind(rec.kind)) throw new MalformedDocumentError(JSON_FORMAT);
    if (typeof rec.author !== "string") throw new MalformedDocumentError(JSON_FORMAT);
    if (typeof rec.createdAt !== "number") throw new MalformedDocumentError(JSON_FORMAT);
    const record: SuggestionRecord =
      rec.proposedAttrs === undefined
        ? {
            id: id as SuggestionRecord["id"],
            kind: rec.kind,
            author: rec.author,
            createdAt: rec.createdAt,
          }
        : {
            id: id as SuggestionRecord["id"],
            kind: rec.kind,
            author: rec.author,
            createdAt: rec.createdAt,
            proposedAttrs: decodeProposedAttrs(rec.proposedAttrs),
          };
    out.push(record);
  }
  return out;
}

function decodeProposedAttrs(raw: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(raw)) throw new MalformedDocumentError(JSON_FORMAT);
  return Object.freeze({ ...raw });
}

// ─────────────────────────────────────────────────────────────────────────
// Narrowing helpers
// ─────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coerce an optional `children` / forest field to an array, throwing if present-but-not-an-array. */
function toNodeArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MalformedDocumentError(JSON_FORMAT);
  return value;
}

/** Coerce an optional `content` field to an array, throwing if present-but-not-an-array. */
function toItemArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new MalformedDocumentError(JSON_FORMAT);
  return value;
}
