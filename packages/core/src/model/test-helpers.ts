/** Test-only helpers for the schema-4 model: raw-Yjs document setup and version comparison. */
import * as Y from "yjs";
import { expect } from "vitest";
import type { Block } from "./block";
import type { Document, TreeKind } from "./derive";
import { PIECE_SOFT_MAX, createDocMap, flowOf, newFootnote, newParagraphMark, newSectionBreak, pieceStructCount, typeId } from "./storage";

export interface Fixture {
  readonly doc: Y.Doc;
  readonly docMap: Y.Map<unknown>;
  readonly flow: Y.Array<Y.Text>;
  /** The body flow's first piece (initially holding the one ¶). */
  readonly piece: Y.Text;
  readonly rootId: string;
}

export function fixture(clientID = 1): Fixture {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const docMap = createDocMap(doc);
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

/** Each flow's internal state, comparable across versions / peers (pieces by item id). */
function flowStates(d: Document): unknown[] {
  return [...d.flows.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, fs]) => ({
      id,
      tree: fs.tree,
      isRoot: fs.isRoot,
      synthetic: fs.synthetic,
      sections: fs.sections.map((s) => s.id),
      segments: fs.segments.map((s) => ({
        piece: typeId(s.piece),
        start: s.start,
        len: s.len,
        tokens: s.tokens.map((t) => (t.k === "run" ? `run:${t.len}` : `${t.k}:${t.id}:${t.len}`)),
      })),
    }));
}

function sortedEntries(d: Document, tree: TreeKind): [string, Block][] {
  return [...d.trees[tree].entries()].map(([k, v]): [string, Block] => [k, v]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Two versions read the same: every tree's records, the flows and the list defs. */
export function expectSameVersion(actual: Document, expected: Document): void {
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    expect(sortedEntries(actual, tree)).toEqual(sortedEntries(expected, tree));
  }
  expect(flowStates(actual)).toEqual(flowStates(expected));
  expect([...actual.listDefs]).toEqual([...expected.listDefs]);
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

const PARAS_PER_PAGE = 45;
const TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor in";

/**
 * A bench document of `pages` pages (45 paragraphs of 80 chars each; every 25th a
 * heading, every 10th with a bold run, every 100th with a footnote), pieces filled to
 * PIECE_SOFT_MAX; with `sectionEveryPage`, an `[S]` ends every page. Returns the middle piece and an offset in its middle.
 */
export function buildPages(pages: number, sectionEveryPage = false): { doc: Y.Doc; piece: Y.Text; at: number } {
  const doc = new Y.Doc();
  const docMap = createDocMap(doc);
  const flow = flowOf(docMap);
  const first = flow?.get(0);
  if (flow === null || !(first instanceof Y.Text)) throw new Error("bench: bad root");
  const n = pages * PARAS_PER_PAGE;
  let piece = first;
  let idx = 0;
  doc.transact(() => {
    for (let i = 0; i < n; i++) {
      if (pieceStructCount(piece) + 6 > PIECE_SOFT_MAX) {
        const fresh = new Y.Text();
        flow.push([fresh]);
        piece = fresh;
        idx = 0;
      }
      if (i % 10 === 0) {
        piece.insert(idx, TEXT.slice(0, 40));
        piece.insert(idx + 40, TEXT.slice(40), { bold: true });
      } else piece.insert(idx, TEXT);
      idx += TEXT.length;
      if (i % 100 === 0) piece.insertEmbed(idx++, newFootnote());
      piece.insertEmbed(idx++, newParagraphMark(i % 25 === 0 ? { "p:type": "heading", "p:level": 2 } : {}));
      if (sectionEveryPage && i % PARAS_PER_PAGE === PARAS_PER_PAGE - 1) piece.insertEmbed(idx++, newSectionBreak({ "s:columnCount": 1 }));
    }
  });
  // Type into the middle piece's middle.
  const mid = flow.get(Math.floor(flow.length / 2));
  if (!(mid instanceof Y.Text)) throw new Error("bench: no mid piece");
  return { doc, piece: mid, at: Math.floor(mid.length / 2) };
}

