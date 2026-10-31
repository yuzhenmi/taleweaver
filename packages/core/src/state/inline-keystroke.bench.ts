/**
 * Per-keystroke cost of the one-`Y.Text`-per-block inline storage
 * (`npx vitest bench --run src/state/inline-keystroke.bench.ts`).
 *
 *   1. DOCUMENT size: a keystroke (History.beginEntry's CRDT-anchored selection +
 *      insertText + commit) into a fixed-size block must stay flat as the document
 *      grows 1e2 → 1e4 blocks (O(1) per keystroke regardless of document size).
 *   2. BLOCK size: the documented per-block bound — Yjs disables a Y.Text's search
 *      markers once it holds formatting, so a keystroke walks the edited block's
 *      items: cost grows with the edited block's item count (runs), independent of
 *      the document.
 *
 * Measured in PRODUCTION mode: the dev-mode invariant checks `applyOperation` runs
 * (chain integrity, orphaned embed bodies, …) are O(document) by design and are
 * compiled out of production (`isDevMode`).
 */
import { bench, describe } from "vitest";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { createHistory } from "./history";
import { insertText } from "./ops/insert-text";
import { createPosition, createSpan } from "./block-position";
import type { Document } from "./state";
import type { BlockId } from "./block-id";
import type { TextItem } from "./inline-content";

// Production mode for the measured code (see the module docstring). Same global
// probe `dev-mode.ts` reads.
const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
if (proc?.env !== undefined) proc.env.NODE_ENV = "production";

/** doc > [ p0 … p{n-1} ]; the edited block "p0" holds `runs` alternating-format runs. */
function documentOf(blocks: number, runs: number): Document {
  const edited: TextItem[] = Array.from({ length: runs }, (_, i) => text("word ", i % 2 === 0 ? { bold: true } : {}));
  const ids = Array.from({ length: blocks }, (_, i) => `p${i}`);
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: ids[ids.length - 1] ?? "p0" }),
      ...ids.map((id, i) =>
        buildBlock({
          id,
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: i > 0 ? ids[i - 1] : undefined,
          nextSiblingId: i < ids.length - 1 ? ids[i + 1] : undefined,
          inlineContent: inlineContent(i === 0 ? edited : [text("other paragraph text")]),
        }),
      ),
    ],
  });
}

/** One user keystroke at the middle of p0, as the editor records it. */
function keystrokeLoop(blocks: number, runs: number): () => void {
  let state = documentOf(blocks, runs);
  const history = createHistory(state);
  const p0 = "p0" as BlockId;
  let offset = Math.floor((runs * 5) / 2);
  let now = 0;
  return () => {
    const caret = createSpan(createPosition(p0, offset), createPosition(p0, offset));
    history.beginEntry("insert", (now += 1000), caret); // a fresh entry every keystroke
    const result = insertText(state, createPosition(p0, offset), "x", {});
    offset += 1;
    history.commit(result, { before: caret, after: createSpan(createPosition(p0, offset), createPosition(p0, offset)) });
    state = result.state;
  };
}

describe("keystroke vs DOCUMENT size (edited block fixed at 20 runs)", () => {
  for (const blocks of [100, 1000, 10000]) {
    bench(`${blocks} blocks`, keystrokeLoop(blocks, 20), { iterations: 500 });
  }
});

describe("keystroke vs edited BLOCK item count (document fixed at 100 blocks)", () => {
  for (const runs of [10, 100, 1000]) {
    bench(`${runs} runs in the edited block`, keystrokeLoop(100, runs), { iterations: 300 });
  }
});
