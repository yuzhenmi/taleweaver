import { useCallback, useEffect, useRef, useState } from "react";
import type { Anchor, Decoration, EditorState, Position } from "@taleweaver/core";

/**
 * Generic "async check" demo for anchors (shared by the print and digital tabs): the
 * button anchors the selected text, a simulated async job runs for 2 s while the user
 * keeps editing, then the result lands on the anchor's CURRENT range (a highlight) —
 * or is discarded when the text was changed or deleted meanwhile.
 */
const JOB_MS = 2000;
const SHOW_MS = 6000;

export interface AsyncCheck {
  status: string;
  /** Busy while the simulated job runs. */
  busy: boolean;
  run: () => void;
  /** The landed result as a decoration, from the anchor's live range. */
  decorations: () => readonly Decoration[];
}

export function useAsyncCheck(
  editorState: EditorState,
  createAnchor: (from: Position, to: Position) => Anchor | null,
): AsyncCheck {
  const [status, setStatus] = useState("Select some text, then run an async check.");
  const [busy, setBusy] = useState(false);
  const [landed, setLanded] = useState<Anchor | null>(null);
  const selection = editorState.selection;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const run = useCallback(() => {
    const { anchor: a, focus: f } = selection;
    if (a.blockId === f.blockId && a.offset === f.offset) {
      setStatus("Select some text first.");
      return;
    }
    const anchor = createAnchor(a, f);
    if (anchor === null) return;
    setBusy(true);
    setStatus("Checking… keep typing — the result lands where the text moves to.");
    timers.current.push(
      window.setTimeout(() => {
        setBusy(false);
        if (anchor.deleted) setStatus("Discarded: the checked text was deleted.");
        else if (anchor.changed) setStatus("Discarded: the checked text changed.");
        else {
          setStatus("Landed: highlighted at the text's current position.");
          setLanded((prev) => {
            prev?.dispose();
            return anchor;
          });
          timers.current.push(
            window.setTimeout(() => {
              setLanded((cur) => (cur === anchor ? null : cur));
              anchor.dispose();
            }, SHOW_MS),
          );
          return;
        }
        anchor.dispose();
      }, JOB_MS),
    );
  }, [selection, createAnchor]);

  const decorations = useCallback((): readonly Decoration[] => {
    const a = landed;
    if (a === null || a.deleted || a.disposed) return [];
    return [
      {
        kind: "inline",
        id: "async-check",
        from: a.from,
        to: a.to,
        style: { backgroundColor: "rgba(52, 168, 83, 0.25)" },
        data: { message: "Async check: no issues found" },
      },
    ];
  }, [landed]);

  return { status, busy, run, decorations };
}

/** The demo row (button + status), shared by both tabs. */
export function AsyncCheckBar({ check }: { check: AsyncCheck }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-1 text-xs text-gray-600">
      <button
        type="button"
        className="rounded border px-2 py-0.5 hover:bg-gray-50 disabled:opacity-50"
        disabled={check.busy}
        onMouseDown={(e) => {
          e.preventDefault(); // keep the editor's selection
          check.run();
        }}
      >
        Async check (anchors demo)
      </button>
      <span>{check.status}</span>
    </div>
  );
}
