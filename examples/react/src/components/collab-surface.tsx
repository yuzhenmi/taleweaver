import { useEffect, useRef, useState } from "react";
import { EditorView, type EditorViewHandle } from "@taleweaver/react";
import {
  createEmptyDocument,
  reduceEditor,
  createEditorStateFromState,
  initialSelectionForState,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  type EditorConfig,
  type State,
  type Position,
} from "@taleweaver/core";
import { useCollabEditor } from "../use-collab-editor";

const PAGE_HEIGHT = 1056; // US Letter at 96 DPI
const PAGE_GAP = 24;

/** Generic peer colours, cycled by peer index via `peerColor`. */
const PEER_COLORS = ["#e8453c", "#1a73e8", "#34a853", "#a142f4", "#f29900", "#12b5cb"];

/** The colour for peer `index`, cycling through `PEER_COLORS`. */
function peerColor(index: number): string {
  return PEER_COLORS[index % PEER_COLORS.length] ?? "#5f6368";
}

/**
 * The COLLABORATION surface: two print editors side-by-side bound to ONE shared
 * Y.Doc. Typing in one pane appears live in the other — no transport, purely the
 * engine's in-process collab seams (origin-tagged transactions + foreign-change
 * observe → reconcile). Each pane also shows the OTHER peer's live cursor as a
 * coloured caret (via the controller's `getCaretRect` query), the demo of true
 * multi-peer presence.
 *
 * The deferred rough edge is same-block concurrent caret drift (selection
 * rebasing is a future feature), noted in the banner so it doesn't read as a bug.
 */
export function CollabSurface({
  seed,
  registerGetState,
}: {
  seed: State | null;
  registerGetState: (getState: () => State) => void;
}) {
  // The ONE shared seed State (over the shared Y.Doc) both panes bind to. Built
  // once: from the handed-off document if a tab switch carried one, else a small
  // fresh starter doc. A `State` wraps a Y.Doc, so handing the SAME seed to both
  // `useCollabEditor` calls puts both panes on the same CRDT.
  const sharedSeedRef = useRef<State | null>(null);
  if (sharedSeedRef.current === null) {
    sharedSeedRef.current = seed ?? makeStarterDoc();
  }
  const sharedSeed = sharedSeedRef.current;

  const paneA = useCollabEditor(sharedSeed, "collab-peer-a");
  const paneB = useCollabEditor(sharedSeed, "collab-peer-b");

  // Hand off pane A's live document on a tab switch (either pane's state reads
  // the same shared doc, so A is an arbitrary-but-fine choice).
  const latestStateA = useRef(paneA.editorState.state);
  latestStateA.current = paneA.editorState.state;
  useEffect(() => {
    registerGetState(() => latestStateA.current);
  }, [registerGetState]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-[#f9fbfd]">
      <div className="border-b border-[#e0e0e0] bg-[#fff8e1] px-4 py-1.5 text-xs text-[#7a5c00]">
        Two editors, one shared CRDT document — type in either pane and watch it sync live, each peer's cursor shown in
        its colour. (Concurrent edits to the same line may drift the caret; selection-rebasing is a planned follow-up.)
      </div>
      <div className="flex flex-1 overflow-hidden">
        <CollabPane
          label="Peer A"
          pane={paneA}
          remoteCaret={paneB.editorState.selection.focus}
          remoteColor={peerColor(1)}
          remoteLabel="Peer B"
        />
        <div className="w-px bg-[#e0e0e0]" />
        <CollabPane
          label="Peer B"
          pane={paneB}
          remoteCaret={paneA.editorState.selection.focus}
          remoteColor={peerColor(0)}
          remoteLabel="Peer A"
        />
      </div>
    </div>
  );
}

function CollabPane({
  label,
  pane,
  remoteCaret,
  remoteColor,
  remoteLabel,
}: {
  label: string;
  pane: ReturnType<typeof useCollabEditor>;
  remoteCaret: Position;
  remoteColor: string;
  remoteLabel: string;
}) {
  const viewRef = useRef<EditorViewHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="px-4 py-1 text-xs font-medium text-[#5f6368] border-b border-[#eee] bg-white">{label}</div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto mt-4 mb-12" style={{ width: 816 }}>
          <EditorView {...pane} ref={viewRef} pageHeight={PAGE_HEIGHT} pageGap={PAGE_GAP} />
        </div>
      </div>
      <RemoteCursor
        viewRef={viewRef}
        scrollRef={scrollRef}
        position={remoteCaret}
        color={remoteColor}
        label={remoteLabel}
      />
    </div>
  );
}

/**
 * A single peer's remote cursor overlaid on THIS pane: a thin coloured caret bar
 * plus a name flag, positioned via the controller's `getCaretRect` (viewport
 * coords → `position: fixed`). Recomputes after every render frame (so it tracks
 * the peer moving AND this pane's own re-layout), and on this pane's scroll +
 * window resize. The rAF defers the read until the controller's `update()` has
 * applied the latest layout for the frame.
 */
function RemoteCursor({
  viewRef,
  scrollRef,
  position,
  color,
  label,
}: {
  viewRef: React.RefObject<EditorViewHandle | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  position: Position;
  color: string;
  label: string;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; height: number } | null>(null);

  useEffect(() => {
    const recompute = () => setRect(viewRef.current?.getCaretRect(position) ?? null);
    const raf = requestAnimationFrame(recompute);
    const sp = scrollRef.current;
    sp?.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(raf);
      sp?.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [position, viewRef, scrollRef]);

  if (rect === null) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        height: rect.height,
        width: 2,
        background: color,
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: -13,
          left: 0,
          fontSize: 9,
          lineHeight: "12px",
          padding: "0 3px",
          color: "white",
          background: color,
          borderRadius: 2,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** A small fresh document so the collab demo opens with editable content. */
function makeStarterDoc(): State {
  const config: EditorConfig = {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 600,
  };
  const empty = createEmptyDocument();
  let editor = createEditorStateFromState(empty, initialSelectionForState(empty), config);
  editor = reduceEditor(
    editor,
    { type: "INSERT_TEXT", text: "Type here — your edits sync to the other pane live." },
    config,
  );
  // Only the seed `State` survives; release this throwaway editor's History so
  // its Y.UndoManager listener doesn't leak on the shared doc the panes will use.
  editor.history.destroy();
  return editor.state;
}
