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
  type EditorAction,
  type EditorState,
  type FindMatchesOptions,
  type PageConfig,
  type Hyphenator,
  type Position,
  type Decoration,
  type State,
  type EditorConfig,
  type Anchor,
  type AnchorOptions,
  type Assoc,
  type MappedPosition,
  type Proposal,
  type ProposeResult,
  type SuggestionGroupStyle,
  markStart,
  markEnd,
  recordSample,
  isPerfTraceEnabled,
} from "@taleweaver/core";
import {
  createEditorController,
  type EditorController,
  type FindStatus,
  type CaretViewportRect,
  type PrintDecorationPointerEvent,
} from "@taleweaver/print";

export interface EditorViewProps {
  editorState: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  measurer: TextShaper | TextMeasurer;
  pageHeight?: number;
  pageGap?: number;
  /**
   * Phase 0b: page setup + auto-hyphenation moved out of core's `EditorConfig`
   * into the controller. The host (e.g. the perf example) threads them through
   * here so the layout-driver paginates / hyphenates. `undefined` ⇒ unpaginated
   * / no hyphenation (the common-path host default).
   */
  pageConfig?: PageConfig;
  hyphenator?: Hyphenator;
  /**
   * View-only host decorations (see core `Decoration`). Applied after the editor state
   * they were computed against; the controller keeps them mapped through later edits
   * until this prop changes.
   */
  decorations?: readonly Decoration[];
  /**
   * The document `State` `decorations` were computed against (default: the current one).
   * Pass it when decorations are computed asynchronously: the controller maps them through
   * the edits made since, or drops them when that State is too old to map.
   */
  decorationsBasedOn?: State;
  /** Hover / click on decorated content (built-in highlights included). */
  onDecorationPointer?: (event: PrintDecorationPointerEvent) => void;
  /**
   * The host's core `EditorConfig` — the SAME object the reducer runs with — so the
   * print controller renders, hit-tests and copies with exactly the registries
   * editing uses (host marks paint via their `toStyle`) and consults the host
   * keymap (`extensions`). `useEditor` returns it,
   * so spreading the hook result passes it. Default: the built-in registries.
   * Read at mount.
   */
  config?: Pick<EditorConfig, "componentRegistry" | "attrRegistry" | "extensions">;
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
}

/**
 * The imperative API a parent gets via `ref` (#433). Delegates the controller's
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
  version(): State | null;
  /** Map a position from an older version (null when aged out / before mount). */
  mapPosition(position: Position, version: State, assoc?: Assoc): MappedPosition | null;
  /** Anchor a point / range that follows every later edit (null before mount / unmappable). */
  createAnchor(from: Position, to?: Position, options?: AnchorOptions & { readonly basedOn?: State }): Anchor | null;
  /** Offer a proposal as one suggestion group; resolves with the reducer's verdict (see the print controller's `propose`). */
  propose(proposal: Proposal, options?: { readonly basedOn?: State }): Promise<ProposeResult>;
}

const EMPTY_FIND_STATUS: FindStatus = { total: 0, activeIndex: -1 };

const handleProfile: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!isPerfTraceEnabled()) return;
  recordSample(`react.render.${id}`, actualDuration);
};

export const EditorView = forwardRef<EditorViewHandle, EditorViewProps>(
  function EditorView(
    { editorState, dispatch, containerRef, measurer, pageHeight, pageGap, pageConfig, hyphenator, decorations, decorationsBasedOn, onDecorationPointer, config, remoteChanges, suggestionStyles },
    ref,
  ) {
  const controllerRef = useRef<EditorController | null>(null);
  // Latest pointer callback, read through a ref so the mount-only controller sees updates.
  const pointerRef = useRef(onDecorationPointer);
  pointerRef.current = onDecorationPointer;

  // Imperative handle (#433): delegate the controller's find/replace methods.
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ctrl = createEditorController(el, {
      measurer,
      dispatch,
      pageHeight,
      pageGap,
      pageConfig,
      hyphenator,
      ...(config !== undefined ? { config } : {}),
      ...(remoteChanges !== undefined ? { remoteChanges } : {}),
      onDecorationPointer: (event) => pointerRef.current?.(event),
    });
    controllerRef.current = ctrl;
    ctrl.update(editorState);
    return () => ctrl.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only

  useEffect(() => {
    const t = markStart("react.subscribe.notify");
    try {
      controllerRef.current?.update(editorState);
    } finally {
      markEnd("react.subscribe.notify", t);
    }
  }, [editorState]);

  useEffect(() => {
    controllerRef.current?.setSuggestionStyles(suggestionStyles ?? null);
  }, [suggestionStyles]);

  // After the state update above, so decorations land on the state they were computed for.
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
