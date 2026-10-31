import type { EditorSnapshot } from "../../editor";

/** True when `key` is a registered NON-exclusive mark type (instances overlap). */
export function isNonExclusive({ config }: EditorSnapshot, key: string): boolean {
  return config.attrRegistry.get(key)?.mark?.exclusive === false;
}
