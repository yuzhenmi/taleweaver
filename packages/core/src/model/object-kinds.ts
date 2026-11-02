/**
 * Registered object kinds, as far as the READ needs them: each kind's required
 * props (with their scalar type) and defaults. Rendering is an extension point
 * outside this module.
 *
 * Read rule (R-obj): an object whose kind is not registered, or whose required
 * props are missing / mistyped, reads as an atomic PLACEHOLDER of its stored size.
 * Its stored data is never touched (valid by definition, nothing rewritten).
 */
import type { Scalar } from "./storage/scalar";

export type PropType = "string" | "number" | "boolean";

export interface ObjectKindDef {
  readonly required?: Readonly<Record<string, PropType>>;
  /** Optional props: a missing or mistyped value reads as the default (or is absent without one). */
  readonly optional?: Readonly<Record<string, PropType>>;
  readonly defaults?: Readonly<Record<string, Scalar>>;
}

export type ObjectKindRegistry = ReadonlyMap<string, ObjectKindDef>;

/** The built-in kinds. `image`: `src` required; `alt` optional, default "". */
export const BUILTIN_OBJECT_KINDS: ObjectKindRegistry = new Map<string, ObjectKindDef>([
  ["image", { required: { src: "string" }, optional: { alt: "string" }, defaults: { alt: "" } }],
]);

/** The built-ins plus `extra` (an extra kind replaces a built-in of the same name). */
export function objectKindRegistry(extra: Readonly<Record<string, ObjectKindDef>> = {}): ObjectKindRegistry {
  return new Map([...BUILTIN_OBJECT_KINDS, ...Object.entries(extra)]);
}

/** The kind's props with defaults applied, or null when the object must read as a placeholder. */
export function resolveObjectProps(
  registry: ObjectKindRegistry,
  kind: string,
  stored: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const def = registry.get(kind);
  if (def === undefined) return null;
  for (const [name, type] of Object.entries(def.required ?? {})) {
    if (typeof stored[name] !== type) return null;
  }
  const out: Record<string, unknown> = { ...stored };
  for (const [name, type] of Object.entries(def.optional ?? {})) {
    if (typeof out[name] === type) continue;
    const d = def.defaults?.[name];
    if (d === undefined) delete out[name];
    else out[name] = d;
  }
  for (const [name, d] of Object.entries(def.defaults ?? {})) if (!(name in out)) out[name] = d;
  return out;
}
