import {
  Profiler,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ProfilerOnRenderCallback,
} from "react";
import {
  type TextShaper,
  type TextMeasurer,
  type Editor,
  type FindMatchesOptions,
  type Hyphenator,
  type Position,
  type Decoration,
  type Document,
  type Anchor,
  type AnchorOptions,
  type Assoc,
  type MappedPosition,
  type Proposal,
  type ProposeResult,
  type SuggestionGroupStyle,
  type IncompatibleDocumentReport,
  markStart,
  markEnd,
  recordSample,
  isPerfTraceEnabled,
  inspectDocument,
  getYDoc,
} from "@taleweaver/core";
import { haltLinkOf } from "./use-editor";
import {
  createEditorController,
  type EditorController,
  type FindStatus,
  type CaretViewportRect,
  type PrintDecorationPointerEvent,
} from "@taleweaver/print";

export interface EditorViewProps {
  /**
   * The editor shown. The view's controller subscribes to it (re-rendering after every
   * dispatch) and its input dispatches to it; another `editor` is a document replacement.
   */
  editor: Editor;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper | TextMeasurer;
  pageHeight?: number;
  pageGap?: number;
  /**
   * Auto-hyphenation: print mechanics, not part of core's `EditorConfig`. `undefined` ⇒
   * no hyphenation. (Page setup, the registries and the host keymap come from
   * `editor.config` — the config the reducer runs with.)
   */
  hyphenator?: Hyphenator;
  /**
   * View-only host decorations (see core `Decoration`). Applied to the document version
   * they were computed against; the controller keeps them mapped through later edits
   * until this prop changes.
   */
  decorations?: readonly Decoration[];
  /**
   * The document `Document` `decorations` were computed against (default: the current one).
   * Pass it when decorations are computed asynchronously: the controller maps them through
   * the edits made since, or drops them when that Document is too old to map.
   */
  decorationsBasedOn?: Document;
  /** Hover / click on decorated content (built-in highlights included). */
  onDecorationPointer?: (event: PrintDecorationPointerEvent) => void;
  /**
   * Collaboration: whether this view's controller applies peer updates landing in the
   * document's Y.Doc (default `"observe"`). Exactly one view per document observes;
   * others pass `"ignore"`. Read at mount.
   */
  remoteChanges?: "observe" | "ignore";
  /**
   * Host per-group styling of suggestions (e.g. per `metadata.source`), kept live by the
   * controller through proposals, accept / reject and undo. Pass a stable function.
   */
  suggestionStyles?: SuggestionGroupStyle | null;
  /**
   * The controller halted on incompatible (legacy) document storage in a peer update
   * (see the print controller's `onIncompatibleDocument`). A `useEditor` hook whose
   * `editor` this view shows is told AUTOMATICALLY; this prop is for other hosts, or extra
   * observers.
   */
  onIncompatibleDocument?: (report: IncompatibleDocumentReport) => void;
}

/**
 * The imperative API a parent gets via `ref`. Delegates the controller's
 * find-session + replace methods so a find-bar (held in the parent) can drive
 * find/replace without reaching into the encapsulated controller. Each method
 * reads `controllerRef.current` lazily; before mount (controller still null) the
 * status-returning ones return the empty `{ total: 0, activeIndex: -1 }` and
 * `findClose` is a no-op.
 */
export interface EditorViewHandle {
  findStart(query: string, options?: FindMatchesOptions): FindStatus;
  findNext(): FindStatus;
  findPrev(): FindStatus;
  findClose(): void;
  replaceActive(replacement: string): FindStatus;
  replaceAll(replacement: string): FindStatus;
  findStatus(): FindStatus;
  /**
   * Resolve a document `Position` to its caret's viewport-relative pixel rect
   * (CSS `position: fixed` space), or `null` before mount / when unresolvable.
   * Delegates to the controller's `getCaretRect`; used to overlay
   * position-anchored UI such as a collaborator's remote cursor.
   */
  getCaretRect(position: Position): CaretViewportRect | null;
  /** The controller's current document version (null before mount). */
  version(): Document | null;
  /** Map a position from an older version (null when aged out / before mount). */
  mapPosition(position: Position, version: Document, assoc?: Assoc): MappedPosition | null;
  /** Anchor a point / range that follows every later edit (null before mount / unmappable). */
  createAnchor(from: Position, to?: Position, options?: AnchorOptions & { readonly basedOn?: Document }): Anchor | null;
  /** Offer a proposal as one suggestion group; resolves with the reducer's verdict (see the print controller's `propose`). */
  propose(proposal: Proposal, options?: { readonly basedOn?: Document }): Promise<ProposeResult>;
}

const EMPTY_FIND_STATUS: FindStatus = { total: 0, activeIndex: -1 };

const handleProfile: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!isPerfTraceEnabled()) return;
  recordSample(`react.render.${id}`, actualDuration);
};

export const EditorView = forwardRef<EditorViewHandle, EditorViewProps>(
  function EditorView(
    { editor, containerRef, measurer, pageHeight, pageGap, hyphenator, decorations, decorationsBasedOn, onDecorationPointer, remoteChanges, suggestionStyles, onIncompatibleDocument },
    ref,
  ) {
  const controllerRef = useRef<EditorController | null>(null);
  // Latest pointer callback, read through a ref so the mount-only controller sees updates.
  const pointerRef = useRef(onDecorationPointer);
  pointerRef.current = onDecorationPointer;
  const incompatibleRef = useRef(onIncompatibleDocument);
  incompatibleRef.current = onIncompatibleDocument;

  // Imperative handle: delegate the controller's find/replace methods.
  // Each closure reads `controllerRef.current` lazily (at call time, not capture
  // time), so the stable `[]` deps are correct — the ref is mutated in the
  // mount effect after the controller is created. Null-guard returns the empty
  // status (pre-mount) / no-ops `findClose`.
  useImperativeHandle(
    ref,
    () => ({
      findStart: (query, options) =>
        controllerRef.current?.findStart(query, options) ?? EMPTY_FIND_STATUS,
      findNext: () => controllerRef.current?.findNext() ?? EMPTY_FIND_STATUS,
      findPrev: () => controllerRef.current?.findPrev() ?? EMPTY_FIND_STATUS,
      findClose: () => {
        controllerRef.current?.findClose();
      },
      replaceActive: (replacement) =>
        controllerRef.current?.replaceActive(replacement) ?? EMPTY_FIND_STATUS,
      replaceAll: (replacement) =>
        controllerRef.current?.replaceAll(replacement) ?? EMPTY_FIND_STATUS,
      findStatus: () => controllerRef.current?.findStatus() ?? EMPTY_FIND_STATUS,
      getCaretRect: (position) => controllerRef.current?.getCaretRect(position) ?? null,
      version: () => controllerRef.current?.version ?? null,
      mapPosition: (position, version, assoc) => controllerRef.current?.mapPosition(position, version, assoc) ?? null,
      createAnchor: (from, to, options) => controllerRef.current?.createAnchor(from, to, options) ?? null,
      propose: (proposal, options) =>
        controllerRef.current?.propose(proposal, options) ??
        Promise.resolve({ ok: false, reason: "rejected", problem: { kind: "invalid", message: "not mounted" } }),
    }),
    [],
  );

  // The `useEditor` hook that created this editor (if any).
  const link = haltLinkOf(editor);
  const decorationsRef = useRef({ decorations, decorationsBasedOn, suggestionStyles });
  decorationsRef.current = { decorations, decorationsBasedOn, suggestionStyles };

  /** The controller halted: tell the linked hook and the `onIncompatibleDocument` prop. */
  function reportIncompatible(report: IncompatibleDocumentReport): void {
    link?.onIncompatibleDocument(report);
    incompatibleRef.current?.(report);
  }

  /** Hand the editor to the controller — never a halted hook's; re-apply props on resume. */
  function show(ctrl: EditorController, next: Editor): void {
    if (link?.halted() === true) return;
    const wasHalted = ctrl.halted;
    ctrl.setEditor(next);
    // The controller is the source of truth: a replacement it refused (legacy storage
    // still / again) halts the hook again.
    if (ctrl.halted && link !== undefined && !link.halted()) {
      reportIncompatible({ reason: "legacy-schema", legacyBlocks: inspectDocument(getYDoc(next.document)).legacyBlocks, legacyText: {} });
    } else if (wasHalted && !ctrl.halted) {
      // A resume replaced the document and dropped every layer: set this view's again.
      const props = decorationsRef.current;
      ctrl.setSuggestionStyles(props.suggestionStyles ?? null);
      ctrl.setDecorations(props.decorations ?? [], props.decorationsBasedOn);
    }
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ctrl = createEditorController(el, {
      measurer,
      editor,
      pageHeight,
      pageGap,
      hyphenator,
      ...(remoteChanges !== undefined ? { remoteChanges } : {}),
      onDecorationPointer: (event) => pointerRef.current?.(event),
      onIncompatibleDocument: reportIncompatible,
      onDocumentCompatible: () => link?.onDocumentCompatible(),
      // Re-created while the hook is halted: start halted (watching the document).
      ...(link?.halted() === true ? { startHalted: true } : {}),
    });
    controllerRef.current = ctrl;
    return () => ctrl.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  // Another editor (a document replacement): hand it over. Edits reach the controller
  // through its own subscription, not through React.
  useEffect(() => {
    const t = markStart("react.subscribe.notify");
    try {
      const ctrl = controllerRef.current;
      if (ctrl !== null) show(ctrl, editor);
    } finally {
      markEnd("react.subscribe.notify", t);
    }
  }, [editor]);

  useEffect(() => {
    controllerRef.current?.setSuggestionStyles(suggestionStyles ?? null);
  }, [suggestionStyles]);

  // After the editor hand-over above, so decorations land on the document they were computed for.
  useEffect(() => {
    controllerRef.current?.setDecorations(decorations ?? [], decorationsBasedOn);
  }, [decorations, decorationsBasedOn]);

  return (
    <Profiler id="EditorView" onRender={handleProfile}>
      <div ref={containerRef} />
    </Profiler>
  );
  },
);
