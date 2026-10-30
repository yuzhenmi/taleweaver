import type { EditorConfig } from "../../editor-config";

/** True when `key` is a registered NON-exclusive mark type (instances overlap). */
export function isNonExclusive(key: string, config: EditorConfig): boolean {
  return config.attrRegistry.get(key)?.mark?.exclusive === false;
}
