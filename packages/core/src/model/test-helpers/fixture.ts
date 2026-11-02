/** Test-only helpers for the schema-4 model: raw-Yjs document setup and version comparison. */
import * as Y from "yjs";
import type { Block } from "../block";
import type { Document, TreeKind } from "../document/types";
import { createDocMap, getDocMap } from "../storage/doc-map";
import { typeId } from "../storage/item-id";
import { flowOf } from "../storage/map-reads";

export interface Fixture {
  readonly doc: Y.Doc;
  readonly docMap: Y.Map<unknown>;
  readonly flow: Y.Array<Y.Text>;
  /** The body flow's first piece (initially holding the one ¶). */
  readonly piece: Y.Text;
  readonly rootId: string;
}

export function fixture(clientID = 1, from?: Y.Doc, gc = true): Fixture {
  const doc = new Y.Doc({ gc });
  doc.clientID = clientID;
  if (from !== undefined) Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
  const docMap = from === undefined ? createDocMap(doc) : getDocMap(doc);
  if (docMap === null) throw new Error("fixture: no root");
  const flow = flowOf(docMap);
  const piece = flow?.get(0);
  const rootId = typeId(docMap);
  if (flow === null || !(piece instanceof Y.Text) || rootId === null) throw new Error("fixture: bad root");
  return { doc, docMap, flow, piece, rootId };
}

/** The item id of an embedded map (a ¶, object, …). */
export function idOf(m: Y.Map<unknown>): string {
  const id = typeId(m);
  if (id === null) throw new Error("idOf: detached map");
  return id;
}

/** The ¶ map at storage index `i` of `piece`. */
export function mapAt(piece: Y.Text, i: number): Y.Map<unknown> {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (n === i && it.content instanceof Y.ContentType && it.content.type instanceof Y.Map) return it.content.type;
    n += it.length;
  }
  throw new Error(`mapAt: no map at ${i}`);
}

/** Children of a container in order. */
export function childrenOf(d: Document, tree: TreeKind, id: string): Block[] {
  const out: Block[] = [];
  for (let c = d.trees[tree].get(id)?.firstChildId ?? null; c !== null; ) {
    const b = d.trees[tree].get(c);
    if (b === undefined) break;
    out.push(b);
    c = b.nextSiblingId;
  }
  return out;
}

/** A block's plain text (embeds as U+FFFC). */
export function textOf(b: Block | undefined): string {
  return (b?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "￼")).join("");
}
