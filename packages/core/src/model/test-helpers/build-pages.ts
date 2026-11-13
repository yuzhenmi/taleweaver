import * as Y from "yjs";
import { createDocMap } from "../storage/doc-map";
import { PIECE_SOFT_MAX } from "../storage/limits";
import { flowOf } from "../storage/map-reads";
import { newFootnote, newParagraphMark, newSectionBreak } from "../storage/new-items";
import { pieceStructCount } from "../storage/pieces";

export const PARAS_PER_PAGE = 45;
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
