import type { Plan } from "../plan";
import { caretAt } from "../position/model-position";
import { newSectionBreak } from "../storage/new-items";
import { type Scalar, isWriteScalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { atOf } from "./helpers/at";
import { plan } from "./helpers/build-plan";
import { inMainTree } from "./helpers/in-main-tree";
import { sectionOwner } from "./helpers/section-owner";
import { splitWrites } from "./helpers/split-writes";
import { keysWrite } from "./helpers/writes";

// ---------------------------------------------------------------------------
// C15 section break
// ---------------------------------------------------------------------------

/**
 * C15: split the focus paragraph at k and put `[S]` after ¶N. The `[S]` copies the
 * section's `s:*`; its explicit `h:*` move to the new `[S]` so the tail section
 * inherits them ("Same as Previous", Word). Caret: the tail's start.
 */
export function insertSectionBreak(ctx: CommandContext): Plan | null {
  const at = atOf(ctx, ctx.selection.focus);
  if (at === null || !inMainTree(at)) return null;
  const owner = sectionOwner(ctx.version, at);
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
  const split = splitWrites(ctx, { start: at, end: at, collapsed: true }, [{ embed: newSectionBreak(s), attrs: {} }]);
  if (split === null) return null;
  const writes = [...split.writes, ...keysWrite(owner, moved)];
  return plan(ctx.version, writes, () => caretAt(split.tail(), 0));
}
