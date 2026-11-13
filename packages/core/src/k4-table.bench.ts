/**
 * K4 (P2 plan, kill signal): the encoded size of a 50-column table (empty cells) in the
 * schema-4 continuous-text storage ≤ 1.25 × schema 3's for the same table. Measured at
 * 20 rows: schema 3's createTable is quadratic (20 rows ≈ 5 s), and the ratio is per row
 * (0.21 at 5 rows, 0.20 at 20; the 50 × 10³ absolute size is `model/table.bench.ts`). Run with
 * `npx vitest bench --run src/k4-table.bench.ts` in packages/core; it FAILS over budget.
 * It lives outside model/ so `core-model-independent-of-state` holds.
 * ponytail: deleted at the P8 cut-over, with schema 3.
 */
import { afterAll, bench, describe, expect } from "vitest";
import * as Y from "yjs";
import { buildTable } from "./model/test-helpers/build-table";
import { createTestAllocator } from "./state/block-id";
import type { BlockId } from "./state/block-id";
import { createPosition } from "./state/block-position";
import { DOCUMENT_INTERNAL } from "./state/document-internal";
import { createTable } from "./state/ops/create-table";
import { buildBlock, buildDocument, inlineContent } from "./test-utils/document-builders";

declare const console: { log(...args: unknown[]): void };

const ROWS = 20;
const COLS = 50;

function schema3Size(): number {
  const doc = buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
    ],
  });
  const { document } = createTable(doc, createPosition("p" as BlockId, 0), ROWS, COLS, createTestAllocator("t"));
  return Y.encodeStateAsUpdate(document[DOCUMENT_INTERNAL].doc).length;
}

let s3 = Number.NaN;
let s4 = Number.NaN;

describe("K4 encoded size", () => {
  bench(
    "50 × 20 table, schema 3 vs schema 4",
    () => {
      s3 = schema3Size();
      s4 = Y.encodeStateAsUpdate(buildTable(ROWS, COLS)).length;
    },
    { iterations: 1, warmupIterations: 0, warmupTime: 0, time: 0 },
  );
});

afterAll(() => {
  console.log(`K4: schema 3 ${(s3 / 1e6).toFixed(2)} MB, schema 4 ${(s4 / 1e6).toFixed(2)} MB, ratio ${(s4 / s3).toFixed(2)}`);
  if (!Number.isNaN(s4 / s3)) expect(s4 / s3).toBeLessThanOrEqual(1.25); // NaN = nothing recorded (filtered out)
});
