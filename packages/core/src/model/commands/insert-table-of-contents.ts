import type { Plan } from "../plan";
import type { Scalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { paste } from "./paste";

/**
 * C14: insert a table of contents (`options` → `a:*`) over the selection: a payload of
 * one block object, so paste's C14 placement — the range deleted first (C9); k > 0
 * splits and puts it before the tail; k = 0 puts it before the paragraph, after a ¶M
 * when the item before is a block object (W2). Caret: the tail's start.
 */
export function insertTableOfContents(ctx: CommandContext, options: Readonly<Record<string, Scalar>> = {}): Plan | null {
  const keys: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(options)) keys[`a:${k}`] = v;
  return paste(ctx, [{ k: "toc", keys }]);
}
