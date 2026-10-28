import type { ReadonlyAttrs } from "./attrs";
import type * as Y from "yjs";
import { attrRegistryOf } from "./mark-attrs";

/**
 * Block attrs that belong to ONE block instance and are never copied to the new
 * block of a split (`AttrInterpreter.inheritOnSplit === false`): a list counter
 * restart applies to the item it was set on, not to every item split from it.
 * The built-ins are listed here so state ops honour them without a registry; a
 * host registers its own with `inheritOnSplit: false` in the registry bound to the doc.
 */
const BUILTIN_ONE_SHOT = new Set(["listCounterOverride"]);

/** `attrs` without its one-shot keys (the same object when it has none). */
export function withoutOneShotAttrs(attrs: ReadonlyAttrs, doc: Y.Doc): ReadonlyAttrs {
  const registry = attrRegistryOf(doc);
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(attrs)) {
    if (!BUILTIN_ONE_SHOT.has(key) && registry?.get(key)?.inheritOnSplit !== false) continue;
    out ??= { ...attrs };
    delete out[key];
  }
  return out === null ? attrs : Object.freeze(out);
}
