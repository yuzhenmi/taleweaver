import { createDefaultComponentRegistry, type ComponentRegistry } from "../components/component-registry";
import type { ComponentDefinition } from "../components/component-definition";
import { createElementBox, type RenderNode } from "../render/render-node";
import type { TextItem, EmbedItem, InlineContent, ReadonlyAttrs, BlockId, Block, State } from "../state";
import type { BlockKindResolver } from "../state/block-kinds";
import { buildStateFromBlocks } from "../state/build-state-from-blocks";
import { getBlock } from "../state/state";
import { createDefaultAttrRegistry, type AttrRegistry } from "../cascade/attr-registry";
import * as Y from "yjs";
import { STATE_INTERNAL } from "../state/state-internal";
import { bindAttrRegistry } from "../state/mark-attrs";

const EMPTY_ATTRS: ReadonlyAttrs = Object.freeze({});

export function text(content: string, attrs?: ReadonlyAttrs): TextItem {
  return Object.freeze({
    kind: "text",
    text: content,
    attrs: attrs ? Object.freeze({ ...attrs }) : EMPTY_ATTRS,
  });
}

export function embed(
  embedType: string,
  properties?: Readonly<Record<string, unknown>>,
  attrs?: ReadonlyAttrs,
): EmbedItem {
  return Object.freeze({
    kind: "embed",
    embedType,
    attrs: attrs ? Object.freeze({ ...attrs }) : EMPTY_ATTRS,
    properties: Object.freeze({ ...(properties ?? {}) }),
  });
}

/**
 * Build a frozen InlineContent fixture from a list of items. Test-only
 * wrapper around the bare `{ items }` shape — production code constructs
 * InlineContent directly via Y.Doc helpers, not through a factory.
 */
export function inlineContent(items: ReadonlyArray<TextItem | EmbedItem>): InlineContent {
  return Object.freeze({ items: Object.freeze([...items]) });
}

export function buildBlock(args: {
  id: string;
  type: string;
  attrs?: Record<string, unknown>;
  parentId?: string | null;
  prevSiblingId?: string | null;
  nextSiblingId?: string | null;
  firstChildId?: string | null;
  lastChildId?: string | null;
  inlineContent?: InlineContent | null;
}): Block {
  return Object.freeze({
    id: args.id as BlockId,
    type: args.type,
    attrs: args.attrs ? Object.freeze({ ...args.attrs }) : EMPTY_ATTRS,
    parentId: (args.parentId ?? null) as BlockId | null,
    prevSiblingId: (args.prevSiblingId ?? null) as BlockId | null,
    nextSiblingId: (args.nextSiblingId ?? null) as BlockId | null,
    firstChildId: (args.firstChildId ?? null) as BlockId | null,
    lastChildId: (args.lastChildId ?? null) as BlockId | null,
    inlineContent: args.inlineContent ?? null,
  });
}

/**
 * Build a Y.Doc-backed State from a list of Block-shape fixtures.
 * Each block is materialized into the Y.Doc's blocks map.
 *
 * Optional `embedContents` parameter materializes embed-content blocks
 * (footnote bodies, etc.) into the Y.Doc's embedContents map instead.
 * Per Decision A, embed-content blocks live in a separate map from
 * main-tree blocks so the "only root has null parentId" invariant
 * holds for state.blocks. Embed-content blocks typically have parentId
 * === null (no parent — they're referenced via EmbedItem.properties.contentBlockId).
 *
 * Optional `templateContents` parameter materializes template-content
 * blocks (header/footer bodies, etc.) into the Y.Doc's templateContents
 * map. Like embed-content blocks, they live in their own top-level map
 * and typically have parentId === null.
 *
 * Delegates to `buildStateFromBlocks` (state-module-internal); the
 * indirection is what keeps the Y.Doc-direct writes inside `state/`.
 */
export function buildState(args: {
  rootId: string;
  blocks: ReadonlyArray<Block>;
  embedContents?: ReadonlyArray<Block>;
  templateContents?: ReadonlyArray<Block>;
  /** Storage-shape authority; defaults to `TEST_RESOLVER`. Pass a registry that registers a host type. */
  resolver?: BlockKindResolver;
}): State {
  return buildStateFromBlocks({
    rootId: args.rootId as BlockId,
    blocks: args.blocks,
    embedContents: args.embedContents,
    templateContents: args.templateContents,
    resolver: args.resolver ?? TEST_RESOLVER,
  });
}

/**
 * The storage-shape authority test fixtures bind: the default component registry
 * (every built-in type). A test needing a host type registers it on its own registry.
 */
export const TEST_RESOLVER = createDefaultComponentRegistry();

/** A minimal host container type (renders a plain block box), for tests needing a type the defaults lack. */
export function testContainer(type: string): ComponentDefinition {
  return { type, kind: "container", render: (view, _ctx, children) => createElementBox(view.id, { display: "block" }, [...children]) };
}

/** A minimal host leaf type, for tests needing a type the defaults lack. */
export function testLeaf(type: string, leafShape: "inline-bearing" | "atomic" = "atomic"): ComponentDefinition {
  return { type, kind: "leaf", leafShape, render: (view) => createElementBox(view.id, { display: "block" }, []) };
}

/** A fresh default registry plus `defs` — a storage-shape authority that knows extra host types. */
export function registryWith(...defs: ComponentDefinition[]): ComponentRegistry {
  const reg = createDefaultComponentRegistry();
  for (const d of defs) reg.register(d);
  return reg;
}

/**
 * A compact document spec for structural tests: paragraphs `{ p, t?, type?, attrs?,
 * markAttrs? }`, images `{ img }`, tables `{ table, cells }` (one row, one paragraph
 * per cell) and explicit sections `{ sec, attrs?, children }`.
 */
export type FlowSpec =
  | { readonly p: string; readonly t?: string; readonly type?: string; readonly attrs?: Record<string, unknown>; readonly markAttrs?: ReadonlyAttrs }
  | { readonly img: string }
  | { readonly table: string; readonly cells: readonly string[] }
  | { readonly sec: string; readonly attrs?: Record<string, unknown>; readonly children: readonly FlowSpec[] };

const specId = (c: FlowSpec): string => ("p" in c ? c.p : "img" in c ? c.img : "table" in c ? c.table : c.sec);

function specBlocks(parent: string, children: readonly FlowSpec[], out: Block[]): void {
  const ids = children.map(specId);
  children.forEach((c, k) => {
    const links = { parentId: parent, prevSiblingId: ids[k - 1] ?? null, nextSiblingId: ids[k + 1] ?? null };
    if ("p" in c) {
      const b = buildBlock({ id: c.p, type: c.type ?? "paragraph", attrs: c.attrs, ...links, inlineContent: inlineContent(c.t === undefined || c.t === "" ? [] : [text(c.t)]) });
      out.push(c.markAttrs === undefined ? b : { ...b, markAttrs: c.markAttrs });
    } else if ("img" in c) {
      out.push(buildBlock({ id: c.img, type: "image", ...links }));
    } else if ("table" in c) {
      const row = `${c.table}-r`;
      out.push(buildBlock({ id: c.table, type: "table", ...links, firstChildId: row, lastChildId: row }));
      out.push(buildBlock({ id: row, type: "table-row", parentId: c.table, firstChildId: c.cells.length > 0 ? `${c.cells[0]}-c` : null, lastChildId: c.cells.length > 0 ? `${c.cells[c.cells.length - 1]}-c` : null }));
      c.cells.forEach((cp, i) => {
        const cell = `${cp}-c`;
        out.push(buildBlock({ id: cell, type: "table-cell", parentId: row, prevSiblingId: i > 0 ? `${c.cells[i - 1]}-c` : null, nextSiblingId: i < c.cells.length - 1 ? `${c.cells[i + 1]}-c` : null, firstChildId: cp, lastChildId: cp }));
        out.push(buildBlock({ id: cp, type: "paragraph", parentId: cell, inlineContent: inlineContent([]) }));
      });
    } else {
      const cids = c.children.map(specId);
      out.push(buildBlock({ id: c.sec, type: "section", attrs: c.attrs, ...links, firstChildId: cids[0] ?? null, lastChildId: cids[cids.length - 1] ?? null }));
      specBlocks(c.sec, c.children, out);
    }
  });
}

/** A `doc` rooted State from a {@link FlowSpec} list (a section-less list sits in the final section). */
export function buildFlowDoc(children: readonly FlowSpec[], resolver?: BlockKindResolver): State {
  const ids = children.map(specId);
  const blocks: Block[] = [buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null })];
  specBlocks("doc", children, blocks);
  return buildState({ rootId: "doc", blocks, resolver });
}

/** The document's final section id (the root's last child — it always exists). */
export function finalSectionOf(state: State): BlockId {
  const f = getBlock(state, state.rootId)?.lastChildId;
  if (f === null || f === undefined) throw new Error("no final section");
  return f;
}

/**
 * The top-level block boxes of a rendered document: the children of the root's
 * section boxes, in order (the root always holds ≥ 1 section).
 */
export function bodyChildren(root: RenderNode): RenderNode[] {
  if (root.type !== "element") return [];
  return root.children.flatMap((s) => (s.type === "element" ? [...s.children] : []));
}

const TEST_ATTRS = createDefaultAttrRegistry();

/** `x` with `registry` (default: the default attr registry) bound to its doc, as an editor binds its own. */
export function withTestAttrs<T extends Y.Doc | State>(x: T, registry: AttrRegistry = TEST_ATTRS): T {
  bindAttrRegistry(x instanceof Y.Doc ? x : x[STATE_INTERNAL].doc, registry);
  return x;
}
