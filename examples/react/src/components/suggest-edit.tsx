import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPosition,
  getBlock,
  getSuggestionGroups,
  newSuggestionGroupId,
  type EditorAction,
  type EditorState,
  type Proposal,
  type ProposedEdit,
  type ProposeResult,
  type State,
  type SuggestionGroupStyle,
} from "@taleweaver/core";

/**
 * Generic "Suggest edit" demo for host proposals (shared by the print and digital tabs):
 * a simulated assistant reads the caret's paragraph, works for ~1 s while the user may
 * keep typing, then proposes ONE suggestion group (tidy double spaces + replace a word +
 * bold the opening words) with metadata { source, reason } against the version it read —
 * the editor maps it through the edits made meanwhile. A review panel lists the open
 * groups (Accept / Reject each); groups are styled per source by the controller's live
 * suggestion styling (`ASSISTANT_STYLE`), which follows accept / reject / undo.
 */
const SOURCE = "assistant";

/** Per-source styling of suggestion groups — stable, handed to the controller once. */
export const ASSISTANT_STYLE: SuggestionGroupStyle = (g) =>
  g.metadata?.source === SOURCE
    ? { class: "tw-demo-assistant-suggestion", style: { backgroundColor: "rgba(124, 58, 237, 0.10)" } }
    : null;
const WORD_SWAPS: Readonly<Record<string, string>> = {
  very: "truly",
  little: "small",
  big: "large",
  said: "replied",
  went: "headed",
  good: "fine",
};

export type Propose = (proposal: Proposal, options?: { readonly basedOn?: State }) => Promise<ProposeResult>;

/** The edits the simulated assistant proposes for the paragraph holding the caret. */
function draftEdits(editor: EditorState): ProposedEdit[] {
  const id = editor.selection.focus.blockId;
  const items = getBlock(editor.state, id)?.inlineContent?.items ?? [];
  const text = items.map((i) => (i.kind === "text" ? i.text : "￼")).join("");
  const edits: ProposedEdit[] = [];
  const taken: Array<[number, number]> = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  for (const m of text.matchAll(/ {2,}/g)) {
    edits.push({ kind: "replace", from: createPosition(id, m.index + 1), to: createPosition(id, m.index + m[0].length), text: "" });
    taken.push([m.index, m.index + m[0].length]);
  }
  const opening = /^\s*(\S+\s+\S+)/.exec(text);
  if (opening?.[1] !== undefined) {
    const start = text.indexOf(opening[1]);
    const end = start + opening[1].length;
    if (free(start, end)) {
      edits.push({ kind: "format", from: createPosition(id, start), to: createPosition(id, end), attrs: { bold: true } });
      taken.push([start, end]);
    }
  }
  for (const m of text.matchAll(/\b[A-Za-z]+\b/g)) {
    const swap = WORD_SWAPS[m[0].toLowerCase()];
    if (swap === undefined || !free(m.index, m.index + m[0].length)) continue;
    edits.push({
      kind: "replace",
      from: createPosition(id, m.index),
      to: createPosition(id, m.index + m[0].length),
      text: m[0][0] === m[0][0]?.toUpperCase() ? swap[0]?.toUpperCase() + swap.slice(1) : swap,
      metadata: { note: `"${m[0]}" → "${swap}"` },
    });
    break;
  }
  return edits;
}

export interface SuggestEdit {
  readonly status: string;
  readonly busy: boolean;
  readonly run: () => void;
}

export function useSuggestEdit(editorState: EditorState, propose: Propose): SuggestEdit {
  const [status, setStatus] = useState("Put the caret in a paragraph and ask for a suggested edit.");
  const [busy, setBusy] = useState(false);
  const latest = useRef(editorState);
  latest.current = editorState;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const run = useCallback(() => {
    const snapshot = latest.current;
    const edits = draftEdits(snapshot);
    if (edits.length === 0) {
      setStatus("Nothing to suggest in this paragraph.");
      return;
    }
    setBusy(true);
    setStatus("Thinking… (keep typing — the suggestion lands where the text moves to)");
    timers.current.push(
      window.setTimeout(() => {
        setBusy(false);
        void propose(
          {
            groupId: newSuggestionGroupId(),
            author: SOURCE,
            metadata: { source: SOURCE, reason: "Tidy spacing, a stronger word, emphasise the opening" },
            edits,
          },
          { basedOn: snapshot.state },
        ).then((result) => {
          // The editor's TRUE verdict (print: once the host has applied the dispatch).
          if (result.ok) setStatus("Suggested — review it in the panel.");
          else if (result.reason === "stale") setStatus("Discarded: the paragraph changed while the suggestion was being made.");
          else if (result.reason === "halted") setStatus("Not proposed: the editor is halted (the document needs an upgrade).");
          else setStatus(`Not proposed (${result.problem.kind === "invalid" ? result.problem.message : result.problem.kind}).`);
        });
      }, 1000),
    );
  }, [propose]);

  return { status, busy, run };
}

/** Button + status + a review panel of the open suggestion groups (shared by both tabs). */
export function SuggestEditBar({
  tool,
  editorState,
  dispatch,
}: {
  tool: SuggestEdit;
  editorState: EditorState;
  dispatch: (action: EditorAction) => void;
}) {
  const groups = getSuggestionGroups(editorState.state);
  return (
    <div className="border-b px-4 py-1 text-xs text-gray-600">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded border px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50"
          disabled={tool.busy}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the editor's selection
            tool.run();
          }}
        >
          Suggest edit (proposals demo)
        </button>
        <span>{tool.status}</span>
      </div>
      {groups.length > 0 && (
        <ul className="mt-1 space-y-1">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <span className="font-medium">{String(g.metadata?.source ?? g.author)}</span>
              <span className="truncate text-gray-500">
                {typeof g.metadata?.reason === "string" ? g.metadata.reason : `${g.suggestions.length} change(s)`}
              </span>
              <button
                type="button"
                className="rounded border px-1.5 hover:bg-green-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  dispatch({ type: "ACCEPT_SUGGESTION_GROUP", groupId: g.id });
                }}
              >
                Accept
              </button>
              <button
                type="button"
                className="rounded border px-1.5 hover:bg-red-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  dispatch({ type: "REJECT_SUGGESTION_GROUP", groupId: g.id });
                }}
              >
                Reject
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
