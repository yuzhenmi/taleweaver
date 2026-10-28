/**
 * A ¶'s character props (`markAttrs`, Word's ¶ rPr): the INCLUSIVE
 * formatting keys of a run, never change-tracking provenance (insertion / deletion /
 * formatting-suggestion ids). Which keys are inclusive is the attr registry's call
 * (`AttrRegistry.isInclusive`, read from the registry bound to the doc), so no
 * non-inclusive mark (a link) or provenance key ever reaches `markAttrs`.
 */
import type * as Y from "yjs";
import type { ReadonlyAttrs } from "./attrs";
import type { AttrRegistry } from "../cascade/attr-registry";
import { INSERTION_SUGGESTION_ATTR, DELETION_SUGGESTION_ATTR, isFormattingSuggestionKey } from "./suggestions";

/** Decides whether a formatting key is inclusive (typing at its edge extends it). */
export type InclusiveKey = (key: string) => boolean;

/** The `markAttrs` a ¶ ending a run with `attrs` takes. */
export function markAttrsOfRun(attrs: ReadonlyAttrs | ReadonlyMap<string, unknown>, isInclusive: InclusiveKey): ReadonlyAttrs {
  const out: Record<string, unknown> = {};
  const entries = attrs instanceof Map ? [...attrs.entries()] : Object.entries(attrs);
  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue;
    if (k === INSERTION_SUGGESTION_ATTR || k === DELETION_SUGGESTION_ATTR || isFormattingSuggestionKey(k)) continue;
    if (!isInclusive(k)) continue;
    out[k] = v;
  }
  return Object.freeze(out);
}

const BOUND = new WeakMap<Y.Doc, AttrRegistry>();

/**
 * Bind the host attr registry to `doc` (the editor does, when it adopts a State; a host
 * that upgrades a document before any editor adopts it binds it first). Every state
 * writer that judges an attr — a ¶'s inclusive `markAttrs`, a split's one-shot attrs,
 * the upgrade's derived ¶ props — reads it here; none takes it as a parameter.
 */
export function bindAttrRegistry(doc: Y.Doc, registry: AttrRegistry): void {
  BOUND.set(doc, registry);
}

/** The registry bound to `doc`, or undefined (none: built-in one-shot attrs only). */
export function attrRegistryOf(doc: Y.Doc): AttrRegistry | undefined {
  return BOUND.get(doc);
}

/** The registry bound to `doc`. Throws when none is (an editor binds its own on adoption). */
export function requireAttrRegistry(doc: Y.Doc): AttrRegistry {
  const registry = BOUND.get(doc);
  if (registry === undefined) throw new Error("attrs: no AttrRegistry bound to this document (adopt its State in an editor, or call bindAttrRegistry)");
  return registry;
}

/** The bound registry's inclusiveness, or undefined (no host registry: write no `markAttrs`). */
export function inclusiveKeysOf(doc: Y.Doc): InclusiveKey | undefined {
  const registry = BOUND.get(doc);
  return registry === undefined ? undefined : (k) => registry.isInclusive(k);
}
