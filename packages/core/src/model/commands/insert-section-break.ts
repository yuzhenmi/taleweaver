import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { newSectionBreak } from "../storage/new-items";
import { type Scalar, isWriteScalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { rangeOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { overSelection } from "./helpers/over-object";
import { canPlace } from "./helpers/placement";
import { sectionOwner } from "./helpers/section-owner";
import { splitWrites } from "./helpers/split-writes";
import { keysWrite } from "./helpers/writes";

// ---------------------------------------------------------------------------
// C15 section break
// ---------------------------------------------------------------------------

/**
 * C15: replace the selection (C9), then split the paragraph at k and put `[S]` after ¶N.
 * The `[S]` copies the section's `s:*` (the section that holds the range's end: the one
 * left after the deletion); its explicit `h:*` move to the new `[S]` so the tail section
 * inherits them ("Same as Previous", Word). Caret: the tail's start.
 */
export function insertSectionBreak(ctx: CommandContext): Plan | null {
  return overSelection(ctx, insertBreak);
}

function insertBreak(ctx: CommandContext): Plan | null {
  const r = rangeOf(ctx);
  if (r === null || !canPlace(ctx.version, "S", r.start)) return null;
  const owner = sectionOwner(ctx.version, r.end);
  if (owner === null) return null;
  const s: Record<string, Scalar> = {};
  const moved: Record<string, Scalar | undefined> = {};
  owner.forEach((v, k) => {
    if (!isWriteScalar(v)) return; // a peer's non-scalar / bigint / NaN is not copied
    if (k.startsWith("s:")) s[k] = v;
    else if (k.startsWith("h:")) {
      s[k] = v;
      moved[k] = undefined;
    }
  });
  const split = splitWrites(ctx, r, [{ embed: newSectionBreak(s), attrs: {} }]);
  if (split === null) return null;
  const writes = [...split.writes, ...keysWrite(owner, moved)];
  return plan(ctx.version, writes, () => caretAt(split.tail(), 0));
}
