import { useEffect, useRef, useState, type Dispatch } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  asBlockId,
  createPosition,
  createSpan,
  getBlock,
  inlineContentLength,
  type BlockId,
  type EditorAction,
  type EditorState,
  type State,
} from "@taleweaver/core";

const HANDLE_GAP = 8; // gap between the handle cluster and the block's content edge
const MENU_GAP = 4; // gap between an icon and the menu it opens

/**
 * A block-type choice, shared by BOTH the "change type" (edit ✎) and "insert
 * below" (+) menus. `apply` dispatches the type-setting action(s) for the block
 * that is currently the editor's FOCUS — so the caller positions the selection
 * first (into the hovered block for ✎, into the freshly-split new block for +).
 */
interface BlockChoice {
  label: string;
  apply: (dispatch: Dispatch<EditorAction>) => void;
}

const BLOCK_CHOICES: readonly BlockChoice[] = [
  { label: "Text", apply: (d) => d({ type: "SET_BLOCK_TYPE", blockType: "paragraph" }) },
  { label: "Heading 1", apply: (d) => d({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } }) },
  { label: "Heading 2", apply: (d) => d({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } }) },
  { label: "Heading 3", apply: (d) => d({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 3 } }) },
  { label: "Bulleted list", apply: (d) => d({ type: "TOGGLE_LIST", listType: "unordered" }) },
  { label: "Numbered list", apply: (d) => d({ type: "TOGGLE_LIST", listType: "ordered" }) },
];

/**
 * Which handle's menu is open, the clicked icon's rect to anchor it under, and the
 * block the menu targets. `blockId` is PINNED at menu-open time (not read from the
 * live `hovered` at item-click time) so a background re-render or scroll-reflow that
 * advances `hovered` can't retarget an open menu onto a different block.
 */
type OpenMenu = { kind: "type" | "insert"; iconRect: DOMRect; blockId: BlockId };

/** The block under the cursor: its id and a fresh viewport rect (refreshed on scroll). */
type Hovered = { id: BlockId; rect: DOMRect };

/** A leaf text block (paragraph/heading/list-item) carries `inlineContent`; container
 *  blocks (a list/table wrapper) do not. Handles only target leaf text blocks. */
function leafTextBlockRect(state: State, el: HTMLElement): Hovered | null {
  const raw = el.getAttribute("data-block-id");
  if (raw === null) return null;
  const id = asBlockId(raw);
  const block = getBlock(state, id);
  // A leaf text block carries `inlineContent` (an empty paragraph still has the
  // object, just `items: []`); container blocks (list/table wrappers) do not.
  if (!block || !block.inlineContent) return null;
  return { id, rect: el.getBoundingClientRect() };
}

/** End-of-block caret offset (one past the last inline unit). 0 for an empty block. */
function blockEndOffset(state: State, id: BlockId): number {
  const block = getBlock(state, id);
  return block && block.inlineContent ? inlineContentLength(block.inlineContent) : 0;
}

/**
 * The leaf text block whose vertical extent contains `clientY` (Notion-style gutter
 * capture: hovering anywhere in the left band — not just over the text — reveals that
 * block's handles). Scans block elements in document order; the leaf-only filter
 * (`leafTextBlockRect`) skips a list/table CONTAINER whose box also spans `clientY`,
 * so the contained list-item/paragraph wins. Returns `null` between blocks.
 */
function blockAtY(wrapper: HTMLElement, state: State, clientY: number): Hovered | null {
  for (const el of wrapper.querySelectorAll("[data-block-id]")) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) continue;
    const h = leafTextBlockRect(state, el);
    if (h !== null) return h;
  }
  return null;
}

/**
 * Notion-style per-block hover handles (digital editor): hovering a block reveals,
 * in the left margin gutter, a ✎ (change block type) and a + (insert a block below)
 * icon. Each opens a block-type menu. The handles compose existing editor actions —
 * no engine change:
 *   - ✎ change type: move the selection into the hovered block, then dispatch the
 *     type action (SET_BLOCK_TYPE / TOGGLE_LIST) — which retypes the focus block.
 *   - + insert below: move the selection to the END of the hovered block, SPLIT_NODE
 *     (creates an empty next sibling with the caret in it — the same path Enter
 *     takes), then apply the chosen type to that NEW focus block.
 *
 * Hover tracking listens on the editor's full-width scroll wrapper (the handles sit
 * in its left margin, so moving onto them never leaves the wrapper). The WHOLE left
 * band — from the editor's left edge up to the content column's right edge — captures
 * hover (Notion-style), resolving the target block by the pointer's vertical position
 * via `blockAtY` (so you don't have to hover the block's text). The hover is sticky in
 * inter-block gaps and clears only when the pointer leaves the wrapper (and no menu is
 * open). Step 3 of the digital Notion direction (block-level affordances).
 */
export function BlockHoverHandles({
  dispatch,
  editorState,
  containerRef,
  focus,
}: {
  dispatch: Dispatch<EditorAction>;
  editorState: EditorState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  focus: () => void;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // The handle cluster is a `position:fixed` DOM SIBLING of the scroll wrapper (not
  // a child), so moving the pointer onto the buttons fires the wrapper's mouseleave.
  // This ref lets that handler tell "left the editor" from "moved onto the handles".
  const clusterRef = useRef<HTMLDivElement>(null);

  // Live refs for the window/wrapper listeners (which close over a stale render).
  const stateRef = useRef<State>(editorState.state);
  stateRef.current = editorState.state;
  const hoveredRef = useRef<Hovered | null>(hovered);
  hoveredRef.current = hovered;
  const menuOpenRef = useRef<boolean>(menu !== null);
  menuOpenRef.current = menu !== null;

  // Hover tracking on the full-width scroll wrapper (containerRef's parent). The
  // handle cluster is a fixed-positioned DOM SIBLING of the wrapper (not a child),
  // so moving onto it DOES fire the wrapper's mouseleave — `onLeave` + the cluster's
  // own `onMouseLeave` cooperate (via `relatedTarget`) to keep the handles alive
  // while the pointer is on them, clearing only when it leaves the editor entirely.
  useEffect(() => {
    const wrapper = containerRef.current?.parentElement ?? null;
    if (wrapper === null) return;

    const onMove = (e: MouseEvent): void => {
      if (menuOpenRef.current) return; // freeze the target while a menu is open
      const container = containerRef.current;
      if (container === null) return;
      // Notion-style gutter capture: the WHOLE left band — from the editor's left
      // edge up to the content column's right edge — reveals a block's handles,
      // resolved by the pointer's vertical position. (Just being over the text is
      // not required; that clunky "hover the block itself" trigger is the bug.)
      // The right margin (clientX past the column) is the inline-menu's zone, so
      // leave the hover sticky there rather than retargeting.
      const cRect = container.getBoundingClientRect();
      if (e.clientX > cRect.right) return;
      const next = blockAtY(wrapper, stateRef.current, e.clientY);
      // A real block at this Y → reveal its handles; between blocks keep the current
      // target (sticky) so the handles don't flicker in inter-block gaps.
      if (next !== null) setHovered(next);
    };
    const onLeave = (e: MouseEvent): void => {
      if (menuOpenRef.current) return;
      // The handle cluster is a fixed-positioned sibling of the wrapper, so moving
      // the pointer from the gutter onto the buttons fires THIS mouseleave. Keep the
      // handles alive in that case (relatedTarget = a node inside the cluster) — else
      // they'd vanish the instant you reach for them.
      const to = e.relatedTarget;
      if (to instanceof Node && clusterRef.current?.contains(to) === true) return;
      setHovered(null);
    };
    // Keep the handle rect aligned to the block as the editor scrolls/resizes.
    const onReflow = (): void => {
      const h = hoveredRef.current;
      if (h === null) return;
      const el = wrapper.querySelector(`[data-block-id="${CSS.escape(h.id)}"]`);
      if (el instanceof HTMLElement) setHovered({ id: h.id, rect: el.getBoundingClientRect() });
      else setHovered(null);
    };

    wrapper.addEventListener("mousemove", onMove);
    wrapper.addEventListener("mouseleave", onLeave);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      wrapper.removeEventListener("mousemove", onMove);
      wrapper.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [containerRef]);

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (menu === null) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-block-handles]") !== null) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (hovered === null) return null;

  // Position the handle cluster in the left gutter, top-aligned to the block.
  const clusterStyle: React.CSSProperties = {
    position: "fixed",
    top: hovered.rect.top,
    // Two ~22px icons + a small gap ≈ 48px wide; sit it just left of the content.
    left: hovered.rect.left - 48 - HANDLE_GAP,
    zIndex: 50,
  };

  const choose = (choice: BlockChoice): void => {
    const open = menu;
    if (open === null) return;
    const id = open.blockId; // the block pinned when the menu opened
    focus(); // contenteditable must be focused for SET_SELECTION to reach the DOM
    if (open.kind === "type") {
      // Change the block's type: select into it, then retype the focus block.
      const at = createPosition(id, 0);
      dispatch({ type: "SET_SELECTION", selection: createSpan(at, at) });
      choice.apply(dispatch);
    } else {
      // Insert a block below: caret to the block end, split (new empty sibling with
      // the caret in it), then apply the chosen type to that new focus block.
      const end = createPosition(id, blockEndOffset(stateRef.current, id));
      dispatch({ type: "SET_SELECTION", selection: createSpan(end, end) });
      dispatch({ type: "SPLIT_NODE" });
      choice.apply(dispatch);
    }
    // Dismiss the menu AND the handles (Notion hides the gutter affordance on a
    // selection; the next mousemove re-reveals it for whatever block is hovered).
    setMenu(null);
    setHovered(null);
  };

  const iconBtn = (
    kind: OpenMenu["kind"],
    label: string,
    Icon: typeof Pencil,
  ) => (
    <button
      type="button"
      aria-label={label}
      // Don't let the click move focus out of the editor before our handler runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => setMenu({ kind, iconRect: e.currentTarget.getBoundingClientRect(), blockId: hovered.id })}
      className="flex h-[22px] w-[22px] items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
    >
      <Icon size={16} />
    </button>
  );

  return (
    <div
      ref={clusterRef}
      data-block-handles=""
      style={clusterStyle}
      className="flex items-center gap-0.5"
      // Leaving the cluster: keep the handles if the pointer went back into the editor
      // body (the wrapper's mousemove resumes tracking); clear only when it left the
      // editor entirely. Without this, the wrapper-mouseleave/cluster pair could strand
      // the handles after you move away.
      onMouseLeave={(e) => {
        if (menuOpenRef.current) return;
        const to = e.relatedTarget;
        const wrapper = containerRef.current?.parentElement ?? null;
        if (to instanceof Node && wrapper?.contains(to) === true) return;
        setHovered(null);
      }}
    >
      {iconBtn("type", "Change block type", Pencil)}
      {iconBtn("insert", "Insert block below", Plus)}
      {menu !== null && (
        <div
          role="menu"
          style={{
            position: "fixed",
            top: menu.iconRect.bottom + MENU_GAP,
            left: menu.iconRect.left,
            zIndex: 60,
          }}
          className="min-w-40 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl"
        >
          {BLOCK_CHOICES.map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(choice)}
              className="flex w-full items-center px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
