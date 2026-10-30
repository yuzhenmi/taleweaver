import type { Edit } from "../edit";
import {
  runWithTransactionOrigin,
  currentTransactionOrigin,
  UntrackedOrigin,
} from "../../state";
import type { EditorState } from "../editor-state";
import type { ActionOf } from "../editor-action";
import {
  applyProposal,
  chainOutcome,
  mapProposal,
  mappingSince,
  validateProposal,
  type ProposalOutcome,
  type Verdict,
} from "../proposals";

/**
 * The PROPOSE reducer arm — the AUTHORITATIVE check: map the edits from `basedOn` (the
 * version they were computed against) through the editor's change chain (stale when the
 * ranges changed or the version is unknown), validate, then apply every edit as a
 * suggestion (fresh, non-coalescing records, author = the proposal's), mapping each
 * later edit through the earlier ones, and tag all records with the group + metadata.
 * A proposal is another author's change, so it is NOT in the user's undo stack:
 * it runs under an {@link UntrackedOrigin} owned by the dispatching host's origin
 * (untracked; self to that host's own foreign-change subscription) and the History only advances its
 * cached state — Ctrl+Z keeps undoing the user's own last edit (accept / reject stay
 * undoable user actions). Inline storage never re-mints a character on an in-block
 * edit, and undo selections are CRDT-anchored, so the user's open entry survives.
 * A multi-paragraph replace is untracked too: its new paragraphs are splits (marks),
 * so no character is re-minted. The selection is rebased and stored typing attrs
 * kept. The verdict is `lastProposal`.
 */
export function handlePropose(
  editor: EditorState,
  { proposal: input, basedOn }: ActionOf<"PROPOSE">,
): Edit | null {
  const outcomeOf = (verdict: Verdict): ProposalOutcome => chainOutcome(editor.lastProposal, { ...verdict, proposal: input });
  const verdict = (v: Verdict): Edit => ({ proposal: outcomeOf(v) });
  let proposal = input;
  if (basedOn !== undefined && basedOn !== editor.state) {
    const mapping = mappingSince(editor, basedOn);
    const mapped = mapping === null ? null : mapProposal(input, mapping);
    if (mapped === null) return verdict({ groupId: input.groupId, outcome: "stale" });
    proposal = mapped;
  }
  const problem = validateProposal(editor.state, proposal);
  if (problem !== null) return verdict({ groupId: proposal.groupId, outcome: "rejected", problem });
  // Per-instance untracked origin: wraps the dispatching host's own (ambient) origin,
  // so no History tracks it but the host's own foreign-change subscription treats it
  // as self (a second host on the same doc still sees it as foreign).
  const origin = new UntrackedOrigin(currentTransactionOrigin());
  return runWithTransactionOrigin(origin, () => applyProposal(editor, proposal, outcomeOf));
}
