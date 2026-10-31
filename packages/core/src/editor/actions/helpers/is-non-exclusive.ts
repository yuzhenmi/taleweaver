import type { EditorState } from "../../editor-state";

/** True when `key` is a registered NON-exclusive mark type (instances overlap). */
export function isNonExclusive({ config }: EditorState, key: string): boolean {
  return config.attrRegistry.get(key)?.mark?.exclusive === false;
}
