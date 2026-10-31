/**
 * Structural-storage costs (`npx vitest bench --run src/state/structural.bench.ts`),
 * production mode. Each must stay flat from 1e2 to 1e4 paragraphs:
 *   - keystroke, Enter, one REMOTE transaction (a peer's keystroke) with dirty
 *     derivation;
 *   - keystroke, Enter, Backspace-merge and a remote keystroke in the final and in a
 *     middle section of a 2e4-paragraph document split into four sections;
 *   - keystroke + suggesting Enter + a selection change's boundary-mark reads with 1e3
 *     pending break-suggestion tags in a 1e4-paragraph document;
 *   - a keystroke after a 1000-paragraph mid-paragraph paste, after splitting a
 *     100k-character paragraph, and after deleting 1e4 paragraphs between two blocks
 *     (the first keystroke after the delete crosses the tombstones once).
 */
import { bench, describe } from "vitest";
import * as Y from "yjs";
import { TEST_RESOLVER, buildDocument, buildBlock, inlineContent, text } from "../test-utils/document-builders";
import { createDocument, getBlock, type Document } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { insertText } from "./ops/insert-text";
import { splitBlockAtPosition } from "./ops/split-block";
import { insertBlocksAfter } from "./ops/insert-blocks-after";
import { deleteRange } from "./ops/delete-range";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { subscribeForeignChanges } from "./collab";
import { markParagraphMarkDeletion } from "./ops/merge-blocks";
import { splitWithSuggestion } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { applySectionBreak } from "./ops/section-break";
import type { SuggestionId } from "./suggestions";
import { endMarkOf } from "./break-suggestions";
import { comparePositions, spanStart, spanEnd } from "./block-compare";
import { moveByCharacter } from "../cursor/cursor-ops";

const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
if (proc?.env !== undefined) proc.env.NODE_ENV = "production";

const id = (s: string) => s as BlockId;

function documentOf(n: number, para = "paragraph text of moderate length"): Document {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: ids[ids.length - 1] ?? "p0" }),
      ...ids.map((pid, i) =>
        buildBlock({
          id: pid,
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: i > 0 ? ids[i - 1] : undefined,
          nextSiblingId: i < ids.length - 1 ? ids[i + 1] : undefined,
          inlineContent: inlineContent([text(para)]),
        }),
      ),
    ],
  });
}

/** Typing into block `target` (read back each time, like the editor's render). */
function typing(document0: Document, target: BlockId, offset0: number): () => void {
  let document = document0;
  let offset = offset0;
  return () => {
    document = insertText(document, createPosition(target, offset), "x", {}).document;
    offset++;
    getBlock(document, target);
  };
}

describe("keystroke vs document size", () => {
  for (const n of [100, 1000, 10000]) {
    const mid = id(`p${Math.floor(n / 2)}`);
    bench(`${n} paragraphs`, typing(documentOf(n), mid, 5), { iterations: 500 });
  }
});

describe("Enter vs document size", () => {
  for (const n of [100, 1000, 10000]) {
    let document = documentOf(n);
    let cur = id(`p${Math.floor(n / 2)}`);
    const alloc = createTestAllocator("e");
    bench(
      `${n} paragraphs`,
      () => {
        // Enter at the end of the current paragraph (typical typing flow): the new ¶ ends
        // the head, the caret continues in the (empty) tail, which keeps `cur`'s id.
        const len = (getBlock(document, cur)?.inlineContent?.items ?? []).reduce((k, it) => k + (it.kind === "text" ? it.text.length : 1), 0);
        const r = splitBlockAtPosition(document, createPosition(cur, len), alloc);
        document = r.document;
        getBlock(document, r.newBlockId);
        getBlock(document, cur);
      },
      { iterations: 300 },
    );
  }
});

describe("remote transaction (peer keystroke) vs document size", () => {
  for (const n of [100, 1000, 10000]) {
    const base = documentOf(n);
    const localDoc = new Y.Doc();
    Y.applyUpdate(localDoc, Y.encodeStateAsUpdate(base[DOCUMENT_INTERNAL].doc));
    const local = createDocument({ rootId: base.rootId, doc: localDoc, resolver: TEST_RESOLVER });
    let dirty = 0;
    subscribeForeignChanges(local, "self", (ids) => {
      dirty += ids.size;
    }, () => {});
    // The peer's incremental updates (what a provider ships), applied to `local`.
    let pending: Uint8Array | null = null;
    base[DOCUMENT_INTERNAL].doc.on("update", (u: Uint8Array) => {
      pending = u;
    });
    let remote = base;
    let offset = 5;
    const mid = id(`p${Math.floor(n / 2)}`);
    bench(
      `${n} paragraphs`,
      () => {
        remote = insertText(remote, createPosition(mid, offset++), "x", {}).document;
        if (pending !== null) Y.applyUpdate(localDoc, pending, "peer");
        pending = null;
      },
      { iterations: 300, teardown: () => void dirty },
    );
  }
});

describe("2e4 paragraphs in four sections", () => {
  let document = documentOf(20000);
  for (const at of [5000, 10000, 15000]) document = applySectionBreak(document, createPosition(id(`p${at}`), 0), createTestAllocator(`s${at}`)).document;
  const remoteDoc = new Y.Doc();
  Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(document[DOCUMENT_INTERNAL].doc));
  const peer = createDocument({ rootId: document.rootId, doc: remoteDoc, resolver: TEST_RESOLVER });
  subscribeForeignChanges(peer, "self", () => {}, () => {});
  // Keystrokes / merges at `target`; Enters at the end of `enterAt` (whose id stays on the empty tail).
  for (const [where, target, enterAt] of [["final", id("p19998"), id("p19999")], ["middle", id("p12000"), id("p12001")]] as const) {
    let offset = 5;
    bench(`${where} section: keystroke`, () => {
      document = insertText(document, createPosition(target, offset++), "x", {}).document;
      getBlock(document, target);
    }, { iterations: 300 });
    // The peer catches up once (setup), then applies each keystroke's own update (what a provider ships).
    let pending: Uint8Array | null = null;
    const doc = document[DOCUMENT_INTERNAL].doc;
    doc.on("update", (u: Uint8Array) => {
      pending = u;
    });
    bench(`${where} section: remote keystroke`, () => {
      document = insertText(document, createPosition(target, offset++), "x", {}).document;
      if (pending !== null) Y.applyUpdate(remoteDoc, pending, "peer");
      pending = null;
    }, { iterations: 300, setup: () => Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(remoteDoc)), "peer") });
    const alloc = createTestAllocator(`e${where}`);
    bench(`${where} section: Enter`, () => {
      const len = (getBlock(document, enterAt)?.inlineContent?.items ?? []).reduce((k, it) => k + (it.kind === "text" ? it.text.length : 1), 0);
      const r = splitBlockAtPosition(document, createPosition(enterAt, len), alloc);
      document = r.document;
      getBlock(document, enterAt);
      getBlock(document, r.newBlockId);
    }, { iterations: 300 });
    // Over 200 neighbouring paragraphs: repeating it at ONE spot piles tombstones there,
    // which every dirty derivation at that spot crosses (a cost of its own, unsectioned too).
    const base = Number(target.slice(1));
    let k = 0;
    bench(`${where} section: Enter + Backspace-merge`, () => {
      const at = id(`p${base - (k++ % 200)}`);
      const r = splitBlockAtPosition(document, createPosition(at, 3), alloc);
      document = mergeAdjacentBlocks(r.document, r.newBlockId, at).document;
      getBlock(document, at);
    }, { iterations: 300 });
  }
});

describe("keystroke after a 1000-paragraph mid-paragraph paste", () => {
  for (const n of [100, 10000]) {
    let document = documentOf(n);
    const mid = id(`p${Math.floor(n / 2)}`);
    const split = splitBlockAtPosition(document, createPosition(mid, 5), createTestAllocator("s"));
    document = insertBlocksAfter(
      split.document,
      mid,
      Array.from({ length: 1000 }, () => ({ type: "paragraph", inlineContent: inlineContent([text("pasted line")]) })),
      createTestAllocator("q"),
    ).document;
    bench(`${n} paragraphs`, typing(document, split.newBlockId, 0), { iterations: 500 });
  }
});

describe("keystroke after splitting a 100k-character paragraph", () => {
  for (const n of [100, 10000]) {
    const big = documentOf(n, "y".repeat(100_000));
    const mid = id(`p${Math.floor(n / 2)}`);
    const r = splitBlockAtPosition(big, createPosition(mid, 50_000), createTestAllocator("b"));
    bench(`${n} paragraphs`, typing(r.document, r.newBlockId, 10), { iterations: 300 });
  }
});

describe("keystroke after deleting 1e4 paragraphs between two blocks", () => {
  const n = 10002;
  const s = documentOf(n);
  const del = deleteRange(s, createSpan(createPosition(id("p0"), 3), createPosition(id(`p${n - 1}`), 3)));
  // The survivor of the cross-paragraph delete is the last paragraph (its ¶ ends the joined content).
  bench("first + later keystrokes at the seam", typing(del.document, id(`p${n - 1}`), 3), { iterations: 300 });
});

describe("1e3 deletion-keyed ¶s in a 1e4-paragraph document", () => {
  let keyed = documentOf(10000);
  for (let i = 1; i < 10000; i += 10) {
    keyed = markParagraphMarkDeletion(keyed, id(`p${i - 1}`), { id: `j${i}` as SuggestionId, author: "a", createdAt: 0 }).document;
  }
  bench("keystroke", typing(keyed, id("p5001"), 5), { iterations: 500 });
  // A selection change reads only the selected blocks' derived marks (O(selected
  // blocks)): 1-block and 20-block selections walk the same handful of neighbours
  // wherever they sit in the document.
  let at = 0;
  bench(
    "selection change: end marks + selection coverage of 20 selected blocks",
    () => {
      const start = 100 + (at++ % 9000);
      const span = createSpan(createPosition(id(`p${start}`), 3), createPosition(id(`p${start + 19}`), 3));
      for (let i = start; i < start + 20; i++) {
        const m = endMarkOf(keyed, id(`p${i}`));
        if (m !== null) void (comparePositions(keyed, spanStart(keyed, span), createPosition(id(`p${i}`), 33)) <= 0 && comparePositions(keyed, spanEnd(keyed, span), createPosition(id(`p${i + 1}`), 0)) >= 0);
      }
    },
    { iterations: 500 },
  );
  let document = keyed;
  let cur = id("p7001");
  const alloc = createTestAllocator("t");
  let k = 0;
  bench(
    "suggesting Enter",
    () => {
      const len = (getBlock(document, cur)?.inlineContent?.items ?? []).reduce((n, it) => n + (it.kind === "text" ? it.text.length : 1), 0);
      const r = splitWithSuggestion(document, createPosition(cur, len), alloc, { id: `s${k++}` as SuggestionId, author: "a", createdAt: 0 });
      document = r.document;
      cur = r.newBlockId;
      getBlock(document, cur);
    },
    { iterations: 300 },
  );
  // A caret move across a deletion-keyed ¶ (end of p_i → start of p_{i+1}) and back,
  // reading that ¶'s end mark: O(1) wherever it sits in the document.
  let mv = 0;
  bench(
    "caret move across a deletion-keyed ¶ (+ its end mark)",
    () => {
      const i = 10 * (1 + (mv++ % 900));
      const from = createPosition(id(`p${i}`), (getBlock(keyed, id(`p${i}`))?.inlineContent?.items ?? []).reduce((n, it) => n + (it.kind === "text" ? it.text.length : 1), 0));
      const fwd = moveByCharacter(keyed, from, "forward");
      moveByCharacter(keyed, fwd, "backward");
      endMarkOf(keyed, id(`p${i}`));
    },
    { iterations: 500 },
  );
});
