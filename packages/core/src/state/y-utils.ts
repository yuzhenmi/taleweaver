import * as Y from "yjs";

/**
 * Assert that `value` and its nested children contain no live Yjs shared
 * types (Y.Map / Y.Array / Y.Text / etc., all subclasses of
 * `Y.AbstractType`). The state-tree contract restricts inline-item
 * `attrs` and `properties` to primitive JSON-serializable scalars (with
 * `contentBlockId` as the only mechanism for cross-block references).
 *
 * This is a defense in depth: nested Y types in attrs/properties would
 * leak as live shared-type references into "frozen" Block snapshots
 * (silently mutating post-snapshot) and, worse, would be copied across
 * Y.Docs on cross-doc paste — undefined CRDT behavior. We assert on both
 * the write path (`toYAttributes` / embed content in `y-inline.ts`) and the read path
 * (`inlineItemsFromYText`, `yMapAsObject`, snapshot's `yMapToObject`) so peer-replicated data is also caught.
 */
export function assertNoNestedYTypes(value: unknown, contextPath: string): void {
  if (value instanceof Y.AbstractType) {
    throw new Error(
      `${contextPath}: nested Y types are not allowed in inline-item properties / attrs. ` +
        `Use plain JSON-serializable values. To reference another block, use contentBlockId.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNestedYTypes(v, `${contextPath}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertNoNestedYTypes(v, `${contextPath}.${k}`);
    }
  }
}

/**
 * Snapshot a Y.Map's current entries as a plain object. Used by Layer 3
 * ops to read attrs/properties Y.Maps into the value-shape that builder
 * helpers expect.
 *
 * Asserts at the leaf-value level that no nested Y types are present —
 * see `assertNoNestedYTypes`. This catches bad data already present in a
 * Y.Doc (e.g. from a collab peer that bypassed our builders).
 */
export function yMapAsObject(yMap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    assertNoNestedYTypes(value, key);
    obj[key] = value;
  }
  return obj;
}
