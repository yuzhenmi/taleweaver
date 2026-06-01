/**
 * Shared catalog of the fields stored on a block's inner Y.Map, used by
 * both the write path (`buildYBlock`) and the read path
 * (`buildBlockSnapshot`). This is the single source of truth for the
 * block schema; both paths iterate `BLOCK_FIELDS` and dispatch on
 * `spec.kind`, so a new field cannot be added to one path without the
 * other (the type-level coverage check below makes this a compile error).
 *
 * **Why a runtime list, not just a type.** TypeScript interface keys are
 * erased at runtime; `Object.keys(block)` only sees actual instance
 * properties on a value. The write path needs to iterate fields BEFORE
 * any block instance exists (it's constructing one). A runtime catalog
 * paired with a compile-time coverage check gives us both: the catalog
 * drives iteration; the check enforces completeness.
 *
 * **The `satisfies + const declaration` trick.** Annotating
 * `BLOCK_FIELDS: ReadonlyArray<BlockFieldSpec>` would widen the per-
 * element `K` parameter to `keyof Block`, losing the literal key union
 * and turning `DeclaredKeys` into `keyof Block` — at which point
 * `MissingKeys` is always `never` and the coverage check passes
 * trivially. Using `as const satisfies ...` preserves the literal types
 * while still type-checking the array. The check itself is forced to
 * evaluate by assigning `true` to a value of type
 * `MissingKeys extends never ? true : never`; if a `Block` field is
 * added without updating this catalog, `true` is not assignable to
 * `never` and the build fails at the variable declaration.
 *
 * `id` is intentionally absent: the block id is the outer
 * `blocks: Y.Map<Y.Map>` key, not a field on the inner map.
 */
import type { Block } from "./block";

type FieldKind = "string" | "id-nullable" | "attrs-map" | "inline-content-array-nullable";

export interface BlockFieldSpec<K extends keyof Block = keyof Block> {
  readonly key: K;
  readonly kind: FieldKind;
}

// CRITICAL: NO type annotation on the const — `as const satisfies` preserves
// the literal key union for the DeclaredKeys inference below.
export const BLOCK_FIELDS = [
  { key: "type",          kind: "string" },
  { key: "attrs",         kind: "attrs-map" },
  { key: "parentId",      kind: "id-nullable" },
  { key: "prevSiblingId", kind: "id-nullable" },
  { key: "nextSiblingId", kind: "id-nullable" },
  { key: "firstChildId",  kind: "id-nullable" },
  { key: "lastChildId",   kind: "id-nullable" },
  { key: "inlineContent", kind: "inline-content-array-nullable" },
  // NOTE: `id` is NOT here — it's the outer Y.Map key.
] as const satisfies ReadonlyArray<BlockFieldSpec>;

// Compile-time coverage check: every field on `Block` (except `id`) must
// appear in BLOCK_FIELDS.
type DeclaredKeys = (typeof BLOCK_FIELDS)[number]["key"];
type RequiredKeys = Exclude<keyof Block, "id">;
type MissingKeys = Exclude<RequiredKeys, DeclaredKeys>;

// Force compile-time evaluation via a variable declaration. If MissingKeys
// is non-empty (a Block field was added without updating BLOCK_FIELDS),
// `true` is not assignable to `never` and the build fails here.
const _BLOCK_FIELDS_COMPLETE: MissingKeys extends never ? true : never = true;
void _BLOCK_FIELDS_COMPLETE; // suppress noUnusedLocals
