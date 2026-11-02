import * as Y from "yjs";
import { BLOCK_TYPES, type Block, type BlockId, EMBED_TYPES } from "../block";
import type { FlowState, SectionInfo, TreeKind } from "../document/types";
import { finalSectionId, flowEndId, footnoteBodyId, sectionIdOf } from "../ids";
import { flattenPiece } from "../scan/flatten-piece";
import type { FootnoteRef, ScanCtx, Segment } from "../scan/tokens";
import { flowOf } from "../storage/map-reads";
import { type BlockEntity, type Entity, type SectionBreakEntity, flatten, group, indexSegments } from "./entities";
import { EMPTY_ATTRS, containerRecord, entityRecord } from "./records";
import { writeSections } from "./sections";
import type { Working } from "./working";

// ---------------------------------------------------------------------------
// Flow derivation
// ---------------------------------------------------------------------------

export function piecesOf(arr: Y.Array<Y.Text> | null): Y.Text[] {
  if (arr === null) return [];
  const out: Y.Text[] = [];
  for (const p of arr.toArray()) if (p instanceof Y.Text) out.push(p);
  return out;
}


/** Split entities at `[S]`s: segments[i] ends at breaks[i]; the last segment ends the flow. */
export function segmentsOf(ents: readonly Entity[]): { segments: BlockEntity[][]; breaks: SectionBreakEntity[] } {
  const segments: BlockEntity[][] = [[]];
  const breaks: SectionBreakEntity[] = [];
  for (const e of ents) {
    if (e.k === "S") {
      breaks.push(e);
      segments.push([]);
    } else {
      const seg = segments[segments.length - 1];
      if (seg !== undefined) seg.push(e);
    }
  }
  return { segments, breaks };
}

/** Write a segment's records (siblings of one container), `prev` / `next` at its ends. */
export function writeSegment(w: Working, tree: TreeKind, seg: readonly BlockEntity[], parentId: BlockId, prev: BlockId | null, next: BlockId | null): void {
  for (let i = 0; i < seg.length; i++) {
    const e = seg[i];
    if (e === undefined) continue;
    w.put(
      tree,
      entityRecord(e, {
        parentId,
        prevSiblingId: i === 0 ? prev : (seg[i - 1]?.id ?? null),
        nextSiblingId: i === seg.length - 1 ? next : (seg[i + 1]?.id ?? null),
      }),
    );
  }
}

const isBlockEntity = (e: Entity): e is BlockEntity => e.k !== "S";

/** The scan context of a flow in `tree`: footnote anchors are read only in the main tree. */
export function scanCtxOf(w: Working, tree: TreeKind): ScanCtx {
  return { registry: w.registry, footnotes: tree === "block" };
}

/** Derive one flow from scratch (and, recursively, the footnote bodies its paragraphs anchor). */
export function deriveFlow(w: Working, holderId: BlockId, tree: TreeKind, array: Y.Array<Y.Text> | null, isRoot: boolean): void {
  const flowSegments: Segment[] = [];
  const ctx = scanCtxOf(w, tree);
  for (const p of piecesOf(array)) flattenPiece(p, ctx, flowSegments);
  let ents = group(flatten(flowSegments), true, holderId);
  if (!isRoot) ents = ents.filter(isBlockEntity);
  const synthetic = !ents.some(isBlockEntity);
  if (synthetic) ents.push({ k: "para", id: flowEndId(holderId), map: null, items: [], footnotes: [] });
  const { segments, breaks } = segmentsOf(ents);
  const sections: SectionInfo[] = isRoot
    ? [...breaks.map((b) => ({ id: sectionIdOf(b.id), map: b.map })), { id: finalSectionId(w.rootId), map: w.docMap }]
    : [];
  if (isRoot) {
    segments.forEach((seg, i) => {
      const sec = sections[i];
      if (sec === undefined) return;
      writeSegment(w, tree, seg, sec.id, null, null);
      w.put(tree, containerRecord(sec.id, BLOCK_TYPES.section, EMPTY_ATTRS, { parentId: holderId, prevSiblingId: null, nextSiblingId: null }, seg[0]?.id ?? null, seg[seg.length - 1]?.id ?? null));
    });
  } else {
    const seg = segments[0] ?? [];
    writeSegment(w, tree, seg, holderId, null, null);
    const type = tree === "templateContent" ? BLOCK_TYPES.templateBody : BLOCK_TYPES.footnoteBody;
    w.put(tree, containerRecord(holderId, type, EMPTY_ATTRS, { parentId: null, prevSiblingId: null, nextSiblingId: null }, seg[0]?.id ?? null, seg[seg.length - 1]?.id ?? null));
  }
  w.flows = w.flows.set(holderId, { holderId, tree, isRoot, array, segments: flowSegments, segIndex: indexSegments(flowSegments), sections, synthetic });
  w.fresh.add(holderId);
  if (isRoot) writeSections(w);
  for (const e of ents) if (e.k === "para") for (const f of e.footnotes) deriveFootnote(w, f);
}

export function deriveFootnote(w: Working, f: FootnoteRef): void {
  deriveFlow(w, footnoteBodyId(f.id), "embedContent", f.body === null ? null : flowOf(f.body), false);
}

/** The footnote body ids anchored by a block's inline content. */
export function footnoteBodiesOf(b: Block | undefined): BlockId[] {
  const out: BlockId[] = [];
  for (const item of b?.inlineContent?.items ?? []) {
    if (item.kind === "embed" && item.embedType === EMBED_TYPES.footnoteAnchor) {
      const id = item.properties["contentBlockId"];
      if (typeof id === "string") out.push(id);
    }
  }
  return out;
}

/** Every container of a flow: the sections + root, or the holder. */
function containersOf(fs: FlowState): BlockId[] {
  return fs.isRoot ? fs.sections.map((s) => s.id) : [fs.holderId];
}

/** Remove a flow's records (and, recursively, the footnote bodies it anchors). */
export function removeFlow(w: Working, holderId: BlockId): void {
  const fs = w.flows.get(holderId);
  if (fs === undefined) return;
  for (const c of containersOf(fs)) {
    let id = w.get(fs.tree, c)?.firstChildId ?? null;
    while (id !== null) {
      const b = w.get(fs.tree, id);
      if (b === undefined) break;
      for (const body of footnoteBodiesOf(b)) removeFlow(w, body);
      w.del(fs.tree, id);
      id = b.nextSiblingId;
    }
    w.del(fs.tree, c);
  }
  if (fs.isRoot) w.del(fs.tree, fs.holderId);
  w.flows = w.flows.delete(holderId);
}
