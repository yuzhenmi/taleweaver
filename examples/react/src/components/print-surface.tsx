import { useEffect, useRef, useState } from "react";
import { EditorView, type EditorViewHandle } from "@taleweaver/react";
import { setPerfTraceEnabled, report, resetPerfTrace, type State } from "@taleweaver/core";
import { usePerfEditor } from "../use-perf-editor";
import { EditorChrome } from "./editor-chrome";
import { FindBar } from "./find-bar";

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

  // Ctrl/Cmd+F → find; Ctrl/Cmd+H → replace (find/replace is print-only in v1).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        e.preventDefault();
        setFindMode("find");
      } else if (key === "h") {
        e.preventDefault();
        setFindMode("replace");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <EditorChrome dispatch={editor.dispatch} editorState={editor.editorState} focus={editor.focus} />
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
          <EditorView {...editor} ref={viewRef} pageHeight={PAGE_HEIGHT} pageGap={PAGE_GAP} />
        </div>
      </div>
    </>
  );
}
