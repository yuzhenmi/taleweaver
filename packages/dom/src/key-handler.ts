import type { EditorAction } from "@taleweaver/core";

/** Map a KeyboardEvent to an EditorAction, or null if unrecognized. */
export function mapKeyEvent(event: KeyboardEvent): EditorAction | null {
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
  const mod = ctrlKey || metaKey;

  // Undo / Redo
  if (mod && key === "z" && shiftKey) return { type: "REDO" };
  if (mod && key === "z") return { type: "UNDO" };
  if (ctrlKey && key === "y") return { type: "REDO" };

  // Select all
  if (mod && key === "a") return { type: "SELECT_ALL" };

  // Arrow keys (horizontal)
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const boundary = key === "ArrowLeft" ? "start" : "end";
    const direction = key === "ArrowLeft" ? "backward" : "forward";

    // Cmd+Arrow (Mac): line boundary — check metaKey before ctrlKey/altKey
    if (shiftKey && metaKey)
      return { type: "EXPAND_LINE_BOUNDARY", boundary };
    if (metaKey) return { type: "MOVE_LINE_BOUNDARY", boundary };

    if (shiftKey && (ctrlKey || altKey))
      return { type: "EXPAND_WORD", direction };
    if (shiftKey) return { type: "EXPAND_SELECTION", direction };
    if (ctrlKey || altKey) return { type: "MOVE_WORD", direction };
    return { type: "MOVE_CURSOR", direction };
  }

  // Arrow keys (vertical)
  if (key === "ArrowUp" || key === "ArrowDown") {
    const boundary = key === "ArrowUp" ? "start" : "end";
    const direction = key === "ArrowUp" ? "up" : "down";

    // Cmd+Arrow (Mac): document boundary — check metaKey before plain
    if (shiftKey && metaKey)
      return { type: "EXPAND_DOCUMENT_BOUNDARY", boundary };
    if (metaKey) return { type: "MOVE_DOCUMENT_BOUNDARY", boundary };

    if (shiftKey) return { type: "EXPAND_LINE", direction };
    return { type: "MOVE_LINE", direction };
  }

  // Home / End
  if (key === "Home" || key === "End") {
    const boundary = key === "Home" ? "start" : "end";
    if (shiftKey && ctrlKey)
      return { type: "EXPAND_DOCUMENT_BOUNDARY", boundary };
    if (ctrlKey) return { type: "MOVE_DOCUMENT_BOUNDARY", boundary };
    if (shiftKey) return { type: "EXPAND_LINE_BOUNDARY", boundary };
    return { type: "MOVE_LINE_BOUNDARY", boundary };
  }

  // Backspace — Cmd before Alt before plain
  if (key === "Backspace") {
    if (metaKey) return { type: "DELETE_LINE" };
    if (altKey || ctrlKey) return { type: "DELETE_WORD", direction: "backward" };
    return { type: "DELETE_BACKWARD" };
  }

  // Delete — modifier variants before plain
  if (key === "Delete") {
    if (altKey || ctrlKey) return { type: "DELETE_WORD", direction: "forward" };
    return { type: "DELETE_FORWARD" };
  }

  if (key === "Enter") return { type: "SPLIT_NODE" };

  // Text styling shortcuts
  if (mod && key === "b") return { type: "TOGGLE_STYLE", style: "bold" };
  if (mod && key === "i") return { type: "TOGGLE_STYLE", style: "italic" };
  if (mod && key === "u") return { type: "TOGGLE_STYLE", style: "underline" };

  return null;
}
