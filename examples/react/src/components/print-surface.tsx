import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, type EditorViewHandle } from "@taleweaver/react";
import { setPerfTraceEnabled, report, resetPerfTrace, type Decoration, type State } from "@taleweaver/core";
import { usePerfEditor } from "../use-perf-editor";
import { EditorChrome } from "./editor-chrome";
import { FindBar, useFindShortcut } from "./find-bar";
import { useWritingAids, WritingAidPopover, WritingAidsToggle, type AidPointerEvent } from "./writing-aids";

const PAGE_HEIGHT = 1056; // US Letter at 96 DPI
const PAGE_GAP = 24;

/**
 * The PRINT editing surface: the `@taleweaver/print` canvas backend (paginated
 * geometry computed in-engine). Owns its own chrome + find-bar (find/replace is
 * print-geometry-specific). Exposes its live `State` via `registerGetState` so
 * the tab-bar can hand the document off on switch.
 */
export function PrintSurface({
  seed,
  registerGetState,
}: {
  seed: State | null;
  registerGetState: (getState: () => State) => void;
}) {
  const editor = usePerfEditor(seed ?? undefined);
  const viewRef = useRef<EditorViewHandle>(null);
  const [findMode, setFindMode] = useState<null | "find" | "replace">(null);
  // Same writing-aids decoration demo as the digital tab.
  const [aids, setAids] = useState(true);
  const [aidResult, setAidResult] = useState<{ decorations: readonly Decoration[]; basedOn: State | undefined }>({
    decorations: [],
    basedOn: undefined,
  });
  const setDecorations = useCallback(
    (decorations: readonly Decoration[], basedOn: State) => setAidResult({ decorations, basedOn }),
    [],
  );
  const [pointer, setPointer] = useState<AidPointerEvent | null>(null);
  useWritingAids(aids, editor.editorState, setDecorations);

  // Register the live-state getter for the tab-bar hand-off (stable across renders).
  useEffect(() => {
    registerGetState(editor.getState);
  }, [registerGetState, editor.getState]);

  // Perf-fixture dev hooks (print-only): when ?perfFixture=N seeded a synthetic
  // document, enable tracing and expose console report/reset helpers.
  useEffect(() => {
    if (!editor.isPerfFixture) return;
    setPerfTraceEnabled(true);
    const w = window as unknown as { __perfReport: () => unknown; __perfReset: () => void };
    w.__perfReport = () => {
      const r = report();
      console.table(r.entries);
      return r;
    };
    w.__perfReset = () => {
      resetPerfTrace();
      console.log("Perf trace reset");
    };
  }, [editor.isPerfFixture]);

  useFindShortcut(setFindMode);

  return (
    <>
      <EditorChrome dispatch={editor.dispatch} editorState={editor.editorState} focus={editor.focus} />
      <WritingAidsToggle checked={aids} onChange={setAids} />
      <div className="relative flex-1 overflow-y-auto bg-[#f9fbfd]">
        {findMode && viewRef.current && (
          <FindBar
            handle={viewRef.current}
            mode={findMode}
            editorState={editor.editorState}
            onClose={() => {
              setFindMode(null);
              editor.focus();
            }}
          />
        )}
        <div className="mx-auto mt-4 mb-12" style={{ width: 816 }}>
          <EditorView
            {...editor}
            ref={viewRef}
            pageHeight={PAGE_HEIGHT}
            pageGap={PAGE_GAP}
            decorations={aidResult.decorations}
            decorationsBasedOn={aidResult.basedOn}
            onDecorationPointer={setPointer}
          />
        </div>
      </div>
      <WritingAidPopover event={pointer} />
    </>
  );
}
