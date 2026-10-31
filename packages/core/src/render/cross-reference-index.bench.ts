/**
 * Per-keystroke cost of the cross-reference index
 * (`npx vitest bench --run src/render/cross-reference-index.bench.ts`), production
 * mode: a keystroke inside a bookmark target (insertText + the index update the
 * incremental render runs) must stay flat as the document grows 1e2 → 1e4
 * paragraphs, with a bookmark (and a field referencing it) every 10 paragraphs.
 */
import { bench, describe } from "vitest";
import { buildDocument, buildBlock, inlineContent, text, embed } from "../test-utils/document-builders";
import { insertText } from "../state/ops/insert-text";
import { createPosition } from "../state/block-position";
import { BOOKMARK_START_EMBED_TYPE, BOOKMARK_END_EMBED_TYPE } from "../state/bookmarks";
import { CROSS_REFERENCE_EMBED_TYPE } from "../state/ops/insert-cross-reference";
import type { Document } from "../state/document";
import type { BlockId } from "../state/block-id";
import { buildCrossReferenceIndex, updateCrossReferenceIndex } from "./collect-cross-references";

const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
if (proc?.env !== undefined) proc.env.NODE_ENV = "production";

/** doc > [ p0 … p{n-1} ]: every 10th paragraph is a bookmarked heading, the next one references it. */
function documentOf(n: number): Document {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: ids[n - 1] ?? "p0" }),
      ...ids.map((id, i) =>
        buildBlock({
          id,
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: i > 0 ? ids[i - 1] : undefined,
          nextSiblingId: i < n - 1 ? ids[i + 1] : undefined,
          inlineContent: inlineContent(
            i % 10 === 0
              ? [embed(BOOKMARK_START_EMBED_TYPE, { bookmarkId: `b${i}` }), text("Heading text"), embed(BOOKMARK_END_EMBED_TYPE, { bookmarkId: `b${i}` })]
              : i % 10 === 1
                ? [text("see "), embed(CROSS_REFERENCE_EMBED_TYPE, { bookmarkId: `b${i - 1}`, refMode: "text" })]
                : [text("paragraph text of moderate length")],
          ),
        }),
      ),
    ],
  });
}

describe("keystroke inside a bookmark target vs document size", () => {
  for (const n of [100, 1000, 10000]) {
    let document = documentOf(n);
    let index = buildCrossReferenceIndex(document);
    const target = `p${Math.floor(n / 20) * 10}` as BlockId; // a bookmarked heading mid-document
    let offset = 3;
    const none = new Set<BlockId>();
    bench(
      `${n} paragraphs`,
      () => {
        const r = insertText(document, createPosition(target, offset++), "x", {});
        index = updateCrossReferenceIndex(index, document, r.document, r.dirtyIds, none).index;
        document = r.document;
      },
      { iterations: 500 },
    );
  }
});
