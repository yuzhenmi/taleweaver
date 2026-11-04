import * as Y from "yjs";
import { createDocMap } from "../storage/doc-map";
import { PIECE_SOFT_MAX } from "../storage/limits";
import { flowOf } from "../storage/map-reads";
import { newParagraphMark } from "../storage/new-items";
import { pieceStructCount } from "../storage/pieces";
import { newCellMark, newRowMark, newTableEnd, newTableStart } from "../storage/table-marks";

/**
 * A bench document holding one `rows × cols` table (each cell `text` + ¶) and a ¶ after
 * it (the flow's own final ¶), its marks spread over pieces filled to PIECE_SOFT_MAX (as commands write them).
 */
export function buildTable(rows: number, cols: number, text = ""): Y.Doc {
  const doc = new Y.Doc();
  const flow = flowOf(createDocMap(doc));
  if (flow === null) throw new Error("bench: bad root");
  // The table's pieces go before the flow's own piece (its final ¶ stays last).
  let piece = new Y.Text();
  let idx = 0;
  const room = (n: number): void => {
    if (pieceStructCount(piece) + n <= PIECE_SOFT_MAX) return;
    piece = new Y.Text();
    flow.insert(flow.length - 1, [piece]);
    idx = 0;
  };
  const put = (m: Y.Map<unknown>): void => {
    piece.insertEmbed(idx++, m);
  };
  doc.transact(() => {
    flow.insert(0, [piece]);
    put(newTableStart(0, Array.from({ length: cols }, () => 1)));
    for (let r = 0; r < rows; r++) {
      room(1 + cols * 3);
      put(newRowMark(0));
      for (let c = 0; c < cols; c++) {
        put(newCellMark(0));
        if (text !== "") {
          piece.insert(idx, text);
          idx += text.length;
        }
        put(newParagraphMark());
      }
    }
    put(newTableEnd(0));
  });
  return doc;
}
